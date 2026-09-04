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
