import { q, db } from './db.js';
import { decrypt } from './crypto.js';
import { NotionClient } from './notion.js';
import { GithubApp } from './githubApp.js';
import { GithubCommitter } from './commit.js';
import { syncOnce } from './sync.js';

const github = new GithubApp();

/** Marks a config as running. Returns null when another run already holds it. */
export async function claim(id) {
  const res = await q(
    `update sync_configs set status = 'running', last_message = 'Sync started', last_run_at = now(), updated_at = now()
     where id = $1 and status <> 'running' returning *`,
    [id]
  );
  return res.rows[0] || null;
}

async function loadState(configId) {
  const [pages, assets] = await Promise.all([
    q('select notion_page_id, path, content_hash, notion_last_edited from synced_pages where sync_config_id = $1', [configId]),
    q('select block_id, path, content_hash from synced_assets where sync_config_id = $1', [configId]),
  ]);
  return {
    pages: Object.fromEntries(pages.rows.map((r) => [r.notion_page_id, { path: r.path, hash: r.content_hash, edited: r.notion_last_edited }])),
    assets: Object.fromEntries(assets.rows.map((r) => [r.block_id, { path: r.path, hash: r.content_hash }])),
  };
}

async function saveState(configId, result) {
  const page = Object.entries(result.pages);
  const asset = Object.entries(result.assets);
  const client = await db().connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into synced_pages (sync_config_id, notion_page_id, path, content_hash, notion_last_edited)
       select $1, * from unnest($2::text[], $3::text[], $4::text[], $5::text[])
       on conflict (sync_config_id, notion_page_id)
       do update set path = excluded.path, content_hash = excluded.content_hash, notion_last_edited = excluded.notion_last_edited`,
      [configId, page.map((p) => p[0]), page.map((p) => p[1].path), page.map((p) => p[1].hash), page.map((p) => p[1].edited)]
    );
    await client.query('delete from synced_pages where sync_config_id = $1 and notion_page_id <> all($2::text[])', [configId, page.map((p) => p[0])]);
    await client.query(
      `insert into synced_assets (sync_config_id, block_id, path, content_hash)
       select $1, * from unnest($2::text[], $3::text[], $4::text[])
       on conflict (sync_config_id, block_id)
       do update set path = excluded.path, content_hash = excluded.content_hash`,
      [configId, asset.map((a) => a[0]), asset.map((a) => a[1].path), asset.map((a) => a[1].hash)]
    );
    await client.query('delete from synced_assets where sync_config_id = $1 and block_id <> all($2::text[])', [configId, asset.map((a) => a[0])]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

const finish = (id, status, message, success) =>
  q(
    `update sync_configs set status = $2, last_message = $3, updated_at = now(),
       last_synced_at = case when $4 then now() else last_synced_at end where id = $1`,
    [id, status, String(message).slice(0, 480), success]
  );

/** Runs one config that has already been claimed. Never throws: failures are saved on the config. */
export async function runClaimed(config) {
  try {
    const conn = (await q('select access_token_enc from notion_connections where id = $1', [config.notion_connection_id])).rows[0];
    const inst = (await q('select installation_id from github_installations where id = $1', [config.github_installation_id])).rows[0];
    if (!conn || !inst) throw new Error('This sync lost its Notion or GitHub connection. Reconnect and create it again.');

    const client = await github.installationClient(Number(inst.installation_id));
    const committer = new GithubCommitter(client, config.repo_full_name, config.branch);

    const result = await syncOnce({
      config,
      notion: new NotionClient(decrypt(conn.access_token_enc)),
      commit: (change) => committer.commit(change),
      state: await loadState(config.id),
      maxPages: Number(process.env.NOTIONSYNC_MAX_PAGES) || 500,
    });

    await saveState(config.id, result);
    await finish(config.id, 'ok', result.message, true);
  } catch (e) {
    await finish(config.id, 'failed', e.message || 'Sync failed.', false);
  }
}
