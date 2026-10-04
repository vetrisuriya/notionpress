import { api, el, flash, setupHeader } from './common.js';

const $ = (id) => document.getElementById(id);
let repos = [];
let pages = [];

const me = await api('/me').catch((e) => { if (e.status === 401) location.href = '/'; throw e; });
setupHeader(me.appName);
if (!me.connections.length || !me.installations.length) location.href = '/dashboard?error=connect-first';

function fill(select, options, empty) {
  select.replaceChildren(...(options.length ? options : [{ value: '', label: empty }]).map((o) => el('option', { value: o.value }, o.label)));
}

function showPageOptions() {
  const text = $('page-search').value.trim().toLowerCase();
  const shown = pages.filter((p) => !text || p.title.toLowerCase().includes(text));
  fill($('page'), shown.map((p) => ({ value: p.id, label: `${p.icon || ''} ${p.title}`.trim() })), pages.length ? 'No matching pages' : 'No pages are shared yet');
}

async function loadPages() {
  pages = await api(`/notion/pages?connection=${$('workspace').value}`).catch((e) => { flash(e.message, 'err'); return []; });
  $('page-search').value = '';
  showPageOptions();
  $('no-pages').classList.toggle('hidden', pages.length > 0);
}

function showRepo() {
  const repo = repos.find((r) => r.full_name === $('repo').value);
  $('public-warning').classList.toggle('hidden', !repo || repo.private);
  if (repo) $('branch').value = repo.default_branch;
}

function showRepoOptions() {
  const text = $('repo-search').value.trim().toLowerCase();
  const shown = repos.filter((r) => !text || r.full_name.toLowerCase().includes(text));
  fill($('repo'), shown.map((r) => ({ value: r.full_name, label: r.full_name + (r.private ? '' : ' (public)') })), repos.length ? 'No matching repositories' : 'No repositories shared with the app');
  showRepo();
}

async function loadRepos() {
  fill($('repo'), [], 'Loading repositories…');
  try {
    repos = await api(`/github/installations/${$('installation').value}/repos`);
    $('repo-search').value = '';
    showRepoOptions();
  } catch (e) {
    repos = [];
    fill($('repo'), [], e.message);
  }
}

fill($('workspace'), me.connections.map((c) => ({ value: c.id, label: c.workspace_name || 'Workspace' })), '');
fill($('installation'), me.installations.map((i) => ({ value: i.id, label: i.account_login })), '');
$('workspace-field').classList.toggle('hidden', me.connections.length < 2);

$('workspace').addEventListener('change', loadPages);
$('installation').addEventListener('change', loadRepos);
$('repo').addEventListener('change', showRepo);
$('page-search').addEventListener('input', showPageOptions);
$('repo-search').addEventListener('input', showRepoOptions);

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('submit');
  button.disabled = true;
  try {
    await api('/syncs', {
      method: 'POST',
      body: {
        notion_connection_id: $('workspace').value,
        notion_root_page_id: $('page').value,
        github_installation_id: $('installation').value,
        repo_full_name: $('repo').value,
        branch: $('branch').value.trim(),
        target_dir: $('target_dir').value.trim(),
        frequency: $('frequency').value,
        export_type: $('export_type').value,
        confirm_public: $('confirm-public').checked,
      },
    });
    location.href = '/dashboard?status=created';
  } catch (e) {
    flash(e.message, 'err');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    button.disabled = false;
  }
});

await Promise.all([loadPages(), loadRepos()]);
