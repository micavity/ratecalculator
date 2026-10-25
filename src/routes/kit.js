import { html, redirect } from '../lib/http.js';
import { RESERVED_SLUGS, getConnections, refreshStats } from '../lib/users.js';
import { renderKit, renderNotFound } from '../lib/kit.js';

// Public media kits live at creatorgg.com/<slug>
export async function onRequestGet(context) {
  const { request, env, params } = context;
  const slug = params.slug;

  // Let static files and app pages through
  if (slug.includes('.') || RESERVED_SLUGS.has(slug.toLowerCase())) return context.next();
  if (slug !== slug.toLowerCase()) return redirect(`/${slug.toLowerCase()}`);

  const user = await env.DB.prepare('SELECT * FROM users WHERE slug = ?').bind(slug).first();
  if (!user) return html(renderNotFound(), 404);

  const connections = await getConnections(env, user.id);
  // Refresh stale stats in the background; this view shows the cached ones
  context.waitUntil(refreshStats(env, user.id));

  return html(renderKit(user, connections, new URL(request.url).origin));
}
