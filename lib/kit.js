import { escapeHtml as e } from './http.js';
import { estimateRates, formatRange } from '../public/rates.js';
import { rateInput } from './users.js';

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function count(value) {
  return value === null || value === undefined ? null : compact.format(value);
}

function stat(label, value, note) {
  if (value === null || value === undefined) return '';
  return `<div class="stat"><span class="stat-value">${e(value)}</span><span class="stat-label">${e(label)}</span>${note ? `<span class="stat-note">${e(note)}</span>` : ''}</div>`;
}

function platformCard(name, link, verified, stats) {
  const body = stats.filter(Boolean).join('');
  if (!body) return '';
  const badge = verified ? '<span class="badge" title="Stats pulled directly from the platform">✓ Verified</span>' : '';
  const handle = link ? `<a href="${e(link.url)}" target="_blank" rel="noopener">${e(link.label)}</a>` : '';
  return `<section class="kit-card platform-card">
    <header><h2>${e(name)}</h2>${badge}</header>
    ${handle ? `<p class="handle">${handle}</p>` : ''}
    <div class="stats">${body}</div>
  </section>`;
}

export function renderKit(user, connections, origin) {
  const twitch = connections.twitch;
  const youtube = connections.youtube;
  const tiktokUrl = user.tiktok_handle ? `https://www.tiktok.com/@${encodeURIComponent(user.tiktok_handle)}` : null;
  const yt = youtube?.stats || {};

  const cards = [
    platformCard('Twitch', twitch && { url: twitch.url, label: twitch.username }, Boolean(twitch), [
      stat('Followers', count(twitch?.stats.followers)),
      stat('Avg viewers', count(user.twitch_avg_viewers), 'Self-reported'),
    ]),
    platformCard('YouTube', youtube && { url: youtube.url, label: youtube.username }, Boolean(youtube), [
      stat('Subscribers', count(yt.subscribers)),
      stat('Avg views / video', count(yt.avgViews)),
      stat('Avg views / Short', count(yt.avgShortsViews)),
      stat('Engagement', yt.engagement != null ? `${yt.engagement}%` : null),
    ]),
    platformCard('TikTok', tiktokUrl && { url: tiktokUrl, label: `@${user.tiktok_handle}` }, false, [
      stat('Followers', count(user.tiktok_followers), 'Self-reported'),
      stat('Avg views', count(user.tiktok_avg_views), 'Self-reported'),
      stat('Engagement', user.tiktok_engagement != null ? `${user.tiktok_engagement}%` : null, 'Self-reported'),
    ]),
  ].join('');

  const audience = (twitch?.stats.followers || 0) + (yt.subscribers || 0) + (user.tiktok_followers || 0);

  let rates = '';
  if (user.show_rates) {
    const { sections, bundle } = estimateRates(rateInput(user, connections));
    if (sections.length) {
      const rows = sections.map((s) => `<h3>${e(s.name)}</h3>${s.rates.map(([label, range]) => `<div class="rate"><span>${e(label)}</span><span class="amount">${e(formatRange(range))}</span></div>`).join('')}`).join('');
      const bundleRow = bundle ? `<h3>Bundle</h3><div class="rate bundle"><span>One of each platform's main deal</span><span class="amount">${e(formatRange(bundle))}</span></div>` : '';
      rates = `<section class="kit-card"><header><h2>Sponsorship rates</h2></header>${rows}${bundleRow}<p class="note">Starting rates. Custom packages available.</p></section>`;
    }
  }

  const games = user.games
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((g) => `<li>${e(g)}</li>`)
    .join('');

  const updated = Math.max(0, ...Object.values(connections).map((c) => c.statsUpdatedAt || 0));
  const avatar = user.avatar_url
    ? `<img class="avatar" src="${e(user.avatar_url)}" alt="" width="96" height="96">`
    : `<div class="avatar avatar-fallback" aria-hidden="true">${e(user.display_name.charAt(0).toUpperCase())}</div>`;
  const contact = user.contact_email
    ? `<a class="button" href="mailto:${e(user.contact_email)}?subject=${encodeURIComponent(`Sponsorship inquiry for ${user.display_name}`)}">Work with me</a>`
    : '';
  const description = user.bio || `${user.display_name}'s media kit: audience stats and sponsorship rates.`;
  const pageUrl = `${origin}/${user.slug}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${e(user.display_name)} · Media Kit · CreatorGG</title>
  <meta name="description" content="${e(description.slice(0, 160))}">
  <meta property="og:title" content="${e(user.display_name)} · Media Kit">
  <meta property="og:description" content="${e(description.slice(0, 200))}">
  <meta property="og:url" content="${e(pageUrl)}">
  ${user.avatar_url ? `<meta property="og:image" content="${e(user.avatar_url)}">` : ''}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="/">Creator<span class="gg">GG</span></a>
      <span class="header-note">Media kit</span>
    </div>
  </header>
  <main class="wrap kit">
    <section class="kit-hero">
      ${avatar}
      <div class="kit-intro">
        <h1>${e(user.display_name)}</h1>
        ${user.bio ? `<p class="bio">${e(user.bio)}</p>` : ''}
        ${games ? `<ul class="games" aria-label="Games">${games}</ul>` : ''}
        ${contact}
      </div>
    </section>
    ${audience ? `<p class="audience"><strong>${e(count(audience))}</strong> total followers across platforms</p>` : ''}
    <div class="kit-grid">${cards || '<p class="empty">No stats yet.</p>'}</div>
    ${rates}
    ${updated ? `<p class="updated">Verified stats updated ${e(dateFormat.format(updated))}</p>` : ''}
  </main>
  <footer class="site-footer">
    <div class="wrap">Made with <a href="/">CreatorGG</a>. <a href="/login/">Make your free media kit →</a></div>
  </footer>
</body>
</html>`;
}

export function renderNotFound() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Not found · CreatorGG</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="site-header"><div class="wrap"><a class="brand" href="/">Creator<span class="gg">GG</span></a></div></header>
  <main class="wrap kit">
    <section class="hero">
      <h1>No media kit here</h1>
      <p>This link isn't taken yet. It could be yours.</p>
      <p><a class="button" href="/login/">Claim it free</a></p>
    </section>
  </main>
</body>
</html>`;
}
