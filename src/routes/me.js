import { json } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { getConnections, getViewStats, profileFields } from '../lib/users.js';
import { planInfo, planLimits } from '../lib/plans.js';
import { businessSettings, seasonalBoost } from '../lib/business.js';
import { getVersions, versionFields } from '../lib/versions.js';
import { billingInfo } from '../lib/billing.js';
import { stripeConfigured, planConfigured } from '../lib/stripe.js';
import { twitchConfigured } from '../lib/twitch.js';
import { youtubeConfigured } from '../lib/youtube.js';

// The signed-in creator's profile and linked accounts
export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Not signed in' }, 401);
  return json({
    accountId: user.id,
    manager: user.manager ? { name: user.manager.name, role: user.manager.role } : null,
    business: businessSettings(user),
    seasonalBoost: seasonalBoost(user),
    profile: profileFields(user),
    connections: await getConnections(env, user.id),
    views: await getViewStats(env, user.id),
    plan: planInfo(user),
    limits: planLimits(user),
    billing: billingInfo(user, stripeConfigured(env), planConfigured(env, 'pro'), planConfigured(env, 'ultra')),
    referralDiscount: Boolean(user.referred_by && !user.first_paid_at),
    versions: (await getVersions(env, user.id)).map(versionFields),
    available: { twitch: twitchConfigured(env), youtube: youtubeConfigured(env) },
  });
}
