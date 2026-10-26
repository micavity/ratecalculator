import { json } from '../lib/http.js';
import { getSessionUser } from '../lib/session.js';
import { twitchConfigured, twitchAppToken, searchGames } from '../lib/twitch.js';

// Game suggestions with box art as a creator types: /api/games?q=valo
export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Not signed in' }, 401);
  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 60);
  if (q.length < 2 || !twitchConfigured(env)) return json({ games: [] });
  try {
    const games = await searchGames(env, await twitchAppToken(env), q, 8);
    return json({ games: games.slice(0, 6) });
  } catch (err) {
    console.error('Game search failed:', err.message);
    return json({ games: [] });
  }
}
