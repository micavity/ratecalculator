// Box art for the games a creator lists, from Twitch. Matches are saved
// with the profile, so kits never wait on Twitch.
import { twitchConfigured, twitchAppToken, getGamesByName, searchGames } from './twitch.js';

export const MAX_GAMES = 12;

export function splitGames(text) {
  return String(text ?? '').split(',').map((g) => g.trim()).filter(Boolean).slice(0, MAX_GAMES);
}

// "ARC Raiders", "arc raiders" and "Arc-Raiders" all count as the same name
export function sameName(a, b) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(a) !== '' && norm(a) === norm(b);
}

// Twitch art URLs have {width}x{height} placeholders
export function boxArt(template, width, height) {
  return template.replace('{width}', width).replace('{height}', height);
}

/**
 * Returns an entry for each listed name: { text, id, name, art } for games
 * Twitch knows, and { text } for topics it doesn't. Names checked before are
 * reused without asking Twitch again.
 */
export async function matchGames(env, gamesText, previous = []) {
  const entries = splitGames(gamesText);
  const matches = new Map();
  for (const text of entries) {
    const known = previous.find((p) => p.text === text);
    if (known) matches.set(text, known);
  }
  const missing = entries.filter((t) => !matches.has(t));
  let checked = false;
  if (missing.length && twitchConfigured(env)) {
    try {
      const token = await twitchAppToken(env);
      const exact = await getGamesByName(env, token, missing);
      for (const text of missing) {
        const game = exact.find((g) => sameName(g.name, text));
        if (game) matches.set(text, { text, ...game });
      }
      // Close spellings ("arc raiders") that the exact lookup missed
      await Promise.all(missing.filter((t) => !matches.has(t)).map(async (text) => {
        const found = await searchGames(env, token, text, 5);
        const game = found.find((g) => sameName(g.name, text));
        if (game) matches.set(text, { text, ...game });
      }));
      checked = true;
    } catch (err) {
      console.error('Game art lookup failed:', err.message);
    }
  }
  // If Twitch couldn't be reached, unmatched names are left out so they're tried again next time
  return entries.map((t) => matches.get(t) || (checked ? { text: t } : null)).filter(Boolean);
}

// Adds art for creators who listed games before box art existed, a few at a time
export async function backfillGameArt(env, limit = 25) {
  if (!twitchConfigured(env)) return 0;
  const { results } = await env.DB.prepare("SELECT id, games FROM users WHERE game_art IS NULL AND games != '' LIMIT ?").bind(limit).all();
  for (const u of results) {
    const art = await matchGames(env, u.games);
    await env.DB.prepare('UPDATE users SET game_art = ? WHERE id = ? AND games = ?').bind(JSON.stringify(art), u.id, u.games).run();
  }
  return results.length;
}
