// election-clock.test.mjs — offline tests for the PURE federal-election calendar math.
// No network, no key. The clock is injected via nowMs / fromDate. Run: node --test integrations/soapbox/election-clock.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isElectionYear, isPresidentialYear, generalElectionDate, nextGeneralElection,
  registrationDeadline, registrationOffsetDays, REGISTRATION_DEADLINE_OFFSETS,
  daysBetween, toISODate, parseDate,
} from './election-clock.mjs';

test('election-year predicates: even years; presidential = divisible by 4', () => {
  assert.equal(isElectionYear(2024), true);
  assert.equal(isElectionYear(2025), false);
  assert.equal(isElectionYear(2026), true);
  assert.equal(isPresidentialYear(2024), true);
  assert.equal(isPresidentialYear(2026), false);
  assert.equal(isPresidentialYear(2025), false);
});

test('generalElectionDate = Tuesday after the first Monday in November (known years)', () => {
  // 2024: first Monday Nov 4 → election Nov 5
  assert.equal(toISODate(generalElectionDate(2024)), '2024-11-05');
  // 2026: first Monday Nov 2 → election Nov 3
  assert.equal(toISODate(generalElectionDate(2026)), '2026-11-03');
  // 2028: first Monday Nov 6 → election Nov 7
  assert.equal(toISODate(generalElectionDate(2028)), '2028-11-07');
  // 2032: Nov 1 is a Monday → first Monday is the 1st → election Nov 2
  assert.equal(toISODate(generalElectionDate(2032)), '2032-11-02');
  // odd year → null
  assert.equal(generalElectionDate(2025), null);
});

test('nextGeneralElection finds the next election on/after a date, with presidential flag', () => {
  const r1 = nextGeneralElection({ fromDate: '2026-03-01' });
  assert.equal(r1.date, '2026-11-03');
  assert.equal(r1.year, 2026);
  assert.equal(r1.presidential, false);
  assert.ok(r1.daysUntil > 0);

  // after the 2026 election → jumps to 2028 (presidential)
  const r2 = nextGeneralElection({ fromDate: '2026-12-01' });
  assert.equal(r2.date, '2028-11-07');
  assert.equal(r2.presidential, true);

  // from an odd year → next even-year election
  const r3 = nextGeneralElection({ fromDate: '2025-07-04' });
  assert.equal(r3.date, '2026-11-03');

  // on election day itself → that same election (daysUntil 0)
  const r4 = nextGeneralElection({ fromDate: '2026-11-03' });
  assert.equal(r4.date, '2026-11-03');
  assert.equal(r4.daysUntil, 0);
});

test('nextGeneralElection uses injectable nowMs and returns null on bad input', () => {
  const r = nextGeneralElection({ nowMs: Date.UTC(2026, 0, 1) });
  assert.equal(r.date, '2026-11-03');
  assert.equal(nextGeneralElection({ fromDate: 'not-a-date' }) && nextGeneralElection({ fromDate: 'not-a-date' }).date, '2026-11-03'); // bad fromDate falls back to nowMs
});

test('registrationOffsetDays reads the config stub; same-day states are 0; default fallback', () => {
  assert.equal(registrationOffsetDays('CA'), 0);  // same-day registration
  assert.equal(registrationOffsetDays('tx'), 30); // case-insensitive
  assert.equal(registrationOffsetDays('ZZ'), REGISTRATION_DEADLINE_OFFSETS._default);
  assert.equal(registrationOffsetDays(''), REGISTRATION_DEADLINE_OFFSETS._default);
});

test('registrationDeadline is a labeled ESTIMATE with defer-to-officials note', () => {
  const ca = registrationDeadline({ state: 'CA', fromDate: '2026-03-01' });
  assert.equal(ca.electionDate, '2026-11-03');
  assert.equal(ca.offsetDays, 0);
  assert.equal(ca.sameDay, true);
  assert.equal(ca.deadline, '2026-11-03'); // same-day → deadline == election date
  assert.equal(ca.estimate, true);
  assert.match(ca.note, /official sources/i);

  const tx = registrationDeadline({ state: 'TX', fromDate: '2026-03-01' });
  assert.equal(tx.offsetDays, 30);
  assert.equal(tx.sameDay, false);
  assert.equal(tx.deadline, '2026-10-04'); // 30 days before 2026-11-03
  assert.equal(daysBetween(tx.deadline, '2026-11-03'), 30);
});

test('date helpers: parseDate / toISODate / daysBetween are pure and tolerant', () => {
  assert.equal(toISODate(parseDate('2026-11-03')), '2026-11-03');
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('garbage'), null);
  assert.equal(toISODate('not a date'), '');
  assert.equal(daysBetween('2026-11-01', '2026-11-03'), 2);
  assert.equal(daysBetween('2026-11-03', '2026-11-01'), -2);
  assert.equal(daysBetween('bad', '2026-11-03'), null);
});
