// game-communities.mjs — the SoapBox game-community LINK-OUT directory. Posture: we AGGREGATE and POINT.
// We never host, mirror, or scrape a community — we build the canonical links a gamer wants (official
// forum, subreddit, official Discord invite page, official wiki, Steam community hub) and link out. Every
// link is to a first-party / community-owned destination; nothing here fetches or copies their content.
//
// The per-game link set is computed from a small curated REGISTRY of popular games. If a shared
// integrations/games-popular.mjs registry exists in this worktree we PREFER its TOP_GAMES export (single
// source of truth across the Gamer Hub); otherwise we fall back to the minimal LOCAL_TOP_GAMES below.
//   MERGE POINT: when integrations/games-popular.mjs lands, delete LOCAL_TOP_GAMES and rely on the import.
//
// Pattern matches worldbank.mjs: ESM, zero deps, graceful soft-fail (return []/null, NEVER throw),
// guarded CLI, escaped rendered HTML, no secrets, provenance note. No network at all — this module is
// pure URL composition (so it has no __setFetch; there is nothing to fetch).

// ---- registry source: MERGE the shared module with the local curated set ----
// The shared integrations/games-popular.mjs registry is the canonical single source of truth (its slugs
// are canonical, e.g. 'stardew', 'cyberpunk'). We treat it as the BASE and overlay our LOCAL_TOP_GAMES
// on top, FILLING GAPS only — for a game present in both we keep the shared entry's canonical slug/name
// but fill in any community field (forum/subreddit/discord/wiki) it's missing from our curated values;
// for a game we curate that the shared list doesn't carry (e.g. Fallout 4, RimWorld) we add it. The
// shared entries' `aliases` (e.g. stardew → 'stardew-valley') let callers look a game up by either slug.
// A static import of a possibly-absent sibling would crash module load, so we lazy-resolve+merge once.
let _TOP_GAMES = null;
async function loadSharedRegistry() {
  try {
    const mod = await import('../games-popular.mjs');
    if (mod && Array.isArray(mod.TOP_GAMES) && mod.TOP_GAMES.length) return mod.TOP_GAMES;
  } catch { /* not present in this worktree — use local fallback only */ }
  return null;
}

// Match a local curated entry to a shared entry by canonical slug OR any alias OR fuzzy name.
function sameGame(shared, local) {
  const sSlug = norm(shared.slug);
  const aliases = Array.isArray(shared.aliases) ? shared.aliases.map(norm) : [];
  const lSlug = norm(local.slug);
  if (sSlug === lSlug || aliases.includes(lSlug)) return true;
  return norm(shared.name) === norm(local.name);
}

// Build the active registry: shared base, local overlay (fill-gaps), local-only games appended.
async function buildRegistry() {
  const shared = await loadSharedRegistry();
  if (!shared) return LOCAL_TOP_GAMES.slice();
  const merged = shared.map((s) => {
    const local = LOCAL_TOP_GAMES.find((l) => sameGame(s, l));
    if (!local) return s;
    // fill gaps: shared values win where present; local fills the holes. Slug/name stay canonical.
    return {
      ...local, ...s,
      subreddit: s.subreddit ?? local.subreddit,
      forum: s.forum ?? local.forum,
      discord: s.discord ?? local.discord,
      wiki: s.wiki ?? local.wiki,
    };
  });
  for (const l of LOCAL_TOP_GAMES) {
    if (!shared.some((s) => sameGame(s, l))) merged.push(l);
  }
  return merged;
}

// Minimal local CURATED set. Each entry: { slug, name, steamAppId?, subreddit?, forum?, discord?,
// wiki? }. When the shared registry is present these overlay/fill it (and add any games it lacks); when
// it's absent this IS the registry. Where a field is omitted we synthesize a search/builder link instead.
export const LOCAL_TOP_GAMES = Object.freeze([
  { slug: 'minecraft', name: 'Minecraft', steamAppId: null, subreddit: 'Minecraft',
    forum: 'https://www.minecraftforum.net/', wiki: 'https://minecraft.wiki/',
    discord: 'https://discord.gg/minecraft' },
  { slug: 'skyrim', name: 'The Elder Scrolls V: Skyrim', steamAppId: 489830, subreddit: 'skyrim',
    forum: 'https://forums.bethesda.net/', wiki: 'https://elderscrolls.fandom.com/wiki/The_Elder_Scrolls_V:_Skyrim' },
  { slug: 'stardew-valley', name: 'Stardew Valley', steamAppId: 413150, subreddit: 'StardewValley',
    forum: 'https://forums.stardewvalley.net/', wiki: 'https://stardewvalleywiki.com/' },
  { slug: 'terraria', name: 'Terraria', steamAppId: 105600, subreddit: 'Terraria',
    forum: 'https://forums.terraria.org/', wiki: 'https://terraria.wiki.gg/' },
  { slug: 'cyberpunk-2077', name: 'Cyberpunk 2077', steamAppId: 1091500, subreddit: 'cyberpunkgame',
    forum: 'https://forums.cdprojektred.com/', wiki: 'https://cyberpunk.fandom.com/' },
  { slug: 'fallout-4', name: 'Fallout 4', steamAppId: 377160, subreddit: 'fo4',
    forum: 'https://forums.bethesda.net/', wiki: 'https://fallout.fandom.com/wiki/Fallout_4' },
  { slug: 'factorio', name: 'Factorio', steamAppId: 427520, subreddit: 'factorio',
    forum: 'https://forums.factorio.com/', wiki: 'https://wiki.factorio.com/' },
  { slug: 'rimworld', name: 'RimWorld', steamAppId: 294100, subreddit: 'RimWorld',
    forum: 'https://ludeon.com/forums/', wiki: 'https://rimworldwiki.com/' },
]);

// ---- pure helpers ----

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Normalize an arbitrary query/slug → a comparable lowercase token (letters+digits only).
function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// ---- canonical link builders (first-party / community destinations, never our own host) ----

/** Subreddit URL for a game (community-run). */
export function subredditUrl(sub) {
  const s = String(sub || '').replace(/^\/?r\//i, '').trim();
  return s ? `https://www.reddit.com/r/${encodeURIComponent(s)}/` : null;
}
/** A Reddit SEARCH link-out when we don't have a curated subreddit. */
export function redditSearchUrl(name) {
  const q = String(name || '').trim();
  return q ? `https://www.reddit.com/search/?q=${encodeURIComponent(q)}` : null;
}
/** Steam community hub for a game by its Steam appid. */
export function steamHubUrl(appId) {
  const id = Number(appId);
  return Number.isFinite(id) && id > 0 ? `https://steamcommunity.com/app/${id}` : null;
}
/** A Discord invite-discovery search when we don't have an official invite page on file. */
export function discordSearchUrl(name) {
  const q = String(name || '').trim();
  return q ? `https://disboard.org/search?keyword=${encodeURIComponent(q)}` : null;
}

/**
 * Resolve a registry entry by slug OR fuzzy name match. Async because the shared registry (if any) is
 * lazy-imported. Returns the entry object or null. Never throws.
 */
export async function lookupGame(slug) {
  const want = norm(slug);
  if (!want) return null;
  if (!_TOP_GAMES) _TOP_GAMES = await buildRegistry();
  const list = Array.isArray(_TOP_GAMES) ? _TOP_GAMES : LOCAL_TOP_GAMES;
  const aliasesOf = (g) => (Array.isArray(g.aliases) ? g.aliases.map(norm) : []);
  // exact canonical slug, then alias slug, then name contains / token match
  return list.find((g) => norm(g.slug) === want)
    || list.find((g) => aliasesOf(g).includes(want))
    || list.find((g) => norm(g.name).includes(want) || want.includes(norm(g.slug)))
    || null;
}

/**
 * Build the community link-out set for a game (by slug or name). Returns
 *   { slug, name, links: [{ label, url, note }], note }
 * Always returns an object; an unknown game still yields useful SEARCH link-outs (Reddit/Discord/Steam
 * store search) so the gamer is never stranded. Never throws.
 * @param {string} slug  game slug or name
 */
export async function communitiesFor(slug) {
  const raw = typeof slug === 'string' ? slug.trim() : '';
  const game = await lookupGame(raw);
  const name = game ? game.name : raw;
  const links = [];
  const add = (label, url, note) => { if (url) links.push({ label, url, note: note || '' }); };

  if (game) {
    add('Official forum', game.forum, 'first-party support/discussion forum');
    add('Subreddit', subredditUrl(game.subreddit) || redditSearchUrl(name), 'community subreddit');
    add('Official Discord', game.discord, 'official invite page');
    if (!game.discord) add('Find a Discord', discordSearchUrl(name), 'community Discord directory search');
    add('Official wiki', game.wiki, 'community/official wiki');
    add('Steam community hub', steamHubUrl(game.steamAppId), 'screenshots, guides, discussions');
  } else if (name) {
    // unknown game → search-style link-outs so the user still gets somewhere useful
    add('Search Reddit', redditSearchUrl(name), 'find the game\'s subreddit');
    add('Find a Discord', discordSearchUrl(name), 'community Discord directory search');
    add('Search Steam', `https://store.steampowered.com/search/?term=${encodeURIComponent(name)}`, 'find on Steam → community hub');
  }

  return { slug: game ? game.slug : norm(raw), name, links, note: dataNote() };
}

/** List every game in the active registry (slug + name) — for index pages / autocomplete. */
export async function listGames() {
  if (!_TOP_GAMES) _TOP_GAMES = await buildRegistry();
  const list = Array.isArray(_TOP_GAMES) ? _TOP_GAMES : LOCAL_TOP_GAMES;
  return list.map((g) => ({ slug: g.slug, name: g.name }));
}

// ---- rendering (escaped HTML) ----

/** Render communitiesFor() output into escaped link cards. PURE. */
export function renderCommunities(data = {}) {
  const name = esc(data.name || 'Game');
  const links = Array.isArray(data.links) ? data.links : [];
  const parts = [`<section class="game-communities"><h3>Communities — ${name}</h3>`];
  if (!links.length) {
    parts.push('<p class="gc-empty">No community links available.</p>');
  } else {
    parts.push('<ul class="gc-list" style="list-style:none;padding:0">');
    for (const l of links) {
      parts.push(
        '<li style="padding:5px 0">'
        + `<a href="${esc(l.url)}" target="_blank" rel="noopener nofollow">${esc(l.label)}</a>`
        + (l.note ? ` <span class="muted" style="font-size:12px">— ${esc(l.note)}</span>` : '')
        + '</li>',
      );
    }
    parts.push('</ul>');
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance / posture line. */
export function dataNote() {
  return 'we link out to official forums, subreddits, Discords, wikis and Steam hubs — we do not host or scrape communities';
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('game-communities.mjs')) {
  const slug = process.argv.slice(2).join(' ') || 'minecraft';
  const res = await communitiesFor(slug);
  console.log(`SoapBox Game Communities — ${res.name}`);
  console.log('─'.repeat(50));
  res.links.forEach((l) => console.log(`  ${l.label.padEnd(22)} ${l.url}`));
  console.log(`  ${res.note}`);
}
