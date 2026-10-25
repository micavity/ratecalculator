import { json } from '../../lib/http.js';
import { getSessionUser } from '../../lib/session.js';
import { getConnections, profileFields } from '../../lib/users.js';
import { twitchConfigured } from '../../lib/twitch.js';
import { youtubeConfigured } from '../../lib/youtube.js';

// The signed-in creator's profile and linked accounts
export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Not signed in' }, 401);
  return json({
    profile: profileFields(user),
    connections: await getConnections(env, user.id),
    available: { twitch: twitchConfigured(env), youtube: youtubeConfigured(env) },
  });
}
