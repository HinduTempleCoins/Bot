// game-guides.test.mjs — offline tests for the cheats/guides link-out aggregator. Pure URL composition,
// no network. Run: node --test integrations/soapbox/game-guides.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  guidesFor, renderGuides, dataNote,
  gamefaqsSearchUrl, steamGuidesUrl, wikiSearchUrl,
} from './game-guides.mjs';

test('link builders produce licensed/community link-outs (or null)', () => {
  assert.ok(gamefaqsSearchUrl('Skyrim').includes('gamefaqs.gamespot.com/search'));
  assert.equal(gamefaqsSearchUrl(''), null);
  assert.equal(steamGuidesUrl(413150), 'https://steamcommunity.com/app/413150/guides/');
  assert.equal(steamGuidesUrl(null), null);
  assert.ok(wikiSearchUrl('Skyrim').includes('duckduckgo.com'));
});

test('guidesFor builds link-outs for a known game (curated wiki + Steam guides + GameFAQs)', async () => {
  const res = await guidesFor('Stardew Valley');
  assert.equal(res.name, 'Stardew Valley');
  const labels = res.links.map((l) => l.label);
  assert.ok(labels.includes('Game wiki'));
  assert.ok(labels.includes('Steam community guides'));
  assert.ok(labels.includes('GameFAQs (search)'));
  assert.ok(res.links.every((l) => /^https?:\/\//.test(l.url)), 'absolute URLs only');
});

test('guidesFor still offers a wiki search + GameFAQs for an UNKNOWN game', async () => {
  const res = await guidesFor('Totally Made Up Game 9000');
  assert.ok(res.links.length >= 1);
  const labels = res.links.map((l) => l.label);
  assert.ok(labels.includes('Find the wiki') || labels.includes('Game wiki'));
  assert.ok(labels.includes('GameFAQs (search)'));
});

test('guidesFor soft-handles empty input without throwing', async () => {
  const res = await guidesFor('');
  assert.ok(res && Array.isArray(res.links));
  assert.deepEqual(res.links, []);
});

test('renderGuides escapes content, links out, and shows the copyright posture note', async () => {
  const html = renderGuides(await guidesFor('Stardew Valley'));
  assert.ok(html.includes('rel="noopener nofollow"'));
  assert.ok(html.includes('data-note'));
  const evil = renderGuides({ name: '<img src=x onerror=1>', links: [] });
  assert.ok(!evil.includes('<img src=x'));
  assert.ok(evil.includes('&lt;img'));
});

test('dataNote states the copyright posture (link, never copy)', () => {
  const n = dataNote();
  assert.ok(/link/i.test(n));
  assert.ok(/never copy|copyright/i.test(n));
});
