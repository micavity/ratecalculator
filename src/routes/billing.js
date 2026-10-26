import { json, sameOrigin } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { stripe, stripeConfigured, verifyWebhook } from '../lib/stripe.js';
import { handleStripeEvent } from '../lib/billing.js';
import { ensurePromotionCode } from '../lib/referrals.js';
import { effectivePlan, PLAN_RANK } from '../lib/plans.js';

async function signedIn(request, env) {
  if (!sameOrigin(request)) return { response: json({ error: 'Bad origin' }, 403) };
  const user = await getSessionUser(request, env);
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

// Starts Stripe Checkout for Essential: { interval: 'month' | 'year' }
export async function checkout({ request, env }) {
  const { user, response } = await signedIn(request, env);
  if (response) return response;

  if (['active', 'trialing', 'past_due'].includes(user.subscription_status)) {
    return json({ error: 'You already have a subscription. Use "Manage subscription" to change it.' }, 409);
  }
  if (user.plan_source === 'gift' && !user.plan_expires && PLAN_RANK[effectivePlan(user)] >= PLAN_RANK.essential) {
    return json({ error: 'You already have Essential for life.' }, 409);
  }

  const body = await request.json().catch(() => ({}));
  const price = body.interval === 'year' ? env.STRIPE_PRICE_YEARLY : env.STRIPE_PRICE_MONTHLY;
  const origin = new URL(request.url).origin;
  const params = {
    mode: 'subscription',
    customer: await ensureCustomer(env, user),
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { user_id: user.id } },
    success_url: `${origin}/dashboard/?upgraded=1`,
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
