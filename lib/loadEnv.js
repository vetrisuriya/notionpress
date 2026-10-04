// Loads ./.env for local runs (Node 20.12+). Real environment variables always win.
// On Vercel and GitHub Actions there is no .env file, so this does nothing.
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile?.(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  // no .env file: fine
}
