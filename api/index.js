import { route } from '../lib/router.js';

// One function serves every /api/* route (keeps within free-plan function limits).
export default async function handler(req, res) {
  await route(req, res);
}
