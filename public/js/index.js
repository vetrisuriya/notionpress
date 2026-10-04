import { api, flashFromQuery } from './common.js';

flashFromQuery();

try {
  await api('/me');
  const button = document.getElementById('start');
  button.textContent = 'Open dashboard';
  button.href = '/dashboard';
} catch {
  // Not signed in: the default "Continue with Notion" link stays.
}
