// game-communities.test.mjs — offline tests for the community link-out directory. Pure URL composition,
// no network. Run: node --test integrations/soapbox/game-communities.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  communitiesFor, listGames, lookupGame, renderCommunities, dataNote,
  subredditUrl, redditSearchUrl, steamHubUrl, discordSearchUrl, LOCAL_TOP_GAMES,
} from './game-communities.mjs';

test('LOCAL_TOP_GAMES fallback registry is present and well-formed', () => {
  assert.ok(Array.isArray(LOCAL_TOP_GAMES) && LOCAL_TOP_GAMES.length >= 5);
  for (const g of LOCAL_TOP_GAMES) {
    assert.equal(typeof g.slug, 'string');
    assert.equal(typeof g.name, 'string');
  }
});

test('link builders produce canonical first-party URLs (or null)', () => {
  assert.equal(subredditUrl('Minecraft'), 'https://www.reddit.com/r/Minecraft/');
  assert.equal(subredditUrl('r/skyrim'), 'https://www.reddit.com/r/skyrim/');
  assert.equal(subredditUrl(''), null);
  assert.equal(steamHubUrl(413150), 'https://steamcommunity.com/app/413150');
  assert.equal(steamHubUrl(null), null);
  assert.ok(redditSearchUrl('Halo').includes('reddit.com/search'));
  assert.ok(discordSearchUrl('Halo').includes('disboard.org/search'));
});

test('lookupGame resolves by slug, by alias, and by fuzzy name', async () => {
  const a = await lookupGame('minecraft');
  assert.equal(a.name, 'Minecraft');
  // Stardew resolves whether asked by its canonical shared slug or by the curated alias 'stardew-valley'.
  // The shared registry's canonical slug is 'stardew'; the alias must still resolve to the same game.
  const b = await lookupGame('Stardew Valley');
  assert.equal(b.name, 'Stardew Valley');
  const viaAlias = await lookupGame('stardew-valley');
  assert.ok(viaAlias, 'alias slug resolves');
  assert.equal(viaAlias.name, 'Stardew Valley');
  const viaCanonical = await lookupGame('stardew');
  assert.equal(viaCanonical.name, 'Stardew Valley');
  assert.equal(viaAlias.slug, viaCanonical.slug, 'alias and canonical slug resolve to the same game');
  // curated wiki is present on the resolved (merged) entry
  assert.equal(viaAlias.wiki, 'https://stardewvalleywiki.com/');
  assert.equal(await lookupGame(''), null);
});

test('communitiesFor returns curated link-outs for a known game', async () => {
  const res = await communitiesFor('minecraft');
  assert.equal(res.name, 'Minecraft');
  assert.ok(res.links.length >= 3);
  const labels = res.links.map((l) => l.label);
  assert.ok(labels.includes('Official forum'));
  assert.ok(labels.includes('Subreddit'));
  assert.ok(res.links.every((l) => /^https?:\/\//.test(l.url)), 'every link is an absolute URL');
});

test('communitiesFor gives search link-outs for an UNKNOWN game (never stranded)', async () => {
  const res = await communitiesFor('Totally Made Up Game 9000');
  assert.ok(res.links.length >= 1, 'still offers something useful');
  assert.ok(res.links.some((l) => l.url.includes('reddit.com/search') || l.url.includes('store.steampowered')));
});

test('communitiesFor soft-handles empty/garbage input without throwing', async () => {
  const res = await communitiesFor('');
  assert.ok(res && Array.isArray(res.links));
  assert.deepEqual(res.links, []);
});

test('listGames lists the active registry', async () => {
  const games = await listGames();
  assert.ok(games.length >= 5);
  assert.ok(games.every((g) => g.slug && g.name));
});

test('renderCommunities escapes and links out, with the posture note', async () => {
  const html = renderCommunities(await communitiesFor('minecraft'));
  assert.ok(html.includes('rel="noopener nofollow"'), 'link-out rel');
  assert.ok(html.includes('data-note'));
  // injection: a hostile "name" must be escaped
  const evil = renderCommunities({ name: '<script>x</script>', links: [] });
  assert.ok(!evil.includes('<script>x</script>'));
  assert.ok(evil.includes('&lt;script&gt;'));
});

test('dataNote states the link-out (never host/scrape) posture', () => {
  const n = dataNote();
  assert.ok(/link out/i.test(n));
  assert.ok(/do not host|not host|scrape/i.test(n));
});
