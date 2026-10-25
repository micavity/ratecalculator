import { PROVIDERS, STATE_COOKIE, callbackUrl } from '../../../lib/oauth.js';
import { cookie, randomToken, redirect } from '../../../lib/http.js';

// Starts sign-in: /auth/twitch or /auth/youtube
export async function onRequestGet({ request, env, params }) {
  const provider = PROVIDERS[params.provider];
  if (!provider) return new Response('Not found', { status: 404 });
  if (!provider.configured(env)) return redirect('/login?error=not_configured');

  const state = randomToken(16);
  return redirect(provider.authorizeUrl(env, callbackUrl(request, params.provider), state), {
    'set-cookie': cookie(STATE_COOKIE, state, 600),
  });
}
