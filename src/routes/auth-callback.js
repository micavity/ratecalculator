import { PROVIDERS, STATE_COOKIE, callbackUrl } from '../lib/oauth.js';
import { cookie, getCookie } from '../lib/http.js';
import { createSession, getSessionUser } from '../lib/session.js';
import { signInWithAccount } from '../lib/users.js';
import { NoChannelError } from '../lib/youtube.js';

// Where Twitch / Google send the creator back after they approve
export async function onRequestGet({ request, env, params }) {
  const provider = PROVIDERS[params.provider];
  if (!provider) return new Response('Not found', { status: 404 });

  const url = new URL(request.url);
  const currentUser = await getSessionUser(request, env);
  const errorPage = currentUser ? '/dashboard/' : '/login/';
  const headers = new Headers({ 'set-cookie': cookie(STATE_COOKIE, '', 0) });
  const fail = (code) => {
    headers.set('location', `${errorPage}?error=${code}`);
    return new Response(null, { status: 302, headers });
  };

  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (url.searchParams.get('error')) return fail('cancelled');
  if (!code || !state || state !== getCookie(request, STATE_COOKIE)) return fail('expired');

  let result = currentUser ? 'linked' : null;
  try {
    const { account, stats } = await provider.complete(env, code, callbackUrl(request, params.provider));
    const { userId, merged } = await signInWithAccount(env, params.provider, account, stats, currentUser);
    if (!currentUser) headers.append('set-cookie', await createSession(env, userId));
    if (merged) result = 'merged';
  } catch (err) {
    if (err instanceof NoChannelError) return fail('no_channel');
    console.error(`Sign-in with ${params.provider} failed:`, err.message);
    return fail('failed');
  }

  headers.set('location', result ? `/dashboard/?connected=${result}` : '/dashboard/');
  return new Response(null, { status: 302, headers });
}
