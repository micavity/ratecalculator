// Ultra business tools: a tax set-aside percentage and seasonal rate boosts
import { hasPlan } from './plans.js';
import { parseJson } from './kit-content.js';

export const EXPENSE_CATEGORIES = ['Gear', 'Software and subscriptions', 'Editing and freelancers', 'Travel', 'Marketing', 'Other'];

export function businessSettings(user) {
  const b = parseJson(user.business, {});
  const seasonal = Array.isArray(b.seasonal) && b.seasonal.length === 12 ? b.seasonal.map((n) => Number(n) || 0) : Array(12).fill(0);
  return { taxRate: typeof b.taxRate === 'number' ? b.taxRate : null, seasonal };
}

export function readBusinessSettings(body) {
  let taxRate = null;
  if (body.taxRate !== '' && body.taxRate !== null && body.taxRate !== undefined) {
    taxRate = Number(body.taxRate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 80) return { field: 'taxRate', error: 'Enter a percentage between 0 and 80.' };
    taxRate = Math.round(taxRate * 10) / 10;
  }
  const seasonal = Array.isArray(body.seasonal) ? body.seasonal.slice(0, 12) : [];
  while (seasonal.length < 12) seasonal.push(0);
  const clean = seasonal.map((n) => Math.round(Number(n) || 0));
  if (clean.some((n) => n < -50 || n > 100)) return { field: 'seasonal', error: 'Seasonal changes must be between -50% and +100%.' };
  return { value: { taxRate, seasonal: clean } };
}

// This month's boost to estimated rates (Ultra only), e.g. 20 for +20%
export function seasonalBoost(user, now = Date.now()) {
  if (!hasPlan(user, 'ultra')) return 0;
  return businessSettings(user).seasonal[new Date(now).getUTCMonth()] || 0;
}
