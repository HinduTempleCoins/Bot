// audit-report.test.mjs — offline tests for the npm-audit remediation report (Task #158).
// Canned `npm audit --json` fixtures for BOTH schemas. No network, no shelling out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAudit,
  prioritize,
  remediationPlan,
  report,
  summaryLine,
  __setAuditSource,
} from './audit-report.mjs';

// ── fixtures ──────────────────────────────────────────────────────────────────

// npm v7+ shape: top-level `vulnerabilities`. Models the legacy van-kush-discord-bot offenders:
// a critical fixable (non-breaking), a high with a semver-major (breaking) fix, a moderate
// transitive non-breaking fix, and a low with NO fix available.
const V7 = {
  auditReportVersion: 2,
  vulnerabilities: {
    'minimist': {
      name: 'minimist', severity: 'critical', isDirect: true,
      via: [{ title: 'Prototype Pollution in minimist', severity: 'critical' }],
      range: '<1.2.6', fixAvailable: { name: 'minimist', version: '1.2.8', isSemVerMajor: false },
    },
    'request': {
      name: 'request', severity: 'high', isDirect: true,
      via: [{ title: 'SSRF in request' }],
      range: '*', fixAvailable: { name: 'request', version: '3.0.0', isSemVerMajor: true },
    },
    'tough-cookie': {
      name: 'tough-cookie', severity: 'moderate', isDirect: false,
      via: ['request'],
      range: '<4.1.3', fixAvailable: true,
    },
    'old-thing': {
      name: 'old-thing', severity: 'low', isDirect: true,
      via: [{ title: 'Unpatched ancient bug' }],
      range: '*', fixAvailable: false,
    },
  },
  metadata: { vulnerabilities: { critical: 1, high: 1, moderate: 1, low: 1, total: 4 } },
};

// npm v6 shape: top-level `advisories`. One patched (fix available), one with no patch.
const V6 = {
  advisories: {
    '1179': {
      module_name: 'minimist', severity: 'high', title: 'Prototype Pollution',
      vulnerable_versions: '<0.2.1', patched_versions: '>=1.2.3',
      findings: [{ paths: ['minimist'] }],
    },
    '999': {
      module_name: 'deep-nested', severity: 'moderate', title: 'ReDoS',
      vulnerable_versions: '<2.0.0', patched_versions: '<0.0.0',
      findings: [{ paths: ['somepkg>deep-nested'] }],
    },
  },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 1, critical: 0, total: 2 } },
};

// ── parseAudit ──────────────────────────────────────────────────────────────

test('parseAudit normalizes the v7 vulnerabilities shape', () => {
  const f = parseAudit(V7);
  assert.equal(f.length, 4);
  const byName = Object.fromEntries(f.map((x) => [x.name, x]));

  assert.equal(byName.minimist.severity, 'critical');
  assert.equal(byName.minimist.fixAvailable, true);
  assert.equal(byName.minimist.breaking, false);
  assert.deepEqual(byName.minimist.fixTarget, { name: 'minimist', version: '1.2.8' });
  assert.equal(byName.minimist.isDirect, true);

  assert.equal(byName.request.fixAvailable, true);
  assert.equal(byName.request.breaking, true); // isSemVerMajor

  assert.equal(byName['tough-cookie'].fixAvailable, true);
  assert.equal(byName['tough-cookie'].isDirect, false);
  assert.deepEqual(byName['tough-cookie'].via, ['request']);

  assert.equal(byName['old-thing'].fixAvailable, false);
});

test('parseAudit normalizes the v6 advisories shape', () => {
  const f = parseAudit(V6);
  assert.equal(f.length, 2);
  const byName = Object.fromEntries(f.map((x) => [x.name, x]));

  assert.equal(byName.minimist.severity, 'high');
  assert.equal(byName.minimist.fixAvailable, true);
  assert.equal(byName.minimist.fixTarget.version, '>=1.2.3');
  assert.equal(byName.minimist.isDirect, true);

  assert.equal(byName['deep-nested'].fixAvailable, false); // patched_versions <0.0.0 → no patch
  assert.equal(byName['deep-nested'].isDirect, false);
});

test('parseAudit soft-fails junk → []', () => {
  assert.deepEqual(parseAudit('not json {{{'), []);
  assert.deepEqual(parseAudit(null), []);
  assert.deepEqual(parseAudit(42), []);
  assert.deepEqual(parseAudit({}), []);
  assert.deepEqual(parseAudit({ vulnerabilities: [] }), []); // array, not the object map → []
});

// ── prioritize ────────────────────────────────────────────────────────────────

test('prioritize orders critical-first and counts', () => {
  const { list, counts, fixable, breaking } = prioritize(parseAudit(V7));
  assert.deepEqual(list.map((x) => x.severity), ['critical', 'high', 'moderate', 'low']);
  assert.deepEqual(counts, { critical: 1, high: 1, moderate: 1, low: 1 });
  assert.equal(fixable, 3);
  assert.equal(breaking, 1);
});

test('prioritize puts fixable before non-fixable within a severity', () => {
  const findings = [
    { name: 'a', severity: 'high', via: [], range: '*', fixAvailable: false, breaking: false, isDirect: true },
    { name: 'b', severity: 'high', via: [], range: '*', fixAvailable: true, breaking: false, isDirect: true },
  ];
  const { list } = prioritize(findings);
  assert.deepEqual(list.map((x) => x.name), ['b', 'a']);
});

// ── remediationPlan ────────────────────────────────────────────────────────────

test('remediationPlan buckets safe vs breaking vs no-fix', () => {
  const plan = remediationPlan(parseAudit(V7));
  assert.deepEqual(plan.safe.map((x) => x.name).sort(), ['minimist', 'tough-cookie']);
  assert.deepEqual(plan.breaking.map((x) => x.name), ['request']);
  assert.deepEqual(plan.noFix.map((x) => x.name), ['old-thing']);

  // suggested actions are TEXT
  const minimist = plan.safe.find((x) => x.name === 'minimist');
  assert.equal(minimist.action, 'npm install minimist@1.2.8');
  const tough = plan.safe.find((x) => x.name === 'tough-cookie');
  assert.equal(tough.action, 'npm update tough-cookie'); // fixAvailable:true but no fixTarget
  assert.match(plan.breaking[0].action, /semver-major|@latest/);
  assert.match(plan.noFix[0].action, /no patch/i);
});

// ── report ─────────────────────────────────────────────────────────────────────

test('report renders the verdict with the "did not change deps" note', () => {
  const md = report(remediationPlan(parseAudit(V7)));
  assert.match(md, /# npm audit/);
  assert.match(md, /Safe fixes/);
  assert.match(md, /Breaking fixes/);
  assert.match(md, /No fix yet/);
  assert.match(md, /minimist/);
  assert.match(md, /I did not change any/);
  assert.match(md, /never run `npm install`/);
  // counts surfaced
  assert.match(md, /1 critical/);
});

test('report accepts a raw findings array too, and clean audit reads clean', () => {
  const md = report(parseAudit(V7));
  assert.match(md, /vulnerable package/);
  const clean = report(remediationPlan(parseAudit({ vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } })));
  assert.match(clean, /No known vulnerabilities/);
  assert.match(clean, /I did not change any/); // note present even when clean
});

// ── summaryLine ──────────────────────────────────────────────────────────────

test('summaryLine is correct', () => {
  assert.equal(summaryLine(parseAudit(V7)), '1 critical, 1 high, 1 moderate, 1 low; 3 fixable, 1 breaking');
  assert.equal(summaryLine(parseAudit(V6)), '1 high, 1 moderate; 1 fixable');
  assert.equal(summaryLine([]), 'no known vulnerabilities');
});

// ── advise-only / injectable source ──────────────────────────────────────────

test('__setAuditSource is injectable (smoke) and resets cleanly', () => {
  // Exercising the setter is the contract; it feeds the guarded CLI, which we don't run here.
  assert.doesNotThrow(() => __setAuditSource(() => V7));
  assert.doesNotThrow(() => __setAuditSource(null));
});

test('ADVISE-ONLY by construction: the module never shells out or runs install/update', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('./audit-report.mjs', import.meta.url)), 'utf8');
  // Strip line-comments so the disavowal prose ("...never imports child_process...") doesn't
  // false-trip the checks; we're asserting the actual CODE never spawns a process.
  const code = src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.doesNotMatch(code, /child_process/);
  assert.doesNotMatch(code, /execSync|spawnSync|\bexec\s*\(|\bspawn\s*\(/);
  // `npm install`/`update`/`audit fix` only ever appear inside quoted strings (suggestions or the
  // disavowal note) — never as an executed shell command (which would require exec/spawn, ruled out above).
});
