import { json } from '../lib/http.js';
import { twitchConfigured } from '../lib/twitch.js';
import { youtubeConfigured } from '../lib/youtube.js';
import { stripeConfigured, proConfigured } from '../lib/stripe.js';

// Setup check: which features are configured. Never shows the values.
export async function onRequestGet({ env }) {
  let database = false;
  try {
    database = Boolean(await env.DB.prepare('SELECT 1 AS ok').first());
  } catch {}
  return json({
    database,
    twitch: twitchConfigured(env),
    youtube: youtubeConfigured(env),
    payments: stripeConfigured(env) && Boolean(env.STRIPE_WEBHOOK_SECRET),
    pro: proConfigured(env),
    found: {
      TWITCH_CLIENT_ID: Boolean(env.TWITCH_CLIENT_ID),
      TWITCH_CLIENT_SECRET: Boolean(env.TWITCH_CLIENT_SECRET),
      GOOGLE_CLIENT_ID: Boolean(env.GOOGLE_CLIENT_ID),
      GOOGLE_CLIENT_SECRET: Boolean(env.GOOGLE_CLIENT_SECRET),
      YOUTUBE_API_KEY: Boolean(env.YOUTUBE_API_KEY),
      STRIPE_SECRET_KEY: Boolean(env.STRIPE_SECRET_KEY),
      STRIPE_WEBHOOK_SECRET: Boolean(env.STRIPE_WEBHOOK_SECRET),
      STRIPE_PRICE_MONTHLY: Boolean(env.STRIPE_PRICE_MONTHLY),
      STRIPE_PRICE_YEARLY: Boolean(env.STRIPE_PRICE_YEARLY),
      STRIPE_PRICE_PRO_MONTHLY: Boolean(env.STRIPE_PRICE_PRO_MONTHLY),
      STRIPE_PRICE_PRO_YEARLY: Boolean(env.STRIPE_PRICE_PRO_YEARLY),
    },
  });
}
