import crypto from 'node:crypto';
import { q } from './db.js';
import { UserFacingError, sendJson, redirect, readJson } from './http.js';
import { sign, verify, parseCookies, setCookie, clearCookie, currentUserId, safeEqual } from './session.js';
import { encrypt, decrypt } from './crypto.js';
import { NotionClient } from './notion.js';
import { GithubApp } from './githubApp.js';

const github = new GithubApp();
const GH_HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'repo-sync-for-notion' };

const appUrl = () => (process.env.APP_URL || '').replace(/\/$/, '');
const notionRedirectUri = () => process.env.NOTION_REDIRECT_URI || `${appUrl()}/api/auth/notion/callback`;

function requireUser(req) {
  const id = currentUserId(req);
  if (!id) throw new UserFacingError('Sign in required.', 401);
  return id;
}

function checkState(req, res, cookieName, given) {
  const saved = verify(parseCookies(req.headers.cookie)[cookieName]);
  clearCookie(res, cookieName);
  if (!saved || !given || !safeEqual(saved.s, given)) throw new UserFacingError('The sign-in expired. Please start again.', 403);
}

/** Starts the GitHub Actions workflow right away. Optional: without it, syncs start on the next scheduled run. */
async function dispatchWorkflow() {
  const { DISPATCH_TOKEN, DISPATCH_REPO } = process.env;
  if (!DISPATCH_TOKEN || !DISPATCH_REPO) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${DISPATCH_REPO}/actions/workflows/sync.yml/dispatches`, {
      method: 'POST',
      headers: { ...GH_HEADERS, Authorization: `Bearer ${DISPATCH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: process.env.DISPATCH_REF || 'main' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------- Notion sign-in ----------

async function notionStart({ res }) {
  const state = crypto.randomBytes(20).toString('hex');
  setCookie(res, 'rs_nstate', sign({ s: state }, 600));
  const params = new URLSearchParams({
    client_id: process.env.NOTION_CLIENT_ID || '',
    response_type: 'code',
    owner: 'user',
    redirect_uri: notionRedirectUri(),
    state,
  });
  redirect(res, `https://api.notion.com/v1/oauth/authorize?${params}`);
}

async function notionCallback({ req, res, url }) {
  if (url.searchParams.has('error')) return redirect(res, '/?error=cancelled');
  checkState(req, res, 'rs_nstate', url.searchParams.get('state'));

  const basic = Buffer.from(`${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`).toString('base64');
  const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: JSON.stringify({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: notionRedirectUri() }),
  });
  if (!tokenRes.ok) return redirect(res, '/?error=notion');
  const data = await tokenRes.json();

  // Nothing about the person is needed beyond their Notion ID and display name. No email is stored.
  const notionUserId = data.owner?.user?.id ?? data.bot_id;
  const name = data.owner?.user?.name ?? 'Notion user';
  const user = await q(
    `insert into users (notion_user_id, name) values ($1, $2)
     on conflict (notion_user_id) do update set name = excluded.name returning id`,
    [notionUserId, name]
  );
  const uid = user.rows[0].id;

  await q(
    `insert into notion_connections (user_id, workspace_id, workspace_name, bot_id, access_token_enc)
     values ($1, $2, $3, $4, $5)
     on conflict (user_id, workspace_id) do update
       set workspace_name = excluded.workspace_name, bot_id = excluded.bot_id,
           access_token_enc = excluded.access_token_enc, updated_at = now()`,
    [uid, data.workspace_id, data.workspace_name ?? null, data.bot_id ?? null, encrypt(data.access_token)]
  );

  const month = 60 * 60 * 24 * 30;
  setCookie(res, 'rs_session', sign({ uid }, month), { maxAge: month });
  redirect(res, '/dashboard');
}

async function logout({ res }) {
  clearCookie(res, 'rs_session');
  sendJson(res, 200, { ok: true });
}

// ---------- GitHub App ----------

async function githubStart({ req, res }) {
  requireUser(req);
  const state = crypto.randomBytes(20).toString('hex');
  setCookie(res, 'rs_gstate', sign({ s: state }, 900));
  redirect(res, `https://github.com/apps/${process.env.GITHUB_APP_SLUG}/installations/new?${new URLSearchParams({ state })}`);
}

async function githubCallback({ req, res, url }) {
  const uid = requireUser(req);
  checkState(req, res, 'rs_gstate', url.searchParams.get('state'));

  const installationId = Number(url.searchParams.get('installation_id'));
  const code = url.searchParams.get('code');
  if (!installationId || !code) return redirect(res, '/dashboard?error=github-code');

  // Prove the signed-in person really owns this installation before saving it.
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.GITHUB_APP_CLIENT_ID, client_secret: process.env.GITHUB_APP_CLIENT_SECRET, code }),
  });
  const token = (await tokenRes.json().catch(() => ({}))).access_token;
  if (!token) return redirect(res, '/dashboard?error=github-auth');

  const listRes = await fetch('https://api.github.com/user/installations?per_page=100', { headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` } });
  const installations = (await listRes.json().catch(() => ({}))).installations || [];
  const match = installations.find((i) => i.id === installationId);
  if (!match) return redirect(res, '/dashboard?error=github-owner');

  await q(
    `insert into github_installations (user_id, installation_id, account_login, account_type) values ($1, $2, $3, $4)
     on conflict (user_id, installation_id) do update set account_login = excluded.account_login, account_type = excluded.account_type`,
    [uid, installationId, match.account?.login ?? 'unknown', match.account?.type ?? null]
  );
  redirect(res, '/dashboard?status=github-connected');
}

async function githubRepos({ req, res, params }) {
  const uid = requireUser(req);
  const row = (await q('select installation_id from github_installations where id = $1 and user_id = $2', [params.id, uid])).rows[0];
  if (!row) throw new UserFacingError('GitHub account not found.', 404);
  sendJson(res, 200, await github.repositories(Number(row.installation_id)));
}

// ---------- Dashboard data ----------

async function me({ req, res }) {
  const uid = requireUser(req);
  const [user, connections, installations, configs] = await Promise.all([
    q('select name from users where id = $1', [uid]),
    q('select id, workspace_name from notion_connections where user_id = $1 order by id', [uid]),
    q('select id, account_login from github_installations where user_id = $1 order by id', [uid]),
    q(`select id, notion_root_title, repo_full_name, branch, target_dir, frequency, export_type, status, last_message, last_synced_at
       from sync_configs where user_id = $1 order by id desc`, [uid]),
  ]);
  sendJson(res, 200, {
    appName: process.env.NOTIONSYNC_APP_NAME || 'NotionPress',
    user: user.rows[0] ?? null,
    connections: connections.rows,
    installations: installations.rows,
    configs: configs.rows,
  });
}

async function notionPages({ req, res, url }) {
  const uid = requireUser(req);
  const row = (await q('select access_token_enc from notion_connections where id = $1 and user_id = $2', [Number(url.searchParams.get('connection')), uid])).rows[0];
  if (!row) throw new UserFacingError('Notion workspace not found.', 404);
  sendJson(res, 200, await new NotionClient(decrypt(row.access_token_enc)).searchPages());
}

// ---------- Syncs ----------

async function createSync({ req, res }) {
  const uid = requireUser(req);
  const b = await readJson(req);

  const connectionId = Number(b.notion_connection_id);
  const installationId = Number(b.github_installation_id);
  const pageId = String(b.notion_root_page_id || '');
  const repoName = String(b.repo_full_name || '');
  const branch = String(b.branch || '');
  const dir = String(b.target_dir || '').replace(/^\/+|\/+$/g, '');
  const frequency = String(b.frequency || 'manual');
  const exportType = String(b.export_type || 'html');

  if (!/^[0-9a-f-]{32,36}$/i.test(pageId)) throw new UserFacingError('Choose a Notion page.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repoName)) throw new UserFacingError('Choose a repository.');
  if (!/^[\w./-]{1,255}$/.test(branch)) throw new UserFacingError('Enter a valid branch name.');
  if (!/^[\w./-]*$/.test(dir) || dir.length > 200 || /(^|\/)\.{1,2}(\/|$)/.test(dir) || /(^|\/)\.git(\/|$)/i.test(dir)) {
    throw new UserFacingError('Choose a normal folder name, for example notion-docs.');
  }
  if (!['manual', 'hourly', 'daily'].includes(frequency)) throw new UserFacingError('Choose a schedule.');
  if (!['html', 'markdown'].includes(exportType)) throw new UserFacingError('Choose what to export.');

  const conn = (await q('select id, access_token_enc from notion_connections where id = $1 and user_id = $2', [connectionId, uid])).rows[0];
  const inst = (await q('select id, installation_id from github_installations where id = $1 and user_id = $2', [installationId, uid])).rows[0];
  if (!conn || !inst) throw new UserFacingError('Connection not found.', 404);

  const repo = await github.repository(Number(inst.installation_id), repoName);
  const notion = new NotionClient(decrypt(conn.access_token_enc));
  const title = notion.pageTitle(await notion.page(pageId));

  if (!repo.private && b.confirm_public !== true) {
    throw new UserFacingError('This repository is public. Confirm that everyone on the internet may read these pages.');
  }

  const created = await q(
    `insert into sync_configs (user_id, notion_connection_id, github_installation_id, notion_root_page_id, notion_root_title,
       repo_full_name, branch, target_dir, frequency, export_type, status, last_message)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued','Waiting for the next sync run') returning id`,
    [uid, conn.id, inst.id, pageId, title, repo.full_name, branch, dir, frequency, exportType]
  );
  await dispatchWorkflow();
  sendJson(res, 201, { id: created.rows[0].id });
}

async function runSync({ req, res, params }) {
  const uid = requireUser(req);
  const done = await q(
    `update sync_configs set status = 'queued', last_message = 'Waiting for the next sync run', updated_at = now()
     where id = $1 and user_id = $2 and status not in ('running', 'queued') returning id`,
    [params.id, uid]
  );
  if (done.rowCount) await dispatchWorkflow();
  sendJson(res, 200, { queued: done.rowCount > 0 });
}

async function deleteSync({ req, res, params }) {
  const uid = requireUser(req);
  await q('delete from sync_configs where id = $1 and user_id = $2', [params.id, uid]);
  sendJson(res, 200, { ok: true });
}

// Removes the user and everything tied to it (cascades through connections, installations and syncs).
async function deleteAccount({ req, res }) {
  const uid = requireUser(req);
  await q('delete from users where id = $1', [uid]);
  clearCookie(res, 'rs_session');
  sendJson(res, 200, { ok: true });
}

// Daily safety net (Vercel Cron on the free plan can only run once a day).
async function cron({ req, res }) {
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`;
  if (!process.env.CRON_SECRET || !safeEqual(req.headers.authorization || '', expected)) throw new UserFacingError('Not allowed.', 401);
  sendJson(res, 200, { dispatched: await dispatchWorkflow() });
}

export const handlers = [
  ['GET', /^\/api\/auth\/notion$/, notionStart],
  ['GET', /^\/api\/auth\/notion\/callback$/, notionCallback],
  ['POST', /^\/api\/auth\/logout$/, logout],
  ['GET', /^\/api\/github\/connect$/, githubStart],
  ['GET', /^\/api\/github\/callback$/, githubCallback],
  ['GET', /^\/api\/github\/installations\/(?<id>\d+)\/repos$/, githubRepos],
  ['GET', /^\/api\/me$/, me],
  ['GET', /^\/api\/notion\/pages$/, notionPages],
  ['POST', /^\/api\/syncs$/, createSync],
  ['POST', /^\/api\/syncs\/(?<id>\d+)\/run$/, runSync],
  ['DELETE', /^\/api\/syncs\/(?<id>\d+)$/, deleteSync],
  ['DELETE', /^\/api\/account$/, deleteAccount],
  ['GET', /^\/api\/cron$/, cron],
];
