// content-posture.test.mjs — guards for the v3 §0/§9/§13 three-posture content engine (the legal
// keystone). Pure classification + a pure §512 moderation state machine; no network.
// Run: node --test integrations/content-posture.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  postureFor, canChainAsset, licenseTag, routeTier,
  moderate, makeModeration, flagDontTakedown, postureFromLibraryBucket,
  POSTURES, LICENSE_TAGS, MODERATION_STATES,
} from './content-posture.mjs';

const CURRENT_YEAR = new Date().getUTCFullYear();

// ── licenseTag normalization ────────────────────────────────────────────────────────────────────────
test('licenseTag: PD signals (token, rights text, old year) → PD', () => {
  assert.equal(licenseTag({ license: 'Public Domain' }), LICENSE_TAGS.PD);
  assert.equal(licenseTag({ rights: 'No known copyright' }), LICENSE_TAGS.PD);
  assert.equal(licenseTag({ year: 1851 }), LICENSE_TAGS.PD);
  assert.equal(licenseTag({ year: CURRENT_YEAR - 100 }), LICENSE_TAGS.PD);
});

test('licenseTag: CC0 and the CC-BY family normalize to canonical tags', () => {
  assert.equal(licenseTag({ license: 'CC0 1.0' }), LICENSE_TAGS.CC0);
  assert.equal(licenseTag({ license: 'cc-pdm' }), LICENSE_TAGS.CC0);
  assert.equal(licenseTag({ license: 'CC BY 4.0' }), LICENSE_TAGS.CC_BY);
  assert.equal(licenseTag({ license: 'CC_BY_SA' }), LICENSE_TAGS.CC_BY_SA);
  assert.equal(licenseTag({ license: 'CC BY-ND 4.0' }), LICENSE_TAGS.CC_BY_ND);
});

test('licenseTag: ANY NonCommercial CC variant is flagged CC-NC (unusable for us)', () => {
  assert.equal(licenseTag({ license: 'CC BY-NC 4.0' }), LICENSE_TAGS.CC_NC);
  assert.equal(licenseTag({ license: 'CC BY-NC-SA 4.0' }), LICENSE_TAGS.CC_NC);
  assert.equal(licenseTag({ license: 'CC BY-NC-ND' }), LICENSE_TAGS.CC_NC);
  assert.equal(licenseTag({ rights: 'NonCommercial use only' }), LICENSE_TAGS.CC_NC);
});

test('licenseTag: gov-works, user-original, and open-other', () => {
  assert.equal(licenseTag({ rights: 'U.S. Government Works' }), LICENSE_TAGS.GOV_WORKS);
  assert.equal(licenseTag({ license: 'OGL' }), LICENSE_TAGS.GOV_WORKS);
  assert.equal(licenseTag({ source: 'data.gov' }), LICENSE_TAGS.GOV_WORKS);
  assert.equal(licenseTag({ userOriginal: true }), LICENSE_TAGS.USER_ORIGINAL);
  assert.equal(licenseTag({ owner: 'self' }), LICENSE_TAGS.USER_ORIGINAL);
  assert.equal(licenseTag({ license: 'MIT' }), LICENSE_TAGS.OPEN_OTHER);
});

test('licenseTag: ToS-restricted embed sources, copyrighted, and unknown safe default', () => {
  assert.equal(licenseTag({ source: 'youtube' }), LICENSE_TAGS.TOS_RESTRICTED);
  assert.equal(licenseTag({ source: 'google places' }), LICENSE_TAGS.TOS_RESTRICTED);
  assert.equal(licenseTag({ source: 'yelp' }), LICENSE_TAGS.TOS_RESTRICTED);
  assert.equal(licenseTag({ embeddable: true }), LICENSE_TAGS.TOS_RESTRICTED);
  assert.equal(licenseTag({ rights: 'All rights reserved' }), LICENSE_TAGS.COPYRIGHTED);
  assert.equal(licenseTag({ title: 'mystery' }), LICENSE_TAGS.UNKNOWN);
  assert.equal(licenseTag(null), LICENSE_TAGS.UNKNOWN);
});

test('licenseTag: explicit in-copyright blocks the PD year heuristic', () => {
  assert.equal(licenseTag({ year: 1850, rights: 'All rights reserved' }), LICENSE_TAGS.COPYRIGHTED);
});

// ── postureFor: the single test, applied ───────────────────────────────────────────────────────────
test('postureFor: openly-licensed / ours / user → host', () => {
  assert.equal(postureFor({ owner: 'melek' }).posture, POSTURES.HOST);
  assert.equal(postureFor({ source: 'gutenberg', year: 1851 }).posture, POSTURES.HOST);
  assert.equal(postureFor({ license: 'CC0' }).posture, POSTURES.HOST);
  assert.equal(postureFor({ license: 'CC BY 4.0' }).posture, POSTURES.HOST);
  assert.equal(postureFor({ rights: 'U.S. Government Works' }).posture, POSTURES.HOST);
  assert.equal(postureFor({ userOriginal: true }).posture, POSTURES.HOST);
});

test('postureFor: third-party embed surfaces → window (never store)', () => {
  for (const src of ['youtube', 'vimeo', 'google places', 'yelp', 'tripadvisor', 'spotify']) {
    const p = postureFor({ source: src });
    assert.equal(p.posture, POSTURES.WINDOW, `${src} should be window`);
    assert.equal(p.canChain, false);
  }
});

test('postureFor: copyrighted-no-embed, CC-NC, and unknown → aggregate (safe default)', () => {
  assert.equal(postureFor({ rights: 'All rights reserved' }).posture, POSTURES.AGGREGATE);
  assert.equal(postureFor({ license: 'CC BY-NC 4.0' }).posture, POSTURES.AGGREGATE);
  assert.equal(postureFor({ title: 'mystery' }).posture, POSTURES.AGGREGATE);
  assert.equal(postureFor(null).posture, POSTURES.AGGREGATE);
  assert.equal(postureFor(undefined).posture, POSTURES.AGGREGATE);
});

test('postureFor: result always carries reason + licenseTag', () => {
  const p = postureFor({ license: 'CC BY-SA 4.0' });
  assert.equal(p.licenseTag, LICENSE_TAGS.CC_BY_SA);
  assert.ok(typeof p.reason === 'string' && p.reason.length > 0);
});

// ── canChain: the MELEK immutable-tier rule ────────────────────────────────────────────────────────
test('canChain: only host + PD/CC0/gov/user-original may be chained', () => {
  assert.equal(canChainAsset({ license: 'CC0' }), true);
  assert.equal(canChainAsset({ year: 1851 }), true);
  assert.equal(canChainAsset({ rights: 'U.S. Government Works' }), true);
  assert.equal(canChainAsset({ userOriginal: true }), true);
});

test('canChain: host-but-attribution-encumbered CC-BY* is NOT chain-able', () => {
  // host-able, but no-takedown rule keeps attribution/share-alike obligations off the immutable tier.
  assert.equal(postureFor({ license: 'CC BY 4.0' }).posture, POSTURES.HOST);
  assert.equal(canChainAsset({ license: 'CC BY 4.0' }), false);
  assert.equal(canChainAsset({ license: 'CC BY-SA 4.0' }), false);
  assert.equal(canChainAsset({ license: 'CC BY-ND 4.0' }), false);
  assert.equal(canChainAsset({ license: 'MIT' }), false);
});

test('canChain: never for window or aggregate (copyrighted media off-chain, period)', () => {
  assert.equal(canChainAsset({ source: 'youtube' }), false);
  assert.equal(canChainAsset({ rights: 'All rights reserved' }), false);
  assert.equal(canChainAsset({ license: 'CC BY-NC 4.0' }), false);
  assert.equal(canChainAsset({}), false);
});

// ── routeTier (§9) ──────────────────────────────────────────────────────────────────────────────────
test('routeTier: chain / ipfs-mutable / frontend-embed routing', () => {
  assert.equal(routeTier({ license: 'CC0' }), 'chain');
  assert.equal(routeTier({ year: 1851 }), 'chain');
  assert.equal(routeTier({ userOriginal: true }), 'chain');
  assert.equal(routeTier({ license: 'CC BY 4.0' }), 'ipfs-mutable');   // host but not chain
  assert.equal(routeTier({ license: 'CC BY-SA 4.0' }), 'ipfs-mutable');
  assert.equal(routeTier({ source: 'youtube' }), 'frontend-embed');     // window
  assert.equal(routeTier({ rights: 'All rights reserved' }), 'frontend-embed'); // aggregate
  assert.equal(routeTier({}), 'frontend-embed');
});

// ── moderation state machine (≥6 states) ─────────────────────────────────────────────────────────
test('moderate: plain complaint/label FLAGS, does not take down', () => {
  const r = moderate({ owner: 'melek' }, { type: 'complaint', reason: 'spam' });
  assert.equal(r.state, MODERATION_STATES.FLAGGED);
  assert.equal(r.action, 'flag');
  assert.ok(r.label && r.label.kind === 'label');
});

test('moderate: §512(c) on a HOSTED surface disables access (record retained)', () => {
  const r = moderate({ posture: POSTURES.HOST }, { type: 'dmca-512c', valid: true });
  assert.equal(r.state, MODERATION_STATES.DISABLED);
  assert.equal(r.action, 'disable-access');
  assert.equal(r.hostedSurface, true);
});

test('moderate: §512(c) on a non-hosted (window/aggregate) surface only flags + redirects', () => {
  const r = moderate({ posture: POSTURES.WINDOW }, { type: 'dmca-512c' });
  assert.equal(r.state, MODERATION_STATES.FLAGGED);
  assert.equal(r.hostedSurface, false);
});

test('moderate: malformed §512(c) notice flags rather than disabling', () => {
  const r = moderate({ posture: POSTURES.HOST }, { type: 'dmca-512c', valid: false });
  assert.equal(r.state, MODERATION_STATES.FLAGGED);
});

test('moderate: §512(g) counter-notice then put-back window elapsed → restored', () => {
  const counter = moderate({ posture: POSTURES.HOST }, { type: 'counter-512g' }, MODERATION_STATES.DISABLED);
  assert.equal(counter.state, MODERATION_STATES.COUNTER_NOTICED);
  assert.equal(counter.action, 'open-putback-window');
  const restored = moderate({ posture: POSTURES.HOST }, { type: 'putback-window-elapsed' }, MODERATION_STATES.COUNTER_NOTICED);
  assert.equal(restored.state, MODERATION_STATES.RESTORED);
  assert.equal(restored.action, 'restore-access');
});

test('moderate: §512(g) ignored unless currently disabled; put-back ignored unless counter-noticed', () => {
  const a = moderate({ posture: POSTURES.HOST }, { type: 'counter-512g' }, MODERATION_STATES.LIVE);
  assert.equal(a.state, MODERATION_STATES.LIVE);
  assert.equal(a.action, 'noop');
  const b = moderate({ posture: POSTURES.HOST }, { type: 'putback-window-elapsed' }, MODERATION_STATES.FLAGGED);
  assert.equal(b.state, MODERATION_STATES.FLAGGED);
  assert.equal(b.action, 'noop');
});

test('moderate: terminal removals (court-order / repeat-infringer / illegal) from any state', () => {
  for (const type of ['court-order', 'repeat-infringer', 'illegal']) {
    const r = moderate({ posture: POSTURES.HOST }, { type }, MODERATION_STATES.LIVE);
    assert.equal(r.state, MODERATION_STATES.REMOVED, `${type} → removed`);
    assert.equal(r.action, 'remove');
  }
});

test('moderate: unrecognized event is a safe no-op (no destructive default)', () => {
  const r = moderate({ posture: POSTURES.HOST }, { type: 'whatever' }, MODERATION_STATES.LIVE);
  assert.equal(r.state, MODERATION_STATES.LIVE);
  assert.equal(r.action, 'noop');
});

test('moderate: all six documented states are reachable', () => {
  const seen = new Set([MODERATION_STATES.LIVE]);
  seen.add(moderate({ owner: 'melek' }, { type: 'complaint' }).state);                                  // flagged
  seen.add(moderate({ posture: POSTURES.HOST }, { type: 'dmca-512c' }).state);                          // disabled
  seen.add(moderate({ posture: POSTURES.HOST }, { type: 'counter-512g' }, MODERATION_STATES.DISABLED).state); // counter-noticed
  seen.add(moderate({ posture: POSTURES.HOST }, { type: 'putback-window-elapsed' }, MODERATION_STATES.COUNTER_NOTICED).state); // restored
  seen.add(moderate({ posture: POSTURES.HOST }, { type: 'court-order' }).state);                        // removed
  for (const s of Object.values(MODERATION_STATES)) {
    assert.ok(seen.has(s), `state ${s} should be reachable`);
  }
});

test('makeModeration: stateful driver threads the full §512(c)→512(g)→put-back path', () => {
  const m = makeModeration({ posture: POSTURES.HOST });
  assert.equal(m.state, MODERATION_STATES.LIVE);
  m.apply({ type: 'dmca-512c' });
  assert.equal(m.state, MODERATION_STATES.DISABLED);
  m.apply({ type: 'counter-512g' });
  assert.equal(m.state, MODERATION_STATES.COUNTER_NOTICED);
  m.apply({ type: 'putback-window-elapsed' });
  assert.equal(m.state, MODERATION_STATES.RESTORED);
  assert.equal(m.history.length, 3);
});

test('flagDontTakedown alias matches moderate', () => {
  const a = flagDontTakedown({ owner: 'melek' }, { type: 'complaint' });
  const b = moderate({ owner: 'melek' }, { type: 'complaint' });
  assert.deepEqual(a, b);
});

test('moderate does not mutate its inputs', () => {
  const rec = { posture: POSTURES.HOST };
  const complaint = { type: 'dmca-512c' };
  const recCopy = JSON.parse(JSON.stringify(rec));
  const compCopy = JSON.parse(JSON.stringify(complaint));
  moderate(rec, complaint, MODERATION_STATES.LIVE);
  assert.deepEqual(rec, recCopy);
  assert.deepEqual(complaint, compCopy);
});

// ── interop with the Library three-bucket model ────────────────────────────────────────────────────
test('postureFromLibraryBucket: HOST_FULL/USER_NFT → host, METADATA_ONLY → aggregate', () => {
  assert.equal(postureFromLibraryBucket({ owner: 'melek' }).posture, POSTURES.HOST);
  assert.equal(postureFromLibraryBucket({ source: 'gutenberg', year: 1851 }).posture, POSTURES.HOST);
  assert.equal(postureFromLibraryBucket({ userOwned: true, rights: 'in copyright' }).posture, POSTURES.HOST);
  assert.equal(postureFromLibraryBucket({ year: 2023, rights: 'All rights reserved' }).posture, POSTURES.AGGREGATE);
});
