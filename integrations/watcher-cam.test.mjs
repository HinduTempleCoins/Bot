// watcher-cam.test.mjs — OFFLINE tests for the BYO-camera watcher (queue #172).
// Everything that does I/O (frame pull, Gemini call, notify) is injected, so these tests touch
// NO ffmpeg, NO network, NO keys. They cover the pure detectEvents alert logic and the watchOnce
// orchestration (notify fires only on a matching event).

import test from 'node:test';
import assert from 'node:assert/strict';
import { detectEvents, watchOnce, DEFAULT_RULES } from './watcher-cam.mjs';

// ── detectEvents (PURE) ───────────────────────────────────────────────────────

test('detectEvents: alerts on a person', () => {
  const d = detectEvents('A person is standing at the front door.');
  assert.equal(d.alert, true);
  assert.ok(d.matches.some((m) => m.event === 'person'));
  assert.equal(d.priority, 'medium');
});

test('detectEvents: alerts on a package delivery', () => {
  const d = detectEvents('A delivery left a package on the porch.');
  assert.equal(d.alert, true);
  const events = d.matches.map((m) => m.event);
  assert.ok(events.includes('package'));
});

test('detectEvents: alerts on glass break with high priority', () => {
  const d = detectEvents('Sound of glass breaking near the window.');
  assert.equal(d.alert, true);
  assert.ok(d.matches.some((m) => m.event === 'glass-break'));
  assert.equal(d.priority, 'high');
});

test('detectEvents: no alert on a quiet/empty scene', () => {
  const d = detectEvents('An empty driveway, nothing moving, calm.');
  assert.equal(d.alert, false);
  assert.deepEqual(d.matches, []);
  assert.equal(d.priority, null);
});

test('detectEvents: picks highest priority among multiple matches', () => {
  const d = detectEvents('A person near a car, and the sound of glass breaking.');
  assert.equal(d.alert, true);
  assert.equal(d.priority, 'high'); // glass-break outranks person/vehicle
});

test('detectEvents: case-insensitive and null-safe', () => {
  assert.equal(detectEvents('SMOKE AND FLAMES').alert, true);
  assert.equal(detectEvents(null).alert, false);
  assert.equal(detectEvents(undefined).alert, false);
  assert.equal(detectEvents('').alert, false);
});

test('detectEvents: honors custom rules', () => {
  const rules = [{ event: 'cat', keywords: ['cat', 'feline'], priority: 'low' }];
  const hit = detectEvents('a cat on the fence', rules);
  assert.equal(hit.alert, true);
  assert.equal(hit.matches[0].event, 'cat');
  const miss = detectEvents('a person at the door', rules);
  assert.equal(miss.alert, false); // default person rule not used
});

test('DEFAULT_RULES is a non-empty array of well-formed rules', () => {
  assert.ok(Array.isArray(DEFAULT_RULES) && DEFAULT_RULES.length > 0);
  for (const r of DEFAULT_RULES) {
    assert.equal(typeof r.event, 'string');
    assert.ok(Array.isArray(r.keywords) && r.keywords.length > 0);
  }
});

// ── watchOnce (orchestration, all collaborators injected) ─────────────────────

test('watchOnce: notifies when an event matches', async () => {
  const calls = [];
  const out = await watchOnce({
    frameSource: async () => Buffer.from('FAKEFRAME'),
    analyze: async (frame) => {
      assert.ok(Buffer.isBuffer(frame)); // frame passed through
      return { description: 'A person is at the gate.' };
    },
    notify: async (msg, ctx) => calls.push({ msg, ctx }),
  });
  assert.equal(out.alerted, true);
  assert.equal(out.description, 'A person is at the gate.');
  assert.equal(calls.length, 1);
  assert.match(calls[0].msg, /person/i);
  assert.equal(calls[0].ctx.decision.alert, true);
});

test('watchOnce: does NOT notify on a quiet scene', async () => {
  let notified = 0;
  const out = await watchOnce({
    frameSource: async () => 'base64frame',
    analyze: async () => 'Empty room, nothing happening.',
    notify: async () => { notified += 1; },
  });
  assert.equal(out.alerted, false);
  assert.equal(notified, 0);
  assert.equal(out.decision.alert, false);
});

test('watchOnce: accepts a bare-string analyze result', async () => {
  const out = await watchOnce({
    frameSource: async () => ({ data: 'x', mime: 'image/jpeg' }),
    analyze: async () => 'Smoke and flames visible.',
    notify: async () => {},
  });
  assert.equal(out.alerted, true);
  assert.match(out.message, /HIGH/);
});

test('watchOnce: never calls notify if none provided (no throw)', async () => {
  const out = await watchOnce({
    frameSource: async () => Buffer.from('f'),
    analyze: async () => 'A person walks by.',
    // notify omitted
  });
  assert.equal(out.alerted, false); // decision matched but no notifier to fire
  assert.equal(out.decision.alert, true);
});

test('watchOnce: validates injected functions', async () => {
  await assert.rejects(() => watchOnce({ analyze: async () => '' }), /frameSource/);
  await assert.rejects(() => watchOnce({ frameSource: async () => '' }), /analyze/);
});

test('watchOnce: uses custom rules end-to-end', async () => {
  const rules = [{ event: 'dog', keywords: ['dog'], priority: 'low' }];
  let fired = false;
  const out = await watchOnce({
    frameSource: async () => Buffer.from('f'),
    analyze: async () => 'A dog in the yard.',
    notify: async () => { fired = true; },
    rules,
  });
  assert.equal(out.alerted, true);
  assert.equal(fired, true);
  assert.equal(out.decision.matches[0].event, 'dog');
});
