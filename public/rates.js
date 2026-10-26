// Rate estimates are based on common industry rules of thumb for sponsored
// content. Every rate is a [low, high] range in USD before adjustments.
// Shared by the calculator page and the server-rendered media kits.
const RATES = {
  // Per 1,000 average views
  ytIntegration: [10, 25],
  ytDedicated: [25, 50],
  ytShort: [2, 6],
  tiktok: [8, 20],
  // Per average concurrent viewer, per hour
  twitchHourly: [0.75, 2],
  // Per average concurrent viewer, for a whole stream
  twitchMention: [0.25, 0.6],
};

// Typical engagement rates, used to scale prices up or down
const ENGAGEMENT_BENCHMARK = { youtube: 4, tiktok: 6 };

export const REGION_MULTIPLIER = { tier1: 1, mixed: 0.8, other: 0.6 };
// How much brands typically pay in each niche, relative to general gaming.
// Niches whose viewers are worth more to advertisers (finance, business,
// tech) command higher rates for the same audience size.
export const FOCUS_MULTIPLIER = {
  // Gaming
  gaming: 1,
  competitive: 1.05,
  tech: 1.25,
  mobile: 0.9,
  // Other niches
  finance: 2.2,
  business: 1.8,
  technology: 1.5,
  automotive: 1.3,
  education: 1.3,
  health: 1.3,
  beauty: 1.25,
  fashion: 1.15,
  parenting: 1.15,
  travel: 1.1,
  food: 1.05,
  sports: 1,
  lifestyle: 0.95,
  entertainment: 0.85,
  music: 0.8,
};

// Below this, brands usually offer free product or affiliate deals instead of cash
const MIN_CASH_RATE = 25;
const BUNDLE_DISCOUNT = 0.9;

export const PRODUCT_LABEL = 'Product / affiliate';

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function engagementMultiplier(rate, benchmark) {
  if (!rate) return 1;
  const ratio = Math.sqrt(rate / benchmark);
  return Math.min(1.3, Math.max(0.8, ratio));
}

function scale([low, high], amount, multiplier) {
  return [low * amount * multiplier, high * amount * multiplier];
}

function roundNice(value) {
  if (value < 100) return Math.round(value / 5) * 5;
  if (value < 1000) return Math.round(value / 10) * 10;
  if (value < 10000) return Math.round(value / 50) * 50;
  return Math.round(value / 100) * 100;
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function formatRange([low, high]) {
  if (high < MIN_CASH_RATE) return PRODUCT_LABEL;
  return `${usd.format(roundNice(Math.max(low, MIN_CASH_RATE)))} – ${usd.format(roundNice(high))}`;
}

/**
 * input: { platforms: ['twitch', 'youtube', 'tiktok'], region, focus,
 *   twitchViewers, twitchHours, ytViews, ytShortsViews, ytEngagement,
 *   ttViews, ttEngagement }
 * Returns { sections: [{ name, rates: [[label, [low, high]]] }], bundle: [low, high] | null }
 */
export function estimateRates(input) {
  const platforms = input.platforms || [];
  const base = (REGION_MULTIPLIER[input.region] ?? REGION_MULTIPLIER.mixed)
    * (FOCUS_MULTIPLIER[input.focus] ?? FOCUS_MULTIPLIER.gaming);
  const sections = [];
  const bundleParts = [];

  if (platforms.includes('twitch')) {
    const viewers = positive(input.twitchViewers);
    const hours = positive(input.twitchHours) || 3;
    if (viewers) {
      const hourly = scale(RATES.twitchHourly, viewers, base);
      sections.push({
        name: 'Twitch',
        rates: [
          ['Sponsored stream (per hour)', hourly],
          [`Full sponsored stream (${hours} hr)`, hourly.map((v) => v * hours * BUNDLE_DISCOUNT)],
          ['Mention + banner during a stream', scale(RATES.twitchMention, viewers, base)],
        ],
      });
      bundleParts.push(hourly);
    }
  }

  if (platforms.includes('youtube')) {
    const views = positive(input.ytViews) / 1000;
    const shorts = positive(input.ytShortsViews) / 1000;
    const mult = base * engagementMultiplier(positive(input.ytEngagement), ENGAGEMENT_BENCHMARK.youtube);
    const rates = [];
    if (views) {
      const integration = scale(RATES.ytIntegration, views, mult);
      rates.push(['Integration (60–90 sec in a video)', integration]);
      rates.push(['Dedicated video', scale(RATES.ytDedicated, views, mult)]);
      bundleParts.push(integration);
    }
    if (shorts) {
      const short = scale(RATES.ytShort, shorts, mult);
      rates.push(['Sponsored Short', short]);
      if (!views) bundleParts.push(short);
    }
    if (rates.length) sections.push({ name: 'YouTube', rates });
  }

  if (platforms.includes('tiktok')) {
    const views = positive(input.ttViews) / 1000;
    if (views) {
      const mult = base * engagementMultiplier(positive(input.ttEngagement), ENGAGEMENT_BENCHMARK.tiktok);
      const video = scale(RATES.tiktok, views, mult);
      sections.push({
        name: 'TikTok',
        rates: [
          ['Sponsored video', video],
          ['3-video series', video.map((v) => v * 3 * BUNDLE_DISCOUNT)],
        ],
      });
      bundleParts.push(video);
    }
  }

  const bundle = bundleParts.length > 1
    ? bundleParts
      .reduce(([lo, hi], [l, h]) => [lo + l, hi + h], [0, 0])
      .map((v) => v * BUNDLE_DISCOUNT)
    : null;

  return { sections, bundle };
}
