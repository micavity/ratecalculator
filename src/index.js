// CreatorGG Worker. Static pages in public/ are served automatically;
// anything that isn't a static file comes here.
import * as me from './routes/me.js';
import * as profile from './routes/profile.js';
import * as refresh from './routes/refresh.js';
import * as logout from './routes/logout.js';
import * as disconnect from './routes/disconnect.js';
import * as authStart from './routes/auth-start.js';
import * as authCallback from './routes/auth-callback.js';
import * as kit from './routes/kit.js';
import * as status from './routes/status.js';
import * as session from './routes/session.js';
import { ensureSchema } from './lib/migrate.js';

// [method, path pattern, handler]. ":name" matches one path segment.
const ROUTES = [
  ['GET', '/api/status', status.onRequestGet],
  ['GET', '/api/session', session.onRequestGet],
  ['GET', '/api/me', me.onRequestGet],
  ['PUT', '/api/profile', profile.onRequestPut],
  ['POST', '/api/refresh', refresh.onRequestPost],
  ['POST', '/api/logout', logout.onRequestPost],
  ['DELETE', '/api/connections/:provider', disconnect.onRequestDelete],
  ['GET', '/auth/:provider', authStart.onRequestGet],
  ['GET', '/auth/:provider/callback', authCallback.onRequestGet],
  ['GET', '/:slug', kit.onRequestGet],
];

function match(pattern, path) {
  const want = pattern.split('/');
  const got = path.replace(/\/$/, '').split('/');
  if (want.length !== got.length) return null;
  const params = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) {
      if (!got[i]) return null;
      params[want[i].slice(1)] = decodeURIComponent(got[i]);
    } else if (want[i] !== got[i]) {
      return null;
    }
  }
  return params;
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    const next = () => env.ASSETS.fetch(request);

    for (const [method, pattern, handler] of ROUTES) {
      const params = match(pattern, path);
      if (!params) continue;
      if (request.method !== method && !(method === 'GET' && request.method === 'HEAD')) continue;
      try {
        await ensureSchema(env);
        return await handler({ request, env, params, next, waitUntil: (p) => ctx.waitUntil(p) });
      } catch (err) {
        console.error(`${request.method} ${path} failed:`, err);
        return new Response('Something went wrong', { status: 500 });
      }
    }
    return next();
  },
};
