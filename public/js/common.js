export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'repo-sync', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Builds DOM nodes. Text is always inserted as text, never as HTML. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

const MESSAGES = {
  cancelled: 'The Notion connection was cancelled.',
  notion: 'Notion did not accept the sign-in. Please try again.',
  'github-code': 'GitHub did not confirm the installation. In the GitHub App settings, turn on "Request user authorization (OAuth) during installation", then try again.',
  'github-auth': 'GitHub did not accept the authorization. Please try again.',
  'github-owner': 'That GitHub installation does not belong to your account.',
  'connect-first': 'Connect both Notion and GitHub first.',
  'github-connected': 'GitHub connected.',
  created: 'Sync created. It will start on the next sync run, usually within about 10 minutes.',
};

export function flash(message, kind = 'ok') {
  const box = document.getElementById('flash');
  box.replaceChildren(el('div', { class: `flash ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, message));
}

/** Shows ?error=... or ?status=... from a redirect, then cleans the address bar. */
export function flashFromQuery() {
  const params = new URLSearchParams(location.search);
  const error = params.get('error');
  const status = params.get('status');
  if (error) flash(MESSAGES[error] || 'Something went wrong.', 'err');
  else if (status) flash(MESSAGES[status] || 'Done.');
  if (error || status) history.replaceState(null, '', location.pathname);
}

export function setupHeader(appName) {
  if (appName) {
    document.getElementById('brand').textContent = appName;
    document.title = document.title.replace('Repo Sync for Notion', appName);
  }
  const button = document.getElementById('signout');
  button.classList.remove('hidden');
  button.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    location.href = '/';
  });
}
