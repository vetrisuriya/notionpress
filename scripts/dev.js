// Local preview server: serves public/ and the /api routes. Run with: npm run dev
import '../lib/loadEnv.js';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { route } from '../lib/router.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
const port = Number(process.env.PORT) || 3000;

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return route(req, res);

    let name = decodeURIComponent(url.pathname);
    if (name === '/') name = '/index';
    const file = path.normalize(path.join(PUBLIC, path.extname(name) ? name : `${name}.html`));
    if (!file.startsWith(PUBLIC + path.sep)) { res.statusCode = 403; return res.end('Forbidden'); }

    try {
      const body = await readFile(file);
      res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
  })
  .listen(port, () => {
    console.log(`Open http://localhost:${port}`);
    if (!process.env.APP_URL) console.log('Tip: set APP_URL=http://localhost:' + port + ' in .env');
  });
