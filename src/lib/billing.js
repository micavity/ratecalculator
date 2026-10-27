// Stripe subscriptions for Essential and Pro. Stripe is the source of truth: every
// webhook re-fetches the object from Stripe (with our pinned API version)
// before updating the creator's plan.
import { stripe, planForPrice } from './stripe.js';
import { PLAN_RANK, activeGift } from './plans.js';
import { recordCommission, adjustCommissionForRefund } from './referrals.js';

// Access lasts a few days past the paid period, so a slightly late renewal
// doesn't lock anyone out
const GRACE_MS = 3 * 86400000;
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

async function findUser(env, { subscriptionId, userId, customerId }) {
  const db = env.DB;
  if (subscriptionId) {
    const user = await db.prepare('SELECT * FROM users WHERE stripe_subscription_id = ?').bind(subscriptionId).first();
    if (user) return user;
  }
  if (userId) {
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
    if (user) return user;
  }
  if (customerId) return db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').bind(customerId).first();
  return null;
}

// A gift that's at least as good and lasts at least as long wins over a payment
function giftOutranks(user, paidPlan, paidUntil) {
  const gift = activeGift(user);
  if (!gift || PLAN_RANK[gift.plan] < PLAN_RANK[paidPlan]) return false;
  return !gift.expires || gift.expires >= paidUntil;
}

// When a paid plan ends, a gift that's still running takes over again
function planAfterPaidEnds(env, user) {
  const gift = activeGift(user);
  return gift
    ? env.DB.prepare("UPDATE users SET plan = ?, plan_source = 'gift', plan_expires = ? WHERE id = ?").bind(gift.plan, gift.expires, user.id)
    : env.DB.prepare("UPDATE users SET plan = 'free', plan_source = '', plan_expires = NULL WHERE id = ?").bind(user.id);
}

export async function syncSubscription(env, subscription) {
  const user = await findUser(env, {
    subscriptionId: subscription.id,
    userId: subscription.metadata?.user_id,
    customerId: subscription.customer,
  });
  if (!user) return null;

  const active = ACTIVE_STATUSES.has(subscription.status);
  const periodEnd = (subscription.current_period_end || 0) * 1000;
  const price = subscription.items?.data?.[0]?.price;
  const interval = price?.recurring?.interval || null;
  const paidPlan = planForPrice(env, price?.id);
  const statements = [
    env.DB.prepare(`UPDATE users SET stripe_subscription_id = ?, stripe_customer_id = ?, subscription_status = ?,
      subscription_interval = ?, cancel_at_period_end = ? WHERE id = ?`)
      .bind(subscription.id, subscription.customer, subscription.status, interval, subscription.cancel_at_period_end ? 1 : 0, user.id),
  ];

  if (active && periodEnd) {
    const paidUntil = periodEnd + GRACE_MS;
    if (giftOutranks(user, paidPlan, paidUntil)) {
      if (user.plan_source === 'paid') statements.push(planAfterPaidEnds(env, user));
    } else {
      statements.push(env.DB.prepare("UPDATE users SET plan = ?, plan_source = 'paid', plan_expires = ? WHERE id = ?")
        .bind(paidPlan, paidUntil, user.id));
    }
  } else if (['canceled', 'unpaid', 'incomplete_expired'].includes(subscription.status) && user.plan_source === 'paid') {
    statements.push(planAfterPaidEnds(env, user));
  }
  await env.DB.batch(statements);
  return user.id;
}

async function syncById(env, subscriptionId) {
  if (!subscriptionId) return null;
  return syncSubscription(env, await stripe(env, 'GET', `subscriptions/${subscriptionId}`));
}

// Credits a referrer when someone typed their code at checkout instead of using a link
async function attributeFromDiscount(env, userId, subscription) {
  const promoId = subscription.discount?.promotion_code;
  if (!promoId) return;
  const user = await env.DB.prepare('SELECT referred_by FROM users WHERE id = ?').bind(userId).first();
  if (!user || user.referred_by) return;
  const promo = await stripe(env, 'GET', `promotion_codes/${promoId}`);
  const referrerId = promo.metadata?.referrer_id;
  if (referrerId && referrerId !== userId) {
    await env.DB.prepare('UPDATE users SET referred_by = ? WHERE id = ? AND referred_by IS NULL').bind(referrerId, userId).run();
  }
}

async function handleInvoicePaid(env, invoiceId) {
  const invoice = await stripe(env, 'GET', `invoices/${invoiceId}`);
  await syncById(env, invoice.subscription);
  const user = await findUser(env, { subscriptionId: invoice.subscription, customerId: invoice.customer });
  if (!user || (invoice.amount_paid || 0) <= 0) return;
  if (!user.first_paid_at) {
    user.first_paid_at = Date.now();
    await env.DB.prepare('UPDATE users SET first_paid_at = ? WHERE id = ? AND first_paid_at IS NULL').bind(user.first_paid_at, user.id).run();
  }
  await recordCommission(env, user, invoice);
}

async function handleRefund(env, chargeId) {
  const charge = await stripe(env, 'GET', `charges/${chargeId}`);
  if (!charge.invoice) return;
  await adjustCommissionForRefund(env, charge.invoice, charge.amount, charge.amount_refunded);
}

export async function handleStripeEvent(env, event) {
  const object = event.data?.object || {};
  switch (event.type) {
    case 'checkout.session.completed': {
      if (object.mode !== 'subscription' || !object.subscription) return;
      if (object.client_reference_id && object.customer) {
        await env.DB.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ? AND stripe_customer_id IS NULL')
          .bind(object.customer, object.client_reference_id).run();
      }
      const subscription = await stripe(env, 'GET', `subscriptions/${object.subscription}`);
      await syncSubscription(env, subscription);
      if (object.client_reference_id) await attributeFromDiscount(env, object.client_reference_id, subscription);
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncById(env, object.id);
      return;
    case 'invoice.paid':
      await handleInvoicePaid(env, object.id);
      return;
    case 'invoice.payment_failed': {
      const invoice = await stripe(env, 'GET', `invoices/${object.id}`);
      await syncById(env, invoice.subscription);
      return;
    }
    case 'charge.refunded':
      await handleRefund(env, object.id);
      return;
    default:
  }
}

// What the dashboard shows about a creator's subscription
export function billingInfo(user, configured, proAvailable, ultraAvailable) {
  return {
    configured,
    proAvailable,
    ultraAvailable,
    subscribed: Boolean(user.stripe_subscription_id && ACTIVE_STATUSES.has(user.subscription_status)),
    status: user.subscription_status || '',
    interval: user.subscription_interval,
    cancelAtPeriodEnd: Boolean(user.cancel_at_period_end),
    hasCustomer: Boolean(user.stripe_customer_id),
  };
}

// Cancels right away, e.g. when a creator deletes their account
export async function cancelSubscriptionNow(env, user) {
  if (!user.stripe_subscription_id || !ACTIVE_STATUSES.has(user.subscription_status)) return;
  await stripe(env, 'DELETE', `subscriptions/${user.stripe_subscription_id}`);
}
