import { api, el, flash, flashFromQuery, setupHeader } from './common.js';

flashFromQuery();
let timer;

function connectionsPanel(me) {
  const list = (items, label, empty) =>
    items.length ? items.map((i) => el('div', { class: 'muted' }, i[label] || 'Workspace')) : [el('div', { class: 'muted' }, empty)];

  return el('div', { class: 'panel' },
    el('h2', {}, 'Connections'),
    el('div', { class: 'cols2' },
      el('div', {}, el('strong', {}, 'Notion'), list(me.connections, 'workspace_name', 'Not connected'),
        el('a', { href: '/api/auth/notion' }, 'Add or update a workspace')),
      el('div', {}, el('strong', {}, 'GitHub'), list(me.installations, 'account_login', 'Not connected'),
        el('a', { href: '/api/github/connect' }, me.installations.length ? 'Add or change repositories' : 'Connect GitHub'))));
}

function relativeTime(iso) {
  if (!iso) return '';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

function syncsPanel(me) {
  const canCreate = me.connections.length && me.installations.length;
  const head = el('div', { class: 'row between' }, el('h2', {}, 'Syncs'),
    canCreate ? el('a', { class: 'btn small', href: '/new' }, 'New sync') : null);

  if (!me.configs.length) {
    return el('div', { class: 'panel' }, head, el('p', { class: 'muted' }, 'No syncs yet. Connect Notion and GitHub, then create your first sync.'));
  }

  const rows = me.configs.map((c) => el('tr', {},
    el('td', {}, c.notion_root_title),
    el('td', {}, c.repo_full_name, el('div', { class: 'muted' }, `${c.branch} / ${c.target_dir || '(repository root)'} · ${c.export_type === 'markdown' ? 'Markdown' : 'HTML'}`)),
    el('td', {}, c.frequency[0].toUpperCase() + c.frequency.slice(1)),
    el('td', {}, el('span', { class: `badge ${c.status}` }, c.status[0].toUpperCase() + c.status.slice(1)),
      el('div', { class: 'muted' }, c.last_message || ''),
      c.last_synced_at ? el('div', { class: 'muted' }, `Last success ${relativeTime(c.last_synced_at)}`) : null),
    el('td', {}, el('div', { class: 'row' },
      el('button', {
        class: 'btn small', disabled: ['queued', 'running'].includes(c.status),
        onclick: async (e) => {
          e.target.disabled = true;
          try { await api(`/syncs/${c.id}/run`, { method: 'POST' }); await load(); } catch (err) { flash(err.message, 'err'); }
        },
      }, 'Sync now'),
      el('button', {
        class: 'btn danger small',
        onclick: async () => {
          if (!confirm('Remove this sync? Files already in the repository stay there.')) return;
          try { await api(`/syncs/${c.id}`, { method: 'DELETE' }); await load(); } catch (err) { flash(err.message, 'err'); }
        },
      }, 'Remove')))));

  return el('div', { class: 'panel' }, head,
    el('div', { class: 'table-scroll' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Notion page', 'Destination', 'Schedule', 'Status', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, rows))));
}

function dangerZone() {
  return el('div', { class: 'panel' },
    el('h2', {}, 'Your data'),
    el('p', { class: 'muted' }, 'Deleting your account removes your sign-in, workspace connections, GitHub installations, sync settings and stored fingerprints. Files already committed to your repositories stay there.'),
    el('button', {
      class: 'btn danger small',
      onclick: async () => {
        if (!confirm('Really delete your account and everything in our database? This cannot be undone.')) return;
        try { await api('/account', { method: 'DELETE' }); location.href = '/'; } catch (err) { flash(err.message, 'err'); }
      },
    }, 'Delete everything'));
}

async function load() {
  let me;
  try {
    me = await api('/me');
  } catch (e) {
    if (e.status === 401) { location.href = '/'; return; }
    flash(e.message, 'err');
    return;
  }
  setupHeader(me.appName);
  document.getElementById('content').replaceChildren(connectionsPanel(me), syncsPanel(me), dangerZone());

  clearTimeout(timer);
  if (me.configs.some((c) => ['queued', 'running'].includes(c.status))) timer = setTimeout(load, 8000);
}

await load();
