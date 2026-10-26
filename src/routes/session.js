import { json } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';

// Lightweight sign-in check for the site header
export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env);
  return json(user ? { signedIn: true, slug: user.slug } : { signedIn: false });
}
