// Pro invoices. Each invoice keeps a copy of the creator's details at the
// time it was made, so changing your address later doesn't change invoices
// you've already sent. Invoices are shared at /i/<id> with a random ID.
import { escapeHtml as e } from './http.js';
import { parseJson } from './kit-content.js';

export const MAX_ITEMS = 20;
export const STATUSES = ['unpaid', 'paid', 'void'];

export function invoiceId() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function date(value) {
  const v = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;
}

function validEmail(v) {
  return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// The creator's saved "from" and payment details
export function readSettings(body) {
  const settings = {
    name: text(body.name, 100),
    address: text(body.address, 300),
    email: text(body.email, 254),
    taxId: text(body.taxId, 60),
    paymentDetails: text(body.paymentDetails, 600),
    notes: text(body.notes, 600),
  };
  if (!validEmail(settings.email)) return { field: 'senderEmail', error: "Your email address doesn't look right." };
  return { settings };
}

// Checks an invoice from the dashboard. Returns { values } or { error, field }.
export function readInvoice(body, currencies) {
  const fail = (field, error) => ({ field, error });
  const number = text(body.number, 30);
  if (!number) return fail('number', 'Enter an invoice number.');

  const sender = readSettings(body.sender || {});
  if (sender.error) return sender;
  if (!sender.settings.name) return fail('senderName', 'Enter your name or business name.');

  const billTo = {
    name: text(body.billTo?.name, 100),
    contact: text(body.billTo?.contact, 100),
    email: text(body.billTo?.email, 254),
    address: text(body.billTo?.address, 300),
  };
  if (!billTo.name) return fail('billToName', 'Enter who the invoice is for.');
  if (!validEmail(billTo.email)) return fail('billToEmail', "That email address doesn't look right.");

  const issuedOn = date(body.issuedOn);
  if (!issuedOn) return fail('issuedOn', 'Enter the invoice date.');
  if (body.dueOn && !date(body.dueOn)) return fail('dueOn', 'Enter a valid due date.');

  const rows = Array.isArray(body.items) ? body.items : [];
  const items = [];
  for (const row of rows) {
    const description = text(row?.description, 200);
    const quantity = row?.quantity === '' || row?.quantity == null ? 1 : Number(row.quantity);
    const unitPrice = Number(row?.unitPrice);
    if (!description && (row?.unitPrice === '' || row?.unitPrice == null)) continue;
    if (!description) return fail('items', 'Every line needs a description.');
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) return fail('items', `Check the quantity for "${description}".`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 10000000) return fail('items', `Check the price for "${description}".`);
    items.push({ description, quantity: Math.round(quantity * 100) / 100, unitPrice: Math.round(unitPrice * 100) / 100 });
  }
  if (!items.length) return fail('items', 'Add at least one line, like the deliverable and its price.');
  if (items.length > MAX_ITEMS) return fail('items', `Add up to ${MAX_ITEMS} lines.`);

  let taxRate = null;
  if (body.taxRate !== '' && body.taxRate != null) {
    taxRate = Number(body.taxRate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) return fail('taxRate', 'Enter a tax rate between 0 and 100.');
  }

  return {
    values: {
      number,
      issued_on: issuedOn,
      due_on: date(body.dueOn),
      currency: currencies.includes(body.currency) ? body.currency : 'USD',
      sender: JSON.stringify(sender.settings),
      bill_to: JSON.stringify(billTo),
      items: JSON.stringify(items),
      tax_rate: taxRate,
      tax_label: text(body.taxLabel, 30) || null,
      notes: text(body.notes, 1000) || null,
    },
    settings: sender.settings,
  };
}

export function invoiceTotals(items, taxRate) {
  const subtotal = Math.round(items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0) * 100) / 100;
  const tax = taxRate ? Math.round(subtotal * taxRate) / 100 : 0;
  return { subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100 };
}

export function invoiceFields(row) {
  const items = parseJson(row.items, []);
  return {
    id: row.id,
    dealId: row.deal_id || '',
    number: row.number,
    status: row.status,
    issuedOn: row.issued_on,
    dueOn: row.due_on || '',
    paidOn: row.paid_on || '',
    currency: row.currency,
    sender: parseJson(row.sender, {}),
    billTo: parseJson(row.bill_to, {}),
    items,
    taxRate: row.tax_rate,
    taxLabel: row.tax_label || '',
    notes: row.notes || '',
    ...invoiceTotals(items, row.tax_rate),
    createdAt: row.created_at,
  };
}

// The next number after the creator's highest, keeping their prefix: INV-0007 → INV-0008
export function nextNumber(numbers) {
  let best = null;
  for (const n of numbers) {
    const m = /^(.*?)(\d+)$/.exec(n);
    if (m && (!best || Number(m[2]) > Number(best[2]))) best = m;
  }
  if (!best) return 'INV-0001';
  return `${best[1]}${String(Number(best[2]) + 1).padStart(best[2].length, '0')}`;
}

function money(amount, currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function longDate(day) {
  if (!day) return '';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function lines(value) {
  return e(value).replace(/\n/g, '<br>');
}

// The shareable invoice page, also used to save the PDF
export function renderInvoice(invoice, { owner, branding }) {
  const inv = invoiceFields(invoice);
  const s = inv.sender;
  const b = inv.billTo;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = inv.status === 'unpaid' && inv.dueOn && inv.dueOn < today;
  const stamp = inv.status === 'paid' ? '<p class="invoice-stamp paid">Paid</p>'
    : inv.status === 'void' ? '<p class="invoice-stamp void">Void</p>' : '';
  const rows = inv.items.map((i) => `<tr>
      <td>${e(i.description)}</td>
      <td class="num">${e(i.quantity)}</td>
      <td class="num">${e(money(i.unitPrice, inv.currency))}</td>
      <td class="num">${e(money(i.quantity * i.unitPrice, inv.currency))}</td>
    </tr>`).join('');
  const taxRow = inv.taxRate ? `<tr><td colspan="3">${e(inv.taxLabel || 'Tax')} (${e(inv.taxRate)}%)</td><td class="num">${e(money(inv.tax, inv.currency))}</td></tr>` : '';

  const body = `<main class="wrap invoice-page">
  <div class="invoice-toolbar no-print">
    <button type="button" onclick="window.print()">Download PDF</button>
    ${owner ? '<a class="button button-secondary" href="/dashboard/#deals">Back to dashboard</a>' : ''}
    <span class="small muted">${owner ? 'Choose "Save as PDF" in the print window. Anyone with this page\'s link can see this invoice.' : 'Choose "Save as PDF" in the print window.'}</span>
  </div>
  <article class="invoice">
    <header class="invoice-head">
      <div>
        <h1>Invoice</h1>
        <p class="invoice-number">${e(inv.number)}</p>
        ${stamp}
      </div>
      <dl class="invoice-dates">
        <div><dt>Date</dt><dd>${e(longDate(inv.issuedOn))}</dd></div>
        ${inv.dueOn ? `<div><dt>Due</dt><dd${overdue ? ' class="overdue"' : ''}>${e(longDate(inv.dueOn))}</dd></div>` : ''}
        ${inv.status === 'paid' && inv.paidOn ? `<div><dt>Paid</dt><dd>${e(longDate(inv.paidOn))}</dd></div>` : ''}
      </dl>
    </header>
    <section class="invoice-parties">
      <div>
        <h2>From</h2>
        <p><strong>${e(s.name)}</strong></p>
        ${s.address ? `<p>${lines(s.address)}</p>` : ''}
        ${s.email ? `<p>${e(s.email)}</p>` : ''}
        ${s.taxId ? `<p>Tax ID: ${e(s.taxId)}</p>` : ''}
      </div>
      <div>
        <h2>Bill to</h2>
        <p><strong>${e(b.name)}</strong></p>
        ${b.contact ? `<p>Attn: ${e(b.contact)}</p>` : ''}
        ${b.address ? `<p>${lines(b.address)}</p>` : ''}
        ${b.email ? `<p>${e(b.email)}</p>` : ''}
      </div>
    </section>
    <table class="invoice-items">
      <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        ${inv.taxRate ? `<tr><td colspan="3">Subtotal</td><td class="num">${e(money(inv.subtotal, inv.currency))}</td></tr>` : ''}
        ${taxRow}
        <tr class="invoice-total"><td colspan="3">Total due</td><td class="num">${e(money(inv.total, inv.currency))}</td></tr>
      </tfoot>
    </table>
    ${s.paymentDetails ? `<section class="invoice-note"><h2>How to pay</h2><p>${lines(s.paymentDetails)}</p></section>` : ''}
    ${inv.notes ? `<section class="invoice-note"><h2>Notes</h2><p>${lines(inv.notes)}</p></section>` : ''}
    ${branding ? '<p class="invoice-footer">Made with <a href="https://creatorgg.com">CreatorGG</a></p>' : ''}
  </article>
</main>`;

  return `<!doctype html>
<html lang="en" class="invoice-doc">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Invoice ${e(inv.number)} · ${e(s.name)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
${body}
</body>
</html>`;
}
