// license-router.test.mjs — offline guards for the HOST/WINDOW/POINT three-tier license router
// (task #221, v3 §7/§9/§13). Pure functions, no network, INJECTED year=2026 so PD math is
// deterministic. Run: node --test integrations/license-router.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify,
  route,
  canGoOnChain,
  validateForTier,
  tagAsset,
  EMBED_WHITELIST,
  POSTURES,
  ROUTES,
  TIERS,
} from './license-router.mjs';

const YEAR = 2026; // injected current year — PD boundaries: recordings ≤1925, compositions ≤1930

// ── PD timelines (rolling, computed from the injected year) ───────────────────────────────────────
test('1924 sound recording → host / public domain', () => {
  const a = { kind: 'recording', publishedYear: 1924 };
  const c = classify(a, { year: YEAR });
  assert.equal(c.posture, POSTURES.HOST);
  assert.equal(c.license, 'pd');
  assert.equal(route(a, { year: YEAR }).route, ROUTES.HOST);
});

test('1925 recording → host (boundary inclusive)', () => {
  assert.equal(classify({ kind: 'recording', publishedYear: 1925 }, { year: YEAR }).posture, POSTURES.HOST);
});

test('1928 sound recording → NOT public domain (window/point, not host)', () => {
  const c = classify({ kind: 'recording', publishedYear: 1928 }, { year: YEAR });
  assert.notEqual(c.posture, POSTURES.HOST);
  // no embed surface, no license → point
  assert.equal(c.posture, POSTURES.POINT);
});

test('1929 musical composition → host (95-year boundary ≤1930)', () => {
  const c = classify({ kind: 'composition', publishedYear: 1929 }, { year: YEAR });
  assert.equal(c.posture, POSTURES.HOST);
  assert.equal(c.license, 'pd');
});

test('1930 composition is PD but 1931 is not (rolling boundary)', () => {
  assert.equal(classify({ kind: 'composition', publishedYear: 1930 }, { year: YEAR }).posture, POSTURES.HOST);
  assert.notEqual(classify({ kind: 'composition', publishedYear: 1931 }, { year: YEAR }).posture, POSTURES.HOST);
});

test('recording boundary differs from composition boundary in 2026', () => {
  // 1928 recording NOT PD, but a 1928 composition IS PD — the two timelines are distinct.
  assert.notEqual(classify({ kind: 'recording', publishedYear: 1928 }, { year: YEAR }).posture, POSTURES.HOST);
  assert.equal(classify({ kind: 'composition', publishedYear: 1928 }, { year: YEAR }).posture, POSTURES.HOST);
});

// ── source-based host postures ────────────────────────────────────────────────────────────────────
test('US federal gov work → host (always PD)', () => {
  const c = classify({ kind: 'film', source: 'us-gov' }, { year: YEAR });
  assert.equal(c.posture, POSTURES.HOST);
  assert.equal(c.license, 'us-gov-pd');
});

test('pure-AI output → host / PD (USCO 2025)', () => {
  const c = classify({ kind: 'image', source: 'pure-ai' }, { year: YEAR });
  assert.equal(c.posture, POSTURES.HOST);
  assert.equal(c.license, 'pure-ai-pd');
});

test('user-original → host', () => {
  assert.equal(classify({ kind: 'text', source: 'user-original' }, { year: YEAR }).posture, POSTURES.HOST);
});

// ── Creative Commons handling ─────────────────────────────────────────────────────────────────────
test('CC-BY → host + attribution flag', () => {
  const a = { kind: 'text', license: 'cc-by' };
  assert.equal(classify(a, { year: YEAR }).posture, POSTURES.HOST);
  const r = route(a, { year: YEAR });
  assert.equal(r.route, ROUTES.HOST);
  assert.equal(r.attribution, true);
  assert.ok(r.flags.includes('attribution'));
});

test('CC0 → host, no attribution', () => {
  const r = route({ kind: 'image', license: 'cc0' }, { year: YEAR });
  assert.equal(r.route, ROUTES.HOST);
  assert.equal(r.attribution, false);
});

test('CC-BY-SA → host with attribution + sa flags', () => {
  const r = route({ kind: 'text', license: 'cc-by-sa-4.0' }, { year: YEAR });
  assert.equal(r.route, ROUTES.HOST);
  assert.ok(r.flags.includes('attribution'));
  assert.ok(r.flags.includes('sa'));
});

test('CC-BY-ND → host with no-derivatives flag', () => {
  const r = route({ kind: 'image', license: 'cc-by-nd' }, { year: YEAR });
  assert.equal(r.route, ROUTES.HOST);
  assert.ok(r.flags.includes('nd'));
});

test('CC-BY-NC → window route on our commercial surfaces, with nc flag', () => {
  const a = { kind: 'recording', license: 'cc-by-nc' };
  assert.equal(classify(a, { year: YEAR }).posture, POSTURES.WINDOW);
  const r = route(a, { year: YEAR });
  assert.equal(r.route, ROUTES.WINDOW);
  assert.ok(r.flags.includes('nc'));
});

// ── embed whitelist ───────────────────────────────────────────────────────────────────────────────
test('EMBED_WHITELIST includes the official video hosts', () => {
  for (const h of ['youtube', 'vimeo', 'dailymotion', '3speak', 'archive.org']) {
    assert.ok(EMBED_WHITELIST.includes(h), `${h} whitelisted`);
  }
});

test('official YouTube embed → window OK on embed tier', () => {
  const a = { kind: 'film', embedHost: 'youtube.com', license: 'copyrighted' };
  assert.equal(classify(a, { year: YEAR }).posture, POSTURES.WINDOW);
  const r = route(a, { year: YEAR });
  assert.equal(r.route, ROUTES.WINDOW);
  assert.equal(r.tier, TIERS.EMBED);
});

test('2embed-style scraper host → refuse outright', () => {
  const a = { kind: 'film', embedHost: '2embed.to', license: 'copyrighted' };
  const r = route(a, { year: YEAR });
  assert.equal(r.route, ROUTES.REFUSE);
  assert.equal(r.tier, null);
});

test('other unofficial-mirror markers also refuse', () => {
  for (const host of ['vidsrc.me', 'streamtape.com', 'some-unofficial-mirror.net']) {
    assert.equal(route({ kind: 'film', embedHost: host }, { year: YEAR }).route, ROUTES.REFUSE);
  }
});

// ── copyrighted, no surface → point ───────────────────────────────────────────────────────────────
test('modern bestseller, no embed → point (metadata + link out)', () => {
  const a = { kind: 'text', publishedYear: 2023, license: 'copyrighted' };
  const c = classify(a, { year: YEAR });
  assert.equal(c.posture, POSTURES.POINT);
  const r = route(a, { year: YEAR });
  assert.equal(r.route, ROUTES.POINT);
  assert.equal(r.tier, null);
});

// ── canGoOnChain — host posture ONLY ─────────────────────────────────────────────────────────────
test('canGoOnChain true only for host-posture assets', () => {
  assert.equal(canGoOnChain({ kind: 'recording', publishedYear: 1924 }, { year: YEAR }), true);
  assert.equal(canGoOnChain({ kind: 'film', source: 'us-gov' }, { year: YEAR }), true);
  assert.equal(canGoOnChain({ kind: 'image', source: 'pure-ai' }, { year: YEAR }), true);
  assert.equal(canGoOnChain({ kind: 'text', license: 'cc-by' }, { year: YEAR }), true);
  // not host:
  assert.equal(canGoOnChain({ kind: 'recording', license: 'cc-by-nc' }, { year: YEAR }), false);
  assert.equal(canGoOnChain({ kind: 'film', embedHost: 'youtube.com', license: 'copyrighted' }, { year: YEAR }), false);
  assert.equal(canGoOnChain({ kind: 'text', publishedYear: 2023, license: 'copyrighted' }, { year: YEAR }), false);
  assert.equal(canGoOnChain({ kind: 'film', embedHost: '2embed.to' }, { year: YEAR }), false);
});

// ── validateForTier — rejects copyrighted-on-chain ───────────────────────────────────────────────
test('validateForTier rejects a window-posture asset aimed at chain', () => {
  const a = { kind: 'film', embedHost: 'youtube.com', license: 'copyrighted' };
  assert.throws(() => validateForTier(a, TIERS.CHAIN, { year: YEAR }), /host-posture/);
});

test('validateForTier rejects a point-posture (copyrighted) asset on chain', () => {
  const a = { kind: 'text', publishedYear: 2023, license: 'copyrighted' };
  assert.throws(() => validateForTier(a, TIERS.CHAIN, { year: YEAR }), /host-posture/);
});

test('validateForTier accepts a host asset on chain', () => {
  const a = { kind: 'recording', publishedYear: 1924 };
  const r = validateForTier(a, TIERS.CHAIN, { year: YEAR });
  assert.equal(r.route, ROUTES.HOST);
});

test('validateForTier: embed tier requires a window asset on a whitelisted surface', () => {
  assert.ok(validateForTier({ kind: 'film', embedHost: 'vimeo.com', license: 'copyrighted' }, TIERS.EMBED, { year: YEAR }));
  assert.throws(() => validateForTier({ kind: 'recording', publishedYear: 1924 }, TIERS.EMBED, { year: YEAR }), /window-posture/);
});

test('validateForTier: ipfs-pinned accepts host only', () => {
  assert.ok(validateForTier({ kind: 'text', license: 'cc0' }, TIERS.IPFS, { year: YEAR }));
  assert.throws(() => validateForTier({ kind: 'recording', license: 'cc-by-nc' }, TIERS.IPFS, { year: YEAR }), /host-posture/);
});

test('validateForTier refuses a scraper-host asset for any tier', () => {
  assert.throws(() => validateForTier({ kind: 'film', embedHost: '2embed.to' }, TIERS.EMBED, { year: YEAR }), /refused/);
});

// ── tagAsset — the complete provenance tag ───────────────────────────────────────────────────────
test('tagAsset returns a complete tag for a host CC-BY asset', () => {
  const t = tagAsset({ kind: 'text', license: 'cc-by' }, { year: YEAR });
  assert.deepEqual(Object.keys(t).sort(), ['attribution', 'flags', 'license', 'posture', 'route', 'tier'].sort());
  assert.equal(t.posture, POSTURES.HOST);
  assert.equal(t.route, ROUTES.HOST);
  assert.equal(t.tier, TIERS.IPFS);
  assert.equal(t.attribution, true);
  assert.ok(Array.isArray(t.flags));
});

test('tagAsset for a refused asset nulls posture/tier and routes refuse', () => {
  const t = tagAsset({ kind: 'film', embedHost: '2embed.to' }, { year: YEAR });
  assert.equal(t.route, ROUTES.REFUSE);
  assert.equal(t.posture, null);
  assert.equal(t.tier, null);
});

test('tagAsset for a 1924 recording is host/chain-eligible', () => {
  const t = tagAsset({ kind: 'recording', publishedYear: 1924 }, { year: YEAR });
  assert.equal(t.posture, POSTURES.HOST);
  assert.equal(t.license, 'pd');
  assert.equal(t.flags.length, 0);
});

// ── injected-year guard ───────────────────────────────────────────────────────────────────────────
test('classify requires a finite injected year', () => {
  assert.throws(() => classify({ kind: 'recording', publishedYear: 1924 }), /year/);
});
