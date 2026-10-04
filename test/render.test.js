import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer, collectAssetBlocks } from '../lib/render.js';

const text = (t, extra = {}) => ({ type: 'text', plain_text: t, annotations: {}, ...extra });
const make = (opts = {}) =>
  new Renderer({ assets: new Map(), pageHref: (k) => (k === 'aaaa' ? '../other/index.html' : null), pageTitle: () => null, ...opts });

test('headings shift down one level because the page title is the h1', () => {
  const html = make().render([{ type: 'heading_1', heading_1: { rich_text: [text('Hi')] } }]);
  assert.equal(html, '<h2>Hi</h2>');
});

test('consecutive list items share one list and nest children', () => {
  const html = make().render([
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [text('a')] }, children: [{ type: 'bulleted_list_item', bulleted_list_item: { rich_text: [text('a1')] } }] },
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [text('b')] } },
    { type: 'numbered_list_item', numbered_list_item: { rich_text: [text('one')] } },
  ]);
  assert.equal(html, '<ul><li>a<ul><li>a1</li></ul></li><li>b</li></ul><ol><li>one</li></ol>');
});

test('text is escaped and annotations are applied', () => {
  const html = make().render([{ type: 'paragraph', paragraph: { rich_text: [text('<b>x</b>', { annotations: { bold: true } })] } }]);
  assert.equal(html, '<p><strong>&lt;b&gt;x&lt;/b&gt;</strong></p>');
});

test('dangerous link schemes are neutralised', () => {
  const html = make().render([{ type: 'paragraph', paragraph: { rich_text: [text('x', { href: 'javascript:alert(1)' })] } }]);
  assert.match(html, /href="#"/);
});

test('links to other exported pages become relative links', () => {
  const html = make({ pageHref: (k) => (k === 'a'.repeat(32) ? '../other/index.html' : null) })
    .render([{ type: 'paragraph', paragraph: { rich_text: [text('x', { href: `https://www.notion.so/Title-${'a'.repeat(32)}` })] } }]);
  assert.match(html, /href="\.\.\/other\/index\.html"/);
});

test('tables use header cells for the first row', () => {
  const html = make().render([{
    type: 'table', table: { has_column_header: true },
    children: [{ table_row: { cells: [[text('H')]] } }, { table_row: { cells: [[text('v')]] } }],
  }]);
  assert.match(html, /<tr><th>H<\/th><\/tr><tr><td>v<\/td><\/tr>/);
});

test('code blocks keep their text escaped', () => {
  const html = make().render([{ type: 'code', code: { language: 'js', rich_text: [text('a < b')] } }]);
  assert.match(html, /<code class="language-js">a &lt; b<\/code>/);
});

test('notion-hosted images use the downloaded asset path; failures show a note', () => {
  const block = { id: 'img-1', type: 'image', image: { type: 'file', file: { url: 'https://s3/x.png' }, caption: [] } };
  assert.match(make({ assets: new Map([['img-1', '../assets/img1.png']]) }).render([block]), /<img src="\.\.\/assets\/img1\.png"/);
  assert.match(make({ assets: new Map([['img-1', null]]) }).render([block]), /could not be exported/);
  assert.deepEqual(collectAssetBlocks([{ ...block, children: [] }]).map((a) => a.id), ['img-1']);
});
