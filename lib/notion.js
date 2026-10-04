import { UserFacingError } from './http.js';

const NOTION_VERSION = '2022-06-28';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequestAt = 0;

/**
 * Small Notion API client: about 3 requests per second, retries on rate limits
 * and server errors, cursor pagination.
 */
export class NotionClient {
  constructor(token, { fetchImpl = fetch, minGapMs = 340 } = {}) {
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.minGapMs = minGapMs;
  }

  async request(method, path, data) {
    for (let attempt = 1; ; attempt++) {
      const wait = this.minGapMs - (Date.now() - lastRequestAt);
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();

      let res;
      try {
        const url = new URL('https://api.notion.com/v1' + path);
        const init = {
          method,
          headers: { Authorization: `Bearer ${this.token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(30000),
        };
        if (method === 'GET' && data) {
          for (const [k, v] of Object.entries(data)) url.searchParams.set(k, String(v));
        } else if (data) {
          init.body = JSON.stringify(data);
        }
        res = await this.fetchImpl(url, init);
      } catch {
        if (attempt < 4) { await sleep(attempt * 2000); continue; }
        throw new UserFacingError('Could not reach Notion. Try again later.');
      }

      if (res.status === 429 && attempt < 6) { await sleep(Math.max(1, Number(res.headers.get('retry-after')) || 2) * 1000); continue; }
      if (res.status >= 500 && attempt < 4) { await sleep(attempt * 2000); continue; }
      if (res.status === 401) throw new UserFacingError('Notion access was revoked or expired. Reconnect your Notion workspace.');
      if (res.status === 404) throw new UserFacingError('Notion page not found. Make sure it is still shared with this integration.');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new UserFacingError(`Notion API error ${res.status}: ${body.message || 'unknown error'}`);
      }
      return res.json();
    }
  }

  /** Pages the integration can see, newest edits first. */
  async searchPages(max = 300) {
    const pages = [];
    let cursor = null;
    do {
      const body = {
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 100,
      };
      if (cursor) body.start_cursor = cursor;
      const res = await this.request('POST', '/search', body);
      for (const page of res.results || []) {
        if (page.archived || page.in_trash) continue;
        pages.push({ id: page.id, title: this.pageTitle(page), icon: this.pageIcon(page), edited: page.last_edited_time || null });
      }
      cursor = res.has_more ? res.next_cursor : null;
    } while (cursor && pages.length < max);
    return pages.slice(0, max);
  }

  page(id) {
    return this.request('GET', `/pages/${id}`);
  }

  pageTitle(page) {
    for (const property of Object.values(page.properties || {})) {
      if (property.type === 'title') {
        const title = (property.title || []).map((t) => t.plain_text || '').join('').trim();
        return title || 'Untitled';
      }
    }
    return 'Untitled';
  }

  pageIcon(page) {
    return page.icon?.type === 'emoji' ? page.icon.emoji : null;
  }

  async children(blockId) {
    const blocks = [];
    let cursor = null;
    do {
      const query = { page_size: 100 };
      if (cursor) query.start_cursor = cursor;
      const res = await this.request('GET', `/blocks/${blockId}/children`, query);
      blocks.push(...(res.results || []));
      cursor = res.has_more ? res.next_cursor : null;
    } while (cursor);
    return blocks;
  }

  /** Blocks with nested children under "children". Sub-pages and databases are not expanded here. */
  async blocksTree(blockId, depth = 0) {
    const blocks = await this.children(blockId);
    for (const block of blocks) {
      if (['child_page', 'child_database'].includes(block.type) || depth >= 15) continue;
      let sourceId = block.id;
      let hasChildren = Boolean(block.has_children);
      const syncedFrom = block.type === 'synced_block' ? block.synced_block?.synced_from?.block_id : null;
      if (syncedFrom) { sourceId = syncedFrom; hasChildren = true; }
      if (hasChildren) block.children = await this.blocksTree(sourceId, depth + 1);
    }
    return blocks;
  }
}
