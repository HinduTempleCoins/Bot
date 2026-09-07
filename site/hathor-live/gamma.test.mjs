// gamma.test.mjs — hathor.live /40hz surface. Offline; never throws.
//
// These tests encode the two rules the source document imposes on this page:
//   1. the photosensitive-epilepsy warning must be present before any visual session can start;
//   2. frequency-specific risk is stated — 15-25Hz is the MOST provocative photic band, not 40Hz.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler } from './server.mjs';
import { GAMMA_PAGE } from './gamma.mjs';

function cap() {
  const o = { code: 0, type: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b || ''; } }, o };
}
function req(path, method = 'GET') {
  const handlers = {};
  const r = { url: path, method, on: (ev, fn) => { handlers[ev] = fn; return r; }, destroy: () => {} };
  queueMicrotask(() => { if (handlers.end) handlers.end(); });
  return r;
}

test('/40hz serves html', async () => {
  const { res, o } = cap();
  await handler(req('/40hz'), res);
  assert.equal(o.code, 200);
  assert.match(o.type, /text\/html/);
  assert.ok(o.body.length > 1000, 'page has content');
});

test('the photosensitive-epilepsy warning is on the page', () => {
  assert.match(GAMMA_PAGE, /photosensitive epilepsy/i);
  assert.match(GAMMA_PAGE, /family history of seizures/i);
  // and the visual channel is gated behind an explicit confirmation
  assert.match(GAMMA_PAGE, /id=ack\b/);
  assert.match(GAMMA_PAGE, /confirm before any visual/i);
  assert.match(GAMMA_PAGE, /ackYes/);   // the unlock control exists
});

test('the page is honest that a 60Hz display cannot do true 40Hz', () => {
  assert.match(GAMMA_PAGE, /60/);
  assert.match(GAMMA_PAGE, /not an integer multiple/i);
  assert.match(GAMMA_PAGE, /sample-accurate|audio is exactly 40Hz/i);
  assert.match(GAMMA_PAGE, /120Hz display/i);  // says when true 40Hz IS possible
});

// NOTE: a 'SCOPE GUARD' test used to live here, blocking any TENS/tDCS build content.
// It encoded Claude's own inference, not an operator rule, and was removed 2026-09-04 when the
// operator retired that restriction ("Claude put that in there, but that is not our Rule").
// Neurostim construction IS in scope. See CLAUDE.md, Scope.
test('dosage context is stated conservatively where stimulation is mentioned', () => {
  assert.match(GAMMA_PAGE, /1[–-]2\s*&nbsp;?mA|1–2&nbsp;mA/i);
  assert.match(GAMMA_PAGE, /experimental/i);
});

test('unknown paths still 404 and the handler never throws', async () => {
  const { res, o } = cap();
  await handler(req('/40hz/nope'), res);
  assert.equal(o.code, 404);
});

test('the Chamber exists as an enclosure with a threshold and a return', () => {
  // The 2026 chamber study's active ingredient is the encounter, not the frequency — so the
  // chamber must be a room you cross into and out of, not a play button.
  assert.match(GAMMA_PAGE, /id=chamber\b/);
  assert.match(GAMMA_PAGE, /The threshold/i);
  assert.match(GAMMA_PAGE, /Cross in/i);
  assert.match(GAMMA_PAGE, /Return/);
  assert.match(GAMMA_PAGE, /Step out/i);
  assert.match(GAMMA_PAGE, /requestFullscreen/);
});

test('the Chamber states the equivalence finding rather than selling the frequency', () => {
  assert.match(GAMMA_PAGE, /alpha and theta arms worked\s*\n?\s*equally well|performed EQUIVALENTLY/i);
  assert.match(GAMMA_PAGE, /The frequency is not what is doing the work/i);
});

test('the visual gate still applies inside the Chamber', () => {
  // chBegin() must refuse to run a visual session until the epilepsy acknowledgement is given.
  assert.match(GAMMA_PAGE, /if\(!unlocked\)\{ ch\.hidden=true; ack\.hidden=false; return; \}/);
});

test('chamber sessions carry the equivalence note in the data', async () => {
  const { byCategory } = await import('./sessions.mjs');
  const ch = byCategory('chamber');
  assert.equal(ch.length, 2, 'alpha and theta arms both offered');
  for (const s of ch) {
    assert.equal(s.chamber, true);
    assert.ok(/equivalen/i.test(s.evidence + s.note), `${s.name} must state the equivalence finding`);
  }
});

// ── the refresh-rate gate ────────────────────────────────────────────────────────────────────
// These assert BEHAVIOUR, not the presence of a sentence. The defect they cover was precisely a
// case where the prose on the page was correct and the code did the opposite: the painter sampled
// at requestAnimationFrame, so a 40Hz request on a 60Hz display resolved to a 3-frame on,off,on
// pattern — an actual ~20Hz flicker, the centre of the band sessions.mjs marks PHOTIC_HIGH_RISK.
// So we lift the real function out of the shipped page and run it.
function liftFromPage(name) {
  const i = GAMMA_PAGE.indexOf(`function ${name}(`);
  assert.ok(i > 0, `${name}() must exist in the shipped page`);
  // functions in this file are single-line; take to end of line
  const line = GAMMA_PAGE.slice(i, GAMMA_PAGE.indexOf('\n', i));
  return line;
}

test('renderable() refuses every refresh rate that is not an integer multiple of the target', () => {
  const fn = new Function('refresh', liftFromPage('renderable') + '; return renderable;');

  // 40Hz — the whole catalogue's headline frequency.
  assert.equal(fn(60)(40), false, '60Hz CANNOT render 40Hz — it aliases to 20Hz');
  assert.equal(fn(90)(40), false, '90Hz cannot render 40Hz');
  assert.equal(fn(144)(40), false, '144Hz cannot render 40Hz either — 3.6 frames per cycle');
  assert.equal(fn(80)(40), true, '80Hz renders 40Hz exactly, 2 frames per cycle');
  assert.equal(fn(120)(40), true, '120Hz renders 40Hz exactly, 3 frames per cycle');
  assert.equal(fn(240)(40), true, '240Hz renders 40Hz exactly, 6 frames per cycle');

  // An unmeasured display is not a permissive one.
  assert.equal(fn(0)(40), false, 'before measurement the visual channel stays shut');

  // 60Hz can place 10Hz and 6Hz exactly — the Dreamachine and strobe-training rates.
  assert.equal(fn(60)(10), true);
  assert.equal(fn(60)(6), true);
  assert.equal(fn(60)(30), true, '60/30 is exactly 2 frames per cycle');
  assert.equal(fn(60)(40), false, 'restated: the one that matters');
  assert.equal(fn(60)(45), false, '60Hz cannot place 45Hz');
});

test('every session the catalogue calls visual is checked against the display before it plays', () => {
  // start() must consult renderable() and must not substitute a nearby rate.
  assert.match(GAMMA_PAGE, /if\(vis && !renderable\(pk\)\)\{ visOK=false;/);
  assert.match(GAMMA_PAGE, /if\(vis && !visOK && !hasAudio\(sess\.method\)\)\{/);
  // paint() re-checks per program step, because a ramp can descend into an unrenderable rate.
  assert.match(GAMMA_PAGE, /if\(!renderable\(hz\)\)\{ stage\.style\.background='#000'/);
  // and the Chamber — the highest-exposure surface on the site — gets the same gate.
  assert.match(GAMMA_PAGE, /if\(isVisual\(sess\.method\) && !renderable\(sessPeak\(sess\)\)\)\{/);
  // no "close enough" path anywhere
  assert.ok(!/Math\.round\(refresh\/pk\)\s*\*\s*/.test(GAMMA_PAGE), 'no rate substitution');
});

test('flicker-only sessions have a program timer, so they advance and they end', async () => {
  const { SESSIONS } = await import('./sessions.mjs');
  // The bug: tick() opened with if(!ctx) return, and a flicker-only session builds no AudioContext.
  assert.ok(!/function tick\(\)\{\s*\n?\s*if\(!ctx\|\|!running\) return;/.test(GAMMA_PAGE),
    'tick() must not be gated on the AudioContext');
  assert.match(GAMMA_PAGE, /function tick\(\)\{\s*\n?\s*if\(!running\) return;/);
  assert.match(GAMMA_PAGE, /function clock\(\)\{ return ctx \? ctx\.currentTime : \(performance\.now\(\)\/1000\); \}/);
  // and stepEndsAt is never Infinity any more
  assert.ok(!/stepEndsAt=Infinity/.test(GAMMA_PAGE), 'no session runs without a time bound');
  assert.match(GAMMA_PAGE, /stepEndsAt=clock\(\)\+sess\.program\[0\]\.secs;/);

  // the two sessions the defect actually affected
  const dream = SESSIONS.find((s) => s.id === 'dreamachine');
  assert.ok(dream && dream.method === 'flicker' && dream.eyesClosed === true);
  const strobe = SESSIONS.find((s) => s.id === 'strobe-training');
  assert.ok(strobe && strobe.program.length > 1, 'multi-step flicker program must be able to advance');
});
