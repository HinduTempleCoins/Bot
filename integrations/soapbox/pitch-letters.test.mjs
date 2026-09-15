import test from 'node:test';
import assert from 'node:assert/strict';
import { letter, lettersFor, duplicateBodies, renderBundle, WHY_THEM, assets } from './pitch-letters.mjs';

test('a letter names the outlet and says why THAT outlet', () => {
  const l = letter('dea-gao', 'filter', { from: 'A. Writer' });
  assert.match(l.body, /Filter/);
  assert.match(l.body, /directly affected by the policy/);
  assert.match(l.body, /— A\. Writer$/);
});

test('⚠️ no two letters for one piece share a body — that is a mail-merge', () => {
  // Seven byte-identical sends to seven food magazines in one afternoon is already in the record.
  // Editors in a small vertical compare notes.
  for (const a of assets()) {
    const ls = lettersFor(a.id, { from: 'A. Writer' });
    const dupes = duplicateBodies(ls);
    assert.equal(dupes.length, 0, `${a.id}: identical bodies for ${dupes.map((g) => g.join('/')).join(', ')}`);
  }
});

test('a pitch subject stands alone; a notice subject continues its thread', () => {
  assert.ok(!/^Re:/i.test(letter('derelict', 'bolts', { from: 'X' }).subject));
  assert.match(letter('derelict', 'bolts', { from: 'X', mode: 'notice' }).subject, /^Re: /);
});

test('a notice is not softened into a pitch', () => {
  const n = letter('derelict', 'bolts', { from: 'X', mode: 'notice' });
  assert.match(n.body, /Continuing the thread/);
  assert.ok(!/I am sending this to/.test(n.body), 'a notice does not plead its relevance');
});

test('⚠️ warnings fire on the exact failures already in the mailbox', () => {
  const marshall = letter('dea-gao', 'marshall', { from: 'X' });
  assert.ok(marshall.warnings.some((w) => /already contacted/i.test(w)));

  const unpaid = letter('merit-not-stake', 'coindesk-opinion', { from: 'X' });
  assert.ok(unpaid.warnings.some((w) => /not income/i.test(w)),
    'an unpaid outlet must say so before the time is spent');

  const noSig = letter('derelict', 'bolts', {});
  assert.ok(noSig.warnings.some((w) => /sign it/i.test(w)));
});

test('every unverified rate produces a warning rather than a silent assumption', () => {
  const l = letter('usda', 'ambrook', { from: 'X' });
  assert.ok(l.warnings.some((w) => /rate is unverified/i.test(w)));
});

test('unknown ids return null, never a half-built letter', () => {
  assert.equal(letter('nope', 'bolts', {}), null);
  assert.equal(letter('derelict', 'nope', {}), null);
});

test('the bundle is workable by a human and flags duplicates at the top', () => {
  const b = renderBundle('spiced-coffee', { from: 'A. Writer' });
  assert.match(b, /Spiced Coffee/);
  assert.match(b, /SUBJECT: Pitch: Spiced Coffee/);
  assert.match(b, /TO: /);
});

test('WHY_THEM entries are specific enough to prove a human chose the outlet', () => {
  for (const [id, why] of Object.entries(WHY_THEM)) {
    assert.ok(why.length > 25, `${id}: too generic to be worth saying`);
    assert.ok(!/great publication|big fan|love your work/i.test(why), `${id}: flattery is not a reason`);
  }
});

test('no identity is hardcoded into a shared module', () => {
  const l = letter('derelict', 'bolts', {});
  assert.ok(!/gallagher|van kush|shaivite/i.test(l.body), 'the sender is supplied at send time');
});
