import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rankSubjectVariants, pickSubject, scoreVariant,
  optimalSendHour, nextSendAt, recordOutcome, DEFAULT_HOUR,
} from './send-optimizer.mjs';

test('unsent variants are explored first (UCB bonus)', () => {
  const ranked = rankSubjectVariants([
    { id: 'a', text: 'Proven winner', sent: 100, opens: 30 }, // 30% but well-explored
    { id: 'b', text: 'Untried', sent: 0, opens: 0 },          // unknown → explore
  ]);
  assert.equal(ranked[0].id, 'b', 'the untried subject is tried first');
});

test('with enough data, the higher open-rate wins', () => {
  const ranked = rankSubjectVariants([
    { id: 'a', text: 'Meh', sent: 200, opens: 20 },   // 10%
    { id: 'b', text: 'Great', sent: 200, opens: 80 },  // 40%
  ]);
  assert.equal(ranked[0].id, 'b');
  assert.ok(ranked[0].openRate > ranked[1].openRate);
});

test('pickSubject returns the top variant; null when empty', () => {
  assert.equal(pickSubject([{ id: 'x', text: 'Hi', sent: 10, opens: 5 }]).id, 'x');
  assert.equal(pickSubject([]), null);
});

test('scoreVariant clamps opens to sent and never throws on junk', () => {
  const s = scoreVariant({ sent: 5, opens: 999 }, 5);
  assert.ok(s.openRate <= 1);
  assert.doesNotThrow(() => scoreVariant(null, 0));
});

test('optimalSendHour falls back to default with <3 samples', () => {
  assert.equal(optimalSendHour([]).hour, DEFAULT_HOUR);
  assert.equal(optimalSendHour([1, 2]).samples, 2);
});

test('optimalSendHour finds the modal open hour', () => {
  // three opens at 14:00 UTC, one at 09:00 → best hour 14
  const h14 = Date.UTC(2026, 0, 1, 14) ;
  const r = optimalSendHour([h14, h14 + 86400000, h14 + 2 * 86400000, Date.UTC(2026, 0, 1, 9)]);
  assert.equal(r.hour, 14);
  assert.ok(r.confidence > 0.5);
});

test('nextSendAt returns a future time on a preferred day/hour', () => {
  const from = Date.UTC(2026, 0, 1, 0); // Thu Jan 1 2026 00:00 UTC
  const at = nextSendAt(from, { dows: [4], tzOffsetMinutes: 0 }); // Thursday only, default hour 10
  assert.ok(at > from);
  const d = new Date(at);
  assert.equal(d.getUTCDay(), 4);
  assert.equal(d.getUTCHours(), DEFAULT_HOUR);
});

test('recordOutcome increments immutably', () => {
  const v0 = { id: 'a', text: 'Hi', sent: 2, opens: 1 };
  const v1 = recordOutcome(v0, { opened: true });
  assert.equal(v1.sent, 3);
  assert.equal(v1.opens, 2);
  assert.equal(v0.sent, 2, 'original untouched');
});
