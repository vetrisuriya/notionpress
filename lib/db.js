import pg from 'pg';

let pool;

export function db() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('Missing environment variable DATABASE_URL');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  }
  return pool;
}

export const q = (text, params) => db().query(text, params);

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
