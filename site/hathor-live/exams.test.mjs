import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXAMS, FRAMING, BROWSER_LIMITS, PERCEPTION, MIN_N_FOR_RANK,
  examById, assertNeverPayable, referenceClass, retestPair, examsIndexHTML, handler,
} from './exams.mjs';
import { isPayableKind } from '../../integrations/token-exams.mjs';
import {
  KEY_LENGTH, normalizeKey, isValidKey, formatKey, participantId, KEYGEN_JS,
} from './participant-key.mjs';
import {
  __setIO, readSittings, history, appendSitting, forget, completionCounts, distribution,
} from './exams-store.mjs';

// ── the payment boundary ──────────────────────────────────────────────────────────────────────────

test('every exam here is a perception exam, and perception is never payable', () => {
  for (const e of EXAMS) {
    assert.equal(e.kind, PERCEPTION);
    assert.equal(isPayableKind(e.kind), false, `${e.id} is payable`);
  }
  // The boundary is imported from token-exams, not restated here, so the two cannot drift apart.
  assert.equal(isPayableKind('knowledge'), true);
});

test('assertNeverPayable throws on a reward, a tier or a rank', () => {
  assert.throws(() => assertNeverPayable([{ id: 'x', kind: PERCEPTION, reward: 5 }]), /reward, tier or rank/);
  assert.throws(() => assertNeverPayable([{ id: 'x', kind: PERCEPTION, tier: 'gold' }]), /reward, tier or rank/);
  assert.throws(() => assertNeverPayable([{ id: 'x', kind: 'knowledge' }]), /must be 'perception'/);
});

test('no exam carries a verdict phrasing, and each declares what it will never say', () => {
  for (const e of EXAMS) {
    assert.ok(e.neverSay, `${e.id} has no neverSay`);
    assert.ok(Array.isArray(e.citations) && e.citations.length, `${e.id} has no citations`);
    assert.ok(Number.isFinite(e.retestDays), `${e.id} has no scheduled retest`);
  }
  assert.ok(EXAMS.some((e) => /aphantasia/i.test(e.neverSay)));
  assert.ok(EXAMS.some((e) => /synaesthesia/i.test(e.neverSay)));
});

// ── honest reporting ──────────────────────────────────────────────────────────────────────────────

test('below the minimum n there is no rank at all, only the score and the count', () => {
  const s = referenceClass(12);
  assert.match(s, /too few to place you/);
  assert.ok(!/%/.test(s));
  assert.match(referenceClass(MIN_N_FOR_RANK), /not a random sample/);
  assert.match(referenceClass(MIN_N_FOR_RANK), /not your rank in the general population/);
});

test('one administration is a reading, not a finding', () => {
  const one = retestPair(19, null);
  assert.equal(one.ok, false);
  assert.match(one.text, /second sitting is part of the instrument/);
});

test('a retest pair refuses to call a difference significant without a measured SEM', () => {
  const pair = retestPair(19, 26, { unit: '' });
  assert.equal(pair.ok, true);
  assert.equal(pair.diff, 7);
  assert.match(pair.text, /we do not have enough of them yet/);
  const withSem = retestPair(19, 26, { sem: 2 });
  assert.match(withSem.text, /larger than/);
  assert.match(retestPair(19, 21, { sem: 2 }).text, /sits inside/);
});

// ── the page ──────────────────────────────────────────────────────────────────────────────────────

test('the index states the browser limits on the page, not in a comment', () => {
  const html = examsIndexHTML({ counts: { vviq: 3 } });
  for (const l of BROWSER_LIMITS) assert.ok(html.includes(l.limit), `${l.id} missing`);
  for (const f of FRAMING) assert.ok(html.includes(f.rule), `${f.id} missing`);
  assert.match(html, /never a diagnosis|Not diagnoses/);
  assert.match(html, /no account, no name, no email|There is no account, no name/i);
  assert.match(html, /Nothing here goes on the chain/);
  assert.match(html, /Nothing here pays anything/);
});

test('the index does not promise a deletion it cannot perform', () => {
  const html = examsIndexHTML();
  assert.match(html, /If you lose it we cannot delete your entries/);
});

test('handler serves the framing as JSON and says perception is not payable', () => {
  let body = '';
  handler({}, { setHeader() {}, end(b) { body = b; } });
  const d = JSON.parse(body);
  assert.equal(d.payable, false);
  assert.equal(d.onChain, false);
  assert.equal(d.exams.length, EXAMS.length);
});

test('examById is case-insensitive and returns null rather than throwing', () => {
  assert.equal(examById('VVIQ').id, 'vviq');
  assert.equal(examById('nope'), null);
  assert.equal(examById(null), null);
});

// ── the participant key ───────────────────────────────────────────────────────────────────────────

test('the key alphabet folds the glyphs people misread off paper', () => {
  assert.equal(normalizeKey('o0 Il1 uU'), '00111VV');
  assert.equal(normalizeKey('  ab-cd  '), 'ABCD');
  assert.equal(normalizeKey(null), '');
});

test('a key is 25 symbols and formats into five readable groups', () => {
  const k = '0123456789ABCDEFGHJKMNPQR'.slice(0, KEY_LENGTH);
  assert.equal(k.length, 25);
  assert.equal(isValidKey(k), true);
  assert.equal(formatKey(k), '01234-56789-ABCDE-FGHJK-MNPQR');
  assert.equal(isValidKey('short'), false);
});

test('participantId is one-way, stable, and refuses anything that is not a key', () => {
  const k = '0123456789ABCDEFGHJKMNPQR';
  const id = participantId(k);
  assert.equal(id.length, 64);
  assert.equal(participantId(k), id, 'not stable');
  assert.equal(participantId(k.toLowerCase().replace(/0/g, 'O')), id, 'normalisation must reach the hash');
  assert.notEqual(id.toUpperCase(), k, 'the id must not be the key');
  assert.ok(!id.includes(k));
  assert.equal(participantId('nope'), '');
  assert.equal(participantId(''), '');
});

test('two different keys do not collide', () => {
  assert.notEqual(participantId('0123456789ABCDEFGHJKMNPQR'), participantId('0123456789ABCDEFGHJKMNPQS'));
});

test('the browser keygen never sends the key anywhere', () => {
  assert.ok(!/fetch|XMLHttpRequest|sendBeacon|WebSocket|http/i.test(KEYGEN_JS));
  assert.match(KEYGEN_JS, /getRandomValues/);
  assert.match(KEYGEN_JS, /localStorage/);
});

// ── the store ─────────────────────────────────────────────────────────────────────────────────────

function memIO() {
  let buf = '';
  return { read: () => buf, append: (_p, line) => { buf += line; return true; }, dump: () => buf };
}

test('sittings are numbered per participant per exam, with days since the first', () => {
  const mem = memIO();
  __setIO(mem);
  const pid = 'a'.repeat(64);
  const a = appendSitting({ pid, exam: 'vviq', score: { total: 19 } }, { now: () => new Date('2026-09-01T10:00:00Z') });
  const b = appendSitting({ pid, exam: 'vviq', score: { total: 24 } }, { now: () => new Date('2026-09-16T10:00:00Z') });
  assert.equal(a.sitting.sessionNumber, 1);
  assert.equal(a.sitting.daysSinceFirst, 0);
  assert.equal(b.sitting.sessionNumber, 2);
  assert.equal(b.sitting.daysSinceFirst, 15);
  assert.equal(history(pid, 'vviq').length, 2);
  __setIO(null);
});

test('forget removes a participant from every read path, by appending not rewriting', () => {
  const mem = memIO();
  __setIO(mem);
  const mine = 'a'.repeat(64);
  const theirs = 'b'.repeat(64);
  appendSitting({ pid: mine, exam: 'vviq', score: { total: 19 } });
  appendSitting({ pid: theirs, exam: 'vviq', score: { total: 70 } });
  assert.equal(readSittings().length, 2);
  assert.equal(forget(mine), true);
  const left = readSittings();
  assert.equal(left.length, 1);
  assert.equal(left[0].pid, theirs);
  // history is preserved on disk as an append — nothing was rewritten under a concurrent reader
  assert.ok(mem.dump().includes('"tombstone":true'));
  __setIO(null);
});

test('completion counts count people, not sittings', () => {
  __setIO(memIO());
  const pid = 'c'.repeat(64);
  appendSitting({ pid, exam: 'vviq', score: { total: 19 } });
  appendSitting({ pid, exam: 'vviq', score: { total: 20 } });
  appendSitting({ pid: 'd'.repeat(64), exam: 'vviq', score: { total: 60 } });
  assert.deepEqual(completionCounts(), { vviq: 2 });
  __setIO(null);
});

test('the distribution uses first sittings only, so repeats do not stack', () => {
  __setIO(memIO());
  const pid = 'e'.repeat(64);
  appendSitting({ pid, exam: 'vviq', score: { total: 19 } }, { now: () => new Date('2026-09-01T00:00:00Z') });
  appendSitting({ pid, exam: 'vviq', score: { total: 55 } }, { now: () => new Date('2026-09-20T00:00:00Z') });
  appendSitting({ pid: 'f'.repeat(64), exam: 'vviq', score: { total: 40 } }, { now: () => new Date('2026-09-02T00:00:00Z') });
  assert.deepEqual(distribution('vviq', 'total'), [19, 40]);
  __setIO(null);
});

test('a sitting with no participant id is refused, never stored anonymously', () => {
  __setIO(memIO());
  assert.equal(appendSitting({ exam: 'vviq' }).ok, false);
  assert.equal(appendSitting({ pid: 'x' }).ok, false);
  __setIO(null);
});

test('a write that did not reach the disk reports failure, so nothing claims it was received', () => {
  __setIO({ read: () => '', append: () => false });
  const out = appendSitting({ pid: 'g'.repeat(64), exam: 'vviq' });
  assert.equal(out.ok, false);
  assert.match(out.reason, /nothing was saved/);
  __setIO(null);
});

test('a torn line loses one sitting, not the file', () => {
  __setIO({ read: () => '{"pid":"a","exam":"vviq"}\n{not json\n{"pid":"b","exam":"vviq"}\n', append: () => true });
  assert.equal(readSittings().length, 2);
  __setIO(null);
});

test('every registered exam has a route, and the index links all of them', () => {
  const html = examsIndexHTML();
  for (const e of EXAMS) {
    assert.match(e.route, /^\/exams\//, `${e.id} has no /exams route`);
    assert.ok(html.includes(`href="${e.route}"`), `${e.id} is not linked from the index`);
  }
});

// The operator asked for "Consult Your Doctor … on Every Page or as Often as Possible." Pasting it into
// each page would work until somebody adds exam number six. It lives in examShell() instead, so a new
// exam cannot ship without it, and this test is what makes that true rather than merely intended.
test('⭐ every page built on examShell carries the consult referral — a new exam cannot omit it', async () => {
  const { examShell } = await import('./exams.mjs');
  const html = examShell('Anything', '<h1>Anything</h1>');
  assert.match(html, /Consult your doctor/, 'the shell dropped the referral');
  assert.match(html, /not a laboratory result/, 'the shell dropped the not-a-lab line');
});

test('the referral is above the content, not buried at the bottom', async () => {
  const { examShell } = await import('./exams.mjs');
  const html = examShell('T', '<h1>MARKER</h1>');
  assert.ok(html.indexOf('Consult your doctor') < html.indexOf('MARKER'),
    'a disclaimer under the fold is a disclaimer nobody reads');
});

test('the footer repeats the referral, so it is present at the decision point too', async () => {
  const { examShell } = await import('./exams.mjs');
  const html = examShell('T', '<p>x</p>');
  const foot = html.slice(html.indexOf('<footer'));
  assert.match(foot, /Consult your doctor/);
});
