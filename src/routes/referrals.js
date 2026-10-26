import { json, sameOrigin } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { stripeConfigured } from '../lib/stripe.js';
import { REFERRAL, ensureReferralCode, ensurePromotionCode, referralStats } from '../lib/referrals.js';

export async function onRequestGet({ request, env, waitUntil }) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Not signed in' }, 401);
  const code = await ensureReferralCode(env, user);
  // Set up the matching Stripe promotion code in the background
  if (stripeConfigured(env)) {
    waitUntil(ensurePromotionCode(env, { ...user, referral_code: code }).catch((err) => console.error('Promotion code failed:', err.message)));
  }
  return json({
    code,
    link: `${new URL(request.url).origin}/?ref=${code}`,
    payoutEmail: user.payout_email,
    stats: await referralStats(env, user.id),
    program: REFERRAL,
  });
}

export async function onRequestPut({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Not signed in' }, 401);
  const body = await request.json().catch(() => ({}));
  const email = String(body.payoutEmail ?? '').trim().slice(0, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid PayPal email.', field: 'payoutEmail' }, 400);
  await env.DB.prepare('UPDATE users SET payout_email = ? WHERE id = ?').bind(email, user.id).run();
  return json({ ok: true });
}
