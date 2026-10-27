// Ultra campaign reports: the creator lists the sponsored videos, streams
// and clips they made, and brands get a page at /r/<id> with live stats.
// Stats refresh when the page is opened (at most every 6 hours) and from
// the scheduled job, so YouTube data is never older than 30 days.
import { escapeHtml as e } from './http.js';
import { parseJson, parseVideoUrl } from './kit-content.js';
import { siteHeader, kitColor, accentStyle, embedUrl } from './kit.js';
import { planLimits } from './plans.js';
import { withVideoStats } from './video-stats.js';

export const MAX_REPORT_LINKS = 12;
export const STATS_MAX_AGE = 6 * 3600000;
const YOUTUBE_KEEP_MS = 25 * 86400000;

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function count(value) {
  if (value === '' || value === null || value === undefined) return { value: null };
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 1e10 ? { value: n } : { error: true };
}

// Checks a report from the dashboard. Keeps stats already fetched for links that didn't change.
export function readReport(body, previous = []) {
  const brand = text(body.brand, 80);
  if (!brand) return { field: 'brand', error: 'Enter the brand name.' };
  const lines = String(body.links ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { field: 'links', error: 'Add at least one link to the content you made.' };
  if (lines.length > MAX_REPORT_LINKS) return { field: 'links', error: `Add up to ${MAX_REPORT_LINKS} links.` };
  const content = [];
  for (const line of lines) {
    const video = parseVideoUrl(line);
    if (!video) return { field: 'links', error: `"${line.slice(0, 60)}" isn't a YouTube video or Twitch clip/VOD link.` };
    const known = previous.find((p) => p.type === video.type && p.id === video.id);
    content.push({ ...known, url: line.slice(0, 300), ...video });
  }
  const clicks = count(body.clicks);
  if (clicks.error) return { field: 'clicks', error: 'Enter a whole number of clicks.' };
  const conversions = count(body.conversions);
  if (conversions.error) return { field: 'conversions', error: 'Enter a whole number.' };
  return {
    values: {
      brand,
      title: text(body.title, 100) || `${brand} campaign report`,
      content,
      clicks: clicks.value,
      conversions: conversions.value,
      summary: text(body.summary, 1500) || null,
    },
  };
}

export function reportTotals(content) {
  const sum = (key) => content.reduce((s, v) => s + (Number(v.stats?.[key]) || 0), 0);
  const views = sum('views');
  const interactions = sum('likes') + sum('comments');
  return { views, likes: sum('likes'), comments: sum('comments'), engagement: views ? Math.round((interactions / views) * 1000) / 10 : null };
}

export function reportFields(row) {
  const content = parseJson(row.content, []);
  return {
    id: row.id,
    dealId: row.deal_id || '',
    brand: row.brand,
    title: row.title,
    links: content.map((v) => v.url).join('\n'),
    content,
    clicks: row.clicks,
    conversions: row.conversions,
    summary: row.summary || '',
    totals: reportTotals(content),
    statsUpdatedAt: row.stats_updated_at,
    createdAt: row.created_at,
  };
}

// Fetches fresh stats and saves them. Returns the updated row.
export async function refreshReport(env, row) {
  const content = await withVideoStats(env, parseJson(row.content, []));
  const now = Date.now();
  await env.DB.prepare('UPDATE campaign_reports SET content = ?, stats_updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(content), now, row.id).run();
  return { ...row, content: JSON.stringify(content), stats_updated_at: now };
}

// Keeps reports' stats fresh, so stored YouTube numbers never get too old
export async function refreshStaleReports(env, limit = 20) {
  const { results } = await env.DB.prepare('SELECT * FROM campaign_reports WHERE stats_updated_at IS NULL OR stats_updated_at < ? ORDER BY stats_updated_at LIMIT ?')
    .bind(Date.now() - YOUTUBE_KEEP_MS, limit).all();
  for (const row of results) {
    await refreshReport(env, row).catch((err) => console.error('Report refresh failed:', err.message));
  }
  return results.length;
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en-US');

function when(ts) {
  return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function renderReport(row, user, { viewer, origin, host }) {
  const r = reportFields(row);
  const essential = planLimits(user).essential;
  const owner = viewer?.id === user.id;
  const t = r.totals;
  const stat = (value, label) => `<div class="stat"><span class="stat-value">${e(value)}</span><span class="stat-label">${e(label)}</span></div>`;
  const stats = [
    stat(compact.format(t.views), 'Total views'),
    t.likes ? stat(compact.format(t.likes), 'Likes') : '',
    t.comments ? stat(compact.format(t.comments), 'Comments') : '',
    t.engagement !== null && t.likes ? stat(`${t.engagement}%`, 'Engagement') : '',
    r.clicks !== null ? stat(full.format(r.clicks), 'Link clicks') : '',
    r.conversions !== null ? stat(full.format(r.conversions), 'Code uses / sales') : '',
  ].join('');
  const items = r.content.map((v) => {
    const s = v.stats || {};
    const parts = [];
    if (s.views != null) parts.push(`${full.format(s.views)} views`);
    if (s.likes != null) parts.push(`${full.format(s.likes)} likes`);
    if (s.comments != null) parts.push(`${full.format(s.comments)} comments`);
    if (s.publishedAt) parts.push(`posted ${when(s.publishedAt)}`);
    return `<div class="report-item">
      <div class="embed no-print"><iframe src="${e(embedUrl(v, host))}" title="${e(s.title || 'Sponsored content')}" loading="lazy" allowfullscreen allow="encrypted-media; picture-in-picture"></iframe></div>
      <div>
        <p class="video-title"><a href="${e(v.url)}" target="_blank" rel="noopener">${e(s.title || v.url)}</a></p>
        <p class="video-stats">${e(parts.join(' · ') || 'Stats not available yet')}</p>
      </div>
    </div>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${e(r.title)} · ${e(user.display_name)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body style="${accentStyle(kitColor(user, essential))}">
${siteHeader(viewer)}
<main class="wrap proposal-page">
  ${owner ? '<p class="owner-bar no-print">This is your campaign report. Send the brand this page\'s link; the numbers stay up to date. <a href="/dashboard/#deals">Back to dashboard</a></p>' : ''}
  <section class="kit-card proposal-hero">
    <p class="small muted">Campaign report for <strong>${e(r.brand)}</strong></p>
    <h1 class="report-title">${e(r.title)}</h1>
    <p class="muted">By <a href="${e(origin)}/${e(user.slug)}">${e(user.display_name)}</a>${r.statsUpdatedAt ? ` · Live stats, updated ${e(when(r.statsUpdatedAt))}` : ''}</p>
    <div class="example-stats proposal-stats">${stats}</div>
  </section>
  ${r.summary ? `<section class="kit-card"><h2>Summary</h2><p class="proposal-message">${e(r.summary).replace(/\n/g, '<br>')}</p></section>` : ''}
  <section class="kit-card">
    <h2>Content</h2>
    <div class="report-items">${items}</div>
    <p class="small muted">Views, likes and comments come straight from YouTube and Twitch. Clicks and code uses are reported by the creator.</p>
  </section>
  <p class="no-print"><button type="button" onclick="window.print()">Download PDF</button></p>
</main>
</body>
</html>`;
}
