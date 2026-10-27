// Monthly reports. Each section needs a plan: growth for everyone, kit and
// brand interest from Essential, the business summary from Pro, and the
// deeper ones on Ultra. Everything comes from data CreatorGG already keeps.
import { hasPlan, PLAN_NAMES } from './plans.js';
import { parseJson } from './kit-content.js';
import { estimateRates, formatRange } from '../../public/rates.js';
import { rateInput } from './users.js';

export const REPORT_PLANS = {
  growth: 'free',
  kitInterest: 'essential',
  summary: 'pro',
  pipeline: 'ultra',
  sponsors: 'ultra',
  rates: 'ultra',
  update: 'ultra',
};

const PLATFORM_NAMES = { twitch: 'Twitch', youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', x: 'X' };
const DAY = 86400000;

// "2026-10" → first day, first day of next month, and timestamps for both
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { startDay: iso(start), endDay: iso(end), prevDay: iso(prev), startMs: start.getTime(), endMs: end.getTime(), prevMs: prev.getTime() };
}

export function currentMonth(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 7);
}

// The months a creator can pick: from when they joined (at most 12 back) to now
export function availableMonths(user, now = Date.now()) {
  const months = [];
  const joined = currentMonth(user.created_at || now);
  const d = new Date(now);
  for (let i = 0; i < 12; i++) {
    const month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
    if (month < joined) break;
    months.push(month);
  }
  return months;
}

function pct(from, to) {
  return from ? Math.round(((to - from) / from) * 1000) / 10 : null;
}

function sumByCurrency(rows) {
  const totals = {};
  for (const r of rows) totals[r.currency] = (totals[r.currency] || 0) + r.amount_cents / 100;
  return totals;
}

async function growth(env, user, r) {
  const { results } = await env.DB.prepare(`SELECT platform, day, followers, avg_views FROM stat_snapshots
    WHERE user_id = ? AND day >= ? AND day < ? ORDER BY day`).bind(user.id, r.startDay, r.endDay).all();
  const platforms = {};
  for (const row of results) (platforms[row.platform] ||= []).push(row);
  return {
    platforms: Object.entries(platforms).map(([platform, rows]) => {
      const first = rows[0];
      const last = rows[rows.length - 1];
      return {
        platform,
        name: PLATFORM_NAMES[platform] || platform,
        followersStart: first.followers,
        followersEnd: last.followers,
        followersChange: first.followers != null && last.followers != null ? last.followers - first.followers : null,
        followersPct: first.followers != null && last.followers != null ? pct(first.followers, last.followers) : null,
        avgViewsStart: first.avg_views,
        avgViewsEnd: last.avg_views,
        avgViewsPct: first.avg_views && last.avg_views != null ? pct(first.avg_views, last.avg_views) : null,
        series: rows.map((x) => ({ day: x.day, followers: x.followers })),
        days: rows.length,
      };
    }),
  };
}

async function kitInterest(env, user, r) {
  const [views, prevViews, sources, countries, opens, proposals, deals] = await Promise.all([
    env.DB.prepare('SELECT COALESCE(SUM(views), 0) AS n FROM kit_views WHERE user_id = ? AND day >= ? AND day < ?').bind(user.id, r.startDay, r.endDay).first(),
    env.DB.prepare('SELECT COALESCE(SUM(views), 0) AS n FROM kit_views WHERE user_id = ? AND day >= ? AND day < ?').bind(user.id, r.prevDay, r.startDay).first(),
    env.DB.prepare(`SELECT source AS label, SUM(views) AS views FROM kit_sources WHERE user_id = ? AND day >= ? AND day < ?
      GROUP BY source ORDER BY views DESC LIMIT 6`).bind(user.id, r.startDay, r.endDay).all(),
    env.DB.prepare(`SELECT country AS label, SUM(views) AS views FROM kit_countries WHERE user_id = ? AND day >= ? AND day < ?
      GROUP BY country ORDER BY views DESC LIMIT 6`).bind(user.id, r.startDay, r.endDay).all(),
    env.DB.prepare(`SELECT l.label, COUNT(*) AS opens, MAX(e.at) AS last FROM link_events e JOIN tracked_links l ON l.id = e.link_id
      WHERE e.user_id = ? AND e.at >= ? AND e.at < ? GROUP BY l.label ORDER BY opens DESC`).bind(user.id, r.startMs, r.endMs).all(),
    env.DB.prepare(`SELECT brand AS label, view_count AS opens, last_viewed_at AS last, status FROM proposals
      WHERE user_id = ? AND last_viewed_at >= ? AND last_viewed_at < ? ORDER BY last_viewed_at DESC`).bind(user.id, r.startMs, r.endMs).all(),
    env.DB.prepare("SELECT LOWER(brand) AS brand FROM deals WHERE user_id = ? AND stage IN ('agreed', 'delivered', 'paid')").bind(user.id).all(),
  ]);
  // Brands that looked this month but haven't become a deal yet
  const booked = new Set(deals.results.map((d) => d.brand));
  const looked = [...opens.results.map((o) => ({ ...o, via: 'kit link' })), ...proposals.results.filter((p) => p.status === 'open').map((p) => ({ ...p, via: 'proposal' }))];
  const followUp = looked.filter((o) => !booked.has(String(o.label).toLowerCase()));
  return {
    views: views.n,
    viewsPrev: prevViews.n,
    viewsPct: pct(prevViews.n, views.n),
    sources: sources.results,
    countries: countries.results,
    brandOpens: opens.results,
    proposalViews: proposals.results,
    followUp,
  };
}

async function summary(env, user, r) {
  const [paid, paidPrev, created, sent, accepted] = await Promise.all([
    env.DB.prepare(`SELECT brand, amount_cents, currency FROM deals WHERE user_id = ? AND stage = 'paid' AND amount_cents IS NOT NULL
      AND paid_on >= ? AND paid_on < ?`).bind(user.id, r.startDay, r.endDay).all(),
    env.DB.prepare(`SELECT amount_cents, currency FROM deals WHERE user_id = ? AND stage = 'paid' AND amount_cents IS NOT NULL
      AND paid_on >= ? AND paid_on < ?`).bind(user.id, r.prevDay, r.startDay).all(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM deals WHERE user_id = ? AND created_at >= ? AND created_at < ?').bind(user.id, r.startMs, r.endMs).first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM proposals WHERE user_id = ? AND created_at >= ? AND created_at < ?').bind(user.id, r.startMs, r.endMs).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM proposals WHERE user_id = ? AND status = 'accepted' AND responded_at >= ? AND responded_at < ?").bind(user.id, r.startMs, r.endMs).first(),
  ]);
  const brands = {};
  for (const d of paid.results) {
    const key = `${d.brand}|${d.currency}`;
    brands[key] = { brand: d.brand, currency: d.currency, amount: (brands[key]?.amount || 0) + d.amount_cents / 100 };
  }
  return {
    earned: sumByCurrency(paid.results),
    earnedPrev: sumByCurrency(paidPrev.results),
    dealsPaid: paid.results.length,
    newDeals: created.n,
    proposalsSent: sent.n,
    proposalsAccepted: accepted.n,
    winRate: sent.n ? Math.round((Math.min(accepted.n, sent.n) / sent.n) * 100) : null,
    topBrands: Object.values(brands).sort((a, b) => b.amount - a.amount).slice(0, 5),
  };
}

async function pipeline(env, user, r) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const [deals, invoices] = await Promise.all([
    env.DB.prepare(`SELECT brand, stage, amount_cents, currency, due_date, payment_due, updated_at FROM deals
      WHERE user_id = ? AND stage IN ('pitched', 'negotiating', 'agreed', 'delivered')`).bind(user.id).all(),
    env.DB.prepare(`SELECT number, issued_on, due_on, paid_on, bill_to FROM invoices WHERE user_id = ? AND status = 'paid'
      AND paid_on >= ? AND paid_on < ?`).bind(user.id, r.startDay, r.endDay).all(),
  ]);
  const stages = {};
  for (const d of deals.results) {
    const s = (stages[d.stage] ||= { count: 0, totals: {} });
    s.count += 1;
    if (d.amount_cents != null) s.totals[d.currency] = (s.totals[d.currency] || 0) + d.amount_cents / 100;
  }
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
  const paidTimes = invoices.results.map((i) => ({
    brand: parseJson(i.bill_to, {}).name || '',
    number: i.number,
    days: daysBetween(i.issued_on, i.paid_on),
    late: i.due_on ? Math.max(0, daysBetween(i.due_on, i.paid_on)) : 0,
  }));
  return {
    stages,
    quiet: deals.results.filter((d) => ['pitched', 'negotiating'].includes(d.stage) && now - d.updated_at > 14 * DAY)
      .map((d) => ({ brand: d.brand, days: Math.round((now - d.updated_at) / DAY) })),
    overdueContent: deals.results.filter((d) => ['negotiating', 'agreed'].includes(d.stage) && d.due_date && d.due_date < today).map((d) => d.brand),
    overduePayment: deals.results.filter((d) => ['agreed', 'delivered'].includes(d.stage) && d.payment_due && d.payment_due < today).map((d) => d.brand),
    expected: sumByCurrency(deals.results.filter((d) => ['agreed', 'delivered'].includes(d.stage) && d.amount_cents != null)),
    avgDaysToPay: paidTimes.length ? Math.round(paidTimes.reduce((s, p) => s + p.days, 0) / paidTimes.length) : null,
    latePayers: paidTimes.filter((p) => p.late > 0),
  };
}

async function sponsors(env, user, r) {
  const { results } = await env.DB.prepare(`SELECT c.brand, c.title, c.content, d.amount_cents, d.currency FROM campaign_reports c
    LEFT JOIN deals d ON d.id = c.deal_id AND d.user_id = c.user_id
    WHERE c.user_id = ? AND c.created_at >= ? AND c.created_at < ?`).bind(user.id, r.startMs, r.endMs).all();
  return {
    campaigns: results.map((c) => {
      const views = parseJson(c.content, []).reduce((s, v) => s + (Number(v.stats?.views) || 0), 0);
      const amount = c.amount_cents != null ? c.amount_cents / 100 : null;
      return { brand: c.brand, title: c.title, views, amount, currency: c.currency || 'USD', cpm: amount && views ? Math.round((amount / (views / 1000)) * 100) / 100 : null };
    }).sort((a, b) => (b.views || 0) - (a.views || 0)),
  };
}

async function rates(env, user, connections) {
  const { results } = await env.DB.prepare(`SELECT platform, day, avg_views FROM stat_snapshots WHERE user_id = ? AND avg_views IS NOT NULL
    AND day >= ? ORDER BY day`).bind(user.id, new Date(Date.now() - 31 * DAY).toISOString().slice(0, 10)).all();
  const change = {};
  for (const row of results) {
    (change[row.platform] ||= { from: row.avg_views }).to = row.avg_views;
  }
  const changes = Object.entries(change).map(([platform, c]) => ({ platform, name: PLATFORM_NAMES[platform] || platform, from: c.from, to: c.to, pct: pct(c.from, c.to) }));
  const best = changes.filter((c) => c.pct !== null).sort((a, b) => b.pct - a.pct)[0];
  const { sections } = estimateRates(rateInput(user, connections));
  let advice = 'Not enough history yet. Check back after a few weeks of daily stats.';
  if (best && best.pct >= 10) advice = `Your ${best.name} views are up ${best.pct}% in the last month. Consider raising your ${best.name} rates by about ${Math.round(best.pct / 2)}–${Math.round(best.pct)}%.`;
  else if (best && best.pct <= -10) advice = `Your ${best.name} views dipped ${Math.abs(best.pct)}% this month. Hold your rates steady rather than discounting, and lead with your best recent videos.`;
  else if (best) advice = 'Your views are steady. Your current rates fit.';
  return {
    changes,
    advice,
    estimates: sections.map((s) => ({ name: s.name, rates: s.rates.map(([label, range]) => [label, formatRange(range)]) })),
    customRates: user.rate_mode === 'custom' ? parseJson(user.rate_card, []) : [],
  };
}

const BUILDERS = { growth, kitInterest, summary, pipeline, sponsors };

// Builds every section the creator's plan includes; the rest come back locked
export async function buildMonthlyReport(env, user, connections, month) {
  const r = monthRange(month);
  const sections = {};
  await Promise.all(Object.entries(REPORT_PLANS).map(async ([key, plan]) => {
    if (!hasPlan(user, plan)) {
      sections[key] = { locked: true, plan, planName: PLAN_NAMES[plan] };
      return;
    }
    if (key === 'rates') sections.rates = await rates(env, user, connections);
    else if (key === 'update') sections.update = { url: `/update/${user.slug}/${month}` };
    else sections[key] = await BUILDERS[key](env, user, r);
  }));
  return sections;
}
