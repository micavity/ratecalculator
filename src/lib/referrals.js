// Referral program: creators share a code or link. New creators who sign up
// with it get a discount, and the referrer earns a commission on what they pay.
import { stripe } from './stripe.js';

export const REFERRAL = {
  commissionRate: 0.25,
  commissionMonths: 12,
  holdDays: 30,
  discountPercent: 20,
  discountMonths: 3,
  minPayoutCents: 2500,
};

const CODE_PATTERN = /^[A-Z0-9]{3,16}$/;

export function isReferralCode(code) {
  return CODE_PATTERN.test(String(code || '').toUpperCase());
}

// Gives a creator a referral code based on their link, e.g. "NOVAPLAYS"
export async function ensureReferralCode(env, user) {
  if (user.referral_code) return user.referral_code;
  let base = user.slug.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (base.length < 3) base = `GG${base}`.padEnd(3, 'G');
  for (let i = 0; i < 20; i++) {
    const code = i === 0 ? base : `${base.slice(0, 12)}${Math.floor(Math.random() * 900) + 100}`;
    const taken = await env.DB.prepare('SELECT 1 FROM users WHERE referral_code = ?').bind(code).first();
    if (taken) continue;
    const result = await env.DB.prepare('UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL')
      .bind(code, user.id).run();
    if (result.meta?.changes) return code;
    // Someone else set it at the same moment
    return (await env.DB.prepare('SELECT referral_code FROM users WHERE id = ?').bind(user.id).first()).referral_code;
  }
  return null;
}

export async function findReferrer(env, code) {
  if (!isReferralCode(code)) return null;
  return env.DB.prepare('SELECT * FROM users WHERE referral_code = ?').bind(code.toUpperCase()).first();
}

// Credits a brand-new account to whoever referred it
export async function attributeSignup(env, newUserId, code) {
  const referrer = await findReferrer(env, code);
  if (!referrer || referrer.id === newUserId) return false;
  await env.DB.prepare('UPDATE users SET referred_by = ? WHERE id = ? AND referred_by IS NULL').bind(referrer.id, newUserId).run();
  return true;
}

function stripeMode(env) {
  return String(env.STRIPE_SECRET_KEY || '').startsWith('sk_live') ? 'live' : 'test';
}

async function getSetting(env, key) {
  return (await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first())?.value ?? null;
}

async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .bind(key, value).run();
}

// One shared Stripe coupon: X% off for the first N months
async function referralCoupon(env) {
  const key = `stripe_referral_coupon:${stripeMode(env)}`;
  const existing = await getSetting(env, key);
  if (existing) return existing;
  const coupon = await stripe(env, 'POST', 'coupons', {
    percent_off: REFERRAL.discountPercent,
    duration: 'repeating',
    duration_in_months: REFERRAL.discountMonths,
    name: `Referral: ${REFERRAL.discountPercent}% off ${REFERRAL.discountMonths} months`,
  });
  await setSetting(env, key, coupon.id);
  return coupon.id;
}

/**
 * Makes sure the referrer's code works as a Stripe promotion code, so it can
 * be typed in at checkout too. Returns the promotion code's Stripe ID.
 */
export async function ensurePromotionCode(env, referrer) {
  const code = await ensureReferralCode(env, referrer);
  const key = `stripe_promo:${stripeMode(env)}:${referrer.id}`;
  const existing = await getSetting(env, key);
  if (existing) return existing;

  const found = await stripe(env, 'GET', 'promotion_codes', { code, limit: 1 });
  let promo = found.data?.[0];
  if (promo && promo.metadata?.referrer_id !== referrer.id) return null;
  if (!promo) {
    promo = await stripe(env, 'POST', 'promotion_codes', {
      coupon: await referralCoupon(env),
      code,
      metadata: { referrer_id: referrer.id },
      restrictions: { first_time_transaction: true },
    });
  }
  await setSetting(env, key, promo.id);
  return promo.id;
}

// Commission on one paid invoice from a referred creator
export async function recordCommission(env, user, invoice, now = Date.now()) {
  const amount = invoice.amount_paid || 0;
  if (amount <= 0 || !user.referred_by) return false;

  const firstPaid = user.first_paid_at || now;
  const cutoff = firstPaid + REFERRAL.commissionMonths * 30.5 * 86400000;
  if (now > cutoff) return false;

  const referrer = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(user.referred_by).first();
  if (!referrer) return false;

  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO commissions (id, referrer_id, referred_id, amount_cents, commission_cents, currency, status, created_at, available_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).bind(
    invoice.id, referrer.id, user.id, amount, Math.round(amount * REFERRAL.commissionRate),
    invoice.currency || 'usd', now, now + REFERRAL.holdDays * 86400000,
  ).run();
  return Boolean(result.meta?.changes);
}

// Shrinks or cancels a commission when its payment is refunded
export async function adjustCommissionForRefund(env, invoiceId, amountPaid, amountRefunded) {
  const commission = await env.DB.prepare("SELECT * FROM commissions WHERE id = ? AND status != 'paid'").bind(invoiceId).first();
  if (!commission) return;
  const kept = Math.max(0, amountPaid - amountRefunded);
  if (kept === 0) {
    await env.DB.prepare("UPDATE commissions SET status = 'void', commission_cents = 0 WHERE id = ?").bind(invoiceId).run();
  } else {
    await env.DB.prepare('UPDATE commissions SET amount_cents = ?, commission_cents = ? WHERE id = ?')
      .bind(kept, Math.round(kept * REFERRAL.commissionRate), invoiceId).run();
  }
}

export async function referralStats(env, userId, now = Date.now()) {
  const [people, money] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS signups, SUM(CASE WHEN first_paid_at IS NOT NULL THEN 1 ELSE 0 END) AS paying
      FROM users WHERE referred_by = ?`).bind(userId).first(),
    env.DB.prepare(`SELECT
        COALESCE(SUM(CASE WHEN status = 'pending' AND available_at > ? THEN commission_cents END), 0) AS held,
        COALESCE(SUM(CASE WHEN status = 'pending' AND available_at <= ? THEN commission_cents END), 0) AS available,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN commission_cents END), 0) AS paid
      FROM commissions WHERE referrer_id = ?`).bind(now, now, userId).first(),
  ]);
  return {
    signups: people.signups || 0,
    paying: people.paying || 0,
    heldCents: money.held,
    availableCents: money.available,
    paidCents: money.paid,
  };
}
