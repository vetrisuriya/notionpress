import test from 'node:test';
import assert from 'node:assert/strict';
import { syncOnce } from '../lib/sync.js';

const para = (t) => ({ id: 'p' + t, type: 'paragraph', paragraph: { rich_text: [{ type: 'text', plain_text: t, annotations: {} }] } });
const childPage = (id, title) => ({ id, type: 'child_page', child_page: { title } });
const ID = (c) => c.repeat(32);

function fakeNotion(tree) {
  return {
    page: async (id) => {
      const p = tree[id.replace(/-/g, '')];
      if (!p) throw new Error('not found');
      return { id, last_edited_time: p.edited || '1', properties: { title: { type: 'title', title: [{ plain_text: p.title }] } } };
    },
    blocksTree: async (id) => tree[id.replace(/-/g, '')].blocks,
    pageTitle: (page) => page.properties.title.title[0].plain_text,
    pageIcon: () => null,
  };
}

test('markdown export writes index.md files, no style.css', async () => {
  const tree = {
    [ID('a')]: { title: 'Root', blocks: [para('hello'), childPage(ID('b'), 'Child')] },
    [ID('b')]: { title: 'Child', blocks: [para('deep')] },
  };
  const commits = [];
  await syncOnce({
    config: { notion_root_page_id: ID('a'), target_dir: '', export_type: 'markdown' },
    notion: fakeNotion(tree),
    state: { pages: {}, assets: {} },
    commit: async (change) => { commits.push(change); return 'sha'; },
  });
  const files = Object.keys(commits[0].files).sort();
  assert.deepEqual(files, ['child/index.md', 'index.md']);
  assert.match(commits[0].files['index.md'].content, /# Root/);
  assert.match(commits[0].files['index.md'].content, /\[Child\]\(child\/index\.md\)/);
});

test('switching an existing sync to markdown removes the old html and style.css', async () => {
  const tree = { [ID('a')]: { title: 'Root', blocks: [para('hello')] } };
  const state = {
    pages: { [ID('a')]: { path: 'index.html', hash: 'x', edited: '1' } },
    assets: { 'style.css': { path: 'assets/style.css', hash: 'x' } },
  };
  const commits = [];
  await syncOnce({
    config: { notion_root_page_id: ID('a'), target_dir: '', export_type: 'markdown' },
    notion: fakeNotion(tree),
    state,
    commit: async (change) => { commits.push(change); return 'sha'; },
  });
  assert.deepEqual(commits[0].deletions.sort(), ['assets/style.css', 'index.html']);
});
