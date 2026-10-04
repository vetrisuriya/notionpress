import test from 'node:test';
import assert from 'node:assert/strict';
import { syncOnce, slugify } from '../lib/sync.js';

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

function harness(tree, state = { pages: {}, assets: {} }, fetchFile) {
  const commits = [];
  const run = async (st = state) => {
    const result = await syncOnce({
      config: { notion_root_page_id: ID('a'), target_dir: '/notion-docs/' },
      notion: fakeNotion(tree),
      state: st,
      fetchFile,
      commit: async (change) => {
        commits.push(change);
        return Object.keys(change.files).length || change.deletions.length ? 'sha' + commits.length : null;
      },
    });
    return { result, state: { pages: result.pages, assets: result.assets } };
  };
  return { run, commits };
}

test('slugify handles accents, symbols and empty results', () => {
  assert.equal(slugify('Café & Crème!'), 'cafe-creme');
  assert.equal(slugify('தமிழ்'), '');
});

test('first sync writes root, sub-pages, breadcrumbs and the stylesheet under the target folder', async () => {
  const tree = {
    [ID('a')]: { title: 'Root', blocks: [para('hello'), childPage(ID('b'), 'Child One')] },
    [ID('b')]: { title: 'Child One', blocks: [childPage(ID('c'), 'Deep')] },
    [ID('c')]: { title: 'Deep', blocks: [para('deep')] },
  };
  const { run, commits } = harness(tree);
  const { result } = await run();

  assert.deepEqual(Object.keys(commits[0].files).sort(), [
    'notion-docs/assets/style.css',
    'notion-docs/child-one/deep/index.html',
    'notion-docs/child-one/index.html',
    'notion-docs/index.html',
  ]);
  const root = commits[0].files['notion-docs/index.html'].content;
  assert.match(root, /href="child-one\/index\.html"/);
  const deep = commits[0].files['notion-docs/child-one/deep/index.html'].content;
  assert.match(deep, /href="\.\.\/\.\.\/index\.html">Root<\/a> \/ <a href="\.\.\/\.\.\/child-one\/index\.html">Child One/);
  assert.match(deep, /href="\.\.\/\.\.\/assets\/style\.css"/);
  assert.equal(result.message, 'Synced 3 page(s); 3 updated.');
});

test('second sync with no changes commits nothing', async () => {
  const tree = { [ID('a')]: { title: 'Root', blocks: [para('hello')] } };
  const { run, commits } = harness(tree);
  const first = await run();
  const second = await run(first.state);
  assert.deepEqual(commits[1].files, {});
  assert.deepEqual(commits[1].deletions, []);
  assert.equal(second.result.committed, false);
  assert.match(second.result.message, /Already up to date/);
});

test('editing one page commits only that page', async () => {
  const tree = {
    [ID('a')]: { title: 'Root', blocks: [childPage(ID('b'), 'Child')] },
    [ID('b')]: { title: 'Child', blocks: [para('v1')] },
  };
  const { run, commits } = harness(tree);
  const first = await run();
  tree[ID('b')].blocks = [para('v2')];
  await run(first.state);
  assert.deepEqual(Object.keys(commits[1].files), ['notion-docs/child/index.html']);
});

test('a page removed in Notion is deleted from the repository', async () => {
  const tree = {
    [ID('a')]: { title: 'Root', blocks: [childPage(ID('b'), 'Child')] },
    [ID('b')]: { title: 'Child', blocks: [para('x')] },
  };
  const { run, commits } = harness(tree);
  const first = await run();
  tree[ID('a')].blocks = [];
  const second = await run(first.state);
  assert.deepEqual(commits[1].deletions, ['notion-docs/child/index.html']);
  assert.ok(!(ID('b') in second.state.pages));
});

test('a renamed page moves: new path written, old path deleted', async () => {
  const tree = {
    [ID('a')]: { title: 'Root', blocks: [childPage(ID('b'), 'Old Name')] },
    [ID('b')]: { title: 'Old Name', blocks: [para('x')] },
  };
  const { run, commits } = harness(tree);
  const first = await run();
  tree[ID('a')].blocks = [childPage(ID('b'), 'New Name')];
  tree[ID('b')].title = 'New Name';
  await run(first.state);
  assert.ok('notion-docs/new-name/index.html' in commits[1].files);
  assert.deepEqual(commits[1].deletions, ['notion-docs/old-name/index.html']);
});

test('notion-hosted images are downloaded once and reused while the page is unchanged', async () => {
  const image = { id: 'img-1', type: 'image', image: { type: 'file', file: { url: 'https://s3.example/pic.png?sig=1' }, caption: [] } };
  const tree = { [ID('a')]: { title: 'Root', edited: 'e1', blocks: [image] } };
  let downloads = 0;
  const fetchFile = async () => { downloads++; return { ok: true, body: Buffer.from('PNGDATA'), contentType: 'image/png' }; };
  const { run, commits } = harness(tree, undefined, fetchFile);

  const first = await run();
  const asset = commits[0].files['notion-docs/assets/img1.png'];
  assert.ok(asset && asset.binary);
  assert.match(commits[0].files['notion-docs/index.html'].content, /src="assets\/img1\.png"/);

  await run(first.state);
  assert.equal(downloads, 1);
  assert.deepEqual(commits[1].files, {});
});

test('a missing root page fails with a clear error', async () => {
  const { run } = harness({});
  await assert.rejects(run(), /not found/);
});
