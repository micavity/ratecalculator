import { html, json, redirect, escapeHtml as e } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { getConnections } from '../lib/users.js';
import { hasPlan, planLimits } from '../lib/plans.js';
import { renderNotFound, siteHeader, kitColor, accentStyle, hiddenStats } from '../lib/kit.js';
import { buildMonthlyReport, availableMonths, currentMonth, monthRange } from '../lib/monthly.js';
import { bookingOpen, today } from '../lib/booking.js';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// The dashboard's Reports tab: /api/monthly?month=2026-10
export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Not signed in' }, 401);
  const months = availableMonths(user);
  const asked = new URL(request.url).searchParams.get('month');
  const month = MONTH.test(asked || '') && months.includes(asked) ? asked : months[0] || currentMonth();
  const sections = await buildMonthlyReport(env, user, await getConnections(env, user.id), month);
  return json({ month, months, sections });
}

function monthName(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

// A one-page update creators send past and current sponsors: /update/<kit link>/<month>
export async function updatePage({ request, env, params }) {
  const viewer = await getSessionUser(request, env);
  const slug = params.slug.toLowerCase();
  if (params.slug !== slug) return redirect(`/update/${slug}/${params.month}`);
  const user = await env.DB.prepare('SELECT * FROM users WHERE slug = ?').bind(slug).first();
  if (!user || !hasPlan(user, 'ultra') || !MONTH.test(params.month) || params.month > currentMonth()) return html(renderNotFound(viewer), 404);
  const connections = await getConnections(env, user.id);
  const essential = planLimits(user).essential;
  const hidden = hiddenStats(user, essential);
  const r = monthRange(params.month);

  const { results } = await env.DB.prepare(`SELECT platform, day, followers FROM stat_snapshots
    WHERE user_id = ? AND day >= ? AND day < ? AND followers IS NOT NULL ORDER BY day`).bind(user.id, r.startDay, r.endDay).all();
  const byPlatform = {};
  for (const row of results) (byPlatform[row.platform] ||= []).push(row.followers);
  const names = { twitch: 'Twitch followers', youtube: 'YouTube subscribers', tiktok: 'TikTok followers', instagram: 'Instagram followers', facebook: 'Facebook followers', x: 'X followers' };
  const growth = Object.entries(byPlatform)
    .filter(([p]) => !hidden.has(`${p}.${p === 'youtube' ? 'subscribers' : 'followers'}`))
    .map(([p, list]) => {
      const change = list[list.length - 1] - list[0];
      return `<div class="stat"><span class="stat-value">${e(compact.format(list[list.length - 1]))}</span><span class="stat-label">${e(names[p] || p)}</span>${change ? `<span class="stat-note">${change > 0 ? '+' : ''}${e(compact.format(change))} this month</span>` : ''}</div>`;
    }).join('');

  // Recent highlights are only meaningful for this month or last
  const recent = params.month >= currentMonth(Date.now() - 32 * 86400000);
  const top = recent ? [
    ...(connections.youtube?.stats.topRecent || []).slice(0, 3).map((v) => ({ title: v.title, views: v.views, url: `https://www.youtube.com/watch?v=${v.id}` })),
    ...(connections.twitch?.stats.topClips || []).slice(0, 2).map((c) => ({ title: c.title, views: c.views, url: c.url })),
  ].sort((a, b) => b.views - a.views).slice(0, 4) : [];

  let slots = '';
  if (bookingOpen(user)) {
    const open = (await env.DB.prepare("SELECT day, kind FROM booking_slots WHERE user_id = ? AND status = 'open' AND day >= ? ORDER BY day LIMIT 5").bind(user.id, today()).all()).results;
    if (open.length) {
      slots = `<section class="kit-card"><h2>Open dates</h2><ul class="update-list">${open.map((s) => `<li><strong>${e(s.day)}</strong> · ${e(s.kind)}</li>`).join('')}</ul>
        <a class="button" href="/book/${e(user.slug)}">Book a date</a></section>`;
    }
  }
  const contact = user.contact_email ? `<a class="button" href="mailto:${e(user.contact_email)}?subject=${encodeURIComponent(`Working together again: ${user.display_name}`)}">Work with me again</a>` : '';
  const avatar = user.avatar_url
    ? `<img class="avatar proposal-avatar" src="${e(user.avatar_url)}" alt="">`
    : `<div class="avatar avatar-fallback proposal-avatar" aria-hidden="true">${e(user.display_name.charAt(0).toUpperCase())}</div>`;

  return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${e(user.display_name)} · ${e(monthName(params.month))} update</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body style="${accentStyle(kitColor(user, essential))}">
${siteHeader(viewer)}
<main class="wrap proposal-page">
  <section class="kit-card proposal-hero">
    <div class="proposal-from">
      ${avatar}
      <div>
        <p class="small muted">${e(monthName(params.month))} update</p>
        <h1>${e(user.display_name)}</h1>
        <a href="/${e(user.slug)}">See full media kit →</a>
      </div>
    </div>
    ${growth ? `<div class="example-stats proposal-stats">${growth}</div>` : '<p class="muted">Stats for this month are still coming in.</p>'}
  </section>
  ${top.length ? `<section class="kit-card"><h2>Top content</h2><ul class="update-list">${top.map((v) => `<li><a href="${e(v.url)}" target="_blank" rel="noopener">${e(v.title || v.url)}</a> · ${e(compact.format(v.views))} views</li>`).join('')}</ul></section>` : ''}
  ${slots}
  <section class="kit-card update-cta"><h2>Let's work together</h2><p class="muted">Thanks for following along. I'd love to plan our next campaign.</p><div class="kit-link-actions">${contact}<a class="button button-secondary" href="/${e(user.slug)}">Media kit</a></div></section>
</main>
</body>
</html>`);
}
