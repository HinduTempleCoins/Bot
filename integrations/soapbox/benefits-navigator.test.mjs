// benefits-navigator.test.mjs — offline tests for the honest benefits navigator. No network I/O; the
// live feed is exercised through an injected fetcher, so no real key or request is ever made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROGRAMS, MECHANISMS, MECHANISM_BADGE, NOT_ADVICE,
  classifyMechanism, classifyProgram, searchPrograms, truthCheck, renderPage, esc, __setFetch,
} from './benefits-navigator.mjs';

const KINDS = new Set(['grant', 'loan', 'cost-share-reimbursement', 'tax-credit', 'other']);

test('PROGRAMS — every program has an honest, recognized mechanism + required fields', () => {
  assert.ok(PROGRAMS.length >= 6);
  for (const p of PROGRAMS) {
    assert.ok(p.name && p.agency && p.honest_summary && p.eligibility_notes && p.source_url, `complete: ${p.name}`);
    assert.ok(MECHANISMS.includes(p.mechanism), `recognized mechanism: ${p.name} -> ${p.mechanism}`);
  }
});

test('PROGRAMS — EQIP high tunnel is cost-share with the sign-first note + the numbers', () => {
  const eqip = PROGRAMS.find((p) => /EQIP/i.test(p.name));
  assert.ok(eqip, 'EQIP present');
  assert.equal(eqip.mechanism, 'cost-share-reimbursement');
  assert.match(eqip.honest_summary, /NOT free money/i);
  assert.match(eqip.honest_summary, /reimburs/i);
  assert.match(eqip.honest_summary, /5\.90/);          // $/sq ft floor
  assert.match(eqip.honest_summary, /12\.21/);         // $/sq ft ceiling
  assert.match(eqip.honest_summary, /2,160/);          // sq ft cap
  assert.match(eqip.honest_summary, /50%/);            // historically-underserved advance
  assert.match(eqip.eligibility_notes, /BEFORE construction/i); // sign-first note
});

test('PROGRAMS — SBA programs are LOANS, never grants', () => {
  const sbaLoans = PROGRAMS.filter((p) => /SBA/i.test(p.name) && /(7\(a\)|loan)/i.test(p.name));
  assert.ok(sbaLoans.some((p) => /7\(a\)/.test(p.name)), '7(a) present');
  assert.ok(sbaLoans.some((p) => /microloan/i.test(p.name)), 'microloan present');
  for (const p of sbaLoans) assert.equal(p.mechanism, 'loan', `${p.name} is a loan`);
});

test('classifyMechanism — maps loan / grant / reimbursement / service / tax / insurance text', () => {
  assert.equal(classifyMechanism('You repay this loan with interest over 10 years'), 'loan');
  assert.equal(classifyMechanism('SBA microloan through an intermediary lender'), 'loan');
  assert.equal(classifyMechanism('Cost-share: you are reimbursed after inspection'), 'cost-share-reimbursement');
  assert.equal(classifyMechanism('Competitive grant awarded with no repayment required'), 'grant');
  assert.equal(classifyMechanism('A tax credit that reduces the tax you owe'), 'tax-credit');
  assert.equal(classifyMechanism('Crop insurance with annual premiums'), 'insurance');
  assert.equal(classifyMechanism('Free mentoring and business advising'), 'service');
  assert.equal(classifyMechanism(''), 'varies');
});

test('classifyMechanism — loan signal beats "free money" framing in the same text', () => {
  // The whole point: a book selling "free money" that is really a loan must classify as a loan.
  assert.equal(classifyMechanism('FREE MONEY! Get cash now — a low-interest loan you repay monthly'), 'loan');
});

test('searchPrograms — returns curated programs, filterable by query', async () => {
  const all = await searchPrograms('');
  assert.ok(all.length >= PROGRAMS.length);
  const tunnel = await searchPrograms('high tunnel');
  assert.ok(tunnel.some((p) => /EQIP/i.test(p.name)), 'EQIP matched by query');
  assert.ok(tunnel.every((p) => MECHANISMS.includes(p.mechanism)), 'all results classified');
});

test('searchPrograms — merges curated + an injected live feed, each carrying mechanism + summary', async () => {
  const live = [
    { type: 'grant', title: 'Clean Water Infrastructure Grant', agency: 'EPA', url: 'https://x/g1' },
    { type: 'grant', title: 'Some Repayable Disaster Loan with interest', agency: 'SBA', url: 'https://x/l1' },
  ];
  const results = await searchPrograms('water', { fetchers: { grants: async () => live } });
  const liveRows = results.filter((p) => p.source === 'live');
  assert.equal(liveRows.length, 2, 'both live rows merged in');
  for (const p of liveRows) {
    assert.ok(MECHANISMS.includes(p.mechanism), `live row classified: ${p.name}`);
    assert.ok(p.honest_summary && p.honest_summary.length > 0, 'live row has honest summary');
  }
  // The grant is a grant; the "loan with interest" row gets honestly reclassified as a loan.
  assert.equal(liveRows.find((p) => /Infrastructure Grant/.test(p.name)).mechanism, 'grant');
  assert.equal(liveRows.find((p) => /Disaster Loan/.test(p.name)).mechanism, 'loan');
});

test('searchPrograms — soft-fails to curated when the live feed throws', async () => {
  const results = await searchPrograms('', { fetchers: { grants: async () => { throw new Error('boom'); } } });
  assert.ok(results.length >= PROGRAMS.length, 'curated still returned');
  assert.ok(results.every((p) => p.source === 'curated'), 'no live rows on failure');
});

test('searchPrograms — soft-fails when the live feed returns a non-array', async () => {
  const results = await searchPrograms('', { fetchers: { grants: async () => null } });
  assert.ok(results.every((p) => p.source === 'curated'));
});

test('truthCheck — flags a "FREE MONEY!" loan as dishonest', () => {
  const bad = {
    name: 'FREE MONEY! No strings government cash',
    mechanism: 'loan',
    honest_summary: 'Get free money fast — never repay it back!',
  };
  const r = truthCheck(bad);
  assert.equal(r.honest, false);
  assert.match(r.why, /repay/i);
});

test('truthCheck — flags free-money framing on a cost-share program', () => {
  const r = truthCheck({ name: 'Free money for your farm!', mechanism: 'cost-share-reimbursement', honest_summary: 'free government cash' });
  assert.equal(r.honest, false);
  assert.match(r.why, /pay first|reimburs/i);
});

test('truthCheck — honest program (real EQIP) passes', () => {
  const eqip = PROGRAMS.find((p) => /EQIP/i.test(p.name));
  assert.equal(truthCheck(eqip).honest, true);
});

test('renderPage — escapes hostile text, shows mechanism badges + not-advice line', () => {
  const html = renderPage([
    { name: '<script>x</script>', agency: 'A & B', mechanism: 'loan', honest_summary: 'sum', eligibility_notes: 'elig', source_url: 'https://x?a=1&b=2' },
    PROGRAMS.find((p) => /EQIP/i.test(p.name)),
  ]);
  // Escaping: no raw injection survives.
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('A &amp; B'));
  assert.ok(html.includes('a=1&amp;b=2'));
  // Badges: the loan card shows the LOAN badge; EQIP shows the cost-share badge.
  assert.ok(html.includes(esc(MECHANISM_BADGE.loan)));
  assert.ok(html.includes(esc(MECHANISM_BADGE['cost-share-reimbursement'])));
  // Not-advice line present on every render.
  assert.ok(html.includes(esc(NOT_ADVICE)));
});

test('renderPage — empty results still renders with the not-advice line', () => {
  const html = renderPage([]);
  assert.ok(html.includes('No programs found'));
  assert.ok(html.includes(esc(NOT_ADVICE)));
});

test('renderPage — a dishonest result surfaces a heads-up warning', () => {
  const html = renderPage([{ name: 'FREE MONEY! never repay it back', agency: 'X', mechanism: 'loan', honest_summary: 'free money', eligibility_notes: 'n/a', source_url: 'https://x' }]);
  assert.match(html, /Heads up/);
  assert.match(html, /repay/i);
});

test('classifyProgram — returns {kind, honestSummary} from the restricted v3 vocabulary', () => {
  for (const fixture of [
    { mechanism: 'loan', name: 'SBA 7(a) Loan' },
    { mechanism: 'grant', name: 'Research Grant' },
    { mechanism: 'tax-credit', name: 'Solar Tax Credit' },
    { mechanism: 'service', name: 'SCORE Mentoring' },     // → other
    { mechanism: 'insurance', name: 'Crop Insurance' },    // → other
    { mechanism: 'varies', name: 'Benefits finder' },      // → other
  ]) {
    const r = classifyProgram(fixture);
    assert.ok(KINDS.has(r.kind), `${fixture.name} -> ${r.kind} in vocab`);
    assert.ok(r.honestSummary && r.honestSummary.length > 0, 'has honestSummary');
  }
  assert.equal(classifyProgram({ mechanism: 'service' }).kind, 'other');
  assert.equal(classifyProgram({ mechanism: 'insurance' }).kind, 'other');
});

test('classifyProgram — EQIP high tunnel is cost-share-reimbursement with the sign-first truth', () => {
  // From text alone (no mechanism field): the USDA EQIP high-tunnel case must be encoded.
  const r = classifyProgram({ name: 'USDA NRCS EQIP — Seasonal High Tunnel', agency: 'USDA NRCS' });
  assert.equal(r.kind, 'cost-share-reimbursement');
  assert.match(r.honestSummary, /NOT free money/i);
  assert.match(r.honestSummary, /reimburs/i);
  assert.match(r.honestSummary, /sign.*BEFORE you build|BEFORE you build/i);
  // "high tunnel" keyword alone also triggers the cost-share case.
  assert.equal(classifyProgram({ name: 'high tunnel cost-share' }).kind, 'cost-share-reimbursement');
});

test('classifyProgram — loan text beats "free money" framing', () => {
  const r = classifyProgram({ name: 'FREE MONEY', description: 'a low-interest loan you repay monthly' });
  assert.equal(r.kind, 'loan');
});

test('searchPrograms — every returned row carries an honest `kind` in the restricted vocabulary', async () => {
  const all = await searchPrograms('');
  assert.ok(all.length >= PROGRAMS.length);
  for (const p of all) assert.ok(KINDS.has(p.kind), `${p.name} -> kind ${p.kind}`);
  // the curated EQIP row is cost-share-reimbursement
  const eqip = all.find((p) => /EQIP/i.test(p.name));
  assert.equal(eqip.kind, 'cost-share-reimbursement');
});

test('searchPrograms — live rows are classified into kinds too', async () => {
  const live = [
    { type: 'grant', title: 'Clean Water Grant', agency: 'EPA', url: 'https://x/g1' },
    { type: 'grant', title: 'Disaster Loan with interest', agency: 'SBA', url: 'https://x/l1' },
  ];
  const results = await searchPrograms('water', { fetchers: { grants: async () => live } });
  const liveRows = results.filter((p) => p.source === 'live');
  assert.equal(liveRows.find((p) => /Water Grant/.test(p.name)).kind, 'grant');
  assert.equal(liveRows.find((p) => /Disaster Loan/.test(p.name)).kind, 'loan');
});

// keep __setFetch referenced (defensive-import seam) so the import is meaningful even offline.
test('__setFetch is callable (seam exists)', () => {
  assert.doesNotThrow(() => { __setFetch(); });
});
