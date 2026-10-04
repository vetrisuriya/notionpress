// Renders Notion pages to ./preview as HTML, with no database, GitHub or sign-in.
//   npm run preview                        -> built-in sample page
//   NOTION_TOKEN=... NOTION_PAGE=... npm run preview   -> one of your real pages
import '../lib/loadEnv.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { syncOnce } from '../lib/sync.js';
import { NotionClient } from '../lib/notion.js';

const OUT = path.resolve('preview');
const t = (plain, annotations = {}, href = null) => ({ type: 'text', plain_text: plain, annotations, href });
const p = (...segs) => ({ id: crypto.randomUUID(), type: 'paragraph', paragraph: { rich_text: segs } });
const id = (c) => c.repeat(32);

function sampleNotion() {
  const tree = {
    [id('a')]: {
      title: 'Team handbook', icon: '📘',
      blocks: [
        p(t('This is a sample export. Every block type below is converted from Notion data to plain HTML.')),
        { id: 'h1', type: 'heading_1', heading_1: { rich_text: [t('Getting started')] } },
        p(t('Text can be '), t('bold', { bold: true }), t(', '), t('italic', { italic: true }), t(', '), t('code', { code: true }), t(' or a '), t('link', {}, 'https://example.com'), t('.')),
        { id: 'c1', type: 'callout', callout: { icon: { type: 'emoji', emoji: '💡' }, rich_text: [t('Callouts keep their emoji.')] } },
        { id: 'l1', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [t('Bullets')] }, children: [{ id: 'l2', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [t('can nest')] } }] },
        { id: 'l3', type: 'to_do', to_do: { rich_text: [t('To-dos too')], checked: true } },
        { id: 'h2', type: 'heading_2', heading_2: { rich_text: [t('Code and tables')] } },
        { id: 'code', type: 'code', code: { language: 'javascript', rich_text: [t('const sum = (a, b) => a + b;\nconsole.log(sum(2, 3));')], caption: [] } },
        { id: 'tbl', type: 'table', table: { has_column_header: true }, children: [
          { table_row: { cells: [[t('Tool')], [t('Use')]] } },
          { table_row: { cells: [[t('Notion')], [t('Write')]] } },
          { table_row: { cells: [[t('GitHub')], [t('Publish')]] } },
        ] },
        { id: 'tg', type: 'toggle', toggle: { rich_text: [t('Click to open a toggle')] }, children: [p(t('Hidden content lives here.'))] },
        { id: 'q', type: 'quote', quote: { rich_text: [t('Quotes are supported.')] } },
        { id: 'img', type: 'image', image: { type: 'file', file: { url: 'https://example.invalid/diagram.svg' }, caption: [t('A Notion-hosted image is downloaded into assets/')] } },
        { id: 'hr', type: 'divider', divider: {} },
        { id: 'cp1', type: 'child_page', child_page: { title: 'Onboarding' } },
      ],
    },
    [id('b')]: { title: 'Onboarding', icon: '🚀', blocks: [p(t('Sub-pages become folders, with breadcrumbs back to the parent.')), { id: 'cp2', type: 'child_page', child_page: { title: 'Day one checklist' } }] },
    [id('c')]: { title: 'Day one checklist', icon: null, blocks: [{ id: 'k1', type: 'to_do', to_do: { rich_text: [t('Say hello')], checked: false } }] },
  };
  const childIds = { cp1: id('b'), cp2: id('c') };
  for (const page of Object.values(tree)) for (const b of page.blocks) if (childIds[b.id]) b.id = childIds[b.id];

  return {
    rootId: id('a'),
    notion: {
      page: async (pid) => ({ id: pid, last_edited_time: '1', properties: { title: { type: 'title', title: [{ plain_text: tree[pid.replace(/-/g, '')].title }] } }, icon: tree[pid.replace(/-/g, '')].icon ? { type: 'emoji', emoji: tree[pid.replace(/-/g, '')].icon } : null }),
      blocksTree: async (pid) => tree[pid.replace(/-/g, '')].blocks,
      pageTitle: (page) => page.properties.title.title[0].plain_text,
      pageIcon: (page) => page.icon?.emoji ?? null,
    },
    fetchFile: async () => ({
      ok: true, contentType: 'image/svg+xml',
      body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="140"><rect width="480" height="140" rx="10" fill="#e7f4ef"/><text x="240" y="78" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#1f6f5c">Downloaded image (sample)</text></svg>'),
    }),
  };
}

let notion, rootId, fetchFile;
if (process.env.NOTION_TOKEN && process.env.NOTION_PAGE) {
  const found = process.env.NOTION_PAGE.replace(/-/g, '').match(/[0-9a-f]{32}/gi);
  if (!found) throw new Error('NOTION_PAGE must be a Notion page URL or page ID.');
  rootId = found.at(-1);
  notion = new NotionClient(process.env.NOTION_TOKEN);
  console.log('Reading your Notion page…');
} else {
  ({ notion, rootId, fetchFile } = sampleNotion());
  console.log('Using the built-in sample page. To use your own page, see the README ("Preview your own page").');
}

const result = await syncOnce({
  config: { notion_root_page_id: rootId, target_dir: '', export_type: process.env.EXPORT_TYPE === 'markdown' ? 'markdown' : 'html' },
  notion,
  fetchFile,
  state: { pages: {}, assets: {} },
  commit: async ({ files }) => {
    await rm(OUT, { recursive: true, force: true });
    for (const [file, { content }] of Object.entries(files)) {
      const dest = path.join(OUT, file);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, content);
    }
    return 'local';
  },
});

console.log(result.message);
console.log(`Open this file in your browser:\n${path.join(OUT, 'index.html')}`);
