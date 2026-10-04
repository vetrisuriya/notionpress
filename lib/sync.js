import crypto from 'node:crypto';
import { Renderer, collectAssetBlocks, esc } from './render.js';
import { MarkdownRenderer } from './markdown.js';
import { pageHtml, CSS } from './template.js';

const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');
const keyOf = (id) => String(id).replace(/-/g, '').toLowerCase();

export function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** All child_page blocks, including ones nested inside columns, toggles and so on. */
function childPages(blocks) {
  const found = [];
  for (const block of blocks) {
    if (block.type === 'child_page') found.push({ id: block.id, title: block.child_page?.title || 'Untitled' });
    if (block.children) found.push(...childPages(block.children));
  }
  return found;
}

async function crawl(notion, pageId, segments, parentKey, nodes, max) {
  const key = keyOf(pageId);
  if (nodes.has(key) || nodes.size >= max) return;

  const page = await notion.page(pageId);
  if (page.archived || page.in_trash) return;

  const blocks = await notion.blocksTree(pageId);
  nodes.set(key, {
    key, id: pageId, title: notion.pageTitle(page), icon: notion.pageIcon(page),
    edited: page.last_edited_time || '', segments, blocks, parent: parentKey,
  });

  const used = new Set();
  for (const child of childPages(blocks)) {
    const childKey = keyOf(child.id);
    let slug = slugify(child.title) || `page-${childKey.slice(0, 6)}`;
    if (used.has(slug)) slug += `-${childKey.slice(0, 6)}`;
    used.add(slug);
    await crawl(notion, child.id, [...segments, slug], key, nodes, max);
  }
}

const pagePath = (segments, markdown) => (segments.length ? segments.join('/') + '/' : '') + (markdown ? 'index.md' : 'index.html');

function breadcrumb(nodes, key, prefix, pathMap, markdown = false) {
  const chain = [];
  for (let p = nodes.get(key).parent; p; p = nodes.get(p)?.parent) chain.unshift(p);
  if (!chain.length) return '';
  if (markdown) {
    const parts = chain.map((k) => `[${nodes.get(k).title}](${prefix + pathMap.get(k)})`);
    parts.push(`**${nodes.get(key).title}**`);
    return parts.join(' / ');
  }
  const parts = chain.map((k) => `<a href="${esc(prefix + pathMap.get(k))}">${esc(nodes.get(k).title)}</a>`);
  parts.push(`<span>${esc(nodes.get(key).title)}</span>`);
  return parts.join(' / ');
}

function extension(url, hint, contentType) {
  for (const source of [hint, (() => { try { return new URL(url).pathname; } catch { return ''; } })()]) {
    const m = /\.([a-z0-9]{1,5})$/i.exec(source);
    if (m) return m[1].toLowerCase();
  }
  const type = String(contentType).split(';')[0].trim().toLowerCase();
  return { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf' }[type] || 'bin';
}

export async function defaultFetchFile(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  return { ok: res.ok, body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || '' };
}

/**
 * One sync run, with no database or network of its own.
 *
 * @param config   {notion_root_page_id, target_dir}
 * @param notion   NotionClient-like: page, blocksTree, pageTitle, pageIcon
 * @param commit   async ({files, deletions, message}) => sha | null
 * @param state    {pages: {key: {path, hash, edited}}, assets: {blockId: {path, hash}}} from the last run
 * @returns        {message, committed, pages, assets} where pages/assets are the new state
 */
export async function syncOnce({ config, notion, commit, state, fetchFile = defaultFetchFile, maxPages = 500, maxAssetBytes = 25 * 1024 * 1024 }) {
  const base = String(config.target_dir || '').replace(/^\/+|\/+$/g, '');
  const markdown = String(config.export_type || 'html') === 'markdown';
  const repoPath = (rel) => (base ? `${base}/${rel}` : rel);
  const files = {};
  const extraDeletions = [];
  const assetState = {};

  // 1. Crawl the page tree.
  const nodes = new Map();
  await crawl(notion, config.notion_root_page_id, [], null, nodes, maxPages);
  if (!nodes.size) throw new Error('The Notion page could not be read. Make sure it is still shared with this integration.');

  const pathMap = new Map([...nodes].map(([key, node]) => [key, pagePath(node.segments, markdown)]));

  // Downloads a Notion-hosted file (their URLs expire after about an hour) and returns its path from the site root.
  async function resolveAsset(node, asset) {
    const stored = state.assets[asset.id];
    const storedPage = state.pages[node.key];

    // Page untouched since the last sync: reuse the file already in the repository.
    if (stored && storedPage && storedPage.edited === node.edited) {
      assetState[asset.id] = stored;
      return stored.path;
    }

    let res = null;
    try { res = await fetchFile(asset.url); } catch { /* fall through */ }
    if (!res || !res.ok || res.body.length > maxAssetBytes) {
      if (stored) { assetState[asset.id] = stored; return stored.path; }
      return null;
    }

    const path = `assets/${keyOf(asset.id)}.${extension(asset.url, asset.hint, res.contentType)}`;
    const hash = sha1(res.body);
    if (!stored || stored.hash !== hash || stored.path !== path) files[repoPath(path)] = { content: res.body, binary: true };
    if (stored && stored.path !== path) extraDeletions.push(repoPath(stored.path));
    assetState[asset.id] = { path, hash };
    return path;
  }

  // 2. Render every page.
  const rendered = new Map();
  for (const [key, node] of nodes) {
    const prefix = '../'.repeat(node.segments.length);

    const assets = new Map();
    for (const asset of collectAssetBlocks(node.blocks)) {
      const path = await resolveAsset(node, asset);
      assets.set(asset.id, path ? prefix + path : null);
    }

    const renderer = markdown
      ? new MarkdownRenderer({ assets, pageHref: (k) => (pathMap.has(k) ? prefix + pathMap.get(k) : null), pageTitle: (k) => nodes.get(k)?.title ?? null })
      : new Renderer({ assets, pageHref: (k) => (pathMap.has(k) ? prefix + pathMap.get(k) : null), pageTitle: (k) => nodes.get(k)?.title ?? null });

    const body = renderer.render(node.blocks);
    const html = markdown
      ? `# ${node.icon ? node.icon + ' ' : ''}${node.title}\n\n${breadcrumb(nodes, key, prefix, pathMap, true) ? breadcrumb(nodes, key, prefix, pathMap, true) + '\n\n' : ''}${body}`
      : pageHtml({ title: node.title, icon: node.icon, breadcrumb: breadcrumb(nodes, key, prefix, pathMap), body, cssHref: `${prefix}assets/style.css` });
    rendered.set(key, { rel: pathMap.get(key), html });
  }

  // 3. Work out what changed.
  let changedPages = 0;
  for (const [key, page] of rendered) {
    const stored = state.pages[key];
    if (!stored || stored.hash !== sha1(page.html) || stored.path !== page.rel) {
      files[repoPath(page.rel)] = { content: page.html, binary: false };
      changedPages++;
    }
  }

  if (!markdown) {
    const cssHash = sha1(CSS);
    if (state.assets['style.css']?.hash !== cssHash) files[repoPath('assets/style.css')] = { content: CSS, binary: false };
    assetState['style.css'] = { path: 'assets/style.css', hash: cssHash };
  }

  const newPaths = new Set([...rendered.values()].map((p) => p.rel));
  const deletions = [...extraDeletions];
  for (const [key, stored] of Object.entries(state.pages)) {
    const gone = !rendered.has(key);
    if ((gone || stored.path !== rendered.get(key).rel) && !newPaths.has(stored.path)) deletions.push(repoPath(stored.path));
  }
  for (const [blockId, stored] of Object.entries(state.assets)) {
    if (!assetState[blockId]) deletions.push(repoPath(stored.path));
  }

  // 4. Commit.
  const sha = await commit({ files, deletions: [...new Set(deletions)], message: `Sync from Notion: ${changedPages} page(s) updated` });

  const pages = {};
  for (const [key, page] of rendered) pages[key] = { path: page.rel, hash: sha1(page.html), edited: nodes.get(key).edited };

  const total = nodes.size;
  return {
    committed: Boolean(sha),
    message: sha ? `Synced ${total} page(s); ${changedPages} updated.` : `Already up to date (${total} page(s)).`,
    pages,
    assets: assetState,
  };
}
