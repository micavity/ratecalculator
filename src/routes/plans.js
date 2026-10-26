import { json } from '../lib/http.js';
import { proConfigured, stripeConfigured } from '../lib/stripe.js';

// Which plans can be bought right now, for the pricing page
export async function onRequestGet({ env }) {
  return json({ essential: stripeConfigured(env), pro: proConfigured(env) });
}
