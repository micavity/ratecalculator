import { estimateRates, formatRange, PRODUCT_LABEL } from './rates.js';

const form = document.getElementById('calc');
const resultsEl = document.getElementById('results');
const actionsEl = document.getElementById('actions');
const copyBtn = document.getElementById('copy');
const copiedEl = document.getElementById('copied');

let lastSummary = '';

function selectedPlatforms() {
  return [...form.querySelectorAll('input[name="platform"]:checked')].map((el) => el.value);
}

function readInput() {
  const value = (name) => form.elements[name].value;
  return {
    platforms: selectedPlatforms(),
    region: value('region'),
    focus: value('focus'),
    twitchViewers: value('twitchViewers'),
    twitchHours: value('twitchHours'),
    ytViews: value('ytViews'),
    ytShortsViews: value('ytShortsViews'),
    ytEngagement: value('ytEngagement'),
    ttViews: value('ttViews'),
    ttEngagement: value('ttEngagement'),
  };
}

function render() {
  const input = readInput();
  form.querySelectorAll('.group[data-platform]').forEach((group) => {
    group.hidden = !input.platforms.includes(group.dataset.platform);
  });

  const { sections, bundle } = estimateRates(input);

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

  if (bundle) {
    const text = formatRange(bundle);
    html += `<div class="platform-result"><h3>Multi-platform bundle</h3>
      <div class="rate bundle"><span>One of each platform's main deal</span><span class="amount">${text}</span></div>
      <p class="note">Includes a 10% bundle discount. Brands like packages.</p></div>`;
    lines.push('', `Multi-platform bundle: ${text}`);
  }

  if (html.includes(PRODUCT_LABEL)) {
    html += '<p class="note">"Product / affiliate" means brands at this size usually offer free products, game keys or affiliate links instead of cash. Those deals are still worth taking to build a track record.</p>';
  }

  html += '<p class="note cta">Want brands to see these numbers? <a href="/login">Make your free media kit →</a></p>';

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

document.getElementById('year').textContent = new Date().getFullYear();

form.addEventListener('input', render);
form.addEventListener('change', render);
render();
