// Views and other public stats for a creator's featured videos
import { twitchConfigured, twitchAppToken, getTwitchClips, getTwitchVideos } from './twitch.js';
import { getYouTubeVideos } from './youtube.js';

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Pure mappers from API responses, kept separate so they can be tested
export function youtubeVideoStats(item) {
  return {
    title: item.snippet?.title || '',
    views: count(item.statistics?.viewCount),
    likes: count(item.statistics?.likeCount),
    comments: count(item.statistics?.commentCount),
    publishedAt: item.snippet?.publishedAt || null,
    ownerId: item.snippet?.channelId || null,
  };
}

export function twitchVideoStats(item) {
  return {
    title: item.title || '',
    views: count(item.view_count),
    likes: null,
    comments: null,
    publishedAt: item.created_at || null,
    ownerId: item.broadcaster_id || item.user_id || null,
  };
}

/**
 * Returns the featured list with fresh stats attached. Videos whose stats
 * can't be fetched keep whatever stats they had before.
 */
export async function withVideoStats(env, featured) {
  const ids = (type) => featured.filter((v) => v.type === type).map((v) => v.id);
  const found = new Map();
  const key = (type, id) => `${type}:${id}`;

  const lookups = [];
  if (env.YOUTUBE_API_KEY && ids('youtube').length) {
    lookups.push(getYouTubeVideos(env.YOUTUBE_API_KEY, ids('youtube'))
      .then((items) => items.forEach((item) => found.set(key('youtube', item.id), youtubeVideoStats(item)))));
  }
  if (twitchConfigured(env) && (ids('twitch-clip').length || ids('twitch-video').length)) {
    // Clips and VODs are looked up separately so one failing doesn't lose the other
    const token = twitchAppToken(env);
    lookups.push(token.then((t) => getTwitchClips(env, t, ids('twitch-clip')))
      .then((items) => items.forEach((item) => found.set(key('twitch-clip', item.id), twitchVideoStats(item)))));
    lookups.push(token.then((t) => getTwitchVideos(env, t, ids('twitch-video')))
      .then((items) => items.forEach((item) => found.set(key('twitch-video', item.id), twitchVideoStats(item)))));
  }

  const results = await Promise.allSettled(lookups);
  for (const r of results) {
    if (r.status === 'rejected') console.error('Featured video stats failed:', r.reason?.message);
  }

  const now = Date.now();
  return featured.map((v) => {
    const stats = found.get(key(v.type, v.id));
    return stats ? { ...v, stats, statsUpdatedAt: now } : v;
  });
}
