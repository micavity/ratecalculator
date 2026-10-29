import { html, redirect } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { RESERVED_SLUGS, getConnections, refreshStats } from '../lib/users.js';
import { recordVisit } from '../lib/analytics.js';
import { hasPlan } from '../lib/plans.js';
import { twitchConfigured, getLiveStream } from '../lib/twitch.js';
import { applyVersion } from '../lib/versions.js';
import { renderKit, renderNotFound, hiddenStats } from '../lib/kit.js';
import { kitGrowthLine } from '../lib/projections.js';

// Ultra kits show a "Live now" badge while the creator streams on Twitch.
// Never holds the kit up for long: anything slower than a second is skipped.
async function liveStatus(env, user, connections) {
  if (!connections.twitch || !hasPlan(user, 'ultra') || !twitchConfigured(env)) return null;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 1000));
  try {
    return await Promise.race([getLiveStream(env, connections.twitch.providerId), timeout]);
  } catch (err) {
    console.error('Live check failed:', err.message);
    return null;
  }
}

// Public media kits live at creatorgg.com/<slug>, and kit versions
// (Essential) at creatorgg.com/<slug>/<version>
export async function onRequestGet(context) {
  const { request, env, params } = context;
  const slug = params.slug;
  const versionKey = params.version?.toLowerCase();

  // Let static files and app pages through
  if (slug.includes('.') || RESERVED_SLUGS.has(slug.toLowerCase())) return context.next();

  const url = new URL(request.url);
  const linkId = /^[a-z0-9]{8}$/.test(url.searchParams.get('for') || '') ? url.searchParams.get('for') : null;
  const query = linkId ? `?for=${linkId}` : '';
  if (slug !== slug.toLowerCase() || (params.version && params.version !== versionKey)) {
    return redirect(`/${slug.toLowerCase()}${versionKey ? `/${versionKey}` : ''}${query}`);
  }

  const viewer = await getSessionUser(request, env);
  const user = await env.DB.prepare('SELECT * FROM users WHERE slug = ?').bind(slug).first();
  if (!user) return html(renderNotFound(viewer), 404);

  let kitUser = user;
  if (versionKey) {
    const version = await env.DB.prepare('SELECT * FROM kit_versions WHERE user_id = ? AND key = ?').bind(user.id, versionKey).first();
    // Unknown versions, or versions on a lapsed plan, fall back to the main kit
    if (!version || !hasPlan(user, 'essential')) return redirect(`/${slug}${query}`);
    kitUser = applyVersion(user, version);
  }

  const connections = await getConnections(env, user.id);
  const live = await liveStatus(env, user, connections);
  const growth = hasPlan(user, 'pro') && user.show_growth
    ? await kitGrowthLine(env, user, hiddenStats(user, true)).catch(() => null)
    : null;
  // Refresh stale stats and count the view in the background
  context.waitUntil(refreshStats(env, user.id));
  context.waitUntil(recordVisit(env, request, user.id, viewer, linkId).catch((err) => console.error('View count failed:', err.message)));

  return html(renderKit(kitUser, connections, {
    origin: url.origin,
    host: url.hostname,
    viewer,
    print: url.searchParams.has('print'),
    path: `/${slug}${versionKey ? `/${versionKey}` : ''}`,
    live,
    growth,
  }));
}
