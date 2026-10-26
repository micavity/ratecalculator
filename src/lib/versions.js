// Kit versions (Essential): extra copies of a kit at /<slug>/<key> that can
// change the bio, featured videos, layout and rates. Anything a version
// doesn't set comes from the main kit.
import { normalizeSections, parseFeatured, parseRateCard, parsePackages, parseJson } from './kit-content.js';

export const VERSION_KEY_PATTERN = /^[a-z0-9-]{2,30}$/;

export function applyVersion(user, version) {
  const o = parseJson(version.overrides, {});
  const merged = { ...user };
  if (typeof o.bio === 'string') merged.bio = o.bio;
  if (Array.isArray(o.featured)) merged.featured = JSON.stringify(o.featured);
  if (Array.isArray(o.sections)) merged.sections = JSON.stringify(o.sections);
  if (o.rates) {
    merged.show_rates = o.rates.show ? 1 : 0;
    merged.rate_mode = o.rates.mode;
    merged.rate_card = JSON.stringify(o.rates.card);
    merged.packages = JSON.stringify(o.rates.packages);
  }
  return merged;
}

// A version as the dashboard edits it. null means "same as main kit".
export function versionFields(version) {
  const o = parseJson(version.overrides, {});
  return {
    id: version.id,
    key: version.key,
    name: version.name,
    bio: typeof o.bio === 'string' ? o.bio : null,
    featured: Array.isArray(o.featured) ? o.featured.map((v) => v.url) : null,
    sections: Array.isArray(o.sections) ? normalizeSections(o.sections) : null,
    rates: o.rates || null,
  };
}

export async function getVersions(env, userId) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM kit_versions WHERE user_id = ? ORDER BY created_at',
  ).bind(userId).all();
  return results;
}

/**
 * Validates a version's name, link and overrides.
 * Returns { name, key, overrides } or { error, field }.
 */
export function validateVersion(body, maxFeatured) {
  const fail = (field, error) => ({ field, error });
  const name = String(body.name ?? '').trim().slice(0, 40);
  if (!name) return fail('name', 'Give this version a name, like "Tech brands".');
  const key = String(body.key ?? '').trim().toLowerCase();
  if (!VERSION_KEY_PATTERN.test(key)) return fail('key', 'Use 2–30 lowercase letters, numbers or dashes for the link.');

  const overrides = {};
  if (body.bio !== null && body.bio !== undefined) overrides.bio = String(body.bio).trim().slice(0, 500);

  if (Array.isArray(body.featured)) {
    const featured = parseFeatured(body.featured);
    if (featured.error) return fail('featured', featured.error);
    if (featured.value.length > maxFeatured) return fail('featured', `Add up to ${maxFeatured} videos.`);
    overrides.featured = featured.value;
  }

  if (Array.isArray(body.sections)) overrides.sections = normalizeSections(body.sections);

  if (body.rates) {
    const card = parseRateCard(body.rates.card);
    if (card.error) return fail('rates', card.error);
    const packages = parsePackages(body.rates.packages);
    if (packages.error) return fail('rates', packages.error);
    overrides.rates = {
      show: Boolean(body.rates.show),
      mode: body.rates.mode === 'custom' ? 'custom' : 'estimates',
      card: card.value,
      packages: packages.value,
    };
  }
  return { name, key, overrides };
}
