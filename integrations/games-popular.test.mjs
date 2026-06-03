// games-popular.test.mjs — offline tests for the top-games registry + Steam feeds. All network is
// stubbed via __setFetch with canned payloads matching the real Steam API shapes; no live calls, keys.
// Run: node --test integrations/games-popular.test.mjs
//
// INFO-FEED ONLY — these guard the read/format lane. No game automation is tested or implemented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOP_GAMES, findGame, fmtCount,
  parseStoreSearch, parsePlayerCount, parseSteamNews,
  steamSearch, playerCount, steamNews, gameInfo, popularityRanking,
  discordFormat, __setFetch,
} from './games-popular.mjs';

// ── fixtures (real Steam API shapes) ─────────────────────────────────────────────────────────────
const STORESEARCH = {
  total: 1,
  items: [{ type: 'app', name: 'Counter-Strike 2', id: 730, price: { final: 0 }, tiny_image: 'https://...jpg' }],
};
const PLAYERS_CS2 = { response: { player_count: 1043215, result: 1 } };
const PLAYERS_DOTA = { response: { player_count: 612000, result: 1 } };
const PLAYERS_FAIL = { response: { result: 42 } }; // result != 1 → no data
const NEWS_DOTA = {
  appnews: {
    appid: 570,
    newsitems: [
      { gid: '1', title: 'Patch 7.40', url: 'https://store.steampowered.com/news/1', date: 1717400000, feedlabel: 'Community Announcements', contents: '...' },
      { gid: '2', title: 'The International', url: 'https://store.steampowered.com/news/2', date: 1717300000, feedlabel: 'Community Announcements', contents: '...' },
    ],
  },
};

function jsonFetch(obj, { ok = true } = {}) { return async () => ({ ok, json: async () => obj }); }
function throwingFetch() { return async () => { throw new Error('network down'); }; }
function notOkFetch() { return async () => ({ ok: false, status: 500, json: async () => ({}) }); }

// route by URL so a single stub can serve player-count + news in one test
function routedFetch(map) {
  return async (url) => {
    const u = String(url);
    for (const [needle, obj] of Object.entries(map)) {
      if (u.includes(needle)) return { ok: true, json: async () => obj };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (1) REGISTRY — ≥6 across registry + helpers
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('registry: has ~50 games and Minecraft + ours present', () => {
  assert.ok(TOP_GAMES.length >= 50, `expected >=50 games, got ${TOP_GAMES.length}`);
  assert.ok(findGame('minecraft'));
  assert.ok(findGame('osrs'));
  assert.ok(findGame('rs3'));
});

test('registry: every entry has the required fields + consistent flags', () => {
  for (const g of TOP_GAMES) {
    assert.equal(typeof g.name, 'string');
    assert.equal(typeof g.slug, 'string');
    assert.equal(typeof g.platform, 'string');
    assert.equal(typeof g.publisher, 'string');
    assert.equal(typeof g.hasApi, 'boolean');
    assert.equal(typeof g.apiNotes, 'string');
    assert.ok(g.steamAppId === null || Number.isInteger(g.steamAppId));
    // a Steam appid implies a usable API
    if (g.steamAppId != null) assert.equal(g.hasApi, true);
  }
});

test('registry: slugs are unique', () => {
  const slugs = TOP_GAMES.map((g) => g.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test('registry: findGame by slug, exact name, and substring', () => {
  assert.equal(findGame('cs2').name, 'Counter-Strike 2');
  assert.equal(findGame('Counter-Strike 2').slug, 'cs2');
  assert.equal(findGame('witcher').slug, 'witcher3'); // substring
  assert.equal(findGame('no-such-game'), null);
  assert.equal(findGame(''), null);
});

test('registry: fmtCount formats player counts compactly', () => {
  assert.equal(fmtCount(1043215), '1.04M');
  assert.equal(fmtCount(61200), '61.2K');
  assert.equal(fmtCount(7231), '7,231');
  assert.equal(fmtCount(null), '—');
});

test('registry: discordFormat.list tags Steam vs API vs none', () => {
  const out = discordFormat.list(TOP_GAMES);
  assert.match(out, /Counter-Strike 2/);
  assert.match(out, /Steam/);
  assert.match(out, /no open API/); // at least one console-exclusive
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (2) STEAM PARSERS — pure, ≥6
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('steam: parseStoreSearch normalizes items', () => {
  const items = parseStoreSearch(STORESEARCH);
  assert.equal(items.length, 1);
  assert.equal(items[0].appid, 730);
  assert.equal(items[0].name, 'Counter-Strike 2');
  assert.deepEqual(parseStoreSearch(null), []);
});

test('steam: parsePlayerCount reads the player_count', () => {
  assert.equal(parsePlayerCount(PLAYERS_CS2), 1043215);
  assert.equal(parsePlayerCount(PLAYERS_FAIL), null); // result != 1
  assert.equal(parsePlayerCount(null), null);
});

test('steam: parseSteamNews converts unix dates to ISO + caps', () => {
  const n = parseSteamNews(NEWS_DOTA, 1);
  assert.equal(n.length, 1);
  assert.equal(n[0].title, 'Patch 7.40');
  assert.ok(n[0].date.endsWith('Z'));
  assert.deepEqual(parseSteamNews({}), []);
});

test('steam: playerCount() fetches + parses (stubbed)', async () => {
  __setFetch(jsonFetch(PLAYERS_CS2));
  assert.equal(await playerCount(730), 1043215);
  __setFetch(null);
});

test('steam: playerCount() soft-fails to null on network error / bad appid', async () => {
  __setFetch(throwingFetch());
  assert.equal(await playerCount(730), null);
  assert.equal(await playerCount('not-a-number'), null);
  __setFetch(null);
});

test('steam: steamSearch + steamNews fetch + parse (stubbed)', async () => {
  __setFetch(jsonFetch(STORESEARCH));
  const items = await steamSearch('cs2');
  assert.equal(items[0].appid, 730);
  __setFetch(jsonFetch(NEWS_DOTA));
  const news = await steamNews(570, 2);
  assert.equal(news.length, 2);
  assert.equal(news[0].title, 'Patch 7.40');
  __setFetch(null);
});

test('steam: steamNews soft-fails to [] on 500', async () => {
  __setFetch(notOkFetch());
  assert.deepEqual(await steamNews(570), []);
  __setFetch(null);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (3) MERGE + RANKING — ≥6
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('gameInfo: merges registry + live Steam data for a Steam game', async () => {
  __setFetch(routedFetch({ GetNumberOfCurrentPlayers: PLAYERS_CS2, GetNewsForApp: NEWS_DOTA }));
  const d = await gameInfo('cs2');
  assert.equal(d.game.name, 'Counter-Strike 2');
  assert.equal(d.onSteam, true);
  assert.equal(d.players, 1043215);
  assert.equal(d.news.length, 2);
  __setFetch(null);
});

test('gameInfo: a non-Steam game returns registry only, no live fields', async () => {
  // Riot game (LoL) — no appid, so no network is consulted; force a throwing stub to prove it.
  __setFetch(throwingFetch());
  const d = await gameInfo('lol');
  assert.equal(d.onSteam, false);
  assert.equal(d.players, null);
  assert.deepEqual(d.news, []);
  __setFetch(null);
});

test('gameInfo: unknown game → null', async () => {
  assert.equal(await gameInfo('definitely-not-a-game'), null);
});

test('ranking: popularityRanking ranks the Steam subset high→low', async () => {
  // Two known appids resolve; everything else returns "no data" so it's excluded.
  __setFetch(routedFetch({ 'appid=730': PLAYERS_CS2, 'appid=570': PLAYERS_DOTA }));
  const rows = await popularityRanking({ limit: 5 });
  assert.ok(rows.length >= 2);
  assert.equal(rows[0].players >= rows[1].players, true); // descending
  const cs2 = rows.find((r) => r.slug === 'cs2');
  assert.equal(cs2.players, 1043215);
  __setFetch(null);
});

test('ranking: excludes games with no live count', async () => {
  __setFetch(jsonFetch(PLAYERS_FAIL)); // every appid returns result!=1 → all excluded
  const rows = await popularityRanking();
  assert.deepEqual(rows, []);
  __setFetch(null);
});

test('format: discordFormat.info / players / ranking / news render', async () => {
  __setFetch(routedFetch({ GetNumberOfCurrentPlayers: PLAYERS_CS2, GetNewsForApp: NEWS_DOTA }));
  const info = discordFormat.info(await gameInfo('cs2'));
  assert.match(info, /Counter-Strike 2/);
  assert.match(info, /playing now/);
  assert.match(discordFormat.players(findGame('cs2'), 1043215), /1\.04M/);
  assert.match(discordFormat.ranking([{ name: 'CS2', slug: 'cs2', appid: 730, players: 1043215 }]), /CS2/);
  assert.match(discordFormat.news(findGame('dota2'), parseSteamNews(NEWS_DOTA)), /Patch 7\.40/);
  __setFetch(null);
});
