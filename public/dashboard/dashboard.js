import { estimateRates, formatRange } from '/rates.js';

const app = document.getElementById('app');
const form = document.getElementById('profile');
const banner = document.getElementById('banner');
const saveStatus = document.getElementById('saveStatus');
const connectionsEl = document.getElementById('connections');

const THEMES = {
  purple: '#8b5cf6', blue: '#3b82f6', green: '#10b981', orange: '#f97316', pink: '#ec4899',
  red: '#ef4444', teal: '#14b8a6', yellow: '#eab308', indigo: '#6366f1', slate: '#64748b',
};

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

const TABS = {
  overview: document.getElementById('panel-overview'),
  edit: form,
  versions: document.getElementById('panel-versions'),
};

function showTab(name) {
  const current = name in TABS ? name : 'overview';
  for (const [key, panel] of Object.entries(TABS)) {
    panel.hidden = key !== current;
    document.getElementById(`tab-${key}`).setAttribute('aria-selected', String(key === current));
  }
  history.replaceState(null, '', current === 'overview' ? location.pathname : `#${current}`);
}

for (const key of Object.keys(TABS)) {
  document.getElementById(`tab-${key}`).addEventListener('click', () => showTab(key));
}

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

function renderCustomRates(container) {
  const p = state.profile;
  const lines = [`${p.displayName}: sponsorship rates`, ''];
  for (const r of p.rateCard) {
    container.append(el('div', { class: 'rate' }, [el('span', { text: r.name }), el('span', { class: 'amount', text: r.price })]));
    lines.push(`- ${r.name}: ${r.price}`);
  }
  if (p.packages.length) {
    container.append(el('h3', { class: 'rates-heading', text: 'Packages' }));
    lines.push('', 'Packages');
    for (const pkg of p.packages) {
      container.append(el('div', { class: 'rate' }, [
        el('span', {}, [el('strong', { text: pkg.name }), pkg.includes ? el('span', { class: 'muted', text: ` · ${pkg.includes}` }) : '']),
        el('span', { class: 'amount', text: pkg.price }),
      ]));
      lines.push(`- ${pkg.name}${pkg.includes ? ` (${pkg.includes})` : ''}: ${pkg.price}`);
    }
  }
  lines.push('', `Media kit: ${kitUrl()}`);
  ratesSummary = lines.join('\n');
  document.getElementById('ratesActions').hidden = false;
}

function renderRates() {
  const container = document.getElementById('myRates');
  const p = state.profile;
  container.replaceChildren();
  const custom = state.limits.essential && p.rateMode === 'custom' && (p.rateCard.length || p.packages.length);
  container.previousElementSibling.textContent = custom
    ? 'Your own rates, as shown on your kit. Edit them on the Edit kit tab.'
    : 'Estimated from your current stats. Change your stats on the Edit kit tab.';
  if (custom) {
    renderCustomRates(container);
    return;
  }
  const { sections, bundle } = estimateRates(rateInput());
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
  const accent = (state.limits.essential && state.profile.accent) || THEMES[state.profile.theme] || THEMES.purple;
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

const SPECIAL_FIELDS = new Set(['featured', 'theme', 'rateMode', 'useAccent', 'accentColor']);

// Plan bar and Essential locks

const PLAN_PRICES = 'Essential is $4.99/month or $49.99/year';
const GRACE_MS = 3 * 86400000;

function renderPlan() {
  const bar = document.getElementById('planBar');
  const { plan, limits } = state;
  bar.replaceChildren();
  const { billing } = state;
  if (limits.essential) {
    let detail = '';
    if (plan.source === 'gift') {
      detail = plan.expires ? `Gifted · until ${new Date(plan.expires).toLocaleDateString()}` : 'Gifted · never expires';
    } else if (billing.status === 'past_due') {
      detail = 'Payment failed · update your card to keep Essential';
    } else if (plan.expires) {
      // plan.expires includes a few days' grace after the paid period
      const periodEnd = new Date(plan.expires - GRACE_MS).toLocaleDateString();
      const cadence = billing.interval === 'year' ? 'Yearly' : 'Monthly';
      detail = billing.cancelAtPeriodEnd ? `${cadence} · ends ${periodEnd}` : `${cadence} · renews ${periodEnd}`;
    }
    bar.append(
      el('strong', { text: `${plan.name} plan` }),
      el('span', { class: detail.startsWith('Payment failed') ? 'plan-warning' : 'muted', text: detail ? ` · ${detail}` : '' }),
    );
    if (plan.founding) bar.append(el('span', { class: 'founding-badge', text: '★ Founding Creator' }));
    if (billing.configured && billing.hasCustomer) {
      const manage = el('button', { type: 'button', class: 'button-secondary plan-button', text: 'Manage subscription' });
      manage.addEventListener('click', () => goToStripe('/api/billing/portal', {}, manage));
      bar.append(manage);
    }
  } else {
    bar.append(el('span', { class: 'plan-pitch' }, [
      el('strong', { text: 'Free plan. ' }),
      document.createTextNode('Essential adds your own rates and packages, detailed analytics, brand tracking links, kit versions and more.'),
    ]));
    if (billing.configured) {
      const monthly = el('button', { type: 'button', class: 'plan-button', text: 'Upgrade · $4.99/month' });
      const yearly = el('button', { type: 'button', class: 'button-secondary plan-button', text: '$49.99/year · 2 months free' });
      monthly.addEventListener('click', () => goToStripe('/api/billing/checkout', { interval: 'month' }, monthly));
      yearly.addEventListener('click', () => goToStripe('/api/billing/checkout', { interval: 'year' }, yearly));
      bar.append(el('span', { class: 'plan-actions' }, [monthly, yearly]));
      if (state.referralDiscount) {
        bar.append(el('span', { class: 'plan-note', text: "You were referred by a creator, so you'll get 20% off your first 3 months." }));
      }
    } else {
      bar.append(el('span', { class: 'plan-cta', text: `${PLAN_PRICES} · Coming soon` }));
    }
  }
  bar.classList.toggle('plan-bar-essential', limits.essential);

  document.querySelectorAll('[data-essential-panel]').forEach((panel) => panel.classList.toggle('locked', !limits.essential));
  form.querySelectorAll('[data-essential]').forEach((group) => {
    group.classList.toggle('locked', !limits.essential);
    if (!limits.essential) group.querySelectorAll('input, select, textarea, button').forEach((control) => { control.disabled = true; });
  });
}

// Sends the creator to Stripe Checkout or the Customer Portal
async function goToStripe(path, body, button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Opening…';
  try {
    const { url } = await api(path, { method: 'POST', body: JSON.stringify(body) });
    location.href = url;
  } catch (err) {
    showBanner(err.message);
    button.disabled = false;
    button.textContent = label;
  }
}

// After paying, Stripe's confirmation can take a few seconds to reach us
async function waitForUpgrade() {
  showBanner('Payment received! Unlocking Essential…', 'info');
  for (let i = 0; i < 15 && !state.limits.essential; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    state = { ...state, ...(await api('/api/me')) };
  }
  if (state.limits.essential) {
    showBanner('Welcome to Essential! Everything is unlocked.', 'success');
    fillForm();
    renderPlan();
    renderOverview();
    renderVersions();
    loadAnalytics();
  } else {
    showBanner("Your payment went through, but Essential isn't showing yet. Refresh in a minute, or contact support@creatorgg.com.", 'info');
  }
}

// Rate card and package editors

const ROW_FIELDS = {
  rateCard: [['name', 'Deliverable', 'e.g. Sponsored stream (1 hour)', 60], ['price', 'Price', 'e.g. $150', 30]],
  packages: [['name', 'Package', 'e.g. Launch bundle', 60], ['price', 'Price', 'e.g. $350', 30], ['includes', "What's included", 'e.g. 1 stream + 2 Shorts', 200]],
};

function addRow(editor, values = {}) {
  const fields = ROW_FIELDS[editor.dataset.field];
  const row = el('div', { class: 'row-item' });
  for (const [key, label, placeholder, max] of fields) {
    const input = el('input', { type: 'text', 'data-key': key, maxlength: String(max), placeholder, 'aria-label': label });
    input.value = values[key] || '';
    row.append(el('label', { class: key === 'includes' ? 'row-wide' : '' }, [document.createTextNode(label), input]));
  }
  const remove = el('button', { type: 'button', class: 'button-link', text: 'Remove', 'aria-label': 'Remove' });
  remove.addEventListener('click', () => row.remove());
  row.append(remove);
  editor.append(row);
}

function fillRows(editor, rows) {
  editor.replaceChildren();
  rows.forEach((r) => addRow(editor, r));
}

function readRows(editor) {
  return [...editor.querySelectorAll('.row-item')].map((row) => Object.fromEntries(
    [...row.querySelectorAll('input[data-key]')].map((input) => [input.dataset.key, input.value.trim()]),
  )).filter((r) => Object.values(r).some(Boolean));
}

const rateCardEditor = document.getElementById('rateCardEditor');
const packagesEditor = document.getElementById('packagesEditor');
document.getElementById('addRate').addEventListener('click', () => addRow(rateCardEditor));
document.getElementById('addPackage').addEventListener('click', () => addRow(packagesEditor));
document.getElementById('fillFromEstimates').addEventListener('click', () => {
  const { sections } = estimateRates(rateInput());
  const rows = sections.flatMap((s) => s.rates.map(([label, range]) => ({ name: `${s.name}: ${label}`, price: formatRange(range) })));
  if (!rows.length) {
    showBanner('Add some stats first so we can estimate your rates.', 'info');
    return;
  }
  fillRows(rateCardEditor, rows);
  form.querySelector('input[name="rateMode"][value="custom"]').checked = true;
});

// Section order editor

const SECTION_LABELS = {
  platforms: 'Platform stats',
  audience: 'Audience',
  featured: 'Featured content',
  brands: "Brands I've worked with",
  rates: 'Sponsorship rates',
};
const sectionList = document.getElementById('sectionList');

function renderSections(sections, list = sectionList) {
  list.replaceChildren();
  sections.forEach((section, i) => {
    const visible = el('input', { type: 'checkbox', 'aria-label': `Show ${SECTION_LABELS[section.key]}` });
    visible.checked = section.visible;
    const up = el('button', { type: 'button', class: 'button-secondary icon-button', 'aria-label': 'Move up', text: '↑' });
    const down = el('button', { type: 'button', class: 'button-secondary icon-button', 'aria-label': 'Move down', text: '↓' });
    up.disabled = i === 0;
    down.disabled = i === sections.length - 1;
    const move = (delta) => {
      const current = readSections(list);
      const [item] = current.splice(i, 1);
      current.splice(i + delta, 0, item);
      renderSections(current, list);
    };
    up.addEventListener('click', () => move(-1));
    down.addEventListener('click', () => move(1));
    list.append(el('li', { 'data-key': section.key }, [
      el('label', { class: 'toggle' }, [visible, document.createTextNode(SECTION_LABELS[section.key])]),
      el('span', { class: 'section-moves' }, [up, down]),
    ]));
  });
}

function readSections(list = sectionList) {
  return [...list.querySelectorAll('li')].map((li) => ({
    key: li.dataset.key,
    visible: li.querySelector('input').checked,
  }));
}

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
  form.querySelector(`input[name="rateMode"][value="${p.rateMode === 'custom' ? 'custom' : 'estimates'}"]`).checked = true;
  form.elements.useAccent.checked = Boolean(p.accent);
  form.elements.accentColor.value = p.accent || THEMES[p.theme] || THEMES.purple;
  fillRows(rateCardEditor, p.rateCard);
  fillRows(packagesEditor, p.packages);
  renderSections(p.sections);
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
  data.rateMode = form.querySelector('input[name="rateMode"]:checked')?.value || 'estimates';
  data.rateCard = readRows(rateCardEditor);
  data.packages = readRows(packagesEditor);
  data.sections = readSections();
  data.accent = form.elements.useAccent.checked ? form.elements.accentColor.value : '';
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
    renderPlan();
    renderOverview();
    renderVersions();
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

// Detailed analytics and tracked brand links (Essential)

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const analyticsBody = document.getElementById('analyticsBody');
const linkForm = document.getElementById('linkForm');

function relativeTime(ts) {
  const minutes = Math.round((Date.now() - ts) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : new Date(ts).toLocaleDateString();
}

function countryName(code) {
  if (!/^[A-Z]{2}$/.test(code)) return 'Unknown';
  try {
    return regionNames.of(code);
  } catch {
    return code;
  }
}

function barList(title, rows, label = (r) => r.label) {
  const max = Math.max(1, ...rows.map((r) => r.views));
  return el('div', { class: 'stat-list' }, [
    el('h3', { class: 'rates-heading', text: title }),
    ...(rows.length ? rows.map((r) => el('div', { class: 'bar-row' }, [
      el('span', { class: 'bar-label', text: label(r), title: label(r) }),
      el('span', { class: 'bar' }, [el('span', { style: `width:${(r.views / max) * 100}%` })]),
      el('span', { class: 'bar-value', text: number.format(r.views) }),
    ])) : [el('p', { class: 'small muted', text: 'No visits yet.' })]),
  ]);
}

function teaser(text) {
  return el('div', { class: 'teaser' }, [
    el('p', { text }),
    el('p', { class: 'plan-cta', text: state.billing.configured ? `${PLAN_PRICES} · Upgrade at the top of this page` : `${PLAN_PRICES} · Coming soon` }),
  ]);
}

function kitLink(versionKey, linkId) {
  return `${location.origin}/${state.profile.slug}${versionKey ? `/${versionKey}` : ''}${linkId ? `?for=${linkId}` : ''}`;
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = 'Copied!';
    setTimeout(() => { button.textContent = original; }, 2000);
  } catch {
    window.prompt('Copy this link:', text);
  }
}

function renderVersionSelect() {
  const select = linkForm.elements.versionId;
  select.replaceChildren(el('option', { value: '', text: 'Main kit' }),
    ...state.versions.map((v) => el('option', { value: v.id, text: `Version: ${v.name}` })));
}

function renderLinks(links, recent) {
  const recentEl = document.getElementById('recentOpens');
  recentEl.replaceChildren();
  if (recent.length) {
    recentEl.append(el('h3', { class: 'rates-heading', text: 'Recent opens' }), el('ul', { class: 'activity' },
      recent.map((r) => el('li', {}, [
        el('strong', { text: r.label }),
        document.createTextNode(` opened your kit · ${relativeTime(r.at)}${r.country && r.country !== 'Unknown' ? ` · ${countryName(r.country)}` : ''}`),
      ]))));
  }

  const list = document.getElementById('linkList');
  list.replaceChildren();
  if (!links.length) {
    list.append(el('p', { class: 'small muted', text: 'No tracked links yet.' }));
    return;
  }
  list.append(el('h3', { class: 'rates-heading', text: 'Your links' }));
  for (const link of links) {
    const url = kitLink(link.versionKey, link.id);
    const copy = el('button', { type: 'button', class: 'button-secondary', text: 'Copy link' });
    copy.addEventListener('click', () => copyText(url, copy));
    const remove = el('button', { type: 'button', class: 'button-link', text: 'Delete' });
    remove.addEventListener('click', async () => {
      if (!confirm(`Delete the link for ${link.label}? It will stop being tracked.`)) return;
      try {
        await api(`/api/links/${link.id}`, { method: 'DELETE' });
        loadAnalytics();
      } catch (err) {
        showBanner(err.message);
      }
    });
    const opened = link.opens
      ? `Opened ${link.opens} time${link.opens === 1 ? '' : 's'} · last ${relativeTime(link.lastOpenedAt)}`
      : 'Not opened yet';
    list.append(el('div', { class: 'connection link-row' }, [
      el('div', {}, [
        el('strong', { text: link.label }),
        link.versionName ? el('span', { class: 'version-tag', text: link.versionName }) : document.createTextNode(''),
        el('p', { class: `small ${link.opens ? 'opened' : 'muted'}`, text: opened }),
        el('p', { class: 'small muted link-url', text: url.replace(/^https?:\/\//, '') }),
      ]),
      el('div', { class: 'kit-link-actions' }, [copy, remove]),
    ]));
  }
}

async function loadAnalytics() {
  const linksPanelParts = [linkForm, document.getElementById('recentOpens'), document.getElementById('linkList')];
  if (!state.limits.essential) {
    analyticsBody.replaceChildren(teaser('See your views day by day, which sites visitors came from (X, Discord, Google, email…) and which countries they are in.'));
    document.getElementById('analyticsDays').disabled = true;
    linksPanelParts[1].replaceChildren(teaser('Make a link for each brand you pitch and see exactly when they open your kit, so you know the right moment to follow up.'));
    linksPanelParts[2].replaceChildren();
    linkForm.hidden = true;
    return;
  }
  linkForm.hidden = false;
  document.getElementById('analyticsDays').disabled = false;
  const days = document.getElementById('analyticsDays').value;
  let data;
  try {
    data = await api(`/api/analytics?days=${days}`);
  } catch (err) {
    analyticsBody.replaceChildren(el('p', { class: 'small muted', text: err.message }));
    return;
  }

  const total = data.daily.reduce((sum, d) => sum + d.views, 0);
  const max = Math.max(1, ...data.daily.map((d) => d.views));
  const chart = el('div', { class: 'day-chart', role: 'img', 'aria-label': `${total} views in the last ${data.days} days` },
    data.daily.map((d) => el('span', {
      class: 'day-bar',
      style: `height:${Math.max(2, (d.views / max) * 100)}%`,
      title: `${new Date(`${d.day}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${d.views} view${d.views === 1 ? '' : 's'}`,
    })));
  analyticsBody.replaceChildren(
    el('p', { class: 'chart-total' }, [el('strong', { text: number.format(total) }), document.createTextNode(` views in the last ${data.days} days`)]),
    chart,
    el('div', { class: 'chart-axis small muted' }, [el('span', { text: `${data.days} days ago` }), el('span', { text: 'Today' })]),
    el('div', { class: 'analytics-lists' }, [
      barList('Where visitors came from', data.sources),
      barList('Countries', data.countries, (r) => countryName(r.label)),
    ]),
  );
  renderLinks(data.links, data.recent);
}

document.getElementById('analyticsDays').addEventListener('change', loadAnalytics);

linkForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/links', {
      method: 'POST',
      body: JSON.stringify({ label: linkForm.elements.label.value, versionId: linkForm.elements.versionId.value || null }),
    });
    linkForm.elements.label.value = '';
    loadAnalytics();
  } catch (err) {
    showBanner(err.message);
  }
});

// Kit versions (Essential)

const versionList = document.getElementById('versionList');
const newVersionForm = document.getElementById('newVersionForm');

function videoInputs(values, max) {
  return Array.from({ length: max }, (_, i) => {
    const input = el('input', { type: 'url', 'data-video': '', placeholder: i === 0 ? 'https://youtube.com/watch?v=…' : '', 'aria-label': `Video ${i + 1}` });
    input.value = values[i] || '';
    return el('label', {}, [document.createTextNode(`Video ${i + 1}`), input]);
  });
}

// One "use something different from my main kit" block in the version editor
function overrideBlock(title, checked, content) {
  const toggle = el('input', { type: 'checkbox', 'data-override': '' });
  toggle.checked = checked;
  const body = el('div', { class: 'override-body' }, content);
  const sync = () => {
    body.hidden = !toggle.checked;
  };
  toggle.addEventListener('change', sync);
  sync();
  return { toggle, node: el('div', { class: 'override' }, [el('label', { class: 'toggle' }, [toggle, document.createTextNode(title)]), body]) };
}

function versionCard(version) {
  const p = state.profile;
  const essential = state.limits.essential;
  const status = el('span', { class: 'save-status', role: 'status' });

  const name = el('input', { type: 'text', maxlength: '40', 'aria-label': 'Version name' });
  name.value = version.name;
  const key = el('input', { type: 'text', maxlength: '30', 'aria-label': 'Version link' });
  key.value = version.key;

  const bioText = el('textarea', { rows: '3', maxlength: '500' });
  bioText.value = version.bio ?? p.bio;
  const bio = overrideBlock('Use a different bio', version.bio !== null, [bioText]);

  const videos = overrideBlock('Use different featured videos', version.featured !== null,
    videoInputs(version.featured ?? p.featured, state.limits.featured || 6));

  const layoutList = el('ul', { class: 'section-list' });
  renderSections(version.sections ?? p.sections, layoutList);
  const layout = overrideBlock('Use a different layout', version.sections !== null, [layoutList]);

  const rates = version.rates ?? { show: p.showRates, mode: p.rateMode, card: p.rateCard, packages: p.packages };
  const showRates = el('input', { type: 'checkbox' });
  showRates.checked = rates.show;
  const modeName = `mode-${version.id}`;
  const modeInputs = ['estimates', 'custom'].map((m) => {
    const input = el('input', { type: 'radio', name: modeName, value: m });
    input.checked = (rates.mode === 'custom' ? 'custom' : 'estimates') === m;
    return el('label', { class: 'toggle' }, [input, document.createTextNode(m === 'custom' ? ' Show my own rates' : ' Show estimated rates')]);
  });
  const cardEditor = el('div', { class: 'row-editor', 'data-field': 'rateCard' });
  const packageEditor = el('div', { class: 'row-editor', 'data-field': 'packages' });
  fillRows(cardEditor, rates.card);
  fillRows(packageEditor, rates.packages);
  const addRate = el('button', { type: 'button', class: 'button-secondary', text: 'Add a rate' });
  addRate.addEventListener('click', () => addRow(cardEditor));
  const addPackage = el('button', { type: 'button', class: 'button-secondary', text: 'Add a package' });
  addPackage.addEventListener('click', () => addRow(packageEditor));
  const ratesBlock = overrideBlock('Use different rates', version.rates !== null, [
    el('label', { class: 'toggle' }, [showRates, document.createTextNode('Show rates on this version')]),
    el('div', { class: 'radio-row' }, modeInputs),
    el('h3', { class: 'sub-heading', text: 'Rates' }), cardEditor, el('div', { class: 'actions' }, [addRate]),
    el('h3', { class: 'sub-heading', text: 'Packages' }), packageEditor, el('div', { class: 'actions' }, [addPackage]),
  ]);

  const url = kitLink(version.key);
  const copy = el('button', { type: 'button', class: 'button-secondary', text: 'Copy link' });
  copy.addEventListener('click', () => copyText(kitLink(version.key), copy));
  const view = el('a', { class: 'button button-secondary', href: `/${p.slug}/${version.key}`, target: '_blank', rel: 'noopener', text: 'View' });
  const remove = el('button', { type: 'button', class: 'button-link', text: 'Delete version' });
  remove.addEventListener('click', async () => {
    if (!confirm(`Delete "${version.name}"? Its link will go to your main kit instead.`)) return;
    try {
      await api(`/api/versions/${version.id}`, { method: 'DELETE' });
      state.versions = state.versions.filter((v) => v.id !== version.id);
      renderVersions();
      loadAnalytics();
    } catch (err) {
      showBanner(err.message);
    }
  });

  const save = el('button', { type: 'button', text: 'Save version' });
  save.addEventListener('click', async () => {
    status.textContent = 'Saving…';
    status.className = 'save-status';
    const body = {
      name: name.value,
      key: key.value,
      bio: bio.toggle.checked ? bioText.value : null,
      featured: videos.toggle.checked ? [...videos.node.querySelectorAll('[data-video]')].map((i) => i.value.trim()).filter(Boolean) : null,
      sections: layout.toggle.checked ? readSections(layoutList) : null,
      rates: ratesBlock.toggle.checked ? {
        show: showRates.checked,
        mode: ratesBlock.node.querySelector(`input[name="${modeName}"]:checked`)?.value,
        card: readRows(cardEditor),
        packages: readRows(packageEditor),
      } : null,
    };
    try {
      const data = await api(`/api/versions/${version.id}`, { method: 'PUT', body: JSON.stringify(body) });
      state.versions = state.versions.map((v) => (v.id === version.id ? data.version : v));
      renderVersions();
      loadAnalytics();
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('error');
    }
  });

  const card = el('section', { class: 'panel version-card' }, [
    el('div', { class: 'section-head' }, [
      el('div', {}, [el('h2', { text: version.name }), el('p', { class: 'kit-url', text: url.replace(/^https?:\/\//, '') })]),
      el('div', { class: 'kit-link-actions' }, [copy, view]),
    ]),
    el('div', { class: 'field-row' }, [
      el('label', {}, [document.createTextNode('Name'), name]),
      el('label', {}, [document.createTextNode('Link'), el('span', { class: 'prefixed' }, [el('span', { class: 'prefix', text: `/${p.slug}/` }), key])]),
    ]),
    bio.node, videos.node, layout.node, ratesBlock.node,
    el('div', { class: 'save-bar version-save' }, [save, status, remove]),
  ]);
  if (!essential) {
    card.classList.add('locked');
    card.querySelectorAll('input, select, textarea, button').forEach((c) => { c.disabled = c !== remove; });
  }
  return card;
}

function renderVersions() {
  document.getElementById('versionPrefix').textContent = `/${state.profile.slug}/`;
  versionList.replaceChildren(...state.versions.map(versionCard));
  const full = state.versions.length >= (state.limits.versions || 0);
  newVersionForm.hidden = !state.limits.essential || full;
  const panel = newVersionForm.closest('section');
  panel.querySelector('.teaser')?.remove();
  if (!state.limits.essential) {
    panel.append(teaser('Make tailored versions of your kit for different kinds of brands, each with its own link.'));
  } else if (full) {
    panel.append(el('p', { class: 'small muted teaser', text: `You're using all ${state.limits.versions} extra versions.` }));
  }
  renderVersionSelect();
}

newVersionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/versions', {
      method: 'POST',
      body: JSON.stringify({ name: newVersionForm.elements.name.value, key: newVersionForm.elements.key.value }),
    });
    state.versions.push(data.version);
    newVersionForm.reset();
    renderVersions();
  } catch (err) {
    showBanner(err.message);
  }
});

// Referral program

const referralForm = document.getElementById('payoutForm');

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

async function loadReferrals() {
  let data;
  try {
    data = await api('/api/referrals');
  } catch {
    return;
  }
  const p = data.program;
  document.getElementById('referralPitch').textContent = `Share your link or code. Creators who sign up with it get ${p.discountPercent}% off their first ${p.discountMonths} months of Essential, and you earn ${Math.round(p.commissionRate * 100)}% of what they pay for ${p.commissionMonths} months.`;
  document.getElementById('referralCode').textContent = data.code;
  document.getElementById('referralLink').textContent = data.link.replace(/^https?:\/\//, '');
  document.getElementById('copyReferralLink').onclick = (event) => copyText(data.link, event.target);
  document.getElementById('copyReferralCode').onclick = (event) => copyText(data.code, event.target);
  const s = data.stats;
  const card = (value, label) => el('div', { class: 'stat' }, [el('span', { class: 'stat-value', text: value }), el('span', { class: 'stat-label', text: label })]);
  document.getElementById('referralStats').replaceChildren(
    card(number.format(s.signups), 'Sign-ups'),
    card(number.format(s.paying), 'Paying'),
    card(money(s.availableCents), 'Ready to pay out'),
    card(money(s.heldCents), `Held (${p.holdDays} days)`),
    card(money(s.paidCents), 'Paid to you'),
  );
  document.getElementById('referralTerms').textContent = `Earnings are held for ${p.holdDays} days in case of refunds, then paid by PayPal once you reach ${money(p.minPayoutCents)}. When you share your link, say that you earn from it (for example "#ad" or "affiliate link").`;
  referralForm.elements.payoutEmail.value = data.payoutEmail || '';
}

referralForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.getElementById('payoutStatus');
  try {
    await api('/api/referrals', { method: 'PUT', body: JSON.stringify({ payoutEmail: referralForm.elements.payoutEmail.value }) });
    status.textContent = 'Saved';
    status.className = 'save-status ok';
  } catch (err) {
    status.textContent = err.message;
    status.className = 'save-status error';
  }
});

async function init() {
  state = await api('/api/me');
  const params = new URLSearchParams(location.search);
  if (params.get('error')) showBanner(MESSAGES[params.get('error')] || MESSAGES.failed);
  if (params.get('upgrade') === 'cancelled') showBanner('Checkout cancelled. You have not been charged.', 'info');
  const justUpgraded = params.get('upgraded');
  if (params.get('connected') === 'merged') {
    showBanner('Account linked. It was on another CreatorGG profile, so we combined the two into one.', 'success');
  } else if (params.get('connected')) {
    showBanner('Account linked.', 'success');
  }
  if (params.toString()) history.replaceState(null, '', location.pathname + location.hash);

  document.getElementById('accountId').textContent = state.accountId;
  fillForm();
  renderPlan();
  renderOverview();
  renderVersions();
  loadAnalytics();
  showTab(location.hash.slice(1));
  app.hidden = false;
  loadReferrals();
  // Continue an upgrade started on the pricing page
  let pendingUpgrade = null;
  try {
    pendingUpgrade = sessionStorage.getItem('cgg_upgrade');
    sessionStorage.removeItem('cgg_upgrade');
  } catch {}
  if (pendingUpgrade && !state.limits.essential && state.billing.configured) {
    const button = document.querySelector('.plan-actions button') || el('button');
    goToStripe('/api/billing/checkout', { interval: pendingUpgrade === 'year' ? 'year' : 'month' }, button);
  } else if (pendingUpgrade && state.limits.essential) {
    showBanner("You're already on Essential.", 'info');
  }
  if (justUpgraded && !state.limits.essential) waitForUpgrade();
  else if (justUpgraded) showBanner('Welcome to Essential! Everything is unlocked.', 'success');
}

init().catch((err) => {
  if (err.message !== 'Not signed in') {
    app.hidden = false;
    showBanner('Could not load your dashboard. Please refresh the page.');
  }
});
