// token-invariants.test.mjs — OFFLINE. Pure functions; no network, no chain, no clock.
import { test } from 'node:test';
import assert from 'node:assert';
import { INVARIANTS, check, CORNPONE, KULA_AS_DEPLOYED, UNKNOWN, handler } from './token-invariants.mjs';

test('Cornpone as drafted is clean', () => {
  const r = check(CORNPONE);
  assert.equal(r.verdict, 'clean');
  assert.equal(r.problems, 0);
  assert.equal(r.unknowns, 0);
});

test('KULA as deployed has THREE permanent problems — none of them a bug', () => {
  const r = check(KULA_AS_DEPLOYED);
  assert.equal(r.verdict, 'permanent-problems');
  assert.equal(r.permanentProblems, 3);
  const keys = r.rows.filter((x) => x.verdict === 'problem').map((x) => x.key);
  assert.ok(keys.includes('supplyIsFixed'));
  assert.ok(keys.includes('mintAuthority'));
  assert.ok(keys.includes('initialDistribution'));
  assert.match(r.note, /cannot be fixed after deployment/);
});

test('⭐ an UNSTATED answer is a failure, not a pass', () => {
  const r = check({ supplyIsFixed: true });
  assert.equal(r.verdict, 'incomplete');
  assert.ok(r.unknowns >= 4);
  assert.equal(r.ok, false, 'silence must never read as approval — that is the failure mode');
  const un = r.rows.find((x) => x.verdict === UNKNOWN);
  assert.match(un.detail, /must be answered before deployment/);
});

test('an empty spec is entirely unknown, never clean', () => {
  const r = check({});
  assert.equal(r.ok, false);
  assert.equal(r.problems + r.unknowns, r.rows.length);
  assert.equal(check(null).ok, false);
});

test('a timelocked pause is acceptable; an EOA pause is not', () => {
  const base = { ...CORNPONE };
  assert.equal(check({ ...base, pauseAuthority: 'timelock' }).verdict, 'clean');
  const eoa = check({ ...base, pauseAuthority: 'EOA' });
  assert.equal(eoa.verdict, 'recoverable-problems', 'a pause is bad but not permanent — it can be moved');
  assert.equal(eoa.permanentProblems, 0);
});

test('mint authority held by ANYONE is a problem — a timelock is still somebody', () => {
  for (const who of ['EOA', 'multisig', 'timelock', 'a scheduler contract']) {
    const r = check({ ...CORNPONE, mintAuthority: who });
    assert.equal(r.rows.find((x) => x.key === 'mintAuthority').verdict, 'problem', who);
  }
  assert.equal(check({ ...CORNPONE, mintAuthority: 'nobody' }).verdict, 'clean');
});

test('burnable is allowed ONLY if the supply invariant survives it', () => {
  assert.equal(check({ ...CORNPONE, burnable: true }).rows.find((x) => x.key === 'burnable').verdict, 'problem');
  assert.equal(check({ ...CORNPONE, burnable: true, supplyInvariantSurvivesBurn: true }).verdict, 'clean');
});

test('upgradeability makes every other guarantee temporary, and is permanent itself', () => {
  const r = check({ ...CORNPONE, upgradeable: true });
  const row = r.rows.find((x) => x.key === 'upgradeable');
  assert.equal(row.verdict, 'problem');
  assert.equal(row.permanent, true);
  assert.match(row.detail, /every other answer here becomes temporary/);
});

test('distribution to a contract passes; to an EOA does not, and it is permanent', () => {
  assert.equal(check({ ...CORNPONE, initialDistribution: 'contract' }).verdict, 'clean');
  const r = check({ ...CORNPONE, initialDistribution: 'EOA' });
  assert.equal(r.permanentProblems, 1);
  assert.match(r.rows.find((x) => x.key === 'initialDistribution').detail, /already made once/);
});

test('every invariant carries a real reason drawn from what actually happened', () => {
  for (const [k, v] of Object.entries(INVARIANTS)) {
    assert.ok(v.ask && v.good && v.bad && v.why, k);
    assert.equal(typeof v.permanent, 'boolean', k);
  }
});

test('the handler reports Cornpone clean and states the rule', () => {
  let body = '';
  handler({}, { setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.equal(j.cornpone, 'clean');
  assert.match(j.rule, /unstated answer is a failure/);
});
