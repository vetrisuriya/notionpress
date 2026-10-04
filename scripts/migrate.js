// Creates the tables: DATABASE_URL=... npm run migrate
import '../lib/loadEnv.js';
import { readFileSync } from 'node:fs';
import { q, closeDb } from '../lib/db.js';

try {
  await q(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  console.log('Tables are ready.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await closeDb();
}
