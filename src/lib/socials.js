// Platforms whose stats creators type in themselves (no sign-in available).
// Each one gets <key>_handle, <key>_followers, <key>_avg_views and
// <key>_engagement columns on users, and matching dashboard fields.
export const SOCIALS = [
  {
    key: 'instagram',
    field: 'instagram',
    rateKey: 'ig',
    name: 'Instagram',
    viewsLabel: 'Avg Reel views',
    handle: /^[A-Za-z0-9_.]{1,30}$/,
    url: (h) => `https://www.instagram.com/${encodeURIComponent(h)}`,
  },
  {
    key: 'facebook',
    field: 'facebook',
    rateKey: 'fb',
    name: 'Facebook',
    viewsLabel: 'Avg video views',
    handle: /^[A-Za-z0-9.-]{2,50}$/,
    url: (h) => `https://www.facebook.com/${encodeURIComponent(h)}`,
  },
  {
    key: 'x',
    field: 'x',
    rateKey: 'x',
    name: 'X',
    viewsLabel: 'Avg views per post',
    handle: /^[A-Za-z0-9_]{1,15}$/,
    url: (h) => `https://x.com/${encodeURIComponent(h)}`,
  },
];

export const SOCIAL_COLUMNS = SOCIALS.flatMap((s) => ['handle', 'followers', 'avg_views', 'engagement'].map((c) => `${s.key}_${c}`));

// Accepts "@name", "name" or a pasted profile link like instagram.com/name/
export function cleanHandle(value) {
  let v = String(value ?? '').trim();
  const link = v.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|facebook\.com|fb\.com|x\.com|twitter\.com)\/([^/?#]+)/i);
  if (link) v = link[1];
  return v.replace(/^@/, '').slice(0, 60);
}
