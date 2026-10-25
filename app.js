// Rate estimates are based on common industry rules of thumb for sponsored
// content. Every rate is a [low, high] range in USD before adjustments.
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

const REGION_MULTIPLIER = { tier1: 1, mixed: 0.8, other: 0.6 };
const FOCUS_MULTIPLIER = { gaming: 1, competitive: 1.05, tech: 1.25, mobile: 0.9 };

// Below this, brands usually offer free product or affiliate deals instead of cash
const MIN_CASH_RATE = 25;
const BUNDLE_DISCOUNT = 0.9;

const form = document.getElementById('calc');
const resultsEl = document.getElementById('results');
const actionsEl = document.getElementById('actions');
const copyBtn = document.getElementById('copy');
const copiedEl = document.getElementById('copied');

let lastSummary = '';

function num(name) {
  const value = parseFloat(form.elements[name].value);
  return Number.isFinite(value) && value > 0 ? value : 0;
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

function formatRange([low, high]) {
  if (high < MIN_CASH_RATE) return 'Product / affiliate';
  return `${usd.format(roundNice(Math.max(low, MIN_CASH_RATE)))} – ${usd.format(roundNice(high))}`;
}

function selectedPlatforms() {
  return [...form.querySelectorAll('input[name="platform"]:checked')].map((el) => el.value);
}

function calculate() {
  const platforms = selectedPlatforms();
  const base = REGION_MULTIPLIER[form.elements.region.value] * FOCUS_MULTIPLIER[form.elements.focus.value];
  const sections = [];
  const bundle = [];

  if (platforms.includes('twitch')) {
    const viewers = num('twitchViewers');
    const hours = num('twitchHours') || 3;
    if (viewers) {
      const hourly = scale(RATES.twitchHourly, viewers, base);
      const fullStream = hourly.map((v) => v * hours * BUNDLE_DISCOUNT);
      sections.push({
        name: 'Twitch',
        rates: [
          ['Sponsored stream (per hour)', hourly],
          [`Full sponsored stream (${hours} hr)`, fullStream],
          ['Mention + banner during a stream', scale(RATES.twitchMention, viewers, base)],
        ],
      });
      bundle.push(hourly);
    }
  }

  if (platforms.includes('youtube')) {
    const views = num('ytViews') / 1000;
    const shorts = num('ytShortsViews') / 1000;
    const mult = base * engagementMultiplier(num('ytEngagement'), ENGAGEMENT_BENCHMARK.youtube);
    const rates = [];
    if (views) {
      const integration = scale(RATES.ytIntegration, views, mult);
      rates.push(['Integration (60–90 sec in a video)', integration]);
      rates.push(['Dedicated video', scale(RATES.ytDedicated, views, mult)]);
      bundle.push(integration);
    }
    if (shorts) {
      const short = scale(RATES.ytShort, shorts, mult);
      rates.push(['Sponsored Short', short]);
      if (!views) bundle.push(short);
    }
    if (rates.length) sections.push({ name: 'YouTube', rates });
  }

  if (platforms.includes('tiktok')) {
    const views = num('ttViews') / 1000;
    if (views) {
      const mult = base * engagementMultiplier(num('ttEngagement'), ENGAGEMENT_BENCHMARK.tiktok);
      const video = scale(RATES.tiktok, views, mult);
      sections.push({
        name: 'TikTok',
        rates: [
          ['Sponsored video', video],
          ['3-video series', video.map((v) => v * 3 * BUNDLE_DISCOUNT)],
        ],
      });
      bundle.push(video);
    }
  }

  return { sections, bundle };
}

function render() {
  const platforms = selectedPlatforms();
  form.querySelectorAll('.group[data-platform]').forEach((group) => {
    group.hidden = !platforms.includes(group.dataset.platform);
  });

  const { sections, bundle } = calculate();

  if (!sections.length) {
    resultsEl.innerHTML = '<p class="empty">Enter your stats to see your rates.</p>';
    actionsEl.hidden = true;
    lastSummary = '';
    return;
  }

  const lines = ['My estimated sponsorship rates:'];
  let html = '';

  for (const section of sections) {
    html += `<div class="platform-result"><h3>${section.name}</h3>`;
    lines.push('', section.name);
    for (const [label, range] of section.rates) {
      const text = formatRange(range);
      html += `<div class="rate"><span>${label}</span><span class="amount">${text}</span></div>`;
      lines.push(`- ${label}: ${text}`);
    }
    html += '</div>';
  }

  if (bundle.length > 1) {
    const total = bundle
      .reduce(([lo, hi], [l, h]) => [lo + l, hi + h], [0, 0])
      .map((v) => v * BUNDLE_DISCOUNT);
    const text = formatRange(total);
    html += `<div class="platform-result"><h3>Multi-platform bundle</h3>
      <div class="rate bundle"><span>One of each platform's main deal</span><span class="amount">${text}</span></div>
      <p class="note">Includes a 10% bundle discount. Brands like packages.</p></div>`;
    lines.push('', `Multi-platform bundle: ${text}`);
  }

  if (html.includes('Product / affiliate')) {
    html += '<p class="note">"Product / affiliate" means brands at this size usually offer free products, game keys or affiliate links instead of cash. Those deals are still worth taking to build a track record.</p>';
  }

  resultsEl.innerHTML = html;
  actionsEl.hidden = false;
  lastSummary = lines.join('\n');
}

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(lastSummary);
    copiedEl.hidden = false;
    setTimeout(() => { copiedEl.hidden = true; }, 2000);
  } catch {
    window.prompt('Copy your rates:', lastSummary);
  }
});

form.addEventListener('input', render);
form.addEventListener('change', render);
render();
