import crypto from 'node:crypto';
import { UserFacingError } from './http.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'repo-sync-for-notion' };

export function appJwt({ appId, privateKey, now = Math.floor(Date.now() / 1000) }) {
  const b64 = (v) => Buffer.from(v).toString('base64url');
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }));
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

/** REST client for one installation token. Waits and retries when GitHub rate limits a request. */
export class GithubClient {
  constructor(token, { fetchImpl = fetch, retryScale = 1 } = {}) {
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.retryScale = retryScale;
  }

  async call(method, path, data) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const url = new URL('https://api.github.com' + path);
      const init = { method, headers: { ...HEADERS, Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(60000) };
      if (method === 'GET' && data) {
        for (const [k, v] of Object.entries(data)) url.searchParams.set(k, String(v));
      } else if (data) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(data);
      }

      const res = await this.fetchImpl(url, init);
      const body = await res.json().catch(() => ({}));

      const limited = [403, 429].includes(res.status) &&
        (res.headers.get('retry-after') || res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(body.message || ''));
      if (limited && attempt < 5) {
        let wait = Number(res.headers.get('retry-after')) || 0;
        if (!wait) {
          const reset = Number(res.headers.get('x-ratelimit-reset')) || 0;
          wait = reset > Date.now() / 1000 ? Math.ceil(reset - Date.now() / 1000) : 30;
        }
        await sleep(Math.min(90, Math.max(5, wait)) * 1000 * this.retryScale);
        continue;
      }

      if (!res.ok) {
        const err = new UserFacingError(`GitHub API ${res.status}: ${body.message || 'unknown error'}`);
        err.githubStatus = res.status;
        throw err;
      }
      return body;
    }
    throw new UserFacingError('GitHub kept rate limiting this request. Try again later.');
  }
}

/** Authenticates as the GitHub App and returns installation clients and repository lists. */
export class GithubApp {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetchImpl = fetchImpl;
    this.tokens = new Map();
  }

  privateKey() {
    const key = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!key) throw new Error('GITHUB_APP_PRIVATE_KEY is not set.');
    return key.replace(/\\n/g, '\n');
  }

  async installationClient(installationId) {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expires > Date.now()) return new GithubClient(cached.token, { fetchImpl: this.fetchImpl });

    const jwt = appJwt({ appId: process.env.GITHUB_APP_ID, privateKey: this.privateKey() });
    const res = await this.fetchImpl(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: { ...HEADERS, Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) throw new UserFacingError('GitHub access was removed or is no longer valid. Reconnect GitHub.');
    const { token } = await res.json();
    this.tokens.set(installationId, { token, expires: Date.now() + 50 * 60 * 1000 });
    return new GithubClient(token, { fetchImpl: this.fetchImpl });
  }

  async repositories(installationId) {
    const client = await this.installationClient(installationId);
    const repos = [];
    for (let page = 1; page <= 10; page++) {
      const res = await client.call('GET', '/installation/repositories', { per_page: 100, page });
      for (const r of res.repositories || []) {
        repos.push({ full_name: r.full_name, default_branch: r.default_branch || 'main', private: Boolean(r.private) });
      }
      if ((res.repositories || []).length < 100) break;
    }
    return repos;
  }

  async repository(installationId, fullName) {
    const repo = (await this.repositories(installationId)).find((r) => r.full_name.toLowerCase() === fullName.toLowerCase());
    if (!repo) throw new UserFacingError('That repository is not available to this GitHub connection.');
    return repo;
  }
}
