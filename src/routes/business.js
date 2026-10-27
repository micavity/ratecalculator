import { json, sameOrigin } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { planLimits } from '../lib/plans.js';
import { invoiceId } from '../lib/invoices.js';
import { EXPENSE_CATEGORIES, readBusinessSettings } from '../lib/business.js';
import { CURRENCIES } from './deals.js';

// Ultra: expenses, tax set-aside and seasonal pricing. Like deals, saved
// expenses are kept (hidden) if the plan lapses.
const LOCKED = { error: 'Business tools are part of Ultra.', locked: true };
const MAX_EXPENSES = 2000;

async function ultra(request, env, write) {
  if (write && !sameOrigin(request)) return { response: json({ error: 'Bad origin' }, 403) };
  const user = await getSessionUser(request, env);
  if (!user) return { response: json({ error: 'Not signed in' }, 401) };
  if (!planLimits(user).ultra) return { response: json(LOCKED, write ? 403 : 200) };
  return { user };
}

function expenseFields(x) {
  return { id: x.id, day: x.day, category: x.category, description: x.description, amount: x.amount_cents / 100, currency: x.currency };
}

// All of a year's expenses: /api/expenses?year=2026
export async function expensesGet({ request, env }) {
  const { user, response } = await ultra(request, env, false);
  if (response) return response;
  const asked = new URL(request.url).searchParams.get('year');
  const year = /^\d{4}$/.test(asked || '') ? asked : String(new Date().getUTCFullYear());
  const { results } = await env.DB.prepare('SELECT * FROM expenses WHERE user_id = ? AND day >= ? AND day < ? ORDER BY day DESC')
    .bind(user.id, `${year}-01-01`, `${Number(year) + 1}-01-01`).all();
  return json({ year, expenses: results.map(expenseFields), categories: EXPENSE_CATEGORIES, currencies: CURRENCIES });
}

export async function expensePost({ request, env }) {
  const { user, response } = await ultra(request, env, true);
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const day = String(body.day ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) return json({ error: 'Pick the date.', field: 'day' }, 400);
  const description = String(body.description ?? '').trim().slice(0, 120);
  if (!description) return json({ error: 'Say what it was, e.g. "New microphone".', field: 'description' }, 400);
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return json({ error: 'Enter the amount.', field: 'amount' }, 400);
  const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM expenses WHERE user_id = ?').bind(user.id).first();
  if (count >= MAX_EXPENSES) return json({ error: `You can have up to ${MAX_EXPENSES} expenses.` }, 400);
  const id = invoiceId();
  await env.DB.prepare('INSERT INTO expenses (id, user_id, day, category, description, amount_cents, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, user.id, day, EXPENSE_CATEGORIES.includes(body.category) ? body.category : 'Other', description,
      Math.round(amount * 100), CURRENCIES.includes(body.currency) ? body.currency : 'USD', Date.now()).run();
  return json({ ok: true, id });
}

export async function expenseDelete({ request, env, params }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Not signed in' }, 401);
  await env.DB.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?').bind(params.id, user.id).run();
  return json({ ok: true });
}

// Tax set-aside % and seasonal pricing: { taxRate, seasonal: [12 percentages] }
export async function settingsPut({ request, env }) {
  const { user, response } = await ultra(request, env, true);
  if (response) return response;
  const { value, error, field } = readBusinessSettings(await request.json().catch(() => ({})));
  if (error) return json({ error, field }, 400);
  await env.DB.prepare('UPDATE users SET business = ? WHERE id = ?').bind(JSON.stringify(value), user.id).run();
  return json({ ok: true });
}
