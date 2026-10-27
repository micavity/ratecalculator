// Ultra "Book me" page: creators list open sponsorship dates at
// /book/<their kit link>, and brands request one. A request becomes a deal.
import { escapeHtml as e } from './http.js';
import { parseJson } from './kit-content.js';
import { siteHeader, kitColor, accentStyle } from './kit.js';
import { planLimits } from './plans.js';

export const SLOT_KINDS = ['Sponsored stream', 'YouTube integration', 'Dedicated video', 'Short / TikTok / Reel', 'Social post', 'Other'];

export function bookingSettings(user) {
  const b = parseJson(user.booking, {});
  return { enabled: Boolean(b.enabled), intro: b.intro || '' };
}

export function bookingOpen(user) {
  return planLimits(user).ultra && bookingSettings(user).enabled;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

function longDay(day) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function renderBooking(user, slots, { viewer, origin, sent }) {
  const essential = planLimits(user).essential;
  const settings = bookingSettings(user);
  const owner = viewer?.id === user.id;
  const options = slots.map((s) => `<label class="slot">
      <input type="radio" name="slotId" value="${e(s.id)}" required>
      <span><strong>${e(longDay(s.day))}</strong> · ${e(s.kind)}${s.note ? `<br><small>${e(s.note)}</small>` : ''}</span>
    </label>`).join('');
  const avatar = user.avatar_url
    ? `<img class="avatar proposal-avatar" src="${e(user.avatar_url)}" alt="">`
    : `<div class="avatar avatar-fallback proposal-avatar" aria-hidden="true">${e(user.display_name.charAt(0).toUpperCase())}</div>`;

  const form = sent
    ? `<p class="alert alert-success">Thanks! Your request was sent to ${e(user.display_name)}, who will get back to you by email.</p>`
    : `<form class="kit-card booking-form" id="bookingForm">
      <h2>Pick a date</h2>
      ${options ? `<div class="slots">${options}
        <label class="slot"><input type="radio" name="slotId" value="flexible"><span><strong>Another date</strong> · tell us below</span></label>
      </div>` : '<p class="muted">No dates are listed right now, but you can still send a request.</p><input type="hidden" name="slotId" value="flexible">'}
      <div class="field-row">
        <label>Brand or company <input type="text" name="brand" maxlength="80" required></label>
        <label>Your name <input type="text" name="name" maxlength="80" required autocomplete="name"></label>
        <label>Your email <input type="email" name="email" maxlength="254" required autocomplete="email"></label>
      </div>
      <div class="field-row">
        <label>Budget <span class="opt">optional</span><input type="text" name="budget" maxlength="60" placeholder="e.g. $500–800"></label>
        <label>Product website <span class="opt">optional</span><input type="text" name="website" maxlength="200" placeholder="e.g. razer.com"></label>
      </div>
      <label>What would you like to do?
        <textarea name="message" rows="4" maxlength="1500" required placeholder="e.g. A 60-second integration for our new headset, ideally live before Black Friday."></textarea>
      </label>
      <label class="hp" aria-hidden="true">Leave this empty <input type="text" name="company_site" tabindex="-1" autocomplete="off"></label>
      <p class="alert alert-error" id="bookingError" hidden></p>
      ${owner ? '<p class="small muted">This is your Book me page. Brands fill in this form; you can\'t send a request to yourself.</p>' : '<button type="submit">Send request</button>'}
    </form>`;

  const script = sent || owner ? '' : `<script>
  (function () {
    var form = document.getElementById('bookingForm');
    var error = document.getElementById('bookingError');
    form.onsubmit = function (event) {
      event.preventDefault();
      var data = {};
      Array.prototype.forEach.call(form.elements, function (el) { if (el.name && (el.type !== 'radio' || el.checked)) data[el.name] = el.value; });
      var button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      fetch(location.pathname + '/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (res) { return res.json().then(function (body) { if (!res.ok) throw new Error(body.error || 'Something went wrong.'); }); })
        .then(function () { location.href = location.pathname + '?sent=1'; })
        .catch(function (err) { error.textContent = err.message; error.hidden = false; button.disabled = false; });
    };
  })();
  </script>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Book ${e(user.display_name)} for a sponsorship</title>
  <meta name="description" content="${e(`Open sponsorship dates for ${user.display_name}. Pick a date and send a request.`)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body style="${accentStyle(kitColor(user, essential))}">
${siteHeader(viewer)}
<main class="wrap proposal-page">
  <section class="kit-card proposal-hero">
    <div class="proposal-from">
      ${avatar}
      <div>
        <p class="small muted">Sponsorship booking</p>
        <h1>Book ${e(user.display_name)}</h1>
        <a href="${e(origin)}/${e(user.slug)}">See full media kit →</a>
      </div>
    </div>
    ${settings.intro ? `<p class="proposal-message">${e(settings.intro).replace(/\n/g, '<br>')}</p>` : ''}
  </section>
  ${form}
</main>
${script}
</body>
</html>`;
}
