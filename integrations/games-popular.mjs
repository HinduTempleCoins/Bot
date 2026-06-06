// games-popular.mjs — the "Top ~50 Most Popular Games on Earth" registry + live Steam feed for the
// Van Kush Family Discord #games room.
//
// INFO-FEED ONLY — the "not-bot" lane. ───────────────────────────────────────────────────────────
//   This module is a curated REGISTRY of the biggest games (name, slug, platform, publisher, and an
//   honest hasApi/apiNotes flag for each), plus a LIVE read of Steam's public, keyless endpoints for
//   the Steam-available subset: store search, current player counts, and recent news. It plays no
//   game and automates nothing — it READS public data and FORMATS it for a human to read in Discord.
//   (Game-PLAYING agents target OUR OWN servers; see integrations/game-agent.mjs.)
//
// Pattern matches integrations/soapbox/worldbank.mjs + integrations/rs3.mjs + integrations/minecraft.mjs:
// ESM, zero deps, keyless, a __setFetch() hook, graceful soft-fail (return null/[]/safe shape, NEVER
// throw), pure helpers unit-tested offline, a guarded CLI block, provenance lines on every feed.
//
//   import { TOP_GAMES, findGame, gameInfo, playerCount, steamNews, popularityRanking,
//            discordFormat, __setFetch } from './games-popular.mjs'
//   node integrations/games-popular.mjs list
//   node integrations/games-popular.mjs info cs2
//   node integrations/games-popular.mjs players cs2
//   node integrations/games-popular.mjs rank
//   node integrations/games-popular.mjs news dota2

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'VanKushGamesTools/1.0 (+https://data.soapbox.community; info-feed-only, no game automation)' };

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TOP-GAMES REGISTRY  — ~50 of the biggest games on Earth.
//   Each entry: { name, slug, platform, publisher, steamAppId|null, hasApi, apiNotes }.
//   `steamAppId` is the Steam store/stats app id where the game is on Steam (drives live player counts).
//   `hasApi` flags whether a public/keyless data API exists at all (Steam, official, or community);
//   `apiNotes` says which one, honestly — many giants are console/launcher-exclusive with NO open API.
//   "ours" = OSRS/RS3, surfaced via integrations/rs3.mjs (info overlay, separate module).
//   Some entries also carry OPTIONAL curated community fields consumed by the SoapBox Gamer Hub
//   (integrations/soapbox/game-communities.mjs): `subreddit`, `forum`, `wiki`, `discord`, and an
//   `aliases` array of alternate slugs (e.g. stardew → 'stardew-valley'). These are additive — absent
//   on most entries; consumers must treat them as optional and fall back gracefully.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export const TOP_GAMES = [
  { name: 'Minecraft', slug: 'minecraft', platform: 'multi', publisher: 'Mojang', steamAppId: null, hasApi: true, apiNotes: 'server status + Mojang profile + version manifest via integrations/minecraft.mjs (keyless)',
    subreddit: 'Minecraft', forum: 'https://www.minecraftforum.net/', wiki: 'https://minecraft.wiki/', discord: 'https://discord.gg/minecraft' },
  { name: 'Fortnite', slug: 'fortnite', platform: 'multi', publisher: 'Epic Games', steamAppId: null, hasApi: true, apiNotes: 'Fortnite-API.com / fortnitetracker (community, key); no Steam' },
  { name: 'Grand Theft Auto V', slug: 'gta5', platform: 'multi', publisher: 'Rockstar', steamAppId: 271590, hasApi: true, apiNotes: 'Steam player counts; no official stats API' },
  { name: 'League of Legends', slug: 'lol', platform: 'PC', publisher: 'Riot Games', steamAppId: null, hasApi: true, apiNotes: 'Riot API (key required); not on Steam' },
  { name: 'Valorant', slug: 'valorant', platform: 'PC', publisher: 'Riot Games', steamAppId: null, hasApi: true, apiNotes: 'Riot API (key, limited); not on Steam' },
  { name: 'Counter-Strike 2', slug: 'cs2', platform: 'PC', publisher: 'Valve', steamAppId: 730, hasApi: true, apiNotes: 'Steam player counts + news (keyless)' },
  { name: 'Dota 2', slug: 'dota2', platform: 'PC', publisher: 'Valve', steamAppId: 570, hasApi: true, apiNotes: 'Steam player counts + news + OpenDota (keyless)' },
  { name: 'Roblox', slug: 'roblox', platform: 'multi', publisher: 'Roblox Corp', steamAppId: null, hasApi: true, apiNotes: 'Roblox web APIs (keyless, per-game); not on Steam' },
  { name: 'World of Warcraft', slug: 'wow', platform: 'PC', publisher: 'Blizzard', steamAppId: null, hasApi: true, apiNotes: 'Blizzard Battle.net API (OAuth); not on Steam' },
  { name: 'Old School RuneScape', slug: 'osrs', platform: 'multi', publisher: 'Jagex', steamAppId: 1343370, hasApi: true, apiNotes: 'ours — hiscores + GE via integrations/rs3.mjs (keyless); also on Steam' },
  { name: 'RuneScape 3', slug: 'rs3', platform: 'multi', publisher: 'Jagex', steamAppId: 1343400, hasApi: true, apiNotes: 'ours — integrations/rs3.mjs (keyless); also on Steam' },
  { name: 'Apex Legends', slug: 'apex', platform: 'multi', publisher: 'EA', steamAppId: 1172470, hasApi: true, apiNotes: 'Steam player counts; community trackers (key)' },
  { name: 'Call of Duty: Warzone', slug: 'cod-warzone', platform: 'multi', publisher: 'Activision', steamAppId: null, hasApi: false, apiNotes: 'no open API; Battle.net/console launchers' },
  { name: 'Terraria', slug: 'terraria', platform: 'multi', publisher: 'Re-Logic', steamAppId: 105600, hasApi: true, apiNotes: 'Steam player counts + news (keyless)',
    subreddit: 'Terraria', forum: 'https://forums.terraria.org/', wiki: 'https://terraria.wiki.gg/' },
  { name: 'Stardew Valley', slug: 'stardew', aliases: ['stardew-valley'], platform: 'multi', publisher: 'ConcernedApe', steamAppId: 413150, hasApi: true, apiNotes: 'Steam player counts + news (keyless)',
    subreddit: 'StardewValley', forum: 'https://forums.stardewvalley.net/', wiki: 'https://stardewvalleywiki.com/' },
  { name: 'Elden Ring', slug: 'elden-ring', platform: 'multi', publisher: 'Bandai Namco', steamAppId: 1245620, hasApi: true, apiNotes: 'Steam player counts + news (keyless)' },
  { name: 'The Legend of Zelda: Tears of the Kingdom', slug: 'zelda-totk', platform: 'Switch', publisher: 'Nintendo', steamAppId: null, hasApi: false, apiNotes: 'Nintendo first-party; no open API' },
  { name: 'Mario Kart 8 Deluxe', slug: 'mario-kart-8', platform: 'Switch', publisher: 'Nintendo', steamAppId: null, hasApi: false, apiNotes: 'Nintendo first-party; no open API' },
  { name: 'Pokémon GO', slug: 'pokemon-go', platform: 'mobile', publisher: 'Niantic', steamAppId: null, hasApi: true, apiNotes: 'PokeAPI (keyless, game-data); no live-player API' },
  { name: 'Genshin Impact', slug: 'genshin', platform: 'multi', publisher: 'HoYoverse', steamAppId: null, hasApi: true, apiNotes: 'community game-data APIs (keyless); not on Steam' },
  { name: 'Honkai: Star Rail', slug: 'honkai-star-rail', platform: 'multi', publisher: 'HoYoverse', steamAppId: null, hasApi: true, apiNotes: 'community game-data APIs (keyless); not on Steam' },
  { name: 'PUBG: Battlegrounds', slug: 'pubg', platform: 'multi', publisher: 'Krafton', steamAppId: 578080, hasApi: true, apiNotes: 'Steam player counts + official PUBG API (key)' },
  { name: 'Rocket League', slug: 'rocket-league', platform: 'multi', publisher: 'Psyonix', steamAppId: 252950, hasApi: true, apiNotes: 'Steam stats remain; now Epic launcher primary' },
  { name: 'Among Us', slug: 'among-us', platform: 'multi', publisher: 'InnerSloth', steamAppId: 945360, hasApi: true, apiNotes: 'Steam player counts + news (keyless)' },
  { name: 'Fall Guys', slug: 'fall-guys', platform: 'multi', publisher: 'Epic Games', steamAppId: null, hasApi: false, apiNotes: 'moved to Epic launcher; no open API' },
  { name: 'Rust', slug: 'rust', platform: 'PC', publisher: 'Facepunch', steamAppId: 252490, hasApi: true, apiNotes: 'Steam player counts + news (keyless)' },
  { name: 'ARK: Survival Evolved', slug: 'ark', platform: 'multi', publisher: 'Studio Wildcard', steamAppId: 346110, hasApi: true, apiNotes: 'Steam player counts + news (keyless)' },
  { name: 'Sea of Thieves', slug: 'sea-of-thieves', platform: 'multi', publisher: 'Rare / Xbox', steamAppId: 1172620, hasApi: true, apiNotes: 'Steam player counts (keyless)' },
  { name: "Baldur's Gate 3", slug: 'bg3', platform: 'multi', publisher: 'Larian', steamAppId: 1086940, hasApi: true, apiNotes: 'Steam player counts + news (keyless)' },
  { name: 'Cyberpunk 2077', slug: 'cyberpunk', aliases: ['cyberpunk-2077'], platform: 'multi', publisher: 'CD Projekt', steamAppId: 1091500, hasApi: true, apiNotes: 'Steam player counts + news (keyless)',
    subreddit: 'cyberpunkgame', forum: 'https://forums.cdprojektred.com/', wiki: 'https://cyberpunk.fandom.com/' },
  { name: 'The Witcher 3', slug: 'witcher3', platform: 'multi', publisher: 'CD Projekt', steamAppId: 292030, hasApi: true, apiNotes: 'Steam player counts + news (keyless)' },
  { name: 'The Elder Scrolls V: Skyrim', slug: 'skyrim', platform: 'multi', publisher: 'Bethesda', steamAppId: 489830, hasApi: true, apiNotes: 'Steam player counts (Special Edition appid)',
    subreddit: 'skyrim', forum: 'https://forums.bethesda.net/', wiki: 'https://elderscrolls.fandom.com/wiki/The_Elder_Scrolls_V:_Skyrim' },
  { name: 'Civilization VI', slug: 'civ6', platform: 'multi', publisher: '2K', steamAppId: 289070, hasApi: true, apiNotes: 'Steam player counts + news (keyless)' },
  { name: 'Factorio', slug: 'factorio', platform: 'PC', publisher: 'Wube', steamAppId: 427520, hasApi: true, apiNotes: 'Steam player counts + news (keyless)',
    subreddit: 'factorio', forum: 'https://forums.factorio.com/', wiki: 'https://wiki.factorio.com/' },
  { name: 'Satisfactory', slug: 'satisfactory', platform: 'PC', publisher: 'Coffee Stain', steamAppId: 526870, hasApi: true, apiNotes: 'Steam player counts + news (keyless)' },
  { name: 'Palworld', slug: 'palworld', platform: 'multi', publisher: 'Pocketpair', steamAppId: 1623730, hasApi: true, apiNotes: 'Steam player counts + news (keyless)' },
  { name: 'Helldivers 2', slug: 'helldivers2', platform: 'multi', publisher: 'Sony / Arrowhead', steamAppId: 553850, hasApi: true, apiNotes: 'Steam player counts + community war API (keyless)' },
  { name: 'Overwatch 2', slug: 'overwatch2', platform: 'multi', publisher: 'Blizzard', steamAppId: 2357570, hasApi: true, apiNotes: 'Steam player counts (keyless); Battle.net primary' },
  { name: 'Diablo IV', slug: 'diablo4', platform: 'multi', publisher: 'Blizzard', steamAppId: 2344520, hasApi: true, apiNotes: 'Steam player counts (keyless); Battle.net primary' },
  { name: 'Hearthstone', slug: 'hearthstone', platform: 'multi', publisher: 'Blizzard', steamAppId: null, hasApi: true, apiNotes: 'Blizzard Hearthstone API (OAuth, card data); not on Steam' },
  { name: 'Super Smash Bros. Ultimate', slug: 'smash-ultimate', platform: 'Switch', publisher: 'Nintendo', steamAppId: null, hasApi: false, apiNotes: 'Nintendo first-party; no open API' },
  { name: 'Animal Crossing: New Horizons', slug: 'animal-crossing', platform: 'Switch', publisher: 'Nintendo', steamAppId: null, hasApi: true, apiNotes: 'Nookipedia/ACNH community APIs (key, game-data); no live API' },
  { name: 'Splatoon 3', slug: 'splatoon3', platform: 'Switch', publisher: 'Nintendo', steamAppId: null, hasApi: true, apiNotes: 'splatoon3.ink schedule API (keyless); no live-player API' },
  { name: 'EA Sports FC 24', slug: 'ea-fc', platform: 'multi', publisher: 'EA', steamAppId: 2195250, hasApi: true, apiNotes: 'Steam player counts (keyless); FUT data unofficial' },
  { name: 'Madden NFL', slug: 'madden', platform: 'multi', publisher: 'EA', steamAppId: null, hasApi: false, apiNotes: 'no open API; console/EA launcher' },
  { name: 'NBA 2K', slug: 'nba2k', platform: 'multi', publisher: '2K', steamAppId: null, hasApi: false, apiNotes: 'no open API; yearly appid varies' },
  { name: 'Forza Horizon 5', slug: 'forza-horizon-5', platform: 'multi', publisher: 'Xbox', steamAppId: 1551360, hasApi: true, apiNotes: 'Steam player counts (keyless)' },
  { name: 'Halo Infinite', slug: 'halo-infinite', platform: 'multi', publisher: 'Xbox / 343', steamAppId: 1240440, hasApi: true, apiNotes: 'Steam player counts (keyless)' },
  { name: 'Destiny 2', slug: 'destiny2', platform: 'multi', publisher: 'Bungie', steamAppId: 1085660, hasApi: true, apiNotes: 'Steam player counts + Bungie API (key)' },
  { name: 'Warframe', slug: 'warframe', platform: 'multi', publisher: 'Digital Extremes', steamAppId: 230410, hasApi: true, apiNotes: 'Steam player counts + warframestat.us (keyless)' },
  { name: 'Path of Exile', slug: 'poe', platform: 'multi', publisher: 'GGG', steamAppId: 238960, hasApi: true, apiNotes: 'Steam player counts + official PoE API (keyless)' },
];

// ── small shared helpers ────────────────────────────────────────────────────────────────────────
const num = (x) => { if (x == null || x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : null; };

// Compact integer formatting for player counts (1.2M, 340.5K, 7,231 → keep small numbers readable).
export function fmtCount(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'M';
  if (abs >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return Math.round(n).toLocaleString('en-US');
}

async function getJson(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * PURE: find a registry entry by slug (exact, case-insensitive) or by name (case-insensitive substring).
 * @param {string} q
 * @returns {object|null}
 */
export function findGame(q) {
  if (!q || typeof q !== 'string') return null;
  const s = q.trim().toLowerCase();
  if (!s) return null;
  const bySlug = TOP_GAMES.find((g) => g.slug.toLowerCase() === s);
  if (bySlug) return bySlug;
  const byName = TOP_GAMES.find((g) => g.name.toLowerCase() === s);
  if (byName) return byName;
  return TOP_GAMES.find((g) => g.name.toLowerCase().includes(s)) || null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// STEAM — public, keyless endpoints.
//   STORE SEARCH:   store.steampowered.com/api/storesearch/?term=<q>&cc=US&l=en   → { total, items:[{id,name,...}] }
//   PLAYER COUNTS:  api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=<id>
//                     → { response:{ player_count:12345, result:1 } }
//   NEWS:           api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=<id>&count=N
//                     → { appnews:{ appid, newsitems:[{gid,title,url,date,feedlabel,contents}] } }
// ════════════════════════════════════════════════════════════════════════════════════════════════
const STEAM_STORESEARCH = 'https://store.steampowered.com/api/storesearch/';
const STEAM_PLAYERS = 'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/';
const STEAM_NEWS = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/';

// PURE: normalize a storesearch payload → [{ appid, name, price, tiny_image }] (or []).
export function parseStoreSearch(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.items)) return [];
  return json.items.filter(Boolean).map((it) => ({
    appid: num(it.id),
    name: it.name != null ? String(it.name) : null,
    price: it.price && it.price.final != null ? num(it.price.final) : null, // cents
    image: it.tiny_image != null ? String(it.tiny_image) : null,
  })).filter((x) => x.appid != null);
}

// PURE: normalize a GetNumberOfCurrentPlayers payload → an integer count, or null (result!=1 / no data).
export function parsePlayerCount(json) {
  if (!json || typeof json !== 'object' || !json.response) return null;
  const r = json.response;
  if (r.result != null && Number(r.result) !== 1) return null;
  return num(r.player_count);
}

// PURE: normalize a GetNewsForApp payload → [{ title, url, date(ISO), source }] (newest first, capped).
export function parseSteamNews(json, limit = 3) {
  if (!json || typeof json !== 'object' || !json.appnews || !Array.isArray(json.appnews.newsitems)) return [];
  const items = json.appnews.newsitems.filter(Boolean).map((it) => ({
    title: it.title != null ? String(it.title) : null,
    url: it.url != null ? String(it.url) : null,
    date: it.date != null ? new Date(Number(it.date) * 1000).toISOString() : null,
    source: it.feedlabel != null ? String(it.feedlabel) : null,
  })).filter((x) => x.title);
  return items.slice(0, Math.max(1, Math.min(20, Number(limit) || 3)));
}

/**
 * Steam store search. Returns [{appid,name,price,image}] or [].
 * @param {string} term
 */
export async function steamSearch(term, { cc = 'US', l = 'en' } = {}) {
  if (!term || typeof term !== 'string') return [];
  const url = `${STEAM_STORESEARCH}?term=${encodeURIComponent(term)}&cc=${encodeURIComponent(cc)}&l=${encodeURIComponent(l)}`;
  return parseStoreSearch(await getJson(url));
}

/**
 * Current player count for a Steam appid. Soft-fails to null.
 * @param {number|string} appid
 */
export async function playerCount(appid) {
  const id = num(appid);
  if (id == null) return null;
  const url = `${STEAM_PLAYERS}?appid=${id}`;
  return parsePlayerCount(await getJson(url));
}

/**
 * Recent Steam news for an appid. Returns [{title,url,date,source}] or [].
 * @param {number|string} appid
 * @param {number} count
 */
export async function steamNews(appid, count = 3) {
  const id = num(appid);
  if (id == null) return [];
  const n = Math.max(1, Math.min(20, Number(count) || 3));
  const url = `${STEAM_NEWS}?appid=${id}&count=${n}&maxlength=300&format=json`;
  return parseSteamNews(await getJson(url), n);
}

/**
 * Merge the registry entry for a game with its live Steam data (player count, latest news).
 * Soft-fails: registry fields always present; live fields null/[] when unavailable or not on Steam.
 * @param {string} slugOrName
 * @returns {Promise<{game, steamAppId, players, news, onSteam}|null>}
 */
export async function gameInfo(slugOrName) {
  const g = findGame(slugOrName);
  if (!g) return null;
  const onSteam = g.steamAppId != null;
  let players = null;
  let news = [];
  if (onSteam) {
    players = await playerCount(g.steamAppId);
    news = await steamNews(g.steamAppId, 3);
  }
  return { game: g, steamAppId: g.steamAppId, onSteam, players, news };
}

/**
 * Popularity ranking by CURRENT Steam players, for the Steam-available subset of the registry.
 * Games not on Steam (or with no live count) are excluded from the ranking (honest: we only rank
 * what we can actually measure). Returns [{ name, slug, appid, players }] sorted high → low.
 * @param {{limit?:number}} opts
 */
export async function popularityRanking({ limit = 50 } = {}) {
  const steamGames = TOP_GAMES.filter((g) => g.steamAppId != null);
  const rows = [];
  for (const g of steamGames) {
    const players = await playerCount(g.steamAppId);
    if (players != null) rows.push({ name: g.name, slug: g.slug, appid: g.steamAppId, players });
  }
  rows.sort((a, b) => b.players - a.players);
  return rows.slice(0, Math.max(1, Math.min(TOP_GAMES.length, Number(limit) || 50)));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// DISCORD FORMAT HELPERS — produce clean message strings (NO Discord API calls here).
// ════════════════════════════════════════════════════════════════════════════════════════════════
const FOOTER = '_info feed only — reads public registry + Steam data, no game automation_';

export const discordFormat = {
  // Registry listing.  discordFormat.list(TOP_GAMES) — names + which have a usable data API.
  list(games = TOP_GAMES) {
    const arr = Array.isArray(games) ? games : TOP_GAMES;
    if (!arr.length) return 'No games in registry.';
    const lines = [`**Top ${arr.length} games — registry**`];
    arr.forEach((g, i) => {
      const tag = g.steamAppId != null ? '🟦 Steam' : (g.hasApi ? '🔗 API' : '⚪ no open API');
      lines.push(`  ${String(i + 1).padStart(2)}. ${g.name}  (${g.slug})  — ${tag}`);
    });
    lines.push(`_source: curated registry_  ${FOOTER}`);
    return lines.join('\n');
  },

  // Single-game info.  discordFormat.info(await gameInfo(slug))
  info(d) {
    if (!d || !d.game) return 'Game not found in the registry.';
    const g = d.game;
    const lines = [`**${g.name}**  (\`${g.slug}\`)`, `Platform: ${g.platform}  •  Publisher: ${g.publisher}`];
    if (d.onSteam) {
      lines.push(`Steam appid: ${g.steamAppId}${d.players != null ? `  •  playing now: ${fmtCount(d.players)}` : ''}`);
      if (Array.isArray(d.news) && d.news.length) {
        lines.push('Latest news:');
        d.news.slice(0, 2).forEach((n) => lines.push(`  • ${n.title}${n.url ? ` — ${n.url}` : ''}`));
      }
    } else {
      lines.push(`Data API: ${g.apiNotes}`);
    }
    lines.push(`_source: registry${d.onSteam ? ' + Steam' : ''}_  ${FOOTER}`);
    return lines.join('\n');
  },

  // Player-count line.  discordFormat.players(game, count)
  players(game, count) {
    const name = game && game.name ? game.name : (typeof game === 'string' ? game : 'game');
    if (count == null) return `**${name}** — live player count unavailable.\n${FOOTER}`;
    return `**${name}** — ${fmtCount(count)} playing right now.\n_source: Steam (current players)_  ${FOOTER}`;
  },

  // Ranking block.  discordFormat.ranking(await popularityRanking())
  ranking(rows = []) {
    if (!Array.isArray(rows) || !rows.length) return 'Ranking unavailable (no live Steam counts).';
    const lines = ['**Most-played right now (Steam subset)**'];
    rows.forEach((r, i) => lines.push(`  ${String(i + 1).padStart(2)}. ${r.name.padEnd(28)} ${fmtCount(r.players)}`));
    lines.push('_source: Steam current players; ranks only the Steam-measurable games_');
    lines.push(FOOTER);
    return lines.join('\n');
  },

  // News block.  discordFormat.news(game, await steamNews(appid))
  news(game, items = []) {
    const name = game && game.name ? game.name : (typeof game === 'string' ? game : 'game');
    if (!Array.isArray(items) || !items.length) return `**${name}** — no recent Steam news.\n${FOOTER}`;
    const lines = [`**${name} — recent news**`];
    items.forEach((n) => lines.push(`  • ${n.title}${n.url ? `\n    ${n.url}` : ''}`));
    lines.push(`_source: Steam news_  ${FOOTER}`);
    return lines.join('\n');
  },
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CLI (guarded) — quick manual checks. INFO ONLY; never automates a game.
// ════════════════════════════════════════════════════════════════════════════════════════════════
if (process.argv[1] && process.argv[1].endsWith('games-popular.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ').trim();
  switch ((cmd || '').toLowerCase()) {
    case 'list': {
      console.log(discordFormat.list(TOP_GAMES));
      break;
    }
    case 'info': {
      console.log(discordFormat.info(await gameInfo(arg || 'cs2')));
      break;
    }
    case 'players': {
      const g = findGame(arg || 'cs2');
      console.log(discordFormat.players(g || (arg || 'cs2'), g && g.steamAppId != null ? await playerCount(g.steamAppId) : null));
      break;
    }
    case 'news': {
      const g = findGame(arg || 'dota2');
      console.log(discordFormat.news(g || (arg || 'dota2'), g && g.steamAppId != null ? await steamNews(g.steamAppId, 3) : []));
      break;
    }
    case 'rank':
    case 'ranking': {
      console.log(discordFormat.ranking(await popularityRanking({ limit: 20 })));
      break;
    }
    case 'search': {
      const items = await steamSearch(arg || 'minecraft');
      console.log(items.length ? items.map((x) => `  ${x.appid}  ${x.name}`).join('\n') : '  no results');
      break;
    }
    default:
      console.log('Top-games registry + live Steam feeds (info feed only — no game automation).');
      console.log('usage:');
      console.log('  node integrations/games-popular.mjs list');
      console.log('  node integrations/games-popular.mjs info cs2');
      console.log('  node integrations/games-popular.mjs players cs2');
      console.log('  node integrations/games-popular.mjs news dota2');
      console.log('  node integrations/games-popular.mjs rank');
  }
}
