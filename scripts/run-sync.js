// Runs every sync that is queued or due. Called by the GitHub Actions workflow.
import '../lib/loadEnv.js';
import { q, closeDb } from '../lib/db.js';
import { claim, runClaimed } from '../lib/runner.js';

const BUDGET_MS = 5 * 60 * 60 * 1000; // stop starting new syncs after 5 hours (the job limit is 6)
const started = Date.now();

try {
  // A run that died leaves "running" behind. Release it after 6 hours.
  await q(`update sync_configs set status = 'failed', last_message = 'The sync timed out. It will try again on the next run.', updated_at = now()
           where status = 'running' and updated_at < now() - interval '6 hours'`);

  const due = await q(`
    select id from sync_configs
    where status <> 'running' and (
      status = 'queued'
      or (frequency = 'hourly' and (last_run_at is null or last_run_at <= now() - interval '59 minutes'))
      or (frequency = 'daily'  and (last_run_at is null or last_run_at <= now() - interval '23 hours 59 minutes'))
    )
    order by (status = 'queued') desc, last_run_at asc nulls first`);

  let ran = 0;
  for (const { id } of due.rows) {
    if (Date.now() - started > BUDGET_MS) break;
    const config = await claim(id);
    if (!config) continue;
    await runClaimed(config);
    ran++;
  }
  console.log(`Ran ${ran} sync(s).`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await closeDb();
}
