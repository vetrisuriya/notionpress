const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const encodeRef = (branch) => branch.split('/').map(encodeURIComponent).join('/');

/**
 * Writes many files and deletions to a branch as ONE commit (Git Data API).
 * Text goes inline in the tree (no extra requests); binary files are uploaded as blobs.
 */
export class GithubCommitter {
  constructor(client, repo, branch, { blobDelayMs = 700, treeChunk = 200 } = {}) {
    this.client = client;
    this.repo = repo;
    this.branch = branch;
    this.blobDelayMs = blobDelayMs;
    this.treeChunk = treeChunk;
  }

  /**
   * @param {{files: Record<string,{content: string|Buffer, binary: boolean}>, deletions: string[], message: string}} change
   * @returns {Promise<string|null>} new commit SHA, or null when there was nothing to commit
   */
  async commit({ files, deletions, message }) {
    const { client, repo, branch } = this;

    const ref = await client.call('GET', `/repos/${repo}/git/ref/heads/${encodeRef(branch)}`).catch((e) => {
      if (e.githubStatus === 404) throw new Error(`Branch "${branch}" was not found. Create it first, or pick another branch.`);
      throw e;
    });
    const headSha = ref.object?.sha;
    if (!headSha) throw new Error(`Branch "${branch}" was not found. Create it first, or pick another branch.`);

    const headCommit = await client.call('GET', `/repos/${repo}/git/commits/${headSha}`);
    const baseTree = headCommit.tree.sha;

    const toDelete = (await this.existingOnly(baseTree, deletions)).filter((p) => !(p in files));
    if (!Object.keys(files).length && !toDelete.length) return null;

    const entries = [];
    for (const [path, file] of Object.entries(files)) {
      if (file.binary) {
        const blob = await client.call('POST', `/repos/${repo}/git/blobs`, { content: Buffer.from(file.content).toString('base64'), encoding: 'base64' });
        entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
        await sleep(this.blobDelayMs); // stay clear of GitHub's secondary rate limit for content creation
      } else {
        entries.push({ path, mode: '100644', type: 'blob', content: String(file.content) });
      }
    }
    for (const path of toDelete) entries.push({ path, mode: '100644', type: 'blob', sha: null });

    let tree = baseTree;
    for (let i = 0; i < entries.length; i += this.treeChunk) {
      const result = await client.call('POST', `/repos/${repo}/git/trees`, { base_tree: tree, tree: entries.slice(i, i + this.treeChunk) });
      tree = result.sha;
    }

    const commit = await client.call('POST', `/repos/${repo}/git/commits`, { message, tree, parents: [headSha] });
    await client.call('PATCH', `/repos/${repo}/git/refs/heads/${encodeRef(branch)}`, { sha: commit.sha });
    return commit.sha;
  }

  /** Only delete paths that really exist, otherwise GitHub rejects the tree. */
  async existingOnly(treeSha, paths) {
    if (!paths.length) return [];
    const listing = await this.client.call('GET', `/repos/${this.repo}/git/trees/${treeSha}`, { recursive: 1 });
    if (listing.truncated) return paths; // too large to list; trust our own records
    const existing = new Set((listing.tree || []).filter((i) => i.type === 'blob').map((i) => i.path));
    return paths.filter((p) => existing.has(p));
  }
}
