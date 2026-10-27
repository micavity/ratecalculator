// YouTube sign-in (Google OAuth, read-only) and stats
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3';
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

// YouTube has no "is a Short" flag; Shorts can be up to 3 minutes long
const SHORT_MAX_SECONDS = 180;
// Very new videos haven't collected their views yet
const MIN_AGE_MS = 3 * 86400 * 1000;
const SAMPLE_SIZE = 10;
const RECENT_MS = 28 * 86400 * 1000;

export function youtubeConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.YOUTUBE_API_KEY);
}

export function youtubeAuthorizeUrl(env, redirectUri, state) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    state,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeGoogleCode(env, code, redirectUri) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`Google token request failed (${res.status})`);
  return (await res.json()).access_token;
}

// auth is { token } (the creator's OAuth token) or { key } (our API key)
async function yt(path, params, auth) {
  const query = new URLSearchParams(params);
  const headers = {};
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;
  else query.set('key', auth.key);
  const res = await fetch(`${API}/${path}?${query}`, { headers });
  if (!res.ok) throw new Error(`YouTube API ${path} failed (${res.status})`);
  return res.json();
}

export class NoChannelError extends Error {}

export async function getMyYouTubeChannel(token) {
  const data = await yt('channels', { part: 'snippet', mine: 'true' }, { token });
  const channel = data.items?.[0];
  if (!channel) throw new NoChannelError('This Google account has no YouTube channel');
  const handle = channel.snippet.customUrl || '';
  return {
    providerId: channel.id,
    username: channel.snippet.title,
    url: handle ? `https://youtube.com/${handle}` : `https://youtube.com/channel/${channel.id}`,
    avatarUrl: channel.snippet.thumbnails?.medium?.url || channel.snippet.thumbnails?.default?.url || null,
    slugHint: handle.replace(/^@/, '') || channel.snippet.title,
  };
}

export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  const [, d, h, min, s] = m.map((v) => Number(v) || 0);
  return d * 86400 + h * 3600 + min * 60 + s;
}

// Engagement is the average of each video's own rate ((likes + comments) ÷ views),
// so one big video with a lower rate doesn't drag the whole number down
function summarize(videos) {
  if (!videos.length) return { avg: null, engagement: null, likes: null, comments: null };
  const views = videos.reduce((sum, v) => sum + v.views, 0);
  const rates = videos.filter((v) => v.views > 0).map((v) => (v.likes + v.comments) / v.views);
  const engagement = rates.length ? rates.reduce((sum, r) => sum + r, 0) / rates.length : null;
  const average = (key) => Math.round(videos.reduce((sum, v) => sum + v[key], 0) / videos.length);
  return {
    avg: Math.round(views / videos.length),
    engagement: engagement === null ? null : Math.round(engagement * 1000) / 10,
    likes: average('likes'),
    comments: average('comments'),
  };
}

// Pure function so it can be tested without the API
export function computeYouTubeStats(channel, videoItems, now = Date.now()) {
  const videos = videoItems
    .filter((v) => !v.liveStreamingDetails)
    .filter((v) => now - Date.parse(v.snippet.publishedAt) >= MIN_AGE_MS)
    .sort((a, b) => Date.parse(b.snippet.publishedAt) - Date.parse(a.snippet.publishedAt))
    .map((v) => ({
      seconds: parseDuration(v.contentDetails.duration),
      views: Number(v.statistics.viewCount) || 0,
      likes: Number(v.statistics.likeCount) || 0,
      comments: Number(v.statistics.commentCount) || 0,
    }));

  // Most-viewed uploads of the last 28 days, for Ultra's auto-featured videos
  const topRecent = videoItems
    .filter((v) => !v.liveStreamingDetails || v.liveStreamingDetails.actualEndTime)
    .filter((v) => now - Date.parse(v.snippet.publishedAt) <= RECENT_MS)
    .map((v) => ({
      id: v.id,
      title: v.snippet.title || '',
      views: Number(v.statistics.viewCount) || 0,
      likes: Number(v.statistics.likeCount) || 0,
      comments: Number(v.statistics.commentCount) || 0,
      publishedAt: v.snippet.publishedAt,
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 6);

  const long = summarize(videos.filter((v) => v.seconds > SHORT_MAX_SECONDS).slice(0, SAMPLE_SIZE));
  const shorts = summarize(videos.filter((v) => v.seconds <= SHORT_MAX_SECONDS).slice(0, SAMPLE_SIZE));
  const stats = channel.statistics;
  const main = long.avg !== null ? long : shorts;

  // How often they post: uploads in the last 90 days, or the pace of the
  // 50 we fetched if they post more than that
  const published = videoItems
    .filter((v) => !v.liveStreamingDetails || v.liveStreamingDetails.actualEndTime)
    .map((v) => Date.parse(v.snippet.publishedAt))
    .sort((a, b) => b - a);
  const recent = published.filter((t) => now - t <= 90 * 86400000);
  let uploadsPerMonth = recent.length ? Math.round((recent.length / 3) * 10) / 10 : null;
  if (recent.length >= 50) {
    const days = Math.max(1, (now - recent[recent.length - 1]) / 86400000);
    uploadsPerMonth = Math.round((recent.length / days) * 30 * 10) / 10;
  }

  // Average views of past live streams, if they stream on YouTube
  const lives = videoItems.filter((v) => v.liveStreamingDetails?.actualEndTime).slice(0, SAMPLE_SIZE);
  const avgLiveViews = lives.length
    ? Math.round(lives.reduce((sum, v) => sum + (Number(v.statistics.viewCount) || 0), 0) / lives.length)
    : null;

  return {
    subscribers: stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount) || 0,
    totalViews: Number(stats.viewCount) || 0,
    videoCount: Number(stats.videoCount) || 0,
    avgViews: long.avg,
    avgShortsViews: shorts.avg,
    engagement: long.engagement ?? shorts.engagement,
    avgLikes: main.likes ?? null,
    avgComments: main.comments ?? null,
    uploadsPerMonth,
    avgLiveViews,
    since: channel.snippet?.publishedAt || null,
    topRecent,
  };
}

export async function getYouTubeStats(channelId, auth) {
  const channelData = await yt('channels', { part: 'snippet,statistics,contentDetails', id: channelId }, auth);
  const channel = channelData.items?.[0];
  if (!channel) throw new Error('YouTube channel not found');

  const uploads = channel.contentDetails.relatedPlaylists.uploads;
  const playlist = await yt('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: '50' }, auth);
  const ids = (playlist.items || []).map((item) => item.contentDetails.videoId);

  let videoItems = [];
  if (ids.length) {
    const videos = await yt('videos', {
      part: 'snippet,statistics,contentDetails,liveStreamingDetails',
      id: ids.join(','),
    }, auth);
    videoItems = videos.items || [];
  }
  return computeYouTubeStats(channel, videoItems);
}

// Public details for specific videos, looked up with our API key
export async function getYouTubeVideos(apiKey, ids) {
  if (!ids.length) return [];
  const data = await yt('videos', { part: 'snippet,statistics', id: ids.join(',') }, { key: apiKey });
  return data.items || [];
}
