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

// Platforms with stats the creator types in (matches src/lib/socials.js)
const SOCIALS = [
  { key: 'instagram', rateKey: 'ig', name: 'Instagram' },
  { key: 'facebook', rateKey: 'fb', name: 'Facebook' },
  { key: 'x', rateKey: 'x', name: 'X' },
];

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
  deals: document.getElementById('panel-deals'),
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
  for (const s of SOCIALS) {
    if (Number(p[`${s.key}Followers`]) || Number(p[`${s.key}AvgViews`])) platforms.push(s.key);
  }
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
    ...Object.fromEntries(SOCIALS.flatMap((s) => [
      [`${s.rateKey}Followers`, p[`${s.key}Followers`]],
      [`${s.rateKey}Views`, p[`${s.key}AvgViews`]],
      [`${s.rateKey}Engagement`, p[`${s.key}Engagement`]],
    ])),
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
    ...SOCIALS.map((s) => [`${s.name} followers`, p[`${s.key}Followers`]]),
  ].filter(([, v]) => Number(v) > 0)
    // The biggest numbers make the best share card
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3);
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

// "Complete your kit" checklist

const CHECKLIST_HIDDEN = 'cgg_checklist_hidden';
const KIT_SHARED = 'cgg_kit_shared';

function stored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

// Opens the Edit kit tab with the given field in view
function goToField(field) {
  showTab('edit');
  if (!field) return;
  field.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => field.focus({ preventScroll: true }), 300);
}

function checklistItems() {
  const p = state.profile;
  const c = state.connections;
  const audience = p.audience || {};
  const hasAudience = Object.keys(audience.ages || {}).length || Object.keys(audience.gender || {}).length || (audience.countries || []).length;
  const missing = ['twitch', 'youtube'].find((key) => !c[key] && state.available[key]);
  const items = [
    { done: Boolean(p.bio), label: 'Write a short bio', hint: 'Tell brands who you are and what your community is like.', action: () => goToField(form.elements.bio) },
    { done: Boolean(p.games), label: 'Add your games or topics', hint: 'Brands search for creators who cover what they sell.', action: () => goToField(form.elements.games) },
    { done: Boolean(p.contactEmail), label: 'Add a business email', hint: 'It powers the "Work with me" button on your kit.', action: () => goToField(form.elements.contactEmail) },
  ];
  if (c.twitch) {
    items.push({ done: Boolean(p.twitchAvgViewers), label: 'Add your Twitch average viewers', hint: 'Twitch doesn\'t share this with apps, and brands price streams by it.', action: () => goToField(form.elements.twitchAvgViewers) });
  }
  items.push(
    { done: !missing, label: missing ? `Link your ${missing === 'twitch' ? 'Twitch' : 'YouTube'} too` : 'Link your platforms', hint: 'More verified stats make a stronger kit.', action: () => { if (missing) location.href = `/auth/${missing}`; } },
    { done: p.featured.length > 0, label: 'Feature your best video or clip', hint: 'Brands love seeing your content and its real numbers.', action: () => goToField(form.querySelector('input[name="featured"]')) },
    { done: Boolean(hasAudience), label: 'Add your audience details', hint: 'Age, gender and top countries from your analytics.', action: () => goToField(form.querySelector('[data-audience]')) },
    { done: state.views.total > 0 || stored(KIT_SHARED) === '1', label: 'Share your kit with a brand', hint: 'Copies your kit link so you can paste it in an email or DM.', action: () => document.getElementById('copyLink').click() },
  );
  return items;
}

function renderChecklist() {
  const box = document.getElementById('checklist');
  const items = checklistItems();
  const done = items.filter((i) => i.done).length;
  box.hidden = done === items.length || stored(CHECKLIST_HIDDEN) === '1';
  if (box.hidden) return;
  document.getElementById('checklistCount').textContent = `${done} of ${items.length} done.`;
  document.getElementById('checklistBar').style.width = `${(done / items.length) * 100}%`;
  document.getElementById('checklistItems').replaceChildren(...items.map((item) => {
    const button = el('button', { type: 'button', class: 'button-secondary', text: item.done ? 'Done' : 'Do it' });
    button.disabled = item.done;
    button.addEventListener('click', item.action);
    return el('li', { class: item.done ? 'done' : '' }, [
      el('span', { class: 'check', 'aria-hidden': 'true', text: item.done ? '✓' : '' }),
      el('div', {}, [el('strong', { text: item.label }), el('p', { class: 'small muted', text: item.hint })]),
      button,
    ]);
  }));
}

document.getElementById('hideChecklist').addEventListener('click', () => {
  store(CHECKLIST_HIDDEN, '1');
  document.getElementById('checklist').hidden = true;
});

function renderOverview() {
  renderChecklist();
  renderKitLink();
  renderViews();
  renderRates();
  drawShareImage();
  renderQr();
  renderConnections();
}

// Games: suggestions with Twitch box art as the creator types

const gamesInput = form.elements.games;
const gameSuggestions = document.getElementById('gameSuggestions');
const gamePreview = document.getElementById('gamePreview');
const pickedGames = new Map();
let gameSearchTimer = null;
let gameSearchSeq = 0;
let gameOptions = [];
let gameActive = -1;

function normName(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function boxArt(template, width, height) {
  return template.replace('{width}', width).replace('{height}', height);
}

function gameEntries() {
  return gamesInput.value.split(',').map((g) => g.trim()).filter(Boolean).slice(0, 12);
}

// Art we already know for a listed name: picked just now, or matched when last saved
function knownArt(text) {
  const saved = (state.profile.gameArt || []).find((g) => g.text === text);
  return saved || pickedGames.get(normName(text)) || null;
}

function renderGamePreview() {
  gamePreview.replaceChildren(...gameEntries().map((text) => {
    const game = knownArt(text);
    if (!game?.art) return el('li', { text });
    return el('li', { class: 'game' }, [
      el('img', { src: boxArt(game.art, 72, 96), alt: '', width: '36', height: '48' }),
      document.createTextNode(game.name),
    ]);
  }));
}

// The comma-separated part of the box the cursor is in
function currentSegment() {
  const value = gamesInput.value;
  const caret = gamesInput.selectionStart ?? value.length;
  const start = value.lastIndexOf(',', caret - 1) + 1;
  const comma = value.indexOf(',', caret);
  const end = comma === -1 ? value.length : comma;
  return { start, end, text: value.slice(start, end).trim() };
}

function hideGameSuggestions() {
  gameSuggestions.hidden = true;
  gameSuggestions.replaceChildren();
  gamesInput.setAttribute('aria-expanded', 'false');
  gameOptions = [];
  gameActive = -1;
}

function pickGame(game) {
  const { start, end } = currentSegment();
  const value = gamesInput.value;
  const before = value.slice(0, start).replace(/\s*$/, '');
  const after = value.slice(end).replace(/^,?\s*/, '');
  const prefix = before ? `${before} ` : '';
  gamesInput.value = `${prefix}${game.name}, ${after}`;
  const caret = prefix.length + game.name.length + 2;
  gamesInput.setSelectionRange(caret, caret);
  pickedGames.set(normName(game.name), game);
  hideGameSuggestions();
  renderGamePreview();
  gamesInput.focus();
}

function highlightGame(index) {
  gameActive = index;
  [...gameSuggestions.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === index)));
}

function showGameSuggestions(games) {
  gameOptions = games;
  gameActive = -1;
  if (!games.length) {
    hideGameSuggestions();
    return;
  }
  gameSuggestions.replaceChildren(...games.map((game, i) => {
    const li = el('li', { role: 'option', id: `game-option-${i}`, 'aria-selected': 'false' }, [
      el('img', { src: boxArt(game.art, 52, 70), alt: '', width: '26', height: '35' }),
      el('span', { text: game.name }),
    ]);
    // mousedown so the input doesn't lose focus first
    li.addEventListener('mousedown', (event) => {
      event.preventDefault();
      pickGame(game);
    });
    return li;
  }));
  gameSuggestions.style.top = `${gamesInput.offsetTop + gamesInput.offsetHeight + 4}px`;
  gameSuggestions.hidden = false;
  gamesInput.setAttribute('aria-expanded', 'true');
}

gamesInput.addEventListener('input', () => {
  renderGamePreview();
  clearTimeout(gameSearchTimer);
  const query = currentSegment().text;
  if (query.length < 2) {
    hideGameSuggestions();
    return;
  }
  gameSearchTimer = setTimeout(async () => {
    const seq = ++gameSearchSeq;
    try {
      const { games } = await api(`/api/games?q=${encodeURIComponent(query)}`);
      if (seq === gameSearchSeq) showGameSuggestions(games);
    } catch {
      hideGameSuggestions();
    }
  }, 250);
});

gamesInput.addEventListener('keydown', (event) => {
  if (gameSuggestions.hidden || !gameOptions.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    highlightGame((gameActive + step + gameOptions.length) % gameOptions.length);
  } else if (event.key === 'Enter' && gameActive >= 0) {
    event.preventDefault();
    pickGame(gameOptions[gameActive]);
  } else if (event.key === 'Escape') {
    hideGameSuggestions();
  }
});

gamesInput.addEventListener('blur', () => {
  setTimeout(hideGameSuggestions, 150);
  gamesInput.value = gamesInput.value.replace(/[,\s]+$/, '');
});

// Edit form

const SPECIAL_FIELDS = new Set(['featured', 'theme', 'rateMode', 'useAccent', 'accentColor']);

// Plan bar and Essential locks

const PLAN_PRICES = 'Essential is $4.99/month or $49.99/year';
const PRICES = {
  essential: { name: 'Essential', month: '$4.99', year: '$49.99' },
  pro: { name: 'Pro', month: '$9.99', year: '$99.99' },
};
const GRACE_MS = 3 * 86400000;

// Stripe's customer portal sign-in page: lets people manage billing with
// just their email, e.g. if they can't sign in to CreatorGG
const STRIPE_PORTAL_LOGIN = 'https://billing.stripe.com/p/login/14A14oftjbK7bnjcZO0RG00';

// e.g. "Monthly · renews 11/26/2026" or "Gifted · never expires"
function planDetail() {
  const { plan, billing } = state;
  if (plan.plan === 'free') return '';
  if (plan.source === 'gift') {
    return plan.expires ? `Gifted · until ${new Date(plan.expires).toLocaleDateString()}` : 'Gifted · never expires';
  }
  if (billing.status === 'past_due') return `Payment failed · update your card to keep ${plan.name}`;
  if (!plan.expires) return '';
  // plan.expires includes a few days' grace after the paid period
  const periodEnd = new Date(plan.expires - GRACE_MS).toLocaleDateString();
  const cadence = billing.interval === 'year' ? 'Yearly' : 'Monthly';
  return billing.cancelAtPeriodEnd ? `${cadence} · ends ${periodEnd}` : `${cadence} · renews ${periodEnd}`;
}

// Opens Stripe's portal. Shown to anyone who has ever paid, so creators whose
// plan lapsed can still update their card and see invoices.
function manageButton(text = 'Manage subscription') {
  const manage = el('button', { type: 'button', class: 'button-secondary plan-button', text });
  manage.addEventListener('click', () => goToStripe('/api/billing/portal', {}, manage));
  return manage;
}

function renderBilling() {
  const { plan, billing } = state;
  const body = document.getElementById('billingBody');
  const detail = planDetail();
  const lines = [
    el('p', {}, [
      el('strong', { text: `${plan.name} plan` }),
      el('span', { class: detail.startsWith('Payment failed') ? 'plan-warning' : 'muted', text: detail ? ` · ${detail}` : '' }),
    ]),
  ];
  if (plan.source === 'gift' && billing.subscribed) {
    lines.push(el('p', { class: 'small plan-warning', text: "You also have a paid subscription. Your gift covers you, so cancel the subscription if you don't want to keep paying." }));
  } else if (plan.plan === 'free' && billing.hasCustomer) {
    lines.push(el('p', { class: 'small muted', text: 'Your subscription has ended. You can still see past invoices and update your card.' }));
  }
  const actions = [];
  if (billing.configured && billing.hasCustomer) actions.push(manageButton(billing.subscribed ? 'Manage subscription' : 'Billing & invoices'));
  if (!billing.subscribed && plan.source !== 'gift') actions.push(el('a', { class: 'button plan-button', href: '/pricing/', text: plan.plan === 'free' ? 'See plans' : 'Compare plans' }));
  if (actions.length) lines.push(el('div', { class: 'kit-link-actions' }, actions));
  if (billing.hasCustomer) {
    lines.push(el('p', { class: 'small muted' }, [
      document.createTextNode('Change your plan, update your card, cancel, or download invoices. Payments are handled securely by Stripe. You can also '),
      el('a', { href: STRIPE_PORTAL_LOGIN, target: '_blank', rel: 'noopener', text: 'manage billing with just your email' }),
      document.createTextNode('.'),
    ]));
  } else if (plan.plan === 'free') {
    lines.push(el('p', { class: 'small muted', text: 'Upgrade any time for your own rates, detailed analytics, tracked brand links and more. Cancel whenever you like.' }));
  }
  body.replaceChildren(...lines);
}

function renderPlan() {
  const bar = document.getElementById('planBar');
  const { plan, limits } = state;
  bar.replaceChildren();
  const { billing } = state;
  renderBilling();
  if (limits.essential) {
    const detail = planDetail();
    bar.append(
      el('strong', { text: `${plan.name} plan` }),
      el('span', { class: detail.startsWith('Payment failed') ? 'plan-warning' : 'muted', text: detail ? ` · ${detail}` : '' }),
    );
    if (plan.founding) bar.append(el('span', { class: 'founding-badge', text: '★ Founding Creator' }));
    if (billing.configured && billing.hasCustomer) bar.append(manageButton());
  } else {
    bar.append(el('span', { class: 'plan-pitch' }, [
      el('strong', { text: 'Free plan. ' }),
      document.createTextNode('Essential adds your own rates and packages, detailed analytics, brand tracking links, kit versions and more.'),
    ]));
    if (billing.configured) {
      const actions = upgradeButtons('essential');
      if (billing.hasCustomer) actions.push(manageButton('Billing & invoices'));
      bar.append(el('span', { class: 'plan-actions' }, actions));
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

// Monthly and yearly checkout buttons for a plan, or a single "Switch"
// button for creators who already pay for another plan
function upgradeButtons(plan) {
  const price = PRICES[plan];
  if (state.billing.subscribed) {
    const change = el('button', { type: 'button', class: 'plan-button', text: `Switch to ${price.name}` });
    change.addEventListener('click', () => switchPlan(plan, change));
    return [change];
  }
  const monthly = el('button', { type: 'button', class: 'plan-button', text: `Upgrade · ${price.month}/month` });
  const yearly = el('button', { type: 'button', class: 'button-secondary plan-button', text: `${price.year}/year · 2 months free` });
  monthly.addEventListener('click', () => goToStripe('/api/billing/checkout', { plan, interval: 'month' }, monthly));
  yearly.addEventListener('click', () => goToStripe('/api/billing/checkout', { plan, interval: 'year' }, yearly));
  return [monthly, yearly];
}

// Moves an existing subscription to another plan, keeping its billing period
async function switchPlan(plan, button) {
  const price = PRICES[plan];
  const cost = state.billing.interval === 'year' ? `${price.year}/year` : `${price.month}/month`;
  if (!confirm(`Switch to ${price.name} for ${cost}? Today you'll be charged the difference for the rest of your current billing period.`)) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Switching…';
  try {
    await api('/api/billing/change', { method: 'POST', body: JSON.stringify({ plan }) });
    await reloadEverything();
    showBanner(`Welcome to ${price.name}! Everything is unlocked.`, 'success');
  } catch (err) {
    showBanner(err.message);
    button.disabled = false;
    button.textContent = label;
  }
}

async function reloadEverything() {
  state = { ...state, ...(await api('/api/me')) };
  fillForm();
  renderPlan();
  renderOverview();
  renderVersions();
  loadAnalytics();
  loadDeals();
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
async function waitForUpgrade(plan) {
  const name = PRICES[plan].name;
  showBanner(`Payment received! Unlocking ${name}…`, 'info');
  for (let i = 0; i < 15 && !state.limits[plan]; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    state = { ...state, ...(await api('/api/me')) };
  }
  if (state.limits[plan]) {
    await reloadEverything();
    showBanner(`Welcome to ${name}! Everything is unlocked.`, 'success');
  } else {
    showBanner(`Your payment went through, but ${name} isn't showing yet. Refresh in a minute, or contact support@creatorgg.com.`, 'info');
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
  renderGamePreview();
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
  renderGamePreview();
});

// Buttons

document.getElementById('copyLink').addEventListener('click', async (event) => {
  store(KIT_SHARED, '1');
  renderChecklist();
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

let trackedLinks = [];

function renderLinks(links, recent) {
  trackedLinks = links;
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
    const startDeal = el('button', { type: 'button', class: 'button-secondary', text: 'Start a deal' });
    startDeal.addEventListener('click', () => {
      showTab('deals');
      if (state.limits.pro) openDeal(null, { brand: link.label, linkId: link.id });
    });
    list.append(el('div', { class: 'connection link-row' }, [
      el('div', {}, [
        el('strong', { text: link.label }),
        link.versionName ? el('span', { class: 'version-tag', text: link.versionName }) : document.createTextNode(''),
        el('p', { class: `small ${link.opens ? 'opened' : 'muted'}`, text: opened }),
        el('p', { class: 'small muted link-url', text: url.replace(/^https?:\/\//, '') }),
      ]),
      el('div', { class: 'kit-link-actions' }, [copy, startDeal, remove]),
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

// Deal tracker (Pro)

const STAGE_NAMES = { pitched: 'Pitched', negotiating: 'Negotiating', agreed: 'Agreed', delivered: 'Delivered', paid: 'Paid', lost: 'Lost' };
const OPEN_STAGES = ['pitched', 'negotiating', 'agreed', 'delivered'];
const dealsPanel = document.getElementById('dealsPanel');
const dealsBody = document.getElementById('dealsBody');
const dealDialog = document.getElementById('dealDialog');
const dealForm = document.getElementById('dealForm');
const dealError = document.getElementById('dealError');
let deals = [];
let dealCurrencies = ['USD'];
let dealFilter = 'active';
let editingDeal = null;
let dealLinkId = '';

function isoDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function daysUntil(day) {
  const [y, m, d] = day.split('-').map(Number);
  const now = new Date();
  return Math.round((new Date(y, m - 1, d) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}

function shortDate(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: y === new Date().getFullYear() ? undefined : 'numeric' });
}

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

// Totals in each currency used, e.g. "$1,200 + €300"
function moneyTotal(list) {
  const totals = new Map();
  for (const d of list) {
    if (d.amount === null) continue;
    totals.set(d.currency, (totals.get(d.currency) || 0) + d.amount);
  }
  if (!totals.size) return '–';
  return [...totals].sort((a, b) => b[1] - a[1]).map(([currency, amount]) => formatMoney(amount, currency)).join(' + ');
}

function domainOf(website) {
  try {
    return new URL(website).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function brandLogo(deal) {
  const box = el('span', { class: 'brand-logo', 'aria-hidden': 'true', text: deal.brand.charAt(0).toUpperCase() });
  const domain = domainOf(deal.website);
  if (domain) {
    const img = el('img', { src: `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`, alt: '', loading: 'lazy' });
    img.addEventListener('load', () => {
      if (img.naturalWidth > 1) box.replaceChildren(img);
    });
  }
  return box;
}

function contentOverdue(d) {
  return ['negotiating', 'agreed'].includes(d.stage) && d.dueDate && daysUntil(d.dueDate) < 0;
}

function paymentOverdue(d) {
  return ['agreed', 'delivered'].includes(d.stage) && d.paymentDue && daysUntil(d.paymentDue) < 0;
}

function dueText(label, day) {
  const days = daysUntil(day);
  if (days < 0) return `${label} overdue by ${-days} day${days === -1 ? '' : 's'}`;
  if (days === 0) return `${label} due today`;
  if (days === 1) return `${label} due tomorrow`;
  if (days <= 7) return `${label} due in ${days} days`;
  return `${label} due ${shortDate(day)}`;
}

function dealBadges(d) {
  const badges = [];
  if (['pitched', 'negotiating', 'agreed'].includes(d.stage) && d.dueDate) {
    badges.push([dueText('Content', d.dueDate), daysUntil(d.dueDate) <= 2 ? 'deal-badge-warning' : '']);
  }
  if (['agreed', 'delivered'].includes(d.stage) && d.paymentDue) {
    badges.push([dueText('Payment', d.paymentDue), daysUntil(d.paymentDue) < 0 ? 'deal-badge-warning' : '']);
  }
  if (d.stage === 'paid' && d.paidOn) badges.push([`Paid ${shortDate(d.paidOn)}`, 'deal-badge-good']);
  if (d.invoice && d.stage !== 'paid') {
    const [label, kind] = invoiceState(d.invoice);
    badges.push([`Invoice ${d.invoice.number} · ${label.toLowerCase()}`, kind]);
  }
  if (d.lastOpenedAt && !['paid', 'lost'].includes(d.stage)) {
    badges.push([`Opened your kit ${relativeTime(d.lastOpenedAt)}`, 'deal-badge-good']);
  } else if (d.linkLabel && !['paid', 'lost'].includes(d.stage)) {
    badges.push(['Kit link not opened yet', '']);
  }
  return badges.map(([text, kind]) => el('span', { class: `deal-badge ${kind}`, text }));
}

function dealSummary() {
  const month = isoDay().slice(0, 7);
  const attention = deals.filter((d) => contentOverdue(d) || paymentOverdue(d)).length;
  const card = (value, label, warn) => el('div', { class: `stat${warn ? ' stat-warning' : ''}` }, [
    el('span', { class: 'stat-value', text: value }),
    el('span', { class: 'stat-label', text: label }),
  ]);
  return el('div', { class: 'view-stats deal-stats' }, [
    card(moneyTotal(deals.filter((d) => d.stage === 'paid' && d.paidOn.startsWith(month))), 'Earned this month'),
    card(moneyTotal(deals.filter((d) => ['agreed', 'delivered'].includes(d.stage))), 'Owed to you'),
    card(moneyTotal(deals.filter((d) => ['pitched', 'negotiating'].includes(d.stage))), 'In the pipeline'),
    card(String(attention), attention === 1 ? 'Deal overdue' : 'Deals overdue', attention > 0),
  ]);
}

function dealFilters() {
  const count = (stage) => deals.filter((d) => d.stage === stage).length;
  const options = [
    ['active', 'Active', deals.filter((d) => OPEN_STAGES.includes(d.stage)).length],
    ...Object.entries(STAGE_NAMES).map(([key, name]) => [key, name, count(key)]),
    ['all', 'All', deals.length],
  ];
  return el('div', { class: 'deal-filters', role: 'group', 'aria-label': 'Show deals' }, options
    .filter(([key, , n]) => n > 0 || key === 'active' || key === 'all')
    .map(([key, name, n]) => {
      const button = el('button', { type: 'button', class: 'deal-filter', 'aria-pressed': String(dealFilter === key), text: `${name} ${n}` });
      button.addEventListener('click', () => {
        dealFilter = key;
        renderDeals();
      });
      return button;
    }));
}

const STAGE_ORDER = Object.keys(STAGE_NAMES);

function sortDeals(list) {
  const nextDate = (d) => (d.stage === 'delivered' ? d.paymentDue : d.dueDate) || '9999';
  return [...list].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)
    || nextDate(a).localeCompare(nextDate(b))
    || b.updatedAt - a.updatedAt);
}

function dealRow(d) {
  const stage = el('select', { 'aria-label': `Stage for ${d.brand}` },
    Object.entries(STAGE_NAMES).map(([key, name]) => el('option', { value: key, text: name })));
  stage.value = d.stage;
  stage.addEventListener('change', async () => {
    const update = { ...d, stage: stage.value };
    if (stage.value === 'paid' && !update.paidOn) update.paidOn = isoDay();
    try {
      await api(`/api/deals/${d.id}`, { method: 'PUT', body: JSON.stringify(update) });
      loadDeals();
    } catch (err) {
      showBanner(err.message);
      stage.value = d.stage;
    }
  });

  const edit = el('button', { type: 'button', class: 'button-link', text: 'Edit' });
  edit.addEventListener('click', () => openDeal(d));
  const side = [stage];
  if (['agreed', 'delivered', 'paid'].includes(d.stage) || d.invoice) {
    const invoice = d.invoice && invoices.find((i) => i.id === d.invoice.id);
    const button = el('button', { type: 'button', class: 'button-secondary deal-invoice', text: invoice ? 'View invoice' : 'Invoice' });
    button.addEventListener('click', () => {
      if (invoice) window.open(`/i/${invoice.id}`, '_blank', 'noopener');
      else openInvoice(null, d);
    });
    side.push(button);
  }
  side.push(edit);
  const main = el('div', { class: 'deal-main' }, [
    el('div', { class: 'deal-title' }, [
      el('strong', { text: d.brand }),
      d.amount !== null ? el('span', { class: 'deal-amount', text: formatMoney(d.amount, d.currency) }) : '',
    ]),
    d.deliverables ? el('p', { class: 'small', text: d.deliverables }) : '',
    d.contactName || d.contactEmail ? el('p', { class: 'small muted', text: [d.contactName, d.contactEmail].filter(Boolean).join(' · ') }) : '',
    el('div', { class: 'deal-badges' }, dealBadges(d)),
  ]);
  main.addEventListener('click', () => openDeal(d));
  return el('div', { class: `deal stage-${d.stage}${d.stage === 'lost' ? ' deal-lost' : ''}` }, [
    brandLogo(d),
    main,
    el('div', { class: 'deal-side' }, side),
  ]);
}

function renderDeals() {
  if (!deals.length) {
    dealsBody.replaceChildren(el('div', { class: 'teaser' }, [
      el('p', { text: 'No deals yet. Add the brands you\'ve pitched or are talking to, and track each one through to payment.' }),
      el('p', { class: 'small', text: 'Tip: on the Overview tab, tracked brand links have a "Start a deal" button, and your deal shows when the brand opens your kit.' }),
    ]));
    return;
  }
  const shown = sortDeals(deals.filter((d) => dealFilter === 'all'
    || (dealFilter === 'active' ? OPEN_STAGES.includes(d.stage) : d.stage === dealFilter)));
  dealsBody.replaceChildren(
    dealSummary(),
    dealFilters(),
    shown.length
      ? el('div', { class: 'deal-list' }, shown.map(dealRow))
      : el('p', { class: 'small muted', text: 'No deals here.' }),
  );
}

function renderDealsLocked(saved) {
  const parts = [
    el('p', { text: 'Pro adds a deal tracker: every sponsorship from first pitch to payment, with deadlines, payment due dates, totals of what you\'ve earned and what you\'re owed, alerts when a brand opens your kit, and one-click invoices.' }),
  ];
  if (saved) parts.push(el('p', { class: 'small', text: `You have ${saved} saved deal${saved === 1 ? '' : 's'}. ${saved === 1 ? 'It\'s' : 'They\'re'} kept safe and will be back when you upgrade.` }));
  if (state.billing.proAvailable) {
    parts.push(el('span', { class: 'plan-actions' }, upgradeButtons('pro')));
    if (state.referralDiscount && !state.billing.subscribed) {
      parts.push(el('p', { class: 'plan-note', text: "You were referred by a creator, so you'll get 20% off your first 3 months." }));
    }
  } else {
    parts.push(el('p', { class: 'plan-cta', text: 'Pro is $9.99/month · Coming soon' }));
  }
  dealsBody.replaceChildren(el('div', { class: 'teaser' }, parts));
}

async function loadDeals() {
  dealsPanel.classList.toggle('locked', !state.limits.pro);
  let data;
  try {
    data = await api('/api/deals');
  } catch (err) {
    dealsBody.replaceChildren(el('p', { class: 'small muted', text: err.message }));
    return;
  }
  if (data.locked) {
    renderDealsLocked(data.saved);
    loadInvoices();
    setupPitches();
    return;
  }
  deals = data.deals;
  dealCurrencies = data.currencies;
  await loadInvoices();
  renderDeals();
  renderBrandSuggestions();
  setupPitches();
}

// Kit brands are saved as "Name, https://link" lines
function kitBrands() {
  return String(state.profile.brands || '').split('\n').map((line) => {
    const comma = line.lastIndexOf(',');
    const url = comma > 0 ? line.slice(comma + 1).trim() : '';
    return /^https?:\/\//i.test(url) ? { name: line.slice(0, comma).trim(), url } : { name: line.trim(), url: '' };
  }).filter((b) => b.name);
}

function renderBrandSuggestions() {
  const names = new Map();
  for (const name of [...deals.map((d) => d.brand), ...kitBrands().map((b) => b.name), ...trackedLinks.map((l) => l.label)]) {
    if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  document.getElementById('brandSuggestions').replaceChildren(...[...names.values()].sort().map((name) => el('option', { value: name })));
}

// Fills in details from an earlier deal with the same brand, or from the kit's brand list
function autofillBrand() {
  const f = dealForm.elements;
  const name = f.brand.value.trim().toLowerCase();
  if (!name) return;
  const earlier = deals.find((d) => d.brand.toLowerCase() === name && d !== editingDeal);
  const kitBrand = kitBrands().find((b) => b.name.toLowerCase() === name);
  const fill = (field, value) => {
    if (value && !f[field].value) f[field].value = value;
  };
  fill('website', (earlier?.website || kitBrand?.url || '').replace(/^https?:\/\//, '').replace(/\/$/, ''));
  fill('contactName', earlier?.contactName);
  fill('contactEmail', earlier?.contactEmail);
}

function togglePaidOn() {
  const paid = dealForm.elements.stage.value === 'paid';
  dealForm.querySelector('[data-paid-only]').hidden = !paid;
  if (paid && !dealForm.elements.paidOn.value) dealForm.elements.paidOn.value = isoDay();
}

function openDeal(deal, prefill = {}) {
  editingDeal = deal;
  const values = deal || { stage: 'pitched', currency: dealCurrencies.includes('USD') ? 'USD' : dealCurrencies[0], ...prefill };
  const f = dealForm.elements;
  dealForm.reset();
  dealForm.querySelectorAll('.invalid').forEach((input) => input.classList.remove('invalid'));
  dealError.hidden = true;
  f.stage.replaceChildren(...Object.entries(STAGE_NAMES).map(([key, name]) => el('option', { value: key, text: name })));
  f.currency.replaceChildren(...dealCurrencies.map((c) => el('option', { value: c, text: c })));
  for (const key of ['brand', 'website', 'contactName', 'contactEmail', 'stage', 'currency', 'deliverables', 'dueDate', 'paymentDue', 'paidOn', 'notes']) {
    f[key].value = values[key] || '';
  }
  f.website.value = f.website.value.replace(/^https?:\/\//, '');
  f.amount.value = values.amount ?? '';
  dealLinkId = values.linkId || '';
  const link = trackedLinks.find((l) => l.id === dealLinkId);
  const linkName = values.linkLabel || link?.label;
  const note = document.getElementById('dealLinkNote');
  note.hidden = !linkName;
  note.textContent = linkName ? `Connected to your tracked link "${linkName}", so you'll see here when they open your kit.` : '';
  document.getElementById('dealDialogTitle').textContent = deal ? `Edit deal: ${deal.brand}` : 'Add a deal';
  document.getElementById('deleteDeal').hidden = !deal;
  renderBrandSuggestions();
  if (!deal) autofillBrand();
  togglePaidOn();
  dealDialog.showModal();
  if (!deal) f.brand.focus();
}

dealForm.elements.brand.addEventListener('change', autofillBrand);
dealForm.elements.stage.addEventListener('change', togglePaidOn);
document.getElementById('newDeal').addEventListener('click', () => openDeal(null));
document.getElementById('closeDeal').addEventListener('click', () => dealDialog.close());

dealForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const f = dealForm.elements;
  const body = Object.fromEntries(['brand', 'website', 'contactName', 'contactEmail', 'stage', 'amount', 'currency', 'deliverables', 'dueDate', 'paymentDue', 'paidOn', 'notes']
    .map((key) => [key, f[key].value.trim()]));
  body.linkId = dealLinkId;
  const button = document.getElementById('saveDeal');
  button.disabled = true;
  dealForm.querySelectorAll('.invalid').forEach((input) => input.classList.remove('invalid'));
  try {
    await api(editingDeal ? `/api/deals/${editingDeal.id}` : '/api/deals', {
      method: editingDeal ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    });
    dealDialog.close();
    if (!editingDeal && dealFilter !== 'all' && !(dealFilter === 'active' ? OPEN_STAGES.includes(body.stage) : dealFilter === body.stage)) {
      dealFilter = 'all';
    }
    await loadDeals();
  } catch (err) {
    dealError.textContent = err.message;
    dealError.hidden = false;
    if (err.field && f[err.field]) {
      f[err.field].classList.add('invalid');
      f[err.field].focus();
    }
  } finally {
    button.disabled = false;
  }
});

document.getElementById('deleteDeal').addEventListener('click', async () => {
  if (!editingDeal || !confirm(`Delete the deal with ${editingDeal.brand}? This can't be undone.`)) return;
  try {
    await api(`/api/deals/${editingDeal.id}`, { method: 'DELETE' });
    dealDialog.close();
    loadDeals();
  } catch (err) {
    dealError.textContent = err.message;
    dealError.hidden = false;
  }
});

// Invoices (Pro)

const invoicesPanel = document.getElementById('invoicesPanel');
const invoicesBody = document.getElementById('invoicesBody');
const invoiceDialog = document.getElementById('invoiceDialog');
const invoiceForm = document.getElementById('invoiceForm');
const invoiceError = document.getElementById('invoiceError');
const invoiceItemsEditor = document.getElementById('invoiceItems');
let invoices = [];
let invoiceSettings = {};
let nextInvoiceNumber = 'INV-0001';
let editingInvoice = null;
let invoiceDealId = '';

function invoiceUrl(invoice) {
  return `${location.origin}/i/${invoice.id}`;
}

function invoiceState(invoice) {
  if (invoice.status === 'paid') return ['Paid', 'deal-badge-good'];
  if (invoice.status === 'void') return ['Void', ''];
  if (invoice.dueOn && daysUntil(invoice.dueOn) < 0) return ['Overdue', 'deal-badge-warning'];
  return ['Unpaid', ''];
}

function addInvoiceItem(values = {}) {
  const row = el('div', { class: 'row-item invoice-item' });
  const fields = [['description', 'Description', 'e.g. YouTube integration (60–90 sec)', 'text'], ['quantity', 'Qty', '1', 'number'], ['unitPrice', 'Price', '0.00', 'number']];
  for (const [key, label, placeholder, type] of fields) {
    const input = el('input', { type, 'data-key': key, placeholder, 'aria-label': label });
    if (type === 'number') {
      input.min = '0';
      input.step = key === 'quantity' ? '1' : '0.01';
      input.inputMode = 'decimal';
    } else {
      input.maxLength = 200;
    }
    input.value = values[key] ?? '';
    input.addEventListener('input', renderInvoiceTotal);
    row.append(el('label', { class: key === 'description' ? 'item-description' : '' }, [document.createTextNode(label), input]));
  }
  const remove = el('button', { type: 'button', class: 'button-link', text: 'Remove' });
  remove.addEventListener('click', () => {
    row.remove();
    renderInvoiceTotal();
  });
  row.append(remove);
  invoiceItemsEditor.append(row);
}

function readInvoiceItems() {
  return [...invoiceItemsEditor.querySelectorAll('.invoice-item')].map((row) => Object.fromEntries(
    [...row.querySelectorAll('input[data-key]')].map((input) => [input.dataset.key, input.value.trim()]),
  )).filter((i) => i.description || i.unitPrice);
}

function renderInvoiceTotal() {
  const f = invoiceForm.elements;
  const subtotal = readInvoiceItems().reduce((sum, i) => sum + (Number(i.quantity) || 1) * (Number(i.unitPrice) || 0), 0);
  const rate = Number(f.taxRate.value) || 0;
  const total = subtotal + (subtotal * rate) / 100;
  document.getElementById('invoiceTotal').textContent = `Total: ${formatMoney(Math.round(total * 100) / 100, f.currency.value || 'USD')}`;
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

// Opens the editor for an existing invoice, or a new one (optionally from a deal)
function openInvoice(invoice, deal = null) {
  editingInvoice = invoice;
  const f = invoiceForm.elements;
  invoiceForm.reset();
  invoiceForm.querySelectorAll('.invalid').forEach((input) => input.classList.remove('invalid'));
  invoiceError.hidden = true;
  f.currency.replaceChildren(...dealCurrencies.map((c) => el('option', { value: c, text: c })));

  const p = state.profile;
  const sender = invoice ? invoice.sender : invoiceSettings;
  f.senderName.value = sender.name || (invoice ? '' : p.displayName || '');
  f.senderEmail.value = sender.email || (invoice ? '' : p.contactEmail || '');
  f.senderAddress.value = sender.address || '';
  f.senderTaxId.value = sender.taxId || '';
  f.paymentDetails.value = sender.paymentDetails || '';

  if (invoice) {
    invoiceDealId = invoice.dealId;
    f.number.value = invoice.number;
    f.issuedOn.value = invoice.issuedOn;
    f.dueOn.value = invoice.dueOn;
    f.currency.value = invoice.currency;
    f.billToName.value = invoice.billTo.name || '';
    f.billToContact.value = invoice.billTo.contact || '';
    f.billToEmail.value = invoice.billTo.email || '';
    f.billToAddress.value = invoice.billTo.address || '';
    f.taxRate.value = invoice.taxRate ?? '';
    f.taxLabel.value = invoice.taxLabel;
    f.notes.value = invoice.notes;
  } else {
    invoiceDealId = deal?.id || '';
    f.number.value = nextInvoiceNumber;
    f.issuedOn.value = isoDay();
    f.dueOn.value = deal?.paymentDue || addDays(30);
    f.currency.value = deal?.currency || 'USD';
    f.billToName.value = deal?.brand || '';
    f.billToContact.value = deal?.contactName || '';
    f.billToEmail.value = deal?.contactEmail || '';
    f.notes.value = invoiceSettings.notes || '';
  }

  invoiceItemsEditor.replaceChildren();
  const items = invoice ? invoice.items
    : deal ? [{ description: deal.deliverables || `Sponsorship: ${deal.brand}`, quantity: 1, unitPrice: deal.amount ?? '' }]
      : [{}];
  items.forEach((item) => addInvoiceItem(item));
  renderInvoiceTotal();

  document.getElementById('invoiceDialogTitle').textContent = invoice ? `Edit invoice ${invoice.number}` : deal ? `Invoice for ${deal.brand}` : 'Create invoice';
  document.getElementById('deleteInvoice').hidden = !invoice;
  invoiceDialog.showModal();
}

async function setInvoiceStatus(invoice, status) {
  try {
    await api(`/api/invoices/${invoice.id}`, { method: 'PUT', body: JSON.stringify({ statusOnly: true, status, paidOn: isoDay() }) });
    loadDeals();
  } catch (err) {
    showBanner(err.message);
  }
}

function invoiceRow(invoice) {
  const [label, kind] = invoiceState(invoice);
  const open = el('a', { class: 'button button-secondary', href: `/i/${invoice.id}`, target: '_blank', rel: 'noopener', text: 'View / PDF' });
  const copy = el('button', { type: 'button', class: 'button-secondary', text: 'Copy link' });
  copy.addEventListener('click', () => copyText(invoiceUrl(invoice), copy));
  const edit = el('button', { type: 'button', class: 'button-link', text: 'Edit' });
  edit.addEventListener('click', () => openInvoice(invoice));
  const actions = [open, copy];
  if (invoice.status === 'unpaid') {
    const paid = el('button', { type: 'button', class: 'button-secondary', text: 'Mark paid' });
    paid.addEventListener('click', () => setInvoiceStatus(invoice, 'paid'));
    actions.push(paid);
  } else {
    const reopen = el('button', { type: 'button', class: 'button-link', text: 'Mark unpaid' });
    reopen.addEventListener('click', () => setInvoiceStatus(invoice, 'unpaid'));
    actions.push(reopen);
  }
  actions.push(edit);
  const dates = [`Issued ${shortDate(invoice.issuedOn)}`];
  if (invoice.status === 'paid' && invoice.paidOn) dates.push(`paid ${shortDate(invoice.paidOn)}`);
  else if (invoice.dueOn && invoice.status === 'unpaid') dates.push(dueText('Payment', invoice.dueOn));
  return el('div', { class: 'invoice-row' }, [
    el('div', { class: 'invoice-row-main' }, [
      el('div', { class: 'deal-title' }, [
        el('strong', { text: `${invoice.number} · ${invoice.billTo.name}` }),
        el('span', { class: 'deal-amount', text: formatMoney(invoice.total, invoice.currency) }),
        el('span', { class: `deal-badge ${kind}`, text: label }),
      ]),
      el('p', { class: 'small muted', text: dates.join(' · ') }),
    ]),
    el('div', { class: 'kit-link-actions invoice-actions' }, actions),
  ]);
}

function renderInvoices() {
  if (!invoices.length) {
    invoicesBody.replaceChildren(el('p', { class: 'small muted', text: 'No invoices yet. Use "Create invoice", or the Invoice button on a deal to fill it in from the deal.' }));
    return;
  }
  invoicesBody.replaceChildren(el('div', { class: 'invoice-list' }, invoices.map(invoiceRow)));
}

async function loadInvoices() {
  invoicesPanel.classList.toggle('locked', !state.limits.pro);
  let data;
  try {
    data = await api('/api/invoices');
  } catch (err) {
    invoicesBody.replaceChildren(el('p', { class: 'small muted', text: err.message }));
    return;
  }
  if (data.locked) {
    invoicesBody.replaceChildren(el('div', { class: 'teaser' }, [
      el('p', { text: 'Pro turns any deal into a professional invoice in one click: your details, the brand\'s, the deliverables and how to pay you. Download it as a PDF or send the brand a link.' }),
      data.saved ? el('p', { class: 'small', text: `You have ${data.saved} saved invoice${data.saved === 1 ? '' : 's'}. Links you've already sent keep working.` }) : '',
    ]));
    return;
  }
  invoices = data.invoices;
  invoiceSettings = data.settings || {};
  nextInvoiceNumber = data.nextNumber;
  renderInvoices();
}

document.getElementById('newInvoice').addEventListener('click', () => openInvoice(null));
document.getElementById('closeInvoice').addEventListener('click', () => invoiceDialog.close());
document.getElementById('addInvoiceItem').addEventListener('click', () => addInvoiceItem());
invoiceForm.elements.taxRate.addEventListener('input', renderInvoiceTotal);
invoiceForm.elements.currency.addEventListener('change', renderInvoiceTotal);

const INVOICE_FIELDS = {
  senderName: 'senderName', senderEmail: 'senderEmail', billToName: 'billToName', billToEmail: 'billToEmail',
  number: 'number', issuedOn: 'issuedOn', dueOn: 'dueOn', taxRate: 'taxRate',
};

invoiceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const f = invoiceForm.elements;
  const body = {
    dealId: invoiceDealId,
    number: f.number.value.trim(),
    issuedOn: f.issuedOn.value,
    dueOn: f.dueOn.value,
    currency: f.currency.value,
    sender: {
      name: f.senderName.value.trim(),
      email: f.senderEmail.value.trim(),
      address: f.senderAddress.value.trim(),
      taxId: f.senderTaxId.value.trim(),
      paymentDetails: f.paymentDetails.value.trim(),
      notes: f.notes.value.trim(),
    },
    billTo: {
      name: f.billToName.value.trim(),
      contact: f.billToContact.value.trim(),
      email: f.billToEmail.value.trim(),
      address: f.billToAddress.value.trim(),
    },
    items: readInvoiceItems(),
    taxRate: f.taxRate.value.trim(),
    taxLabel: f.taxLabel.value.trim(),
    notes: f.notes.value.trim(),
  };
  const button = document.getElementById('saveInvoice');
  button.disabled = true;
  invoiceForm.querySelectorAll('.invalid').forEach((input) => input.classList.remove('invalid'));
  try {
    const result = await api(editingInvoice ? `/api/invoices/${editingInvoice.id}` : '/api/invoices', {
      method: editingInvoice ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    });
    invoiceDialog.close();
    await loadDeals();
    const saved = invoices.find((i) => i.id === (editingInvoice?.id || result.id));
    if (saved && !editingInvoice) {
      showBanner(`Invoice ${saved.number} created. Use "View / PDF" to download it, or "Copy link" to send it to ${saved.billTo.name}.`, 'success');
      invoicesPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    invoiceError.textContent = err.message;
    invoiceError.hidden = false;
    const target = err.field === 'items' ? invoiceItemsEditor : f[INVOICE_FIELDS[err.field]];
    if (target) {
      target.classList.add('invalid');
      target.scrollIntoView?.({ block: 'center' });
    }
  } finally {
    button.disabled = false;
  }
});

document.getElementById('deleteInvoice').addEventListener('click', async () => {
  if (!editingInvoice || !confirm(`Delete invoice ${editingInvoice.number}? Its link will stop working. If you've already sent it, consider marking it void instead.`)) return;
  try {
    await api(`/api/invoices/${editingInvoice.id}`, { method: 'DELETE' });
    invoiceDialog.close();
    loadDeals();
  } catch (err) {
    invoiceError.textContent = err.message;
    invoiceError.hidden = false;
  }
});

// Pitch templates (Pro): emails filled in from the creator's own stats

const pitchPanel = document.getElementById('pitchPanel');
const pitchTemplate = document.getElementById('pitchTemplate');
const pitchBrand = document.getElementById('pitchBrand');
const pitchContact = document.getElementById('pitchContact');
const pitchSubject = document.getElementById('pitchSubject');
const pitchText = document.getElementById('pitchText');

// The creator's details as the templates use them
function pitchFacts(brand) {
  const p = state.profile;
  const stats = topStats().map(([label, value]) => `${compact.format(Number(value))} ${label.replace(/^Avg /, 'average ')}`);
  const topics = String(p.games || '').split(',').map((g) => g.trim()).filter(Boolean).slice(0, 3);
  // A tracked link for this brand, if there is one, so the creator sees when they open it
  const link = trackedLinks.find((l) => brand && l.label.toLowerCase() === brand.toLowerCase());
  const rateLines = ratesSummary.split('\n').slice(1).filter((l) => l.startsWith('- ') || /^[A-Z]/.test(l)).filter((l) => !l.startsWith('Media kit:'));
  return {
    name: p.displayName,
    stats: stats.length ? stats.join(', ') : '',
    topics: topics.length ? topics.join(', ') : 'my niche',
    kit: link ? kitLink(link.versionKey, link.id) : kitUrl(),
    // A blank line before each platform heading
    rates: rateLines.map((l, i) => (i && !l.startsWith('- ') ? `\n${l}` : l)).join('\n').trim(),
    email: p.contactEmail,
  };
}

const PITCHES = {
  cold: {
    name: 'First pitch to a new brand',
    subject: (f, b) => `Partnership idea: ${f.name} x ${b}`,
    body: (f, b, hi) => `${hi}

I'm ${f.name}, a creator covering ${f.topics}.${f.stats ? ` My community: ${f.stats}.` : ''}

I'm a big fan of ${b} and think my audience would be a great fit. I'd love to put together a sponsored video or stream that shows off what you do in a way that feels natural to my viewers.

My media kit has my verified stats, audience and past partners:
${f.kit}

Would you be open to a quick chat about a campaign? Happy to work around your goals and budget.

Thanks,
${f.name}`,
  },
  followup: {
    name: 'Follow-up (no reply yet)',
    subject: (f, b) => `Following up: ${f.name} x ${b}`,
    body: (f, b, hi) => `${hi}

Just following up on my earlier note about working together. I know inboxes get busy!

Here's my media kit again with my latest stats:
${f.kit}

If now isn't the right time, no problem. Is there someone else on your team I should reach out to, or a better time to check back in?

Thanks,
${f.name}`,
  },
  rates: {
    name: 'Reply with my rates',
    subject: (f, b) => `Rates for ${b}: ${f.name}`,
    body: (f, b, hi) => `${hi}

Thanks for reaching out, I'd love to work with ${b}! Here are my current rates:

${f.rates || '[Add your rates here]'}

Everything is in my media kit, including my stats and audience:
${f.kit}

Packages and multi-platform bundles are available, and I'm happy to put together something that fits your campaign. What deliverables and timing did you have in mind?

Thanks,
${f.name}`,
  },
  recap: {
    name: 'Thank-you and results after a campaign',
    subject: (f, b) => `Thank you, and campaign results: ${f.name} x ${b}`,
    body: (f, b, hi) => `${hi}

Thanks again for partnering with me on this campaign, it was a pleasure working with ${b}!

Here's a quick recap:
- Content: [what you posted, with links]
- Views so far: [number]
- Clicks / code uses: [if you have them]
- Community response: [a highlight or two]

I'd love to keep building on this. If you're planning future campaigns, I'm happy to put together an ongoing package.

My updated media kit:
${f.kit}

Thanks,
${f.name}`,
  },
  return: {
    name: 'Reconnect with a past brand',
    subject: (f, b) => `Working together again? ${f.name} x ${b}`,
    body: (f, b, hi) => `${hi}

Hope all's well at ${b}! I really enjoyed our last collaboration, and my channel has kept growing since then${f.stats ? `: ${f.stats}` : ''}.

I'd love to team up again for an upcoming launch or campaign. Here's my latest media kit:
${f.kit}

Is there anything coming up that I could help with?

Thanks,
${f.name}`,
  },
};

function renderPitch() {
  const brand = pitchBrand.value.trim() || '[Brand]';
  const hi = pitchContact.value.trim() ? `Hi ${pitchContact.value.trim()},` : `Hi ${brand} team,`;
  const template = PITCHES[pitchTemplate.value] || PITCHES.cold;
  const facts = pitchFacts(pitchBrand.value.trim());
  pitchSubject.value = template.subject(facts, brand);
  pitchText.value = template.body(facts, brand, hi);
  const deal = deals.find((d) => d.brand.toLowerCase() === pitchBrand.value.trim().toLowerCase());
  const to = deal?.contactEmail || '';
  document.getElementById('mailPitch').href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(pitchSubject.value)}&body=${encodeURIComponent(pitchText.value)}`;
}

function setupPitches() {
  const locked = !state.limits.pro;
  pitchPanel.classList.toggle('locked', locked);
  pitchPanel.querySelectorAll('input, select, textarea, button, a').forEach((c) => {
    if ('disabled' in c) c.disabled = locked;
  });
  document.getElementById('mailPitch').hidden = locked;
  if (!pitchTemplate.options.length) {
    pitchTemplate.replaceChildren(...Object.entries(PITCHES).map(([key, t]) => el('option', { value: key, text: t.name })));
  }
  if (locked) {
    pitchSubject.value = 'Partnership idea: you x your next sponsor';
    pitchText.value = 'Pro writes ready-to-send pitch emails for you, with your stats, rates and media kit link filled in: first pitches, follow-ups, rate replies, campaign recaps and more.';
    return;
  }
  renderPitch();
}

[pitchTemplate, pitchBrand, pitchContact].forEach((input) => input.addEventListener('input', renderPitch));
pitchBrand.addEventListener('change', () => {
  // Fill the contact's first name from a deal with this brand
  const deal = deals.find((d) => d.brand.toLowerCase() === pitchBrand.value.trim().toLowerCase());
  if (deal?.contactName && !pitchContact.value) pitchContact.value = deal.contactName.split(' ')[0];
  renderPitch();
});
document.getElementById('copyPitch').addEventListener('click', (event) => copyText(pitchText.value, event.target));
document.getElementById('copyPitchSubject').addEventListener('click', (event) => copyText(pitchSubject.value, event.target));

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
  document.getElementById('referralPitch').textContent = `Share your link or code. Creators who sign up with it get ${p.discountPercent}% off their first ${p.discountMonths} months of a paid plan, and you earn ${Math.round(p.commissionRate * 100)}% of what they pay for ${p.commissionMonths} months.`;
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
  loadDeals();
  showTab(location.hash.slice(1));
  app.hidden = false;
  loadReferrals();
  // Continue an upgrade started on the pricing page
  let pendingUpgrade = null;
  try {
    pendingUpgrade = sessionStorage.getItem('cgg_upgrade');
    sessionStorage.removeItem('cgg_upgrade');
  } catch {}
  if (pendingUpgrade) continueUpgrade(pendingUpgrade);
  const upgradedTo = justUpgraded === 'pro' ? 'pro' : 'essential';
  if (justUpgraded && !state.limits[upgradedTo]) waitForUpgrade(upgradedTo);
  else if (justUpgraded) showBanner(`Welcome to ${PRICES[upgradedTo].name}! Everything is unlocked.`, 'success');
}

// The pricing page saves "plan:interval" (older pages saved just the interval)
function continueUpgrade(choice) {
  const [first, second] = choice.split(':');
  const plan = second ? (first === 'pro' ? 'pro' : 'essential') : 'essential';
  const interval = (second || first) === 'year' ? 'year' : 'month';
  const name = PRICES[plan].name;
  if (state.limits[plan]) {
    showBanner(`You're already on ${name}.`, 'info');
  } else if (plan === 'pro' && !state.billing.proAvailable) {
    showBanner("Pro isn't available yet.", 'info');
  } else if (state.billing.subscribed) {
    showTab(plan === 'pro' ? 'deals' : 'overview');
    showBanner(`To move to ${name}, use the "Switch to ${name}" button below.`, 'info');
  } else if (state.billing.configured) {
    goToStripe('/api/billing/checkout', { plan, interval }, el('button'));
  }
}

init().catch((err) => {
  if (err.message !== 'Not signed in') {
    app.hidden = false;
    showBanner('Could not load your dashboard. Please refresh the page.');
  }
});
