import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KSS, DEQ5, SUBSTANCE_CLASSES, FORBIDDEN_FIELDS, PREFER_NOT_TO_SAY,
  validateStateCard, summariseStateCard, stateCardHTML,
} from './state-card.mjs';

const at = () => new Date('2026-09-08T12:00:00Z');

test('KSS ships the published nine anchors, verbatim, in order', () => {
  assert.equal(KSS.length, 9);
  assert.deepEqual(KSS.map((k) => k.value), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(KSS[0].label, 'Extremely alert');
  assert.equal(KSS[8].label, 'Very sleepy, great effort to keep awake, fighting sleep');
});

test('it NEVER accepts dose, amount or route — the refusal is enforced, not intended', () => {
  for (const field of ['dose', 'dosage', 'amount', 'quantity', 'route', 'mg', 'grams']) {
    const out = validateStateCard({ affected: 'yes', classes: ['alcohol'], [field]: '2 units' }, { now: at });
    assert.equal(out.ok, false, `${field} was accepted`);
    assert.match(out.errors[0], /does not accept/);
  }
});

test('nor a name, an email field or an address', () => {
  for (const field of ['name', 'email', 'phone', 'address', 'dob']) {
    assert.equal(validateStateCard({ [field]: 'x' }, { now: at }).ok, false, `${field} was accepted`);
  }
  assert.ok(FORBIDDEN_FIELDS.includes('route'));
});

test('free text carrying contact details is refused, not stored and hoped about', () => {
  const out = validateStateCard({ affected: 'yes', classes: ['other'], otherText: 'ask me at a@b.com' }, { now: at });
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /email address or a phone number/);
});

test('an empty card is valid — nothing is required and nothing is defaulted', () => {
  const out = validateStateCard({}, { now: at });
  assert.equal(out.ok, true);
  assert.equal(out.card.kss, null);
  assert.equal(out.card.affected, null);
  assert.deepEqual(out.card.classes, []);
});

test('"prefer not to say" is recorded as itself, never coerced to a default', () => {
  const out = validateStateCard({ kss: PREFER_NOT_TO_SAY, affected: PREFER_NOT_TO_SAY }, { now: at });
  assert.equal(out.ok, true);
  assert.equal(out.card.kss, null);
  assert.equal(out.card.kssRefused, true);
  assert.equal(out.card.affected, 'prefer not to say');
  assert.match(summariseStateCard(out.card), /declined/);
});

test('a full card normalises into the shape the store keeps', () => {
  const out = validateStateCard({
    kss: 8, hoursAwake: 17, hoursSlept: 4.5, sleepUnusual: true,
    localTime: '2026-09-08T23:14:02+01:00', tz: 'Europe/London', tzOffsetMin: -60,
    affected: 'yes', classes: ['alcohol', 'caffeine', 'alcohol'],
    deq5: { feel: 62, high: 40, like: 71, dislike: 3, more: 25 },
    intoxicationVas: 55, valence: 70, arousal: 30,
    company: 'alone', noise: 'quiet', headphones: 'yes', interruptions: 'none expected',
    practices: ['meditation', 'entrainment session'],
  }, { now: at });
  assert.equal(out.ok, true, out.errors.join('; '));
  assert.equal(out.card.kss, 8);
  assert.deepEqual(out.card.classes, ['alcohol', 'caffeine']); // de-duplicated
  assert.equal(out.card.deq5.like, 71);
  assert.equal(out.card.intoxicationVas, 55);
  assert.equal(out.card.recordedAt, '2026-09-08T12:00:00.000Z');
  assert.match(summariseStateCard(out.card), /sleepiness 8\/9/);
  assert.match(summariseStateCard(out.card), /drug-effect 62\/100/);
});

test('the alcohol VAS only exists when alcohol was ticked', () => {
  const out = validateStateCard({ affected: 'yes', classes: ['caffeine'], intoxicationVas: 90 }, { now: at });
  assert.equal(out.card.intoxicationVas, null);
});

test('substance classes are dropped, not bounced, if the gate is not yes', () => {
  const out = validateStateCard({ affected: 'no', classes: ['alcohol'] }, { now: at });
  assert.equal(out.ok, true);
  assert.deepEqual(out.card.classes, []);
});

test('out-of-menu answers fail rather than being silently coerced', () => {
  assert.equal(validateStateCard({ affected: 'maybe' }, { now: at }).ok, false);
  assert.equal(validateStateCard({ classes: ['heroin'] }, { now: at }).ok, false);
  assert.equal(validateStateCard({ kss: 12 }, { now: at }).ok, false);
});

test('numeric typos cost the value, not the card', () => {
  const out = validateStateCard({ hoursSlept: 99, hoursAwake: -4 }, { now: at });
  assert.equal(out.ok, true);
  assert.equal(out.card.hoursSlept, 14);
  assert.equal(out.card.hoursAwake, 0);
});

test('the rendered card carries the DEQ-5 items, the classes, and the reason there is no dose box', () => {
  const html = stateCardHTML();
  for (const d of DEQ5) assert.ok(html.includes(d.prompt), `${d.id} missing`);
  for (const c of SUBSTANCE_CLASSES) assert.ok(html.includes(c), `${c} missing`);
  assert.match(html, /We do not ask how much, and we never will/);
  assert.match(html, /Karolinska/);
  assert.match(html, /Morean/);
  // No warning, no advice, no health messaging on this screen — a leading question gets a lying answer.
  assert.ok(!/you should not|do not take|dangerous|unsafe/i.test(html));
});

test('the card escapes everything it interpolates', () => {
  assert.ok(!stateCardHTML({ formId: '"><script>x</script>' }).includes('<script>x</script>'));
});
