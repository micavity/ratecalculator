// Growth projections from the daily stat snapshots, Social Blade style.
// We fit a straight line through the last 30 days (so one spike doesn't
// throw it off) and compare it with the last 7 days to show momentum.
// YouTube snapshots only go back 30 days, which is all we use anyway.
import { hasPlan } from './plans.js';
import { estimateRates, formatRange } from '../../public/rates.js';
import { rateInput } from './users.js';

const DAY = 86400000;
export const MIN_DAYS = 7;
const NAMES = { twitch: 'Twitch', youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', x: 'X' };
const MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10000, 15000, 25000, 50000, 75000, 100000, 150000, 250000, 500000, 750000,
  1000000, 2500000, 5000000, 10000000, 25000000, 50000000, 100000000];

// Least-squares slope of value per day. points: [{ t (ms), v }]
export function trend(points) {
  if (points.length < 2) return null;
  const xs = points.map((p) => (p.t - points[0].t) / DAY);
  const n = points.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = points.reduce((s, p) => s + p.v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (points[i].v - my);
    den += (xs[i] - mx) ** 2;
  }
  return den ? num / den : null;
}

function nextMilestone(current) {
  return MILESTONES.find((m) => m > current) || null;
}

/**
 * Projections for one platform from its snapshots ([{ day, followers, avg_views }], oldest first).
 * Returns null until there are MIN_DAYS of data.
 */
export function projectPlatform(platform, rows, now = Date.now()) {
  const followers = rows.filter((r) => r.followers != null).map((r) => ({ t: Date.parse(r.day), v: r.followers }))
    .filter((p) => now - p.t <= 31 * DAY);
  if (followers.length < MIN_DAYS || (followers[followers.length - 1].t - followers[0].t) / DAY < MIN_DAYS - 1) return null;
  const current = followers[followers.length - 1].v;
  const perDay = trend(followers);
  const perDayWeek = trend(followers.filter((p) => followers[followers.length - 1].t - p.t <= 7 * DAY)) ?? perDay;
  const slow = Math.min(perDay, perDayWeek);
  const fast = Math.max(perDay, perDayWeek);
  // Widen the range a little when both rates agree, so it never looks falsely precise
  const spread = Math.max(Math.abs(perDay) * 0.1, (fast - slow) / 2);
  const at = (days, rate) => Math.max(0, Math.round(current + rate * days));

  // Compare the last week's rate with the month's by how far apart they are,
  // so a steady loss doesn't read as "slowing down"
  const diff = perDayWeek - perDay;
  const tolerance = Math.max(Math.abs(perDay) * 0.15, 0.5);
  const momentum = diff > tolerance ? 'speeding up' : diff < -tolerance ? 'slowing down' : 'steady';

  const target = perDay > 0 ? nextMilestone(current) : null;
  const daysToTarget = target ? Math.ceil((target - current) / perDay) : null;
  const milestone = target && daysToTarget <= 3 * 365
    ? { target, days: daysToTarget, date: new Date(now + daysToTarget * DAY).toISOString().slice(0, 10) }
    : null;

  const views = rows.filter((r) => r.avg_views != null).map((r) => ({ t: Date.parse(r.day), v: r.avg_views }))
    .filter((p) => now - p.t <= 31 * DAY);
  let viewsTrend = null;
  if (views.length >= MIN_DAYS) {
    const slope = trend(views);
    const nowViews = views[views.length - 1].v;
    const first = views[0].v;
    viewsTrend = {
      current: nowViews,
      changePct: first ? Math.round(((nowViews - first) / first) * 1000) / 10 : null,
      nextMonth: Math.max(0, Math.round(nowViews + slope * 30)),
      in90: Math.max(0, Math.round(nowViews + slope * 90)),
    };
  }

  return {
    platform,
    name: NAMES[platform] || platform,
    unit: platform === 'youtube' ? 'subscribers' : 'followers',
    days: Math.round((followers[followers.length - 1].t - followers[0].t) / DAY) + 1,
    current,
    perDay: Math.round(perDay * 10) / 10,
    perMonth: Math.round(perDay * 30),
    in30: at(30, perDay),
    in90: at(90, perDay),
    in180: at(180, perDay),
    year: { low: at(365, perDay - spread), likely: at(365, perDay), high: at(365, perDay + spread) },
    momentum,
    milestone,
    viewsTrend,
  };
}

// What each plan sees: more detail with each tier
function forPlan(p, user) {
  const essential = hasPlan(user, 'essential');
  const pro = hasPlan(user, 'pro');
  const out = { platform: p.platform, name: p.name, unit: p.unit, days: p.days, current: p.current, perDay: p.perDay, perMonth: p.perMonth, in30: p.in30 };
  if (essential) Object.assign(out, { in90: p.in90, in180: p.in180, milestone: p.milestone, momentum: p.momentum });
  if (pro) Object.assign(out, { year: p.year, viewsTrend: p.viewsTrend });
  return out;
}

export async function snapshotsByPlatform(env, userId, now = Date.now()) {
  const since = new Date(now - 31 * DAY).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare('SELECT platform, day, followers, avg_views FROM stat_snapshots WHERE user_id = ? AND day >= ? ORDER BY day')
    .bind(userId, since).all();
  const byPlatform = {};
  for (const r of results) (byPlatform[r.platform] ||= []).push(r);
  return byPlatform;
}

export async function buildProjections(env, user, connections, now = Date.now()) {
  const byPlatform = await snapshotsByPlatform(env, user.id, now);
  const all = Object.entries(byPlatform).map(([p, rows]) => projectPlatform(p, rows, now)).filter(Boolean);
  const collecting = Object.entries(byPlatform)
    .filter(([p]) => !all.some((x) => x.platform === p))
    .map(([p, rows]) => ({ platform: p, name: NAMES[p] || p, days: rows.length }));

  // Ultra: today's estimated rates vs. in 3 months at the projected views
  let rates = null;
  if (hasPlan(user, 'ultra')) {
    const input = rateInput(user, connections);
    const future = { ...input };
    // Grow today's numbers by the projected change, so a snapshot taken at a
    // different time of day than the latest refresh can't skew the result
    const scale = (key, from, to) => {
      if (future[key] && from) future[key] = Math.round(future[key] * (to / from));
    };
    for (const p of all) {
      const v = p.viewsTrend;
      if (p.platform === 'youtube' && v) scale('ytViews', v.current, v.in90);
      if (p.platform === 'tiktok' && v) scale('ttViews', v.current, v.in90);
      const key = { instagram: 'ig', facebook: 'fb', x: 'x' }[p.platform];
      if (key) {
        scale(`${key}Followers`, p.current, p.in90);
        if (v) scale(`${key}Views`, v.current, v.in90);
      }
    }
    const nowRates = estimateRates(input).sections;
    const laterRates = estimateRates(future).sections;
    rates = nowRates.map((s) => {
      const later = laterRates.find((l) => l.name === s.name);
      return { name: s.name, label: s.rates[0][0], now: formatRange(s.rates[0][1]), in90: later ? formatRange(later.rates[0][1]) : null };
    }).filter((r) => r.in90 && r.in90 !== r.now);
  }

  return { platforms: all.map((p) => forPlan(p, user)), collecting, rates, minDays: MIN_DAYS };
}

// Pro and up can show a short growth line on their kit
export async function kitGrowthLine(env, user, hidden = new Set(), now = Date.now()) {
  const byPlatform = await snapshotsByPlatform(env, user.id, now);
  const best = Object.entries(byPlatform).map(([p, rows]) => projectPlatform(p, rows, now))
    .filter((p) => p && p.perMonth > 0 && !hidden.has(`${p.platform}.${p.platform === 'youtube' ? 'subscribers' : 'followers'}`))
    .sort((a, b) => b.perMonth - a.perMonth)[0];
  if (!best) return null;
  const amount = best.perMonth >= 1000 ? `${Math.round(best.perMonth / 100) / 10}K` : String(best.perMonth);
  return `Growing ~${amount} ${best.name} ${best.unit} a month`;
}
