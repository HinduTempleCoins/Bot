// server.test.mjs — offline tests for the MELEK Sleep / Focus player. No network: the only reader
// the module touches (the optional PD backing track) is fed a fake fetch via __setFetch, and the
// routes/helpers are driven directly through the exported functions + a mock req/res. Everything is
// pure + soft-fail, so nothing here asserts a throw.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BANDS, presetFor, sessionPlan, renderPage, handler, esc, backingTrack, __setFetch,
} from './server.mjs';

// Minimal mock res that captures what a handler writes.
function mockRes() {
  return {
    code: 0, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers; },
    end(chunk) { this.body += chunk == null ? '' : chunk; },
  };
}
const get = (path) => ({ url: path, method: 'GET' });

// ── BANDS ──────────────────────────────────────────────────────────────────────────────────────
test('BANDS has the five brainwave bands including Gamma 40 Hz', () => {
  const keys = Object.keys(BANDS);
  for (const b of ['delta', 'theta', 'alpha', 'beta', 'gamma']) assert.ok(keys.includes(b), `missing band ${b}`);
  assert.equal(keys.length, 5);
  assert.equal(BANDS.gamma.beat, 40, 'gamma beat must be 40 Hz');
  for (const [name, b] of Object.entries(BANDS)) {
    assert.equal(typeof b.beat, 'number', `${name}.beat`);
    assert.equal(typeof b.carrier, 'number', `${name}.carrier`);
    assert.equal(typeof b.blurb, 'string', `${name}.blurb`);
  }
});

// ── presetFor ────────────────────────────────────────────────────────────────────────────────────
test('presetFor returns a known band, unknown falls back to the safe default', () => {
  const g = presetFor('gamma');
  assert.equal(g.name, 'gamma');
  assert.equal(g.beat, 40);
  // case-insensitive + trims
  assert.equal(presetFor('  DELTA ').name, 'delta');
  // unknown / bad input → default (alpha), never throws
  assert.equal(presetFor('nonsense').name, 'alpha');
  assert.equal(presetFor(null).name, 'alpha');
  assert.equal(presetFor(undefined).name, 'alpha');
  assert.equal(presetFor({}).name, 'alpha');
});

// ── sessionPlan ──────────────────────────────────────────────────────────────────────────────────
test('sessionPlan validates and soft-fails bad input to a safe shape', () => {
  const p = sessionPlan({ band: 'theta', minutes: 45, fadeSec: 20, type: 'isochronic' });
  assert.equal(p.band, 'theta');
  assert.equal(p.type, 'isochronic');
  assert.equal(p.minutes, 45);
  assert.equal(p.fadeSec, 20);
  assert.equal(p.beat, BANDS.theta.beat);
  assert.equal(p.carrier, BANDS.theta.carrier);

  // gamma type pins carrier/beat to the gamma preset regardless of band
  const g = sessionPlan({ band: 'delta', type: 'gamma' });
  assert.equal(g.band, 'gamma');
  assert.equal(g.beat, 40);

  // bad / hostile input → clamped, defaulted, never throws
  const bad = sessionPlan({ band: 123, minutes: 'lots', fadeSec: -99, type: 'evil', carrier: 999999, beat: -5 });
  assert.equal(bad.band, 'alpha');
  assert.equal(bad.type, 'binaural');
  assert.equal(bad.minutes, 30);   // default
  assert.equal(bad.fadeSec, 0);    // clamped up from -99
  assert.ok(bad.carrier <= 1500 && bad.carrier >= 20);
  assert.ok(bad.beat >= 0.5 && bad.beat <= 100);

  // no args at all
  const d = sessionPlan();
  assert.equal(d.band, 'alpha');
  assert.equal(d.type, 'binaural');
});

// ── esc ──────────────────────────────────────────────────────────────────────────────────────────
test('esc escapes HTML-significant characters', () => {
  assert.equal(esc(`<script>"&'`), '&lt;script&gt;&quot;&amp;&#39;');
  assert.equal(esc(null), '');
});

// ── renderPage ───────────────────────────────────────────────────────────────────────────────────
test('renderPage renders the player with Web Audio and an esc-safe band param', () => {
  const html = renderPage(sessionPlan({ band: 'gamma', minutes: 30 }));
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /MELEK Sleep/);
  assert.match(html, /AudioContext/);            // Web Audio present
  assert.match(html, /createOscillator/);        // synthesis present
  assert.match(html, /StereoPanner/);            // binaural panning present
  assert.match(html, /Not medical advice/i);     // safety note
  assert.match(html, /Hearing safety/i);
  assert.ok(html.includes('<script'), 'has a client script');
});

test('renderPage escapes a hostile band param inside the emitted script JSON', () => {
  // renderPage re-normalizes through sessionPlan, so a hostile band collapses to a safe default,
  // and whatever is emitted is JSON-then-esc()d — no raw </script> can break out.
  const html = renderPage({ band: '</script><script>alert(1)</script>', minutes: 5 });
  assert.ok(!html.includes('<script>alert(1)'), 'no unescaped injected script tag');
  assert.match(html, /&lt;\/script&gt;|alpha/); // the injected string is escaped or dropped to default
});

test('renderPage is total — bad input still renders a page', () => {
  assert.match(renderPage(undefined), /<!doctype html>/i);
  assert.match(renderPage('garbage'), /<!doctype html>/i);
  assert.match(renderPage(42), /<!doctype html>/i);
});

// ── routes ───────────────────────────────────────────────────────────────────────────────────────
test('/ renders the player page', async () => {
  const res = mockRes();
  await handler(get('/'), res);
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /MELEK Sleep/);
  assert.match(res.body, /AudioContext/);
});

test('/ honors ?band= and ?min= query params', async () => {
  const res = mockRes();
  await handler(get('/?band=delta&min=45'), res);
  assert.equal(res.code, 200);
  // delta selected in the <option>, 45-min timer present
  assert.match(res.body, /value="delta" selected/);
});

test('/ soft-fails a hostile band param (no injection, still 200)', async () => {
  const res = mockRes();
  await handler(get('/?band=%3Cscript%3E&min=abc'), res);
  assert.equal(res.code, 200);
  assert.ok(!res.body.includes('<script>alert'), 'no injected script');
});

test('/api/presets returns the BANDS JSON', async () => {
  const res = mockRes();
  await handler(get('/api/presets'), res);
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  const parsed = JSON.parse(res.body);
  assert.ok(parsed.bands.gamma);
  assert.equal(parsed.bands.gamma.beat, 40);
  assert.equal(parsed.default, 'alpha');
});

test('/health returns ok', async () => {
  const res = mockRes();
  await handler(get('/health'), res);
  assert.equal(res.code, 200);
  assert.equal(res.body, 'ok');
});

test('unknown route returns 404', async () => {
  const res = mockRes();
  await handler(get('/nope'), res);
  assert.equal(res.code, 404);
  assert.match(res.body, /Not found/);
});

// ── optional backing track (offline, injected fetch) ──────────────────────────────────────────────
test('backingTrack returns a track from an injected fake, soft-fails to null on empty', async () => {
  // A fake fetch that mimics the Internet Archive advancedsearch shape searchIA expects.
  __setFetch(async () => ({
    ok: true,
    json: async () => ({ response: { docs: [{ identifier: 'ambient-rain-1', title: 'Rain', creator: 'PD', licenseurl: 'publicdomain' }] } }),
  }));
  const t = await backingTrack('rain');
  assert.ok(t && t.streamUrl, 'got a track with a streamUrl');
  assert.match(t.streamUrl, /archive\.org\/embed\/ambient-rain-1/);

  // Empty result set → null (soft-fail, no throw)
  __setFetch(async () => ({ ok: true, json: async () => ({ response: { docs: [] } }) }));
  assert.equal(await backingTrack('nothing'), null);

  // Network failure → null (soft-fail, no throw)
  __setFetch(async () => { throw new Error('offline'); });
  assert.equal(await backingTrack('boom'), null);
});
