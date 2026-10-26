// Minimal Stripe API client using fetch, so it runs on Workers without
// extra packages. Requests are pinned to one API version so response shapes
// don't change under us, whatever version the Stripe account defaults to.
const API_VERSION = '2024-06-20';

export function stripeConfigured(env) {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_MONTHLY && env.STRIPE_PRICE_YEARLY);
}

// Stripe takes form-encoded bodies with nested keys like line_items[0][price]
function encode(params, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') encode(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

export class StripeError extends Error {}

export async function stripe(env, method, path, params) {
  const base = env.STRIPE_API_BASE || 'https://api.stripe.com';
  let url = `${base}/v1/${path}`;
  const init = {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'stripe-version': API_VERSION,
    },
  };
  if (params && method === 'GET') {
    url += `?${encode(params)}`;
  } else if (params) {
    init.headers['content-type'] = 'application/x-www-form-urlencoded';
    init.body = encode(params).toString();
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new StripeError(data.error?.message || `Stripe ${method} ${path} failed (${res.status})`);
  return data;
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Checks a webhook's Stripe-Signature header. Returns the parsed event,
 * or null if the signature is missing, wrong or more than 5 minutes old.
 */
export async function verifyWebhook(env, payload, header, now = Date.now()) {
  if (!env.STRIPE_WEBHOOK_SECRET || !header) return null;
  const parts = {};
  const signatures = [];
  for (const item of header.split(',')) {
    const [key, value] = item.split('=');
    if (key === 'v1') signatures.push(value);
    else parts[key] = value;
  }
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(now / 1000 - timestamp) > 300) return null;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts.t}.${payload}`)));
  if (!signatures.some((sig) => timingSafeEqual(sig, expected))) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
