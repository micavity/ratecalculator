import { escapeHtml as e } from './http.js';
import { estimateRates, formatRange } from '../../public/rates.js';
import { rateInput } from './users.js';
import {
  THEMES, ESSENTIAL_THEMES, AGE_GROUPS, isHexColor, normalizeSections, hasAudience, parseJson,
} from './kit-content.js';
import { planLimits } from './plans.js';
import { SOCIALS } from './socials.js';
import { splitGames, boxArt } from './games.js';
import { isReferralCode } from './referrals.js';

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

function embedUrl(video, host) {
  if (video.type === 'youtube') return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}`;
  if (video.type === 'twitch-clip') return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(video.id)}&parent=${encodeURIComponent(host)}&autoplay=false`;
  return `https://player.twitch.tv/?video=${encodeURIComponent(video.id)}&parent=${encodeURIComponent(host)}&autoplay=false`;
}

function videoStatsLine(v, connections) {
  const s = v.stats;
  if (!s) return '';
  const parts = [];
  if (s.views != null) parts.push(`${compact.format(s.views)} views`);
  if (s.likes != null) parts.push(`${compact.format(s.likes)} likes`);
  if (s.comments != null) parts.push(`${compact.format(s.comments)} comments`);
  if (s.publishedAt) parts.push(dateFormat.format(new Date(s.publishedAt)));
  const owner = v.type === 'youtube' ? connections.youtube?.providerId : connections.twitch?.providerId;
  const mine = owner && s.ownerId === owner
    ? ' <span class="badge" title="This video is from a channel linked to this kit">✓ My channel</span>'
    : '';
  return `<p class="video-stats">${e(parts.join(' · '))}${mine}</p>`;
}

function featuredSection(featured, host, connections) {
  if (!featured.length) return '';
  const embeds = featured.map((v) => `<div class="video">
      <div class="embed"><iframe src="${e(embedUrl(v, host))}" title="${e(v.stats?.title || 'Featured video')}" loading="lazy" allowfullscreen allow="encrypted-media; picture-in-picture"></iframe></div>
      ${v.stats?.title ? `<p class="video-title">${e(v.stats.title)}</p>` : ''}
      ${videoStatsLine(v, connections)}
    </div>`).join('');
  const links = featured.map((v) => `<li>${v.stats?.title ? `<strong>${e(v.stats.title)}</strong><br>` : ''}${videoStatsLine(v, connections)}<a href="${e(v.url)}">${e(v.url)}</a></li>`).join('');
  return `<section class="kit-card kit-section">
    <header><h2>Featured content</h2></header>
    <div class="embeds no-print">${embeds}</div>
    <ul class="print-only">${links}</ul>
  </section>`;
}

function brandsSection(brands) {
  if (!brands.length) return '';
  const items = brands.map((b) => (b.url
    ? `<li><a href="${e(b.url)}" target="_blank" rel="noopener nofollow">${e(b.name)}</a></li>`
    : `<li>${e(b.name)}</li>`)).join('');
  return `<section class="kit-card kit-section">
    <header><h2>Brands I've worked with</h2></header>
    <ul class="brand-list">${items}</ul>
  </section>`;
}

function bars(rows) {
  return rows.map(([label, value]) => `<div class="bar-row">
    <span class="bar-label">${e(label)}</span>
    <span class="bar"><span style="width:${Math.min(100, Math.max(0, Number(value) || 0))}%"></span></span>
    <span class="bar-value">${value === null ? '' : `${e(value)}%`}</span>
  </div>`).join('');
}

function audienceSection(audience) {
  if (!hasAudience(audience)) return '';
  const groups = [];
  const ages = AGE_GROUPS.filter((g) => audience.ages?.[g] != null).map((g) => [g, audience.ages[g]]);
  if (ages.length) groups.push(`<div><h3>Age</h3>${bars(ages)}</div>`);
  const gender = [['Male', audience.gender?.male], ['Female', audience.gender?.female]].filter(([, v]) => v != null);
  if (gender.length) groups.push(`<div><h3>Gender</h3>${bars(gender)}</div>`);
  if (audience.countries?.length) {
    groups.push(`<div><h3>Top countries</h3>${bars(audience.countries.map((c) => [c.name, c.percent]))}</div>`);
  }
  return `<section class="kit-card kit-section">
    <header><h2>Audience</h2><span class="stat-note">Self-reported</span></header>
    <div class="audience-grid">${groups.join('')}</div>
  </section>`;
}

export function accentStyle(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `--accent:${hex};--accent-soft:rgba(${r},${g},${b},0.15)`;
}

// The kit color: Essential creators can use extra colors or any custom color
export function kitColor(user, essential) {
  if (essential && isHexColor(user.accent)) return user.accent;
  if (THEMES[user.theme]) return THEMES[user.theme];
  if (essential && ESSENTIAL_THEMES[user.theme]) return ESSENTIAL_THEMES[user.theme];
  return THEMES.purple;
}

export function siteHeader(viewer) {
  const links = viewer
    ? `<a href="/calculator/">Calculator</a><a href="/pricing/">Pricing</a><a href="/dashboard/">Dashboard</a><a href="/${e(viewer.slug)}">My kit</a>`
    : '<a href="/calculator/">Calculator</a><a href="/pricing/">Pricing</a><a href="/affiliates/">Affiliates</a><a class="nav-cta" href="/login/">Get your media kit</a>';
  return `<header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="/">Creator<span class="gg">GG</span></a>
      <nav class="site-nav" aria-label="Main">${links}</nav>
    </div>
  </header>`;
}

function page({ title, head = '', bodyStyle = '', kitStyle = '', body }) {
  return `<!doctype html>
<html lang="en"${kitStyle ? ` data-kit-style="${e(kitStyle)}"` : ''}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${e(title)}</title>
  ${head}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body${bodyStyle ? ` style="${bodyStyle}"` : ''}>
${body}
</body>
</html>`;
}

function estimatedRatesSection(user, connections) {
  const { sections, bundle } = estimateRates(rateInput(user, connections));
  if (!sections.length) return '';
  const rows = sections.map((s) => `<h3>${e(s.name)}</h3>${s.rates.map(([label, range]) => `<div class="rate"><span>${e(label)}</span><span class="amount">${e(formatRange(range))}</span></div>`).join('')}`).join('');
  const bundleRow = bundle ? `<h3>Bundle</h3><div class="rate bundle"><span>One of each platform's main deal</span><span class="amount">${e(formatRange(bundle))}</span></div>` : '';
  return `<section class="kit-card kit-section"><header><h2>Sponsorship rates</h2></header>${rows}${bundleRow}<p class="note">Starting rates. Custom packages available.</p></section>`;
}

function customRatesSection(rateCard, packages) {
  const rows = rateCard.map((r) => `<div class="rate"><span>${e(r.name)}</span><span class="amount">${e(r.price)}</span></div>`).join('');
  const bundles = packages.map((p) => `<div class="package">
      <div class="package-head"><strong>${e(p.name)}</strong><span class="amount">${e(p.price)}</span></div>
      ${p.includes ? `<p>${e(p.includes)}</p>` : ''}
    </div>`).join('');
  return `<section class="kit-card kit-section">
    <header><h2>Sponsorship rates</h2></header>
    ${rows}
    ${bundles ? `<h3>Packages</h3><div class="packages">${bundles}</div>` : ''}
    <p class="note">Custom packages available on request.</p>
  </section>`;
}

/**
 * Renders a public media kit. `user` may already have a kit version's
 * overrides applied; `path` is the kit's own path (with the version, if any).
 */
export function renderKit(user, connections, { origin, host, viewer, print, path = `/${user.slug}` }) {
  const limits = planLimits(user);
  const essential = limits.essential;
  const hideBranding = essential && Boolean(user.hide_branding);
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
    ...SOCIALS.map((s) => {
      const handle = user[`${s.key}_handle`];
      const engagement = user[`${s.key}_engagement`];
      return platformCard(s.name, handle && { url: s.url(handle), label: s.key === 'facebook' ? `facebook.com/${handle}` : `@${handle}` }, false, [
        stat('Followers', count(user[`${s.key}_followers`]), 'Self-reported'),
        stat(s.viewsLabel, count(user[`${s.key}_avg_views`]), 'Self-reported'),
        stat('Engagement', engagement != null ? `${engagement}%` : null, 'Self-reported'),
      ]);
    }),
  ].join('');

  const audienceTotal = (twitch?.stats.followers || 0) + (yt.subscribers || 0) + (user.tiktok_followers || 0)
    + SOCIALS.reduce((sum, s) => sum + (user[`${s.key}_followers`] || 0), 0);

  let rates = '';
  if (user.show_rates) {
    const rateCard = parseJson(user.rate_card, []);
    const packages = parseJson(user.packages, []);
    rates = essential && user.rate_mode === 'custom' && (rateCard.length || packages.length)
      ? customRatesSection(rateCard, packages)
      : estimatedRatesSection(user, connections);
  }

  const sectionHtml = {
    platforms: `${audienceTotal ? `<p class="audience"><strong>${e(count(audienceTotal))}</strong> total followers across platforms</p>` : ''}
    <div class="kit-grid">${cards || '<p class="empty">No stats yet.</p>'}</div>`,
    audience: audienceSection(parseJson(user.audience, {})),
    featured: featuredSection(parseJson(user.featured, []).slice(0, limits.featured), host, connections),
    brands: brandsSection(parseJson(user.brands, [])),
    rates,
  };
  const order = essential ? normalizeSections(parseJson(user.sections, [])) : normalizeSections([]);
  const body = order.filter((s) => s.visible).map((s) => sectionHtml[s.key]).join('\n    ');

  // Games Twitch knows get their box art; anything else stays a plain tag
  const gameArt = parseJson(user.game_art, []);
  const games = splitGames(user.games)
    .map((text) => {
      const game = gameArt.find((g) => g.text === text);
      if (!game?.art) return `<li>${e(text)}</li>`;
      return `<li class="game"><img src="${e(boxArt(game.art, 72, 96))}" srcset="${e(boxArt(game.art, 144, 192))} 2x" alt="" width="36" height="48" loading="lazy">${e(game.name)}</li>`;
    })
    .join('');

  const updated = Math.max(0, ...Object.values(connections).map((c) => c.statsUpdatedAt || 0));
  const avatar = user.avatar_url
    ? `<img class="avatar" src="${e(user.avatar_url)}" alt="" width="96" height="96">`
    : `<div class="avatar avatar-fallback" aria-hidden="true">${e(user.display_name.charAt(0).toUpperCase())}</div>`;
  const pageUrl = `${origin}${path}`;
  const contact = user.contact_email
    ? `<a class="button no-print" href="mailto:${e(user.contact_email)}?subject=${encodeURIComponent(`Sponsorship inquiry for ${user.display_name}`)}">Work with me</a>
       <p class="print-only">Contact: ${e(user.contact_email)} · ${e(pageUrl)}</p>`
    : `<p class="print-only">${e(pageUrl)}</p>`;
  const description = user.bio || `${user.display_name}'s media kit: audience stats and sponsorship rates.`;
  const ownerBar = viewer?.id === user.id
    ? '<p class="owner-bar no-print">This is your media kit. <a href="/dashboard/">Edit it on your dashboard →</a></p>'
    : '';
  // Free kits double as referral links for their creator
  const ref = isReferralCode(user.referral_code) ? `?ref=${user.referral_code}` : '';
  const footer = hideBranding
    ? ''
    : `<footer class="site-footer no-print">
    <div class="wrap footer-inner"><span>Made with <a href="/${ref}">CreatorGG</a>. <a href="/login/${ref}">Make your free media kit →</a></span><nav aria-label="Footer"><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a></nav></div>
  </footer>`;

  return page({
    title: hideBranding ? `${user.display_name} · Media Kit` : `${user.display_name} · Media Kit · CreatorGG`,
    bodyStyle: accentStyle(kitColor(user, essential)),
    kitStyle: essential && user.kit_style !== 'auto' ? user.kit_style : '',
    head: `<meta name="description" content="${e(description.slice(0, 160))}">
  <meta property="og:title" content="${e(user.display_name)} · Media Kit">
  <meta property="og:description" content="${e(description.slice(0, 200))}">
  <meta property="og:url" content="${e(pageUrl)}">
  ${user.avatar_url ? `<meta property="og:image" content="${e(user.avatar_url)}">` : ''}`,
    body: `${hideBranding ? '' : siteHeader(viewer)}
  <main class="wrap kit">
    ${ownerBar}
    <section class="kit-hero">
      ${avatar}
      <div class="kit-intro">
        <h1>${e(user.display_name)}</h1>
        ${user.bio ? `<p class="bio">${e(user.bio)}</p>` : ''}
        ${games ? `<ul class="games" aria-label="Games and topics">${games}</ul>` : ''}
        ${contact}
      </div>
    </section>
    ${body}
    ${updated ? `<p class="updated">Verified stats updated ${e(dateFormat.format(updated))}</p>` : ''}
  </main>
  ${footer}
  ${print ? '<script>addEventListener("load", () => setTimeout(() => print(), 300));</script>' : ''}`,
  });
}

export function renderNotFound(viewer) {
  return page({
    title: 'Not found · CreatorGG',
    body: `${siteHeader(viewer)}
  <main class="wrap kit">
    <section class="hero">
      <h1>No media kit here</h1>
      <p>This link isn't taken yet. It could be yours.</p>
      <p><a class="button" href="/login/">Claim it free</a></p>
    </section>
  </main>`,
  });
}
