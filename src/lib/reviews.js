// Reviews from creators. The dashboard asks once a creator has used
// CreatorGG for 14 days and done something real with it, then again after
// 6 months. Every review is kept and counted; approval only decides which
// quotes may appear on the site (and only with the creator's consent).
const DAY = 86400000;
export const ASK_AFTER_DAYS = 14;
export const ASK_AGAIN_DAYS = 180;
export const SNOOZE_DAYS = 14;

export async function shouldAskForReview(env, user, now = Date.now()) {
  if (user.manager || user.review_opt_out) return false;
  if (now - (user.created_at || now) < ASK_AFTER_DAYS * DAY) return false;
  if (user.review_snooze_until && user.review_snooze_until > now) return false;
  const last = await env.DB.prepare('SELECT MAX(created_at) AS at FROM reviews WHERE user_id = ?').bind(user.id).first();
  if (last?.at && now - last.at < ASK_AGAIN_DAYS * DAY) return false;
  // Only ask people who've actually used it: kit views or a deal
  const used = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM kit_views WHERE user_id = ?) + (SELECT COUNT(*) FROM deals WHERE user_id = ?) AS n`)
    .bind(user.id, user.id).first();
  return used.n > 0;
}

export function readReview(body) {
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: 'Pick 1 to 5 stars.' };
  return {
    value: {
      rating,
      comment: String(body.comment ?? '').trim().slice(0, 1000) || null,
      publicOk: body.publicOk ? 1 : 0,
    },
  };
}
