// flag-bridge.test.mjs — OFFLINE. node:test + node:assert/strict.
// Covers: KIND_MAP fidelity vs flag-pipe's real KINDS, toFlagPipe() mapping (category vs coarse,
// severity, gated/csam, illegal narrowing), unknown-kind handling (skip with reason), and
// importLegacy() into BOTH a fake pipe and the REAL flag-pipe (dedupe-aware).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  toFlagPipe, importLegacy, KIND_MAP, PIPE_KINDS, esc, __setReader,
} from './flag-bridge.mjs';

import * as flagPipe from './flag-pipe.mjs';

// ── a legacy flag looks like a moderation-flags report (optionally w/ flag-taxonomy context) ──
const legacy = (over = {}) => ({
  id: 'mod_x',
  target: '@bob/post',
  kind: 'other',
  reason: 'a reason',
  reporter: 'alice',
  status: 'open',
  raisedAt: '2026-06-11T00:00:00.000Z',
  ...over,
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  KIND_MAP fidelity
// ════════════════════════════════════════════════════════════════════════════════════════════════

test('PIPE_KINDS mirrors flag-pipe.KINDS exactly', () => {
  assert.deepEqual([...PIPE_KINDS].sort(), [...flagPipe.KINDS].sort());
});

test('every non-null KIND_MAP target is a real flag-pipe KIND', () => {
  const set = new Set(flagPipe.KINDS);
  for (const [legacyKind, pipeKind] of Object.entries(KIND_MAP)) {
    if (pipeKind == null) continue;
    assert.ok(set.has(pipeKind), `${legacyKind} → ${pipeKind} is not a real KIND`);
  }
});

test('KIND_MAP covers every flag-taxonomy category key', async () => {
  const tax = await import('./flag-taxonomy.mjs');
  for (const c of tax.TAXONOMY) {
    assert.ok(c.key in KIND_MAP, `taxonomy category ${c.key} missing from KIND_MAP`);
  }
});

test('KIND_MAP covers every moderation-flags REPORT_KIND', async () => {
  const mod = await import('./moderation-flags.mjs');
  for (const k of mod.REPORT_KINDS) {
    assert.ok(k in KIND_MAP, `REPORT_KIND ${k} missing from KIND_MAP`);
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  toFlagPipe() — mapping
// ════════════════════════════════════════════════════════════════════════════════════════════════

test('fine-grained taxonomy category is preferred over the coarse kind', () => {
  // coarse 'abuse' would map to harassment, but category 'hate' should win (also harassment here) —
  // use a clearer divergence: coarse 'illegal', category 'csam' → csam (illegal alone is unmappable).
  const r = toFlagPipe(legacy({ kind: 'illegal', context: { category: 'csam', severity: 5, gated: true } }));
  assert.equal(r.skip, undefined);
  assert.equal(r.kind, 'csam');
  assert.equal(r.severity, 5);
});

test('scam-fraud taxonomy key maps to pipe scam', () => {
  const r = toFlagPipe(legacy({ kind: 'scam', context: { category: 'scam-fraud', severity: 4 } }));
  assert.equal(r.kind, 'scam');
  assert.equal(r.severity, 4);
});

test('harassment-toxicity and hate both map to harassment', () => {
  assert.equal(toFlagPipe(legacy({ kind: 'abuse', context: { category: 'harassment-toxicity' } })).kind, 'harassment');
  assert.equal(toFlagPipe(legacy({ kind: 'abuse', context: { category: 'hate' } })).kind, 'harassment');
});

test('bot-sybil maps to sybil; doxxing-pii maps to doxxing; copyright-dmca maps to image-theft', () => {
  assert.equal(toFlagPipe(legacy({ context: { category: 'bot-sybil' } })).kind, 'sybil');
  assert.equal(toFlagPipe(legacy({ context: { category: 'doxxing-pii' } })).kind, 'doxxing');
  assert.equal(toFlagPipe(legacy({ kind: 'illegal', context: { category: 'copyright-dmca' } })).kind, 'image-theft');
});

test('coarse kind maps when no taxonomy category is present', () => {
  assert.equal(toFlagPipe(legacy({ kind: 'spam' })).kind, 'spam');
  assert.equal(toFlagPipe(legacy({ kind: 'scam' })).kind, 'scam');
  assert.equal(toFlagPipe(legacy({ kind: 'abuse' })).kind, 'harassment');
  assert.equal(toFlagPipe(legacy({ kind: 'impersonation' })).kind, 'impersonation');
});

test('context can be a JSON string (as moderation-flags stores it)', () => {
  const r = toFlagPipe(legacy({ kind: 'other', context: JSON.stringify({ category: 'misinformation', severity: 2 }) }));
  assert.equal(r.kind, 'misinformation');
  assert.equal(r.severity, 2);
});

test('severity falls back to the pipe default when legacy carries none', () => {
  const r = toFlagPipe(legacy({ kind: 'scam' })); // scam default = 4
  assert.equal(r.severity, 4);
  const r2 = toFlagPipe(legacy({ context: { category: 'plagiarism' } })); // plagiarism default = 2
  assert.equal(r2.severity, 2);
});

test('severity is clamped to 1..5', () => {
  assert.equal(toFlagPipe(legacy({ kind: 'spam', context: { category: 'spam', severity: 99 } })).severity, 5);
  assert.equal(toFlagPipe(legacy({ kind: 'spam', context: { category: 'spam', severity: -3 } })).severity, 1);
});

test('evidence carries the legacy reason + provenance note', () => {
  const r = toFlagPipe(legacy({ kind: 'spam', reason: 'flooded the feed', context: { category: 'spam', action: 'queue-for-review' } }));
  assert.match(r.evidence, /flooded the feed/);
  assert.match(r.evidence, /bridged from legacy/);
  assert.match(r.evidence, /mod_x/);
  assert.match(r.evidence, /queue-for-review/);
});

test('original timing is preserved as `at`', () => {
  const r = toFlagPipe(legacy({ kind: 'spam', raisedAt: '2026-01-02T03:04:05.000Z' }));
  assert.equal(r.at, '2026-01-02T03:04:05.000Z');
});

test('a flag that is already a pipe KIND directly maps through', () => {
  const r = toFlagPipe(legacy({ kind: 'plagiarism' })); // not a REPORT_KIND, but a direct pipe KIND
  assert.equal(r.kind, 'plagiarism');
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  toFlagPipe() — edge / unknown handling
// ════════════════════════════════════════════════════════════════════════════════════════════════

test('null / non-object input is skipped, never throws', () => {
  assert.equal(toFlagPipe(null).skip, true);
  assert.equal(toFlagPipe(undefined).skip, true);
  assert.equal(toFlagPipe(42).skip, true);
});

test('missing target is skipped with reason', () => {
  const r = toFlagPipe(legacy({ target: '' }));
  assert.equal(r.skip, true);
  assert.equal(r.reason, 'missing-target');
});

test("coarse 'other' with no category is skipped (no harm signal)", () => {
  const r = toFlagPipe(legacy({ kind: 'other' }));
  assert.equal(r.skip, true);
  assert.match(r.reason, /unmappable-kind:other/);
});

test("coarse 'illegal' with no narrowing context is skipped", () => {
  const r = toFlagPipe(legacy({ kind: 'illegal' }));
  assert.equal(r.skip, true);
  assert.match(r.reason, /unmappable-kind:illegal/);
});

test('an entirely unknown legacy kind is skipped, not mislabeled', () => {
  const r = toFlagPipe(legacy({ kind: 'frobnicate', context: { category: 'wibble' } }));
  assert.equal(r.skip, true);
  assert.match(r.reason, /unmappable-kind/);
});

test('skip results still carry legacy provenance', () => {
  const r = toFlagPipe(legacy({ kind: 'other', id: 'mod_keepme' }));
  assert.equal(r.skip, true);
  assert.equal(r._legacy.id, 'mod_keepme');
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  importLegacy() — into a FAKE pipe
// ════════════════════════════════════════════════════════════════════════════════════════════════

function fakePipe() {
  const filed = [];
  const open = new Map(); // dedupe key (target|kind) → flag, mimicking flag-pipe's open-dup behavior
  return {
    filed,
    fileFlag(args) {
      const key = `${args.target}|${args.kind}`;
      if (open.has(key)) return { flag: open.get(key), deduped: true };
      const flag = { id: `f${filed.length}`, ...args, status: 'pending' };
      filed.push(flag);
      open.set(key, flag);
      return { flag, deduped: false };
    },
  };
}

test('importLegacy files mappable flags and skips unmappable ones', () => {
  const pipe = fakePipe();
  const res = importLegacy([
    legacy({ id: 'a', kind: 'spam', context: { category: 'spam' } }),
    legacy({ id: 'b', kind: 'other' }),                                   // unmappable → skip
    legacy({ id: 'c', kind: 'illegal', context: { category: 'csam' } }), // → csam
  ], pipe);

  assert.equal(res.imported, 2);
  assert.equal(res.skipped, 1);
  assert.equal(res.failed, 0);
  assert.equal(pipe.filed.length, 2);
  assert.deepEqual(pipe.filed.map((f) => f.kind).sort(), ['csam', 'spam']);
});

test('importLegacy is dedupe-aware: re-importing the same flags dedupes', () => {
  const pipe = fakePipe();
  const flags = [legacy({ id: 'a', kind: 'spam', context: { category: 'spam' } })];
  const first = importLegacy(flags, pipe);
  const second = importLegacy(flags, pipe);
  assert.equal(first.imported, 1);
  assert.equal(second.imported, 0);
  assert.equal(second.deduped, 1);
  assert.equal(pipe.filed.length, 1);
});

test('importLegacy soft-fails when given no valid pipe', () => {
  const res = importLegacy([legacy({ kind: 'spam' })], null);
  assert.equal(res.failed, 1);
  assert.equal(res.results[0].reason, 'no-flag-pipe');
});

test('importLegacy soft-fails a fileFlag that throws (one bad flag does not sink the batch)', () => {
  const pipe = {
    n: 0,
    fileFlag(args) {
      this.n += 1;
      if (this.n === 1) throw new Error('boom');
      return { flag: { id: 'ok', ...args }, deduped: false };
    },
  };
  const res = importLegacy([
    legacy({ id: 'a', kind: 'spam', context: { category: 'spam' } }),
    legacy({ id: 'b', kind: 'scam', context: { category: 'scam-fraud' } }),
  ], pipe);
  assert.equal(res.failed, 1);
  assert.equal(res.imported, 1);
  assert.match(res.results[0].reason, /file-threw/);
});

test('importLegacy counts a fileFlag error-result as failed', () => {
  const pipe = { fileFlag: () => ({ flag: null, error: 'store-write-failed' }) };
  const res = importLegacy([legacy({ kind: 'spam', context: { category: 'spam' } })], pipe);
  assert.equal(res.failed, 1);
  assert.equal(res.results[0].reason, 'store-write-failed');
});

test('importLegacy uses the injected reader when no list is passed', () => {
  const pipe = fakePipe();
  __setReader(() => [legacy({ id: 'r', kind: 'spam', context: { category: 'spam' } })]);
  const res = importLegacy(undefined, pipe);
  assert.equal(res.imported, 1);
  __setReader(() => []); // reset
});

test('importLegacy with empty/no source returns a zeroed summary', () => {
  __setReader(() => []);
  const res = importLegacy(undefined, fakePipe());
  assert.deepEqual({ i: res.imported, d: res.deduped, s: res.skipped, f: res.failed }, { i: 0, d: 0, s: 0, f: 0 });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  importLegacy() — into the REAL flag-pipe (in-memory store, fully offline)
// ════════════════════════════════════════════════════════════════════════════════════════════════

test('importLegacy files into the REAL flag-pipe and the queue reflects it', () => {
  const store = flagPipe.memoryStore();
  let n = 0;
  flagPipe.__setIdGen(() => `flag_real_${n++}`);

  const res = importLegacy([
    legacy({ id: 'a', target: '@bob/p1', kind: 'spam', context: { category: 'spam', severity: 2 } }),
    legacy({ id: 'b', target: '@eve/p2', kind: 'illegal', context: { category: 'csam', severity: 5, gated: true } }),
    legacy({ id: 'c', target: '@x/p3', kind: 'other' }), // skipped
  ], flagPipe, { store });

  assert.equal(res.imported, 2);
  assert.equal(res.skipped, 1);
  assert.equal(res.failed, 0);

  const q = flagPipe.reviewQueue({ status: 'pending' }, { store });
  assert.equal(q.length, 2);
  // csam (sev 5) sorts ahead of spam (sev 2)
  assert.equal(q[0].kind, 'csam');
  assert.equal(q[0].gated, true);
  // flag-pipe force-redacts gated evidence — our reason must NOT have leaked through verbatim.
  assert.match(q[0].evidence, /GATED\(csam\)/);
  assert.equal(q[1].kind, 'spam');
});

test('re-import into the REAL flag-pipe dedupes on (target,kind)', () => {
  const store = flagPipe.memoryStore();
  let n = 0;
  flagPipe.__setIdGen(() => `flag_dd_${n++}`);
  const flags = [legacy({ id: 'a', target: '@bob/p', kind: 'spam', context: { category: 'spam' } })];

  const first = importLegacy(flags, flagPipe, { store });
  const second = importLegacy(flags, flagPipe, { store });

  assert.equal(first.imported, 1);
  assert.equal(second.imported, 0);
  assert.equal(second.deduped, 1);
  assert.equal(flagPipe.reviewQueue({ status: 'pending' }, { store }).length, 1);
});

// ── esc() ──
test('esc() escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
});
