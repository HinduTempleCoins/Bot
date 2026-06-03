// conference-monitor.test.mjs — offline tests for the 12-and-12 conference health monitor (task #29).
// node:test, fully deterministic: every case injects a fixed clock and an in-memory history/artifact
// source via __setSource. No disk, no network, no real time.
//
//   node --test integrations/conference-monitor.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import monitor, {
  CONFERENCE_HOURS_UTC,
  DEFAULT_GRACE_MS,
  DEFAULT_MAX_AGE_MS,
  expectedLastConference,
  nextConference,
  verifyConference,
  verifyArtifacts,
  healthBlock,
  checkHealth,
  __setSource,
} from './conference-monitor.mjs';

const HOUR = 60 * 60 * 1000;
const utc = (y, mo, d, h, mi = 0) => Date.UTC(y, mo, d, h, mi, 0, 0);

// ── cadence constant ───────────────────────────────────────────────────────────────────────────
test('cadence is twice daily at UTC 06:00 and 18:00', () => {
  assert.deepEqual(CONFERENCE_HOURS_UTC, [6, 18]);
});

// ── expectedLastConference ─────────────────────────────────────────────────────────────────────
test('expectedLastConference picks the 06:00 slot in the morning', () => {
  // 2026-06-03 09:30 UTC → most recent slot is 06:00 today
  const now = utc(2026, 5, 3, 9, 30);
  assert.equal(expectedLastConference(now), utc(2026, 5, 3, 6, 0));
});

test('expectedLastConference picks the 18:00 slot in the evening', () => {
  // 2026-06-03 20:00 UTC → most recent slot is 18:00 today
  const now = utc(2026, 5, 3, 20, 0);
  assert.equal(expectedLastConference(now), utc(2026, 5, 3, 18, 0));
});

test('expectedLastConference rolls back to yesterday 18:00 before the morning slot', () => {
  // 2026-06-03 03:00 UTC → before 06:00, so the most recent slot is yesterday 18:00
  const now = utc(2026, 5, 3, 3, 0);
  assert.equal(expectedLastConference(now), utc(2026, 5, 2, 18, 0));
});

// ── nextConference ─────────────────────────────────────────────────────────────────────────────
test('nextConference computes the upcoming slot (morning → 18:00 today)', () => {
  const now = utc(2026, 5, 3, 9, 30);
  assert.equal(nextConference(now), utc(2026, 5, 3, 18, 0));
});

test('nextConference rolls to tomorrow 06:00 after the evening slot', () => {
  const now = utc(2026, 5, 3, 20, 0);
  assert.equal(nextConference(now), utc(2026, 5, 4, 6, 0));
});

// ── verifyConference: ok ───────────────────────────────────────────────────────────────────────
test('verifyConference ok when a run landed within grace of the expected slot', () => {
  const now = utc(2026, 5, 3, 7, 0);            // 07:00, expected slot 06:00
  const history = [
    { at: utc(2026, 5, 2, 18, 30), ok: true },  // yesterday evening
    { at: utc(2026, 5, 3, 6, 20), ok: true },   // this morning, 20m after the 06:00 slot
  ];
  const r = verifyConference(history, { now });
  assert.equal(r.ok, true);
  assert.equal(r.missed, false);
  assert.equal(r.stale, false);
  assert.equal(r.expected, utc(2026, 5, 3, 6, 0));
  assert.equal(r.lastRun, utc(2026, 5, 3, 6, 20));
  assert.equal(r.runs, 2);
});

// ── verifyConference: missed ───────────────────────────────────────────────────────────────────
test('verifyConference missed when no run on record at all', () => {
  const now = utc(2026, 5, 3, 9, 0);
  const r = verifyConference([], { now });
  assert.equal(r.ok, false);
  assert.equal(r.missed, true);
  assert.equal(r.stale, true);
  assert.equal(r.lastRun, null);
  assert.equal(r.runs, 0);
  assert.match(r.reason, /never/i);
});

test('verifyConference missed when the expected slot has not run and grace elapsed', () => {
  // 06:00 slot expected; now is 06:00 + 4h (past the 3h default grace); last run was yesterday evening.
  const now = utc(2026, 5, 3, 10, 0);
  const history = [{ at: utc(2026, 5, 2, 18, 10), ok: true }];
  const r = verifyConference(history, { now });
  assert.equal(r.missed, true);
  assert.equal(r.ok, false);
  assert.equal(r.expected, utc(2026, 5, 3, 6, 0));
});

test('verifyConference NOT missed inside the grace window even if the slot run is slightly late', () => {
  // now is 06:00 + 2h, within the 3h grace, and no run yet this cycle → not yet missed.
  const now = utc(2026, 5, 3, 8, 0);
  const history = [{ at: utc(2026, 5, 2, 18, 5), ok: true }];
  const r = verifyConference(history, { now });
  assert.equal(r.missed, false);
});

// ── verifyConference: stale ────────────────────────────────────────────────────────────────────
test('verifyConference stale when the latest run is older than a window + grace', () => {
  // last run was ~20h ago — older than DEFAULT_MAX_AGE_MS (~15h). A run DID cover an earlier expected
  // slot relative to its own time, but relative to now everything is old.
  const now = utc(2026, 5, 3, 18, 30);          // expected slot 18:00 today
  const history = [{ at: utc(2026, 5, 2, 22, 0), ok: true }]; // 20.5h ago
  const r = verifyConference(history, { now });
  assert.equal(r.stale, true);
  assert.equal(r.ok, false);
  assert.ok(r.gapMs > DEFAULT_MAX_AGE_MS);
});

test('verifyConference stale when the latest run is marked failed', () => {
  const now = utc(2026, 5, 3, 6, 30);
  const history = [{ at: utc(2026, 5, 3, 6, 10), ok: false }]; // ran on time but FAILED
  const r = verifyConference(history, { now });
  assert.equal(r.stale, true);
  assert.equal(r.missed, false);
  assert.equal(r.ok, false);
  assert.match(r.reason, /fail/i);
});

// ── verifyArtifacts ────────────────────────────────────────────────────────────────────────────
test('verifyArtifacts ok with a fresh annal and brief', () => {
  const now = utc(2026, 5, 3, 7, 0);
  const r = verifyArtifacts(
    { annals: utc(2026, 5, 3, 6, 15), briefs: { at: utc(2026, 5, 3, 6, 20) } },
    { now },
  );
  assert.equal(r.ok, true);
  assert.equal(r.annal.fresh, true);
  assert.equal(r.brief.fresh, true);
});

test('verifyArtifacts flags a missing fresh brief', () => {
  const now = utc(2026, 5, 3, 7, 0);
  const r = verifyArtifacts(
    { annals: utc(2026, 5, 3, 6, 15), briefs: null },  // annal fresh, NO brief
    { now },
  );
  assert.equal(r.ok, false);
  assert.equal(r.annal.fresh, true);
  assert.equal(r.brief.present, false);
  assert.match(r.reason, /no brief/i);
});

test('verifyArtifacts flags a stale (old) brief', () => {
  const now = utc(2026, 5, 3, 18, 0);
  const r = verifyArtifacts(
    { annals: utc(2026, 5, 3, 17, 50), briefs: utc(2026, 5, 2, 6, 0) }, // brief ~36h old
    { now },
  );
  assert.equal(r.ok, false);
  assert.equal(r.brief.fresh, false);
  assert.match(r.reason, /brief is .*stale/i);
});

test('verifyArtifacts picks the newest from an array of artifacts', () => {
  const now = utc(2026, 5, 3, 7, 0);
  const r = verifyArtifacts(
    {
      annals: [utc(2026, 5, 1, 6, 0), utc(2026, 5, 3, 6, 10)],  // newest is fresh
      briefs: [utc(2026, 5, 3, 6, 5)],
    },
    { now },
  );
  assert.equal(r.ok, true);
  assert.equal(r.annal.at, utc(2026, 5, 3, 6, 10));
});

// ── healthBlock render ─────────────────────────────────────────────────────────────────────────
test('healthBlock renders the ran status with the cadence', () => {
  const now = utc(2026, 5, 3, 7, 0);
  const r = verifyConference([{ at: utc(2026, 5, 3, 6, 20), ok: true }], { now });
  const md = healthBlock(r);
  assert.match(md, /### 12-and-12 health/);
  assert.match(md, /✅/);
  assert.match(md, /Conference: ran/);
  assert.match(md, /06:00 \+ 18:00/);
});

test('healthBlock renders the missed status with a warning icon', () => {
  const md = healthBlock(verifyConference([], { now: utc(2026, 5, 3, 9, 0) }));
  assert.match(md, /⚠/);
  assert.match(md, /Conference: MISSED/);
});

test('healthBlock renders the stale status', () => {
  const now = utc(2026, 5, 3, 18, 30);
  const r = verifyConference([{ at: utc(2026, 5, 2, 22, 0), ok: true }], { now });
  const md = healthBlock(r);
  assert.match(md, /Conference: STALE/);
});

test('healthBlock appends an output line when artifacts are attached', () => {
  const now = utc(2026, 5, 3, 7, 0);
  const r = verifyConference([{ at: utc(2026, 5, 3, 6, 20), ok: true }], { now });
  r.artifacts = verifyArtifacts({ annals: null, briefs: null }, { now });
  const md = healthBlock(r);
  assert.match(md, /output:/);
});

// ── checkHealth with injected source (offline) ──────────────────────────────────────────────────
test('checkHealth pulls from the injected source and attaches artifacts', () => {
  const now = utc(2026, 5, 3, 7, 0);
  __setSource(() => ({
    history: [{ at: utc(2026, 5, 3, 6, 20), ok: true }],
    annals: utc(2026, 5, 3, 6, 21),
    briefs: utc(2026, 5, 3, 6, 22),
  }));
  const r = checkHealth({ now });
  assert.equal(r.ok, true);
  assert.equal(r.missed, false);
  assert.ok(r.artifacts);
  assert.equal(r.artifacts.ok, true);
  __setSource(null); // restore default
});

test('checkHealth soft-fails to a missed result when the source throws', () => {
  __setSource(() => { throw new Error('boom'); });
  const r = checkHealth({ now: utc(2026, 5, 3, 9, 0) });
  assert.equal(r.missed, true);
  assert.equal(r.ok, false);
  __setSource(null);
});

// ── default export surface ───────────────────────────────────────────────────────────────────────
test('default export exposes the public API', () => {
  for (const k of ['expectedLastConference', 'nextConference', 'verifyConference', 'verifyArtifacts', 'healthBlock', 'checkHealth', '__setSource']) {
    assert.equal(typeof monitor[k], 'function', `missing ${k}`);
  }
  assert.ok(DEFAULT_GRACE_MS > 0 && DEFAULT_MAX_AGE_MS > 0);
});
