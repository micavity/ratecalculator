const app = document.getElementById('app');
const form = document.getElementById('profile');
const banner = document.getElementById('banner');
const saveStatus = document.getElementById('saveStatus');
const connectionsEl = document.getElementById('connections');

const PLATFORMS = {
  twitch: { name: 'Twitch', stats: (s) => [['Followers', s.followers]] },
  youtube: {
    name: 'YouTube',
    stats: (s) => [
      ['Subscribers', s.subscribers],
      ['Avg views', s.avgViews],
      ['Avg Short views', s.avgShortsViews],
      ['Engagement', s.engagement != null ? `${s.engagement}%` : null],
    ],
  },
};

const MESSAGES = {
  cancelled: 'Linking was cancelled.',
  expired: 'That link expired. Please try again.',
  no_channel: "That Google account doesn't have a YouTube channel.",
  not_configured: "That platform isn't set up yet.",
  failed: 'Something went wrong. Please try again.',
};

const number = new Intl.NumberFormat('en-US');
let state;

function showBanner(text, kind = 'error') {
  banner.textContent = text;
  banner.className = `alert alert-${kind}`;
  banner.hidden = false;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'content-type': 'application/json' } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    location.replace('/login/');
    throw new Error('Not signed in');
  }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { field: data.field });
  return data;
}

function renderKitLink() {
  const url = `${location.origin}/${state.profile.slug}`;
  document.getElementById('kitUrl').textContent = url.replace(/^https?:\/\//, '');
  document.getElementById('viewKit').href = `/${state.profile.slug}`;
  document.getElementById('slugPrefix').textContent = `${location.host}/`;
}

function renderConnections() {
  connectionsEl.replaceChildren();
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    const conn = state.connections[key];
    const row = el('div', { class: 'connection' });

    if (conn) {
      const stats = platform.stats(conn.stats)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([label, value]) => `${label}: ${typeof value === 'number' ? number.format(value) : value}`)
        .join(' · ');
      const updated = conn.statsUpdatedAt ? `Updated ${new Date(conn.statsUpdatedAt).toLocaleString()}` : '';
      const disconnect = el('button', { type: 'button', class: 'button-link', text: 'Unlink' });
      disconnect.addEventListener('click', () => unlink(key, platform.name));
      row.append(
        el('div', {}, [
          el('strong', { text: platform.name }),
          el('span', { class: 'muted', text: ` · ${conn.username}` }),
          el('p', { class: 'small', text: stats || 'No stats yet' }),
          el('p', { class: 'small muted', text: updated }),
        ]),
        disconnect,
      );
    } else {
      row.append(
        el('div', {}, [el('strong', { text: platform.name }), el('p', { class: 'small muted', text: 'Not linked' })]),
        state.available[key]
          ? el('a', { class: 'button button-secondary', href: `/auth/${key}`, text: `Link ${platform.name}` })
          : el('span', { class: 'small muted', text: 'Coming soon' }),
      );
    }
    connectionsEl.append(row);
  }
}

function fillForm() {
  const p = state.profile;
  for (const [name, value] of Object.entries(p)) {
    const field = form.elements[name];
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = value ?? '';
  }
  document.getElementById('bioCount').textContent = form.elements.bio.value.length;
}

function readForm() {
  const data = {};
  for (const field of form.elements) {
    if (!field.name) continue;
    data[field.name] = field.type === 'checkbox' ? field.checked : field.value.trim();
  }
  return data;
}

async function unlink(provider, name) {
  if (!confirm(`Unlink ${name}? Its stats will be removed from your media kit.`)) return;
  try {
    await api(`/api/connections/${provider}`, { method: 'DELETE' });
    delete state.connections[provider];
    renderConnections();
  } catch (err) {
    showBanner(err.message);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  form.querySelectorAll('.invalid').forEach((f) => f.classList.remove('invalid'));
  saveStatus.textContent = 'Saving…';
  saveStatus.className = 'save-status';
  const data = readForm();
  try {
    await api('/api/profile', { method: 'PUT', body: JSON.stringify(data) });
    state.profile = { ...state.profile, ...data, slug: data.slug.toLowerCase() };
    renderKitLink();
    saveStatus.textContent = 'Saved';
    saveStatus.classList.add('ok');
  } catch (err) {
    saveStatus.textContent = err.message;
    saveStatus.classList.add('error');
    const field = err.field && form.elements[err.field];
    if (field) {
      field.classList.add('invalid');
      field.focus();
    }
  }
});

form.elements.bio.addEventListener('input', () => {
  document.getElementById('bioCount').textContent = form.elements.bio.value.length;
});

document.getElementById('copyLink').addEventListener('click', async (event) => {
  const url = `${location.origin}/${state.profile.slug}`;
  try {
    await navigator.clipboard.writeText(url);
    event.target.textContent = 'Copied!';
    setTimeout(() => { event.target.textContent = 'Copy link'; }, 2000);
  } catch {
    window.prompt('Copy your link:', url);
  }
});

document.getElementById('refresh').addEventListener('click', async (event) => {
  const button = event.target;
  button.disabled = true;
  button.textContent = 'Refreshing…';
  try {
    const data = await api('/api/refresh', { method: 'POST' });
    state.connections = data.connections;
    renderConnections();
    if (!data.refreshed) showBanner('Stats are already up to date. You can refresh every 10 minutes.', 'info');
  } catch (err) {
    showBanner(err.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Refresh stats';
  }
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/';
});

async function init() {
  state = await api('/api/me');
  const params = new URLSearchParams(location.search);
  if (params.get('error')) showBanner(MESSAGES[params.get('error')] || MESSAGES.failed);
  if (params.get('connected') === 'merged') {
    showBanner('Account linked. It was on another CreatorGG profile, so we combined the two into one.', 'success');
  } else if (params.get('connected')) {
    showBanner('Account linked.', 'success');
  }
  if (params.toString()) history.replaceState(null, '', location.pathname);

  renderKitLink();
  renderConnections();
  fillForm();
  app.hidden = false;
}

init().catch((err) => {
  if (err.message !== 'Not signed in') {
    app.hidden = false;
    showBanner('Could not load your dashboard. Please refresh the page.');
  }
});
