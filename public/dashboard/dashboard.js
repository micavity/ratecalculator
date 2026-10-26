import { estimateRates, formatRange } from '/rates.js';

const app = document.getElementById('app');
const form = document.getElementById('profile');
const banner = document.getElementById('banner');
const saveStatus = document.getElementById('saveStatus');
const connectionsEl = document.getElementById('connections');

const THEMES = { purple: '#8b5cf6', blue: '#3b82f6', green: '#10b981', orange: '#f97316', pink: '#ec4899' };

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
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
let state;
let ratesSummary = '';

function kitUrl() {
  return `${location.origin}/${state.profile.slug}`;
}

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

function download(url, filename) {
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
}

// Tabs

function showTab(name) {
  const edit = name === 'edit';
  document.getElementById('panel-overview').hidden = edit;
  form.hidden = !edit;
  document.getElementById('tab-overview').setAttribute('aria-selected', String(!edit));
  document.getElementById('tab-edit').setAttribute('aria-selected', String(edit));
  history.replaceState(null, '', edit ? '#edit' : location.pathname);
}

document.getElementById('tab-overview').addEventListener('click', () => showTab('overview'));
document.getElementById('tab-edit').addEventListener('click', () => showTab('edit'));

// Overview

function renderKitLink() {
  document.getElementById('kitUrl').textContent = kitUrl().replace(/^https?:\/\//, '');
  document.getElementById('viewKit').href = `/${state.profile.slug}`;
  document.getElementById('pdfLink').href = `/${state.profile.slug}?print`;
  document.getElementById('slugPrefix').textContent = `${location.host}/`;
}

function renderViews() {
  document.getElementById('views7').textContent = number.format(state.views.last7);
  document.getElementById('views30').textContent = number.format(state.views.last30);
  document.getElementById('viewsTotal').textContent = number.format(state.views.total);
}

function rateInput() {
  const p = state.profile;
  const yt = state.connections.youtube?.stats || {};
  const platforms = [];
  if (Number(p.twitchAvgViewers)) platforms.push('twitch');
  if (state.connections.youtube) platforms.push('youtube');
  if (Number(p.tiktokAvgViews)) platforms.push('tiktok');
  return {
    platforms,
    region: p.region,
    focus: p.focus,
    twitchViewers: p.twitchAvgViewers,
    twitchHours: p.twitchHours,
    ytViews: yt.avgViews,
    ytShortsViews: yt.avgShortsViews,
    ytEngagement: yt.engagement,
    ttViews: p.tiktokAvgViews,
    ttEngagement: p.tiktokEngagement,
  };
}

function renderRates() {
  const container = document.getElementById('myRates');
  const { sections, bundle } = estimateRates(rateInput());
  container.replaceChildren();
  if (!sections.length) {
    container.append(el('p', { class: 'empty', text: 'Link YouTube or add your Twitch average viewers or TikTok views to see your rates.' }));
    document.getElementById('ratesActions').hidden = true;
    return;
  }
  const lines = [`${state.profile.displayName}: sponsorship rates`];
  for (const section of sections) {
    container.append(el('h3', { class: 'rates-heading', text: section.name }));
    lines.push('', section.name);
    for (const [label, range] of section.rates) {
      const text = formatRange(range);
      container.append(el('div', { class: 'rate' }, [el('span', { text: label }), el('span', { class: 'amount', text })]));
      lines.push(`- ${label}: ${text}`);
    }
  }
  if (bundle) {
    const text = formatRange(bundle);
    container.append(el('h3', { class: 'rates-heading', text: 'Bundle' }));
    container.append(el('div', { class: 'rate bundle' }, [el('span', { text: "One of each platform's main deal" }), el('span', { class: 'amount', text })]));
    lines.push('', `Multi-platform bundle: ${text}`);
  }
  lines.push('', `Media kit: ${kitUrl()}`);
  ratesSummary = lines.join('\n');
  document.getElementById('ratesActions').hidden = false;
}

function topStats() {
  const p = state.profile;
  const c = state.connections;
  return [
    ['Twitch followers', c.twitch?.stats.followers],
    ['Avg Twitch viewers', p.twitchAvgViewers],
    ['YouTube subscribers', c.youtube?.stats.subscribers],
    ['Avg YouTube views', c.youtube?.stats.avgViews],
    ['TikTok followers', p.tiktokFollowers],
    ['Avg TikTok views', p.tiktokAvgViews],
  ].filter(([, v]) => Number(v) > 0).slice(0, 3);
}

function drawShareImage() {
  const canvas = document.getElementById('shareCanvas');
  const ctx = canvas.getContext('2d');
  const accent = THEMES[state.profile.theme] || THEMES.purple;
  const font = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  ctx.fillStyle = '#0f1117';
  ctx.fillRect(0, 0, 1200, 630);
  const glow = ctx.createRadialGradient(1050, 80, 0, 1050, 80, 700);
  glow.addColorStop(0, `${accent}66`);
  glow.addColorStop(1, '#0f111700');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1200, 630);

  ctx.fillStyle = '#9aa1b5';
  ctx.font = `600 28px ${font}`;
  ctx.fillText('MEDIA KIT', 80, 110);

  ctx.fillStyle = '#ffffff';
  let size = 84;
  ctx.font = `800 ${size}px ${font}`;
  while (ctx.measureText(state.profile.displayName).width > 1040 && size > 40) {
    size -= 4;
    ctx.font = `800 ${size}px ${font}`;
  }
  ctx.fillText(state.profile.displayName, 80, 200);

  const width = 330;
  topStats().forEach(([label, value], i) => {
    const x = 80 + i * (width + 25);
    ctx.fillStyle = '#1e2230';
    ctx.beginPath();
    ctx.roundRect(x, 270, width, 170, 20);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 64px ${font}`;
    ctx.fillText(compact.format(Number(value)), x + 30, 360);
    ctx.fillStyle = '#9aa1b5';
    ctx.font = `500 26px ${font}`;
    ctx.fillText(label, x + 30, 405);
  });

  ctx.fillStyle = accent;
  ctx.font = `700 34px ${font}`;
  ctx.fillText(kitUrl().replace(/^https?:\/\//, ''), 80, 545);
  ctx.fillStyle = '#9aa1b5';
  ctx.font = `600 26px ${font}`;
  ctx.textAlign = 'right';
  ctx.fillText('CreatorGG', 1120, 545);
  ctx.textAlign = 'left';
}

function renderQr() {
  if (!window.qrcode) return;
  const qr = window.qrcode(0, 'M');
  qr.addData(kitUrl());
  qr.make();
  document.getElementById('qrImage').src = qr.createDataURL(8, 4);
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

function renderOverview() {
  renderKitLink();
  renderViews();
  renderRates();
  drawShareImage();
  renderQr();
  renderConnections();
}

// Edit form

const SPECIAL_FIELDS = new Set(['featured', 'theme']);

function audienceInputs() {
  return form.querySelectorAll('[data-audience]');
}

function getPath(obj, path) {
  return path.split('.').reduce((o, key) => (o == null ? undefined : o[key]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((key, i) => {
    if (o[key] == null) o[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[key];
  });
  o[keys.at(-1)] = value;
}

function fillForm() {
  const p = state.profile;
  for (const [name, value] of Object.entries(p)) {
    const field = form.elements[name];
    if (!field || SPECIAL_FIELDS.has(name) || !(field instanceof HTMLElement)) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = value ?? '';
  }
  form.querySelectorAll('input[name="featured"]').forEach((input, i) => { input.value = p.featured[i] || ''; });
  const theme = form.querySelector(`input[name="theme"][value="${p.theme}"]`) || form.querySelector('input[name="theme"]');
  theme.checked = true;
  audienceInputs().forEach((input) => { input.value = getPath(p.audience, input.dataset.audience) ?? ''; });
  document.getElementById('bioCount').textContent = form.elements.bio.value.length;
}

function readForm() {
  const data = {};
  for (const field of form.elements) {
    if (!field.name || SPECIAL_FIELDS.has(field.name)) continue;
    data[field.name] = field.type === 'checkbox' ? field.checked : field.value.trim();
  }
  data.featured = [...form.querySelectorAll('input[name="featured"]')].map((i) => i.value.trim()).filter(Boolean);
  data.theme = form.querySelector('input[name="theme"]:checked')?.value || 'purple';
  data.audience = { ages: {}, gender: {}, countries: [] };
  audienceInputs().forEach((input) => {
    if (input.value.trim() !== '') setPath(data.audience, input.dataset.audience, input.value.trim());
  });
  data.audience.countries = data.audience.countries.filter(Boolean);
  return data;
}

function fieldFor(name) {
  if (name === 'featured') return form.querySelector('input[name="featured"]');
  if (name === 'audience') return form.querySelector('[data-audience]');
  const field = form.elements[name];
  return field instanceof HTMLElement ? field : null;
}

async function unlink(provider, name) {
  if (!confirm(`Unlink ${name}? Its stats will be removed from your media kit.`)) return;
  try {
    await api(`/api/connections/${provider}`, { method: 'DELETE' });
    delete state.connections[provider];
    renderOverview();
  } catch (err) {
    showBanner(err.message);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  form.querySelectorAll('.invalid').forEach((f) => f.classList.remove('invalid'));
  saveStatus.textContent = 'Saving…';
  saveStatus.className = 'save-status';
  try {
    await api('/api/profile', { method: 'PUT', body: JSON.stringify(readForm()) });
    state = { ...state, ...(await api('/api/me')) };
    fillForm();
    renderOverview();
    saveStatus.textContent = 'Saved';
    saveStatus.classList.add('ok');
  } catch (err) {
    saveStatus.textContent = err.message;
    saveStatus.classList.add('error');
    const field = err.field && fieldFor(err.field);
    if (field) {
      field.classList.add('invalid');
      field.focus();
    }
  }
});

form.elements.bio.addEventListener('input', () => {
  document.getElementById('bioCount').textContent = form.elements.bio.value.length;
});

// Buttons

document.getElementById('copyLink').addEventListener('click', async (event) => {
  try {
    await navigator.clipboard.writeText(kitUrl());
    event.target.textContent = 'Copied!';
    setTimeout(() => { event.target.textContent = 'Copy link'; }, 2000);
  } catch {
    window.prompt('Copy your link:', kitUrl());
  }
});

document.getElementById('copyRates').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(ratesSummary);
    const copied = document.getElementById('ratesCopied');
    copied.hidden = false;
    setTimeout(() => { copied.hidden = true; }, 2000);
  } catch {
    window.prompt('Copy your rates:', ratesSummary);
  }
});

document.getElementById('downloadImage').addEventListener('click', () => {
  download(document.getElementById('shareCanvas').toDataURL('image/png'), `${state.profile.slug}-media-kit.png`);
});

document.getElementById('downloadQr').addEventListener('click', () => {
  // Redraw the QR code larger so the download is a crisp PNG
  const img = new Image();
  img.onload = () => {
    const canvas = el('canvas', { width: 1024, height: 1024 });
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, 1024, 1024);
    download(canvas.toDataURL('image/png'), `${state.profile.slug}-qr.png`);
  };
  img.src = document.getElementById('qrImage').src;
});

document.getElementById('refresh').addEventListener('click', async (event) => {
  const button = event.target;
  button.disabled = true;
  button.textContent = 'Refreshing…';
  try {
    const data = await api('/api/refresh', { method: 'POST' });
    state.connections = data.connections;
    renderOverview();
    if (!data.refreshed) showBanner('Stats are already up to date. You can refresh every 10 minutes.', 'info');
  } catch (err) {
    showBanner(err.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Refresh stats';
  }
});

document.getElementById('deleteAccount').addEventListener('click', async () => {
  const answer = prompt('This permanently deletes your CreatorGG account and media kit.\n\nType DELETE to confirm.');
  if (answer?.trim().toUpperCase() !== 'DELETE') return;
  try {
    await api('/api/account', { method: 'DELETE' });
    location.href = '/?deleted=1';
  } catch (err) {
    showBanner(err.message);
  }
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
  if (params.toString()) history.replaceState(null, '', location.pathname + location.hash);

  fillForm();
  renderOverview();
  showTab(location.hash === '#edit' ? 'edit' : 'overview');
  app.hidden = false;
}

init().catch((err) => {
  if (err.message !== 'Not signed in') {
    app.hidden = false;
    showBanner('Could not load your dashboard. Please refresh the page.');
  }
});
