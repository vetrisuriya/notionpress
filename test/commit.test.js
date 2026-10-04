import test from 'node:test';
import assert from 'node:assert/strict';
import { GithubCommitter } from '../lib/commit.js';

function fakeClient({ existing = [], headSha = 'head1' } = {}) {
  const calls = [];
  return {
    calls,
    call: async (method, path, data) => {
      calls.push({ method, path, data });
      if (method === 'GET' && path.includes('/git/ref/heads/')) return { object: { sha: headSha } };
      if (method === 'GET' && path.includes('/git/commits/')) return { tree: { sha: 'tree0' } };
      if (method === 'GET' && path.includes('/git/trees/')) return { truncated: false, tree: existing.map((p) => ({ path: p, type: 'blob' })) };
      if (method === 'POST' && path.endsWith('/git/blobs')) return { sha: 'blob' + calls.length };
      if (method === 'POST' && path.endsWith('/git/trees')) return { sha: 'tree' + calls.length };
      if (method === 'POST' && path.endsWith('/git/commits')) return { sha: 'newcommit' };
      if (method === 'PATCH') return {};
      throw new Error('unexpected ' + method + ' ' + path);
    },
  };
}

test('text goes inline, binary becomes a blob, deletions only for existing paths, one commit', async () => {
  const client = fakeClient({ existing: ['docs/old.html'] });
  const committer = new GithubCommitter(client, 'me/repo', 'main', { blobDelayMs: 0 });
  const sha = await committer.commit({
    files: { 'docs/a.html': { content: '<p>a</p>', binary: false }, 'docs/i.png': { content: Buffer.from([1, 2, 3]), binary: true } },
    deletions: ['docs/old.html', 'docs/never-existed.html'],
    message: 'msg',
  });
  assert.equal(sha, 'newcommit');

  const blobs = client.calls.filter((c) => c.path.endsWith('/git/blobs'));
  assert.equal(blobs.length, 1);
  assert.equal(blobs[0].data.encoding, 'base64');

  const tree = client.calls.find((c) => c.path.endsWith('/git/trees') && c.method === 'POST').data.tree;
  assert.deepEqual(tree.find((e) => e.path === 'docs/a.html').content, '<p>a</p>');
  assert.ok(tree.find((e) => e.path === 'docs/i.png').sha);
  assert.equal(tree.find((e) => e.path === 'docs/old.html').sha, null);
  assert.ok(!tree.some((e) => e.path === 'docs/never-existed.html'));

  const patch = client.calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.path, '/repos/me/repo/git/refs/heads/main');
});

test('nothing to change means no commit', async () => {
  const client = fakeClient();
  const sha = await new GithubCommitter(client, 'me/repo', 'main').commit({ files: {}, deletions: [], message: 'x' });
  assert.equal(sha, null);
  assert.ok(!client.calls.some((c) => c.method === 'POST'));
});

test('branch names with slashes are kept as path segments', async () => {
  const client = fakeClient();
  await new GithubCommitter(client, 'me/repo', 'feature/docs', { blobDelayMs: 0 }).commit({ files: { 'a.html': { content: 'x', binary: false } }, deletions: [], message: 'x' });
  assert.equal(client.calls[0].path, '/repos/me/repo/git/ref/heads/feature/docs');
});
