import { json, sameOrigin } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { stripe, stripeConfigured, planConfigured, priceFor, planForPrice, verifyWebhook } from '../lib/stripe.js';
import { handleStripeEvent, syncSubscription } from '../lib/billing.js';
import { ensurePromotionCode } from '../lib/referrals.js';
import { PLAN_NAMES, PLAN_RANK, activeGift } from '../lib/plans.js';

async function signedIn(request, env) {
  if (!sameOrigin(request)) return { response: json({ error: 'Bad origin' }, 403) };
  const user = await getSessionUser(request, env, { creatorOnly: true });
  if (!user) return { response: json({ error: 'Not signed in' }, 401) };
  if (!stripeConfigured(env)) return { response: json({ error: 'Payments are not set up yet.' }, 503) };
  return { user };
}

async function ensureCustomer(env, user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const customer = await stripe(env, 'POST', 'customers', {
    name: user.display_name,
    metadata: { user_id: user.id, kit: user.slug },
  });
  await env.DB.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').bind(customer.id, user.id).run();
  return customer.id;
}

const ACTIVE = ['active', 'trialing', 'past_due'];

function requestedPlan(env, body) {
  if (body.plan === 'pro' || body.plan === 'ultra') {
    return planConfigured(env, body.plan) ? { plan: body.plan } : { error: `${PLAN_NAMES[body.plan]} isn't available yet.` };
  }
  return { plan: 'essential' };
}

// Starts Stripe Checkout: { plan: 'essential' | 'pro' | 'ultra', interval: 'month' | 'year' }
export async function checkout({ request, env }) {
  const { user, response } = await signedIn(request, env);
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const { plan, error } = requestedPlan(env, body);
  if (error) return json({ error }, 400);
  if (ACTIVE.includes(user.subscription_status)) {
    return json({ error: 'You already have a subscription. Use "Manage subscription" to change it.' }, 409);
  }
  const gift = activeGift(user);
  if (gift && !gift.expires && PLAN_RANK[gift.plan] >= PLAN_RANK[plan]) {
    return json({ error: `You already have ${PLAN_NAMES[gift.plan]} for life.` }, 409);
  }

  const price = priceFor(env, plan, body.interval === 'year' ? 'year' : 'month');
  const origin = new URL(request.url).origin;
  const params = {
    mode: 'subscription',
    customer: await ensureCustomer(env, user),
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { user_id: user.id } },
    success_url: `${origin}/dashboard/?upgraded=${plan}`,
    cancel_url: `${origin}/dashboard/?upgrade=cancelled`,
    allow_promotion_codes: true,
  };

  // Referred creators get their referrer's discount applied automatically
  if (user.referred_by && !user.first_paid_at) {
    const referrer = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.referred_by).first();
    const promo = referrer && await ensurePromotionCode(env, referrer).catch((err) => {
      console.error('Referral promotion code failed:', err.message);
      return null;
    });
    if (promo) {
      delete params.allow_promotion_codes;
      params.discounts = [{ promotion_code: promo }];
    }
  }

  const session = await stripe(env, 'POST', 'checkout/sessions', params);
  return json({ url: session.url });
}

// Moves an existing subscription to another plan, keeping its billing
// period: { plan: 'essential' | 'pro' | 'ultra' }. Upgrades charge the difference
// for the rest of the period right away, and only take effect once paid.
export async function changePlan({ request, env }) {
  const { user, response } = await signedIn(request, env);
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const { plan, error } = requestedPlan(env, body);
  if (error) return json({ error }, 400);
  if (!user.stripe_subscription_id || !ACTIVE.includes(user.subscription_status)) {
    return json({ error: "You don't have a subscription to change." }, 400);
  }

  const current = await stripe(env, 'GET', `subscriptions/${user.stripe_subscription_id}`);
  const item = current.items?.data?.[0];
  const price = priceFor(env, plan, item?.price?.recurring?.interval === 'year' ? 'year' : 'month');
  if (!item || item.price?.id === price) return json({ error: `You're already on ${PLAN_NAMES[plan]}.` }, 409);

  const upgrade = PLAN_RANK[plan] > PLAN_RANK[planForPrice(env, item.price?.id)];
  let updated;
  try {
    updated = await stripe(env, 'POST', `subscriptions/${current.id}`, {
      items: [{ id: item.id, price }],
      proration_behavior: upgrade ? 'always_invoice' : 'create_prorations',
      payment_behavior: upgrade ? 'pending_if_incomplete' : undefined,
      cancel_at_period_end: false,
    });
  } catch (err) {
    return json({ error: `Stripe couldn't change your plan: ${err.message}` }, 402);
  }
  if (updated.pending_update) {
    return json({ error: 'Your card was declined, so your plan was not changed. Update your card under "Manage subscription" and try again.' }, 402);
  }
  await syncSubscription(env, updated);
  return json({ ok: true });
}

// Opens Stripe's Customer Portal: change plan, update card, cancel, invoices
export async function portal({ request, env }) {
  const { user, response } = await signedIn(request, env);
  if (response) return response;
  if (!user.stripe_customer_id) return json({ error: "You don't have a subscription yet." }, 400);
  const session = await stripe(env, 'POST', 'billing_portal/sessions', {
    customer: user.stripe_customer_id,
    return_url: `${new URL(request.url).origin}/dashboard/`,
  });
  return json({ url: session.url });
}

// Stripe calls this for payments, renewals and cancellations
export async function webhook({ request, env }) {
  const payload = await request.text();
  const event = await verifyWebhook(env, payload, request.headers.get('stripe-signature'));
  if (!event) return json({ error: 'Invalid signature' }, 400);
  try {
    await handleStripeEvent(env, event);
  } catch (err) {
    // A 500 makes Stripe retry later
    console.error(`Stripe event ${event.type} failed:`, err.message);
    return json({ error: 'Handler failed' }, 500);
  }
  return json({ received: true });
}
