// Parsing and validation for the optional media kit sections

export const THEMES = {
  purple: '#8b5cf6',
  blue: '#3b82f6',
  green: '#10b981',
  orange: '#f97316',
  pink: '#ec4899',
};

// Extra colors, kit styles and a custom accent color are Essential features
export const ESSENTIAL_THEMES = {
  red: '#ef4444',
  teal: '#14b8a6',
  yellow: '#eab308',
  indigo: '#6366f1',
  slate: '#64748b',
};

export const KIT_STYLES = ['auto', 'dark', 'light', 'gradient'];

export function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || '');
}

// The parts of a kit below the header, in their default order
export const SECTION_KEYS = ['platforms', 'audience', 'featured', 'brands', 'rates'];

// Always returns every section exactly once, in the saved order
export function normalizeSections(list) {
  const seen = new Set();
  const sections = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (SECTION_KEYS.includes(item?.key) && !seen.has(item.key)) {
      seen.add(item.key);
      sections.push({ key: item.key, visible: item.visible !== false });
    }
  }
  for (const key of SECTION_KEYS) {
    if (!seen.has(key)) sections.push({ key, visible: true });
  }
  return sections;
}

const MAX_RATE_ROWS = 15;
const MAX_PACKAGES = 6;

function clean(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

// Creator-set prices: [{ name, price }]. Price is free text, e.g. "$150" or "From $300".
export function parseRateCard(list) {
  const rows = (Array.isArray(list) ? list : [])
    .map((r) => ({ name: clean(r?.name, 60), price: clean(r?.price, 30) }))
    .filter((r) => r.name || r.price);
  if (rows.length > MAX_RATE_ROWS) return { error: `Add up to ${MAX_RATE_ROWS} rates.` };
  if (rows.some((r) => !r.name || !r.price)) return { error: 'Each rate needs a name and a price.' };
  return { value: rows };
}

// Bundles: [{ name, includes, price }]
export function parsePackages(list) {
  const rows = (Array.isArray(list) ? list : [])
    .map((p) => ({ name: clean(p?.name, 60), includes: clean(p?.includes, 200), price: clean(p?.price, 30) }))
    .filter((p) => p.name || p.includes || p.price);
  if (rows.length > MAX_PACKAGES) return { error: `Add up to ${MAX_PACKAGES} packages.` };
  if (rows.some((p) => !p.name || !p.price)) return { error: 'Each package needs a name and a price.' };
  return { value: rows };
}

export const AGE_GROUPS = ['13-17', '18-24', '25-34', '35+'];

const MAX_FEATURED = 6;
const MAX_BRANDS = 12;
const MAX_COUNTRIES = 3;

// Turns a YouTube or Twitch link into something we can embed
export function parseVideoUrl(input) {
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, '');
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'youtube.com') {
    const id = parts[0] === 'watch' ? url.searchParams.get('v')
      : ['shorts', 'live', 'embed'].includes(parts[0]) ? parts[1] : null;
    if (id && /^[\w-]{11}$/.test(id)) return { type: 'youtube', id };
  }
  if (host === 'youtu.be' && /^[\w-]{11}$/.test(parts[0] || '')) {
    return { type: 'youtube', id: parts[0] };
  }
  if (host === 'clips.twitch.tv' && /^[\w-]{1,100}$/.test(parts[0] || '')) {
    return { type: 'twitch-clip', id: parts[0] };
  }
  if (host === 'twitch.tv') {
    if (parts[1] === 'clip' && /^[\w-]{1,100}$/.test(parts[2] || '')) return { type: 'twitch-clip', id: parts[2] };
    if (parts[0] === 'videos' && /^\d{1,15}$/.test(parts[1] || '')) return { type: 'twitch-video', id: parts[1] };
  }
  return null;
}

export function parseFeatured(list) {
  const urls = (Array.isArray(list) ? list : [])
    .map((u) => String(u ?? '').trim())
    .filter(Boolean)
    .slice(0, MAX_FEATURED);
  const featured = [];
  for (const url of urls) {
    const video = parseVideoUrl(url);
    if (!video) return { error: `"${url.slice(0, 60)}" isn't a YouTube video or Twitch clip/VOD link.` };
    featured.push({ url: url.slice(0, 300), ...video });
  }
  return { value: featured };
}

// One brand per line, with an optional link after a comma: "Razer, https://razer.com"
export function parseBrands(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > MAX_BRANDS) return { error: `Add up to ${MAX_BRANDS} brands.` };
  const brands = [];
  for (const line of lines) {
    const comma = line.lastIndexOf(',');
    let name = line;
    let url = '';
    if (comma > 0 && /^\s*https?:\/\//i.test(line.slice(comma + 1))) {
      name = line.slice(0, comma).trim();
      url = line.slice(comma + 1).trim();
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
        url = parsed.href.slice(0, 300);
      } catch {
        return { error: `The link for "${name.slice(0, 40)}" isn't valid.` };
      }
    }
    if (!name) continue;
    brands.push({ name: name.slice(0, 40), url });
  }
  return { value: brands };
}

export function brandsToText(brands) {
  return brands.map((b) => (b.url ? `${b.name}, ${b.url}` : b.name)).join('\n');
}

function percent(value) {
  if (value === null || value === undefined || value === '') return { value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { error: true };
  return { value: Math.round(n) };
}

// { ages: { '18-24': 40, ... }, gender: { male, female }, countries: [{ name, percent }] }
export function parseAudience(input) {
  const src = input && typeof input === 'object' ? input : {};
  const audience = { ages: {}, gender: {}, countries: [] };

  let ageTotal = 0;
  for (const group of AGE_GROUPS) {
    const p = percent(src.ages?.[group]);
    if (p.error) return { error: 'Age percentages must be between 0 and 100.' };
    if (p.value !== null) {
      audience.ages[group] = p.value;
      ageTotal += p.value;
    }
  }
  if (ageTotal > 101) return { error: 'Age percentages add up to more than 100%.' };

  let genderTotal = 0;
  for (const key of ['male', 'female']) {
    const p = percent(src.gender?.[key]);
    if (p.error) return { error: 'Gender percentages must be between 0 and 100.' };
    if (p.value !== null) {
      audience.gender[key] = p.value;
      genderTotal += p.value;
    }
  }
  if (genderTotal > 101) return { error: 'Gender percentages add up to more than 100%.' };

  for (const country of (Array.isArray(src.countries) ? src.countries : []).slice(0, MAX_COUNTRIES)) {
    const name = String(country?.name ?? '').trim().slice(0, 40);
    const p = percent(country?.percent);
    if (p.error) return { error: 'Country percentages must be between 0 and 100.' };
    if (name) audience.countries.push({ name, percent: p.value });
  }
  return { value: audience };
}

export function hasAudience(audience) {
  return Object.keys(audience.ages || {}).length > 0
    || Object.keys(audience.gender || {}).length > 0
    || (audience.countries || []).length > 0;
}

export function parseJson(text, fallback) {
  try {
    // Empty columns (NULL) parse to null, so they get the fallback too
    return JSON.parse(text) ?? fallback;
  } catch {
    return fallback;
  }
}
