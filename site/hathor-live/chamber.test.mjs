// chamber.test.mjs — the Chamber's tier selection and photic gating. Offline, no DOM, no network.
//
// The tests that matter are the REFUSALS. A visual drive filling the whole field of view is the worst
// case for photosensitive epilepsy, so the rule is that a high-risk program cannot be consented into a
// headset or a phone viewer at all. Everything else here exists to prove that rule cannot be bypassed
// by junk input, a missing session, or a broken risk function.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  esc, CHAMBER_TIERS, LUMINANCE_CAP, RAMP_SECONDS, CHEAP_OPTIONS,
  planChamber, gateVisual, chamberPlan, chamberScene, handler,
} from './chamber.mjs';

const HIGH = { id: 'h', method: 'flicker', program: [{ hz: 18 }] };   // 15-25Hz band = high photic risk
const STD = { id: 's', method: 'flicker', program: [{ hz: 40 }] };
const AUDIO = { id: 'a', method: 'auditory', program: [{ hz: 40 }] };
const YES = { immersive: true, screen: true };

// --- tiers -------------------------------------------------------------------

test('tiers degrade best-to-worst and plain is the floor', () => {
  assert.deepEqual(CHAMBER_TIERS, ['immersive', 'cardboard', 'flat3d', 'plain']);
  assert.equal(CHAMBER_TIERS[CHAMBER_TIERS.length - 1], 'plain');
});

test('luminance cap tightens as the field of view widens', () => {
  assert.ok(LUMINANCE_CAP.immersive < LUMINANCE_CAP.cardboard);
  assert.ok(LUMINANCE_CAP.cardboard < LUMINANCE_CAP.flat3d);
  assert.ok(LUMINANCE_CAP.flat3d < LUMINANCE_CAP.plain);
  assert.equal(LUMINANCE_CAP.plain, 1);
});

test('ramp lengthens as the field of view widens', () => {
  assert.ok(RAMP_SECONDS.immersive > RAMP_SECONDS.cardboard);
  assert.ok(RAMP_SECONDS.cardboard > RAMP_SECONDS.flat3d);
  assert.ok(RAMP_SECONDS.flat3d > RAMP_SECONDS.plain);
});

test('every tier has a cap and a ramp — no tier can be selected without limits', () => {
  for (const t of CHAMBER_TIERS) {
    assert.equal(typeof LUMINANCE_CAP[t], 'number', `${t} missing luminance cap`);
    assert.equal(typeof RAMP_SECONDS[t], 'number', `${t} missing ramp`);
  }
});

// --- capability planning -----------------------------------------------------

test('a headset gets the immersive tier', () => {
  assert.equal(planChamber({ xrImmersive: true }).tier, 'immersive');
});

test('reduced-motion is honoured over the headset — the OS preference wins', () => {
  const p = planChamber({ xrImmersive: true, reducedMotion: true });
  assert.equal(p.tier, 'flat3d');
  assert.match(p.reason, /reduced motion/i);
});

test('a phone in a viewer gets cardboard, and it does not need WebXR', () => {
  const p = planChamber({ stereoViewer: true });
  assert.equal(p.tier, 'cardboard');
  assert.match(p.reason, /no WebXR required/i);
});

test('WebGL without a headset gets flat3d', () => {
  assert.equal(planChamber({ webgl: true }).tier, 'flat3d');
});

test('no capability at all still returns a working tier, never nothing', () => {
  for (const junk of [{}, null, undefined, 0, 'x', []]) {
    const p = planChamber(junk);
    assert.equal(p.tier, 'plain');
    assert.ok(p.reason);
  }
});

// --- the refusals ------------------------------------------------------------

test('a HIGH photic-risk program is REFUSED in a headset, consent notwithstanding', () => {
  const g = gateVisual(HIGH, 'immersive', YES);
  assert.equal(g.allowed, false);
  assert.equal(g.method, 'auditory', 'must fall back to audio, not simply fail');
  assert.match(g.reason, /refused/i);
});

test('a HIGH photic-risk program is REFUSED in cardboard too — it is still full-field', () => {
  const g = gateVisual(HIGH, 'cardboard', YES);
  assert.equal(g.allowed, false);
  assert.equal(g.method, 'auditory');
});

test('the same high-risk program IS allowed on a flat screen with consent', () => {
  assert.equal(gateVisual(HIGH, 'flat3d', YES).allowed, true);
  assert.equal(gateVisual(HIGH, 'plain', YES).allowed, true);
});

test('flat-screen consent does NOT carry into a headset or a viewer', () => {
  const screenOnly = { screen: true };
  for (const t of ['immersive', 'cardboard']) {
    const g = gateVisual(STD, t, screenOnly);
    assert.equal(g.allowed, false, `${t} accepted flat-screen consent`);
    assert.match(g.reason, /own confirmation|strapped to your face/i);
  }
  assert.equal(gateVisual(STD, 'flat3d', screenOnly).allowed, true);
});

test('an auditory session is always permitted and never counts as photic exposure', () => {
  for (const t of CHAMBER_TIERS) {
    const g = gateVisual(AUDIO, t, {});
    assert.equal(g.allowed, true, `${t} blocked an audio-only session`);
    assert.equal(g.method, 'auditory');
  }
});

test('an unreadable session is treated as WORST case, not as safe', () => {
  // No program array — photicRisk cannot classify it. It must not default to permitted.
  const g = gateVisual({ method: 'flicker' }, 'immersive', YES);
  assert.equal(g.allowed, false);
});

test('an unknown tier falls back to plain rather than to the most permissive', () => {
  const g = gateVisual(STD, 'nonsense', YES);
  assert.match(g.reason, /plain/);
});

test('gateVisual never throws on junk', () => {
  for (const s of [null, undefined, 0, 'x', []]) {
    for (const t of [null, 'immersive', 'plain']) {
      assert.doesNotThrow(() => gateVisual(s, t, null));
    }
  }
});

// --- the whole decision ------------------------------------------------------

test('chamberPlan carries the cap, ramp, disclaimer and cheap options', () => {
  const p = chamberPlan(STD, { xrImmersive: true }, YES);
  assert.equal(p.tier, 'immersive');
  assert.equal(p.luminanceCap, LUMINANCE_CAP.immersive);
  assert.equal(p.rampSeconds, RAMP_SECONDS.immersive);
  assert.match(p.disclaimer, /diagnos/i);
  assert.ok(Array.isArray(p.cheapOptions) && p.cheapOptions.length > 0);
});

test('chamberPlan never throws and always yields a runnable method', () => {
  for (const s of [null, {}, STD, HIGH, AUDIO]) {
    for (const c of [null, {}, { xrImmersive: true }, { stereoViewer: true }]) {
      const p = chamberPlan(s, c, null);
      assert.ok(CHAMBER_TIERS.includes(p.tier));
      assert.ok(p.method, 'a plan must always name a method to run');
    }
  }
});

// --- cheap options -----------------------------------------------------------

test('the cheapest option comes first and needs only a phone', () => {
  assert.equal(CHEAP_OPTIONS[0].id, 'cardboard');
  assert.match(CHEAP_OPTIONS[0].name, /phone you own/i);
});

test('every option states a price, a tier, a reason and a caveat', () => {
  for (const o of CHEAP_OPTIONS) {
    assert.ok(o.approxUSD && o.what && o.why && o.caveat, `${o.id} incomplete`);
    assert.ok(CHAMBER_TIERS.includes(o.tier), `${o.id} names an unknown tier`);
  }
});

test('the standalone headset is listed last and discloses the account requirement', () => {
  const last = CHEAP_OPTIONS[CHEAP_OPTIONS.length - 1];
  assert.equal(last.id, 'used-standalone');
  assert.match(last.caveat, /account/i);
});

// --- rendering ---------------------------------------------------------------

test('the scene carries the tier, method and disclaimer', () => {
  const html = chamberScene(chamberPlan(STD, { xrImmersive: true }, YES));
  assert.match(html, /data-tier="immersive"/);
  assert.match(html, /chamber-disclaimer/);
  assert.match(html, /Enter the Chamber/);
});

test('non-immersive tiers get no enter button', () => {
  const html = chamberScene(chamberPlan(STD, { webgl: true }, YES));
  assert.ok(!html.includes('Enter the Chamber'));
});

test('the scene never throws on junk and always renders a chamber div', () => {
  for (const v of [null, undefined, {}, 0, 'x', { tier: 'nonsense' }]) {
    assert.doesNotThrow(() => chamberScene(v));
    assert.match(chamberScene(v), /<div class="chamber"/);
  }
});

test('hostile values cannot break out of the markup', () => {
  const html = chamberScene({ tier: 'plain', method: '"><script>alert(1)</script>', reason: '<img onerror=x>' });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script survived');
  assert.ok(!html.includes('<img onerror=x>'), 'raw img survived');
});

test('esc never throws on non-strings', () => {
  for (const v of [null, undefined, 0, {}, [], NaN]) assert.doesNotThrow(() => esc(v));
  assert.equal(esc(null), '');
});

// --- handler -----------------------------------------------------------------

test('handler serves the plan as JSON', () => {
  let code = 0; let headers = null; let body = '';
  handler({}, { writeHead(c, h) { code = c; headers = h; }, end(b) { body = b; } },
    HIGH, { xrImmersive: true }, YES);
  assert.equal(code, 200);
  assert.match(headers['content-type'], /application\/json/);
  const j = JSON.parse(body);
  assert.equal(j.allowed, false, 'the refusal must survive serialisation');
  assert.equal(j.method, 'auditory');
});

test('handler with no arguments still serves a valid plan', () => {
  let body = '';
  assert.doesNotThrow(() => handler({}, { writeHead() {}, end(b) { body = b; } }));
  assert.ok(CHAMBER_TIERS.includes(JSON.parse(body).tier));
});
