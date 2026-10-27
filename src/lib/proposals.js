// Pro proposals: a page a brand can open, then accept or ask for changes.
// Shared at /p/<id> with a random ID, like invoices.
import { escapeHtml as e } from './http.js';
import { parseJson } from './kit-content.js';
import { SOCIALS } from './socials.js';
import { siteHeader, kitColor, accentStyle, hiddenStats } from './kit.js';
import { planLimits } from './plans.js';

export const MAX_PROPOSAL_ITEMS = 15;

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function validEmail(v) {
  return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// Checks a proposal from the dashboard. Returns { values } or { error, field }.
export function readProposal(body, currencies) {
  const fail = (field, error) => ({ field, error });
  const brand = text(body.brand, 80);
  if (!brand) return fail('brand', 'Enter the brand name.');
  const contactEmail = text(body.contactEmail, 254);
  if (!validEmail(contactEmail)) return fail('contactEmail', "That email address doesn't look right.");

  const items = [];
  for (const row of Array.isArray(body.items) ? body.items : []) {
    const description = text(row?.description, 200);
    const hasPrice = row?.price !== '' && row?.price != null;
    if (!description && !hasPrice) continue;
    if (!description) return fail('items', 'Every line needs a description.');
    const price = hasPrice ? Number(row.price) : 0;
    if (!Number.isFinite(price) || price < 0 || price > 10000000) return fail('items', `Check the price for "${description}".`);
    items.push({ description, price: Math.round(price * 100) / 100 });
  }
  if (!items.length) return fail('items', 'Add at least one deliverable, like "1 YouTube integration".');
  if (items.length > MAX_PROPOSAL_ITEMS) return fail('items', `Add up to ${MAX_PROPOSAL_ITEMS} lines.`);

  const validUntil = String(body.validUntil ?? '').trim();
  if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return fail('validUntil', 'Enter a valid date.');

  return {
    values: {
      title: text(body.title, 100) || `Sponsorship proposal for ${brand}`,
      brand,
      contact_name: text(body.contactName, 80) || null,
      contact_email: contactEmail || null,
      items: JSON.stringify(items),
      currency: currencies.includes(body.currency) ? body.currency : 'USD',
      timeline: text(body.timeline, 500) || null,
      includes: text(body.includes, 1000) || null,
      message: text(body.message, 1500) || null,
      valid_until: validUntil || null,
    },
  };
}

export function proposalTotal(items) {
  return Math.round(items.reduce((sum, i) => sum + i.price, 0) * 100) / 100;
}

export function proposalFields(row) {
  const items = parseJson(row.items, []);
  return {
    id: row.id,
    dealId: row.deal_id || '',
    status: row.status,
    title: row.title,
    brand: row.brand,
    contactName: row.contact_name || '',
    contactEmail: row.contact_email || '',
    items,
    total: proposalTotal(items),
    currency: row.currency,
    timeline: row.timeline || '',
    includes: row.includes || '',
    message: row.message || '',
    validUntil: row.valid_until || '',
    viewCount: row.view_count,
    lastViewedAt: row.last_viewed_at,
    responderName: row.responder_name || '',
    responderEmail: row.responder_email || '',
    changeNote: row.change_note || '',
    respondedAt: row.responded_at,
    createdAt: row.created_at,
  };
}

function money(amount, currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

// The creator's three biggest numbers, verified ones marked
function headlineStats(user, connections) {
  const yt = connections.youtube?.stats || {};
  const hidden = hiddenStats(user, planLimits(user).essential);
  return [
    ['YouTube subscribers', yt.subscribers, true, 'youtube.subscribers'],
    ['Avg YouTube views', yt.avgViews, true, 'youtube.avgViews'],
    ['Twitch followers', connections.twitch?.stats.followers, true, 'twitch.followers'],
    ['Avg Twitch viewers', user.twitch_avg_viewers, false, 'twitch.avgViewers'],
    ['TikTok followers', user.tiktok_followers, false, 'tiktok.followers'],
    ...SOCIALS.map((s) => [`${s.name} followers`, user[`${s.key}_followers`], false, `${s.key}.followers`]),
  ].filter(([, v, , key]) => Number(v) > 0 && !hidden.has(key)).sort((a, b) => b[1] - a[1]).slice(0, 3);
}

function lines(value) {
  return e(value).replace(/\n/g, '<br>');
}

function longDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function renderProposal(row, user, connections, { owner, viewer, origin }) {
  const p = proposalFields(row);
  const essential = planLimits(user).essential;
  const color = kitColor(user, essential);
  const stats = headlineStats(user, connections).map(([label, value, verified]) => `<div class="stat">
      <span class="stat-value">${e(compact.format(Number(value)))}</span>
      <span class="stat-label">${e(label)}</span>
      ${verified ? '<span class="badge">✓ Verified</span>' : ''}
    </div>`).join('');
  const avatar = user.avatar_url
    ? `<img class="avatar proposal-avatar" src="${e(user.avatar_url)}" alt="">`
    : `<div class="avatar avatar-fallback proposal-avatar" aria-hidden="true">${e(user.display_name.charAt(0).toUpperCase())}</div>`;
  const rows = p.items.map((i) => `<tr><td>${e(i.description)}</td><td class="num">${e(money(i.price, p.currency))}</td></tr>`).join('');
  const expired = p.status === 'open' && p.validUntil && p.validUntil < new Date().toISOString().slice(0, 10);

  let status = '';
  if (p.status === 'accepted') {
    status = `<p class="alert alert-success">✓ Accepted${p.responderName ? ` by ${e(p.responderName)}` : ''} on ${e(longDate(p.respondedAt))}. ${owner ? 'The deal is now marked Agreed on your dashboard.' : `${e(user.display_name)} will see this on their dashboard and be in touch with next steps.`}</p>`;
  } else if (p.status === 'changes') {
    status = `<p class="alert alert-info">Changes requested${p.responderName ? ` by ${e(p.responderName)}` : ''}: “${e(p.changeNote)}”${owner ? '' : ` ${e(user.display_name)} will send an updated proposal at this same link.`}</p>`;
  } else if (expired) {
    status = `<p class="alert alert-info">This proposal was valid until ${e(longDate(`${p.validUntil}T12:00:00Z`))}. Reach out to ${e(user.display_name)} for an updated one.</p>`;
  }

  const canRespond = p.status === 'open' && !expired && !owner;
  const actions = canRespond ? `<section class="kit-card proposal-respond no-print" id="respond">
      <h2>Your response</h2>
      <div class="proposal-buttons">
        <button type="button" id="showAccept">Accept proposal</button>
        <button type="button" class="button-secondary" id="showChanges">Request changes</button>
      </div>
      <form id="acceptForm" class="proposal-form" hidden>
        <p class="small muted">Accepting tells ${e(user.display_name)} you'd like to go ahead with the deliverables and price above. They'll follow up with next steps.</p>
        <div class="field-row">
          <label>Your name <input type="text" name="name" maxlength="80" required autocomplete="name"></label>
          <label>Your email <input type="email" name="email" maxlength="254" required autocomplete="email"></label>
        </div>
        <button type="submit">Accept proposal</button>
      </form>
      <form id="changesForm" class="proposal-form" hidden>
        <label>What would you like changed?
          <textarea name="note" rows="4" maxlength="1000" required placeholder="e.g. Could we do 2 Shorts instead of 3, and move the date to Dec 1?"></textarea>
        </label>
        <div class="field-row">
          <label>Your name <input type="text" name="name" maxlength="80" autocomplete="name"></label>
          <label>Your email <input type="email" name="email" maxlength="254" autocomplete="email"></label>
        </div>
        <button type="submit">Send request</button>
      </form>
      <p class="alert alert-error" id="respondError" hidden></p>
    </section>` : '';

  const script = canRespond ? `<script>
  (function () {
    var accept = document.getElementById('acceptForm');
    var changes = document.getElementById('changesForm');
    var error = document.getElementById('respondError');
    document.getElementById('showAccept').onclick = function () { accept.hidden = false; changes.hidden = true; accept.elements.name.focus(); };
    document.getElementById('showChanges').onclick = function () { changes.hidden = false; accept.hidden = true; changes.elements.note.focus(); };
    function send(form, action) {
      form.onsubmit = function (event) {
        event.preventDefault();
        var data = {};
        Array.prototype.forEach.call(form.elements, function (el) { if (el.name) data[el.name] = el.value; });
        var button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        fetch(location.pathname + '/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
          .then(function (res) { return res.json().then(function (body) { if (!res.ok) throw new Error(body.error || 'Something went wrong.'); }); })
          .then(function () { location.reload(); })
          .catch(function (err) { error.textContent = err.message; error.hidden = false; button.disabled = false; });
      };
    }
    send(accept, 'accept');
    send(changes, 'changes');
  })();
  </script>` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${e(p.title)} · ${e(user.display_name)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body style="${accentStyle(color)}">
${siteHeader(viewer)}
<main class="wrap proposal-page">
  ${owner ? `<p class="owner-bar no-print">This is your proposal. Send the brand this page's link. <a href="/dashboard/#deals">Back to dashboard</a></p>` : ''}
  ${status}
  <section class="kit-card proposal-hero">
    <div class="proposal-from">
      ${avatar}
      <div>
        <p class="small muted">Proposal from</p>
        <h1>${e(user.display_name)}</h1>
        <a href="${e(origin)}/${e(user.slug)}" target="_blank" rel="noopener">See full media kit →</a>
      </div>
    </div>
    <h2 class="proposal-title">${e(p.title)}</h2>
    <p class="muted">Prepared for <strong>${e(p.brand)}</strong>${p.contactName ? `, attn. ${e(p.contactName)}` : ''}</p>
    ${stats ? `<div class="example-stats proposal-stats">${stats}</div>` : ''}
  </section>
  ${p.message ? `<section class="kit-card"><p class="proposal-message">${lines(p.message)}</p></section>` : ''}
  <section class="kit-card">
    <h2>Deliverables</h2>
    <table class="invoice-items proposal-items">
      <tbody>${rows}</tbody>
      <tfoot><tr class="invoice-total"><td>Total</td><td class="num">${e(money(p.total, p.currency))}</td></tr></tfoot>
    </table>
    ${p.timeline ? `<h3>Timeline</h3><p>${lines(p.timeline)}</p>` : ''}
    ${p.includes ? `<h3>What's included</h3><p>${lines(p.includes)}</p>` : ''}
    ${p.validUntil ? `<p class="small muted">This proposal is valid until ${e(longDate(`${p.validUntil}T12:00:00Z`))}.</p>` : ''}
  </section>
  ${actions}
</main>
${script}
</body>
</html>`;
}
