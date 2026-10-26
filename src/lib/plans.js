// Subscription plans. A plan comes from PayPal ("paid") or from an admin
// ("gift"). plan_expires is null for plans that never expire.
export const PLAN_RANK = { free: 0, essential: 1, pro: 2, ultra: 3 };
export const PLAN_NAMES = { free: 'Free', essential: 'Essential', pro: 'Pro', ultra: 'Ultra' };

export function effectivePlan(user, now = Date.now()) {
  const plan = user?.plan in PLAN_RANK ? user.plan : 'free';
  if (plan === 'free') return 'free';
  if (user.plan_expires && user.plan_expires <= now) return 'free';
  return plan;
}

export function hasPlan(user, needed) {
  return PLAN_RANK[effectivePlan(user)] >= PLAN_RANK[needed];
}

// What each plan allows. Data beyond a limit is kept but not shown,
// so nothing is lost if a creator's plan lapses and later comes back.
export function planLimits(user) {
  const essential = hasPlan(user, 'essential');
  return {
    essential,
    featured: essential ? 6 : 3,
    versions: essential ? 2 : 0,
    trackedLinks: essential ? 50 : 0,
  };
}

export function planInfo(user) {
  const plan = effectivePlan(user);
  return {
    plan,
    name: PLAN_NAMES[plan],
    source: plan === 'free' ? '' : user.plan_source,
    expires: plan === 'free' ? null : user.plan_expires,
    founding: Boolean(user.founding),
  };
}
