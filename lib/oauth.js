import { twitchAuthorizeUrl, twitchConfigured, exchangeTwitchCode, getTwitchUser, getTwitchStats } from './twitch.js';
import { youtubeAuthorizeUrl, youtubeConfigured, exchangeGoogleCode, getMyYouTubeChannel, getYouTubeStats } from './youtube.js';

// Each provider: whether it's set up, where to send the creator, and how
// to turn the returned code into an account + its stats
export const PROVIDERS = {
  twitch: {
    configured: twitchConfigured,
    authorizeUrl: twitchAuthorizeUrl,
    async complete(env, code, redirectUri) {
      const token = await exchangeTwitchCode(env, code, redirectUri);
      const account = await getTwitchUser(env, token);
      const stats = await getTwitchStats(env, token, account.providerId);
      return { account, stats };
    },
  },
  youtube: {
    configured: youtubeConfigured,
    authorizeUrl: youtubeAuthorizeUrl,
    async complete(env, code, redirectUri) {
      const token = await exchangeGoogleCode(env, code, redirectUri);
      const account = await getMyYouTubeChannel(token);
      const stats = await getYouTubeStats(account.providerId, { token });
      return { account, stats };
    },
  },
};

export const STATE_COOKIE = 'cgg_oauth_state';

export function callbackUrl(request, provider) {
  return `${new URL(request.url).origin}/auth/${provider}/callback`;
}
