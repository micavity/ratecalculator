import { html, redirect } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { RESERVED_SLUGS, getConnections, refreshStats, recordView } from '../lib/users.js';
import { renderKit, renderNotFound } from '../lib/kit.js';

// Public media kits live at creatorgg.com/<slug>
export async function onRequestGet(context) {
  const { request, env, params } = context;
  const slug = params.slug;

  // Let static files and app pages through
  if (slug.includes('.') || RESERVED_SLUGS.has(slug.toLowerCase())) return context.next();
  if (slug !== slug.toLowerCase()) return redirect(`/${slug.toLowerCase()}`);

  const url = new URL(request.url);
  const viewer = await getSessionUser(request, env);
  const user = await env.DB.prepare('SELECT * FROM users WHERE slug = ?').bind(slug).first();
  if (!user) return html(renderNotFound(viewer), 404);

  const connections = await getConnections(env, user.id);
  // Refresh stale stats and count the view in the background
  context.waitUntil(refreshStats(env, user.id));
  context.waitUntil(recordView(env, request, user.id, viewer).catch((err) => console.error('View count failed:', err.message)));

  return html(renderKit(user, connections, {
    origin: url.origin,
    host: url.hostname,
    viewer,
    print: url.searchParams.has('print'),
  }));
}
