import { handlers } from './routes.js';
import { UserFacingError, sendJson } from './http.js';

export async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  try {
    for (const [method, pattern, handler] of handlers) {
      if (req.method !== method) continue;
      const match = pattern.exec(path);
      if (!match) continue;

      // Browsers cannot add this header from another site, which blocks cross-site form posts.
      if (method !== 'GET' && req.headers['x-requested-with'] !== 'repo-sync') throw new UserFacingError('Bad request.', 403);

      return await handler({ req, res, url, params: match.groups || {} });
    }
    sendJson(res, 404, { error: 'Not found.' });
  } catch (e) {
    if (e instanceof UserFacingError) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    sendJson(res, 500, { error: 'Something went wrong. Please try again.' });
  }
}
