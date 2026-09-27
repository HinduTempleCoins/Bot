// interactions-cannabis.test.mjs — tests for the cannabinoid / endocannabinoid extension to the
// interaction engine, and for the MERGE that folds it into integrations/interactions.mjs.
//
// Fully offline: the engine is pure data plus pure rules, so there is no fetch to inject.
//
// The merge is the risky part, and it is what most of this file is about. interactions-data.mjs is
// the curated core; interactions-cannabis.mjs adds substances, mechanisms, citations and rules, and
// PATCHES a few substances the core already lists (kava, black pepper, turmeric, grapefruit) by
// APPENDING roles. The invariant is that the merge is strictly additive: nothing in the core may be
// removed, reworded or shadowed. A bad merge that silently dropped a documented role would produce a
// checker that returns a clean result for a pair that is actually documented, which is the single
// worst failure this engine can have.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as merged from './interactions.mjs';
import * as core from './interactions-data.mjs';
import * as cann from './interactions-cannabis.mjs';

test('the extension exports the shape the merge expects', () => {
  assert.ok(Array.isArray(cann.SUBSTANCES_CANNABIS) && cann.SUBSTANCES_CANNABIS.length >= 5);
  assert.equal(typeof cann.MECHANISMS_CANNABIS, 'object');
  assert.ok(Object.keys(cann.MECHANISMS_CANNABIS).length >= 3);
  assert.equal(typeof cann.CITES_CANNABIS, 'object');
  assert.ok(Object.keys(cann.CITES_CANNABIS).length >= 10);
  assert.ok(Array.isArray(cann.SUBSTANCE_PATCHES));
  assert.ok(Array.isArray(cann.RULES_CANNABIS) && cann.RULES_CANNABIS.length >= 1);
  for (const r of cann.RULES_CANNABIS) assert.equal(typeof r, 'function');
  assert.ok(Array.isArray(cann.COVERS_CANNABIS) && cann.COVERS_CANNABIS.length >= 1);
  assert.ok(Array.isArray(cann.DOES_NOT_COVER_CANNABIS) && cann.DOES_NOT_COVER_CANNABIS.length >= 1);
});

test('the merge is additive: every core substance survives it', () => {
  const mergedIds = new Set(merged.SUBSTANCES.map((s) => s.id));
  const missing = core.SUBSTANCES.map((s) => s.id).filter((id) => !mergedIds.has(id));
  assert.deepEqual(missing, [], `the merge dropped core substances: ${missing.join(', ')}`);
  assert.equal(
    merged.SUBSTANCES.length,
    core.SUBSTANCES.length + cann.SUBSTANCES_CANNABIS.length,
    'the merged list is not exactly core + extension — something was dropped or duplicated',
  );
});

test('substance ids are unique after the merge', () => {
  const seen = new Map();
  const dupes = [];
  for (const s of merged.SUBSTANCES) {
    if (seen.has(s.id)) dupes.push(s.id);
    seen.set(s.id, true);
  }
  assert.deepEqual(dupes, [], `duplicate substance ids after the merge: ${dupes.join(', ')}`);
});

test('SUBSTANCE_PATCHES append roles and never remove or reword an existing one', () => {
  assert.ok(cann.SUBSTANCE_PATCHES.length >= 1, 'no patches — if that is deliberate, delete this test');
  for (const patch of cann.SUBSTANCE_PATCHES) {
    const before = core.SUBSTANCES.find((s) => s.id === patch.id);
    const after = merged.SUBSTANCES.find((s) => s.id === patch.id);
    assert.ok(before, `patch targets ${patch.id}, which is not in the core dataset`);
    assert.ok(after, `${patch.id} vanished from the merged dataset`);
    // Everything except `roles` is untouched, field for field.
    for (const k of Object.keys(before)) {
      if (k === 'roles') continue;
      assert.deepEqual(after[k], before[k], `${patch.id}.${k} was changed by the merge`);
    }
    // Every original role is still present, in order, unmodified.
    const beforeRoles = before.roles || [];
    const afterRoles = after.roles || [];
    assert.equal(afterRoles.length, beforeRoles.length + (patch.addRoles || []).length,
      `${patch.id}: role count does not match core + added`);
    for (let i = 0; i < beforeRoles.length; i += 1) {
      assert.deepEqual({ ...afterRoles[i] }, { ...beforeRoles[i] }, `${patch.id}: original role ${i} was altered`);
    }
  }
});

test('the merge is additive for mechanisms and citations too', () => {
  for (const k of Object.keys(core.MECHANISMS)) assert.ok(merged.MECHANISMS[k], `mechanism ${k} was lost in the merge`);
  for (const k of Object.keys(core.CITES)) assert.ok(merged.CITES[k], `citation ${k} was lost in the merge`);
  for (const k of Object.keys(cann.MECHANISMS_CANNABIS)) assert.ok(merged.MECHANISMS[k], `extension mechanism ${k} did not arrive`);
  for (const k of Object.keys(cann.CITES_CANNABIS)) assert.ok(merged.CITES[k], `extension citation ${k} did not arrive`);
});

test('every citation a substance or mechanism references resolves after the merge', () => {
  const missing = [];
  for (const s of merged.SUBSTANCES) {
    for (const k of s.toxicityCites || []) if (!merged.CITES[k]) missing.push(`substance ${s.id} → ${k}`);
    for (const role of s.roles || []) for (const k of role.cites || []) if (!merged.CITES[k]) missing.push(`role ${s.id}/${role.mechanism || '?'} → ${k}`);
  }
  for (const [id, m] of Object.entries(merged.MECHANISMS)) {
    for (const k of m.cites || []) if (!merged.CITES[k]) missing.push(`mechanism ${id} → ${k}`);
  }
  assert.deepEqual(missing, [], `unresolved citation keys after the merge:\n${missing.join('\n')}`);
});

test('the coverage statement grew to admit what the extension now models', () => {
  for (const line of cann.COVERS_CANNABIS) assert.ok(merged.COVERS.includes(line), 'a COVERS line from the extension did not arrive');
  for (const line of cann.DOES_NOT_COVER_CANNABIS) assert.ok(merged.DOES_NOT_COVER.includes(line), 'a DOES_NOT_COVER line did not arrive');
  // The core's sedation caveat was REWORDED by the merge (additive sedation is now modelled), so the
  // stale absolute claim must be gone. Leaving it would be a documented lie on every page.
  const stale = merged.DOES_NOT_COVER.filter((l) => /^Additive sedation, respiratory depression/.test(l));
  assert.deepEqual(stale, [], 'DOES_NOT_COVER still claims additive sedation is unmodelled, but it is modelled now');
  assert.ok(merged.DOES_NOT_COVER.some((l) => /Additive CNS depression and GABA-A modulation ARE now modelled/.test(l)),
    'the corrected sedation line is missing');
  const cov = merged.coverage();
  assert.ok(cov.substancesInDataset >= merged.SUBSTANCES.length - 1);
  assert.ok(String(cov.statement).length > 80);
});

test('resolve finds the cannabinoids the extension added, by name and by synonym', () => {
  const added = cann.SUBSTANCES_CANNABIS;
  for (const s of added) {
    const byId = merged.resolve(s.id);
    assert.ok(byId, `resolve() cannot find ${s.id} by id`);
    assert.equal(byId.id, s.id);
    const byName = merged.resolve(s.name);
    assert.ok(byName, `resolve() cannot find ${s.id} by name "${s.name}"`);
    assert.equal(byName.id, s.id);
    for (const syn of s.synonyms || []) {
      const r = merged.resolve(syn);
      assert.ok(r, `resolve() cannot find ${s.id} by its own synonym "${syn}"`);
      assert.equal(r.id, s.id, `synonym "${syn}" resolved to ${r.id} instead of ${s.id}`);
    }
  }
});

test('check() is a total function: any input produces a well-formed result', () => {
  const inputs = [
    '', null, undefined, 'CBD', ['CBD', 'clobazam'], 'CBD, clobazam, grapefruit, kava',
    'not-a-substance', '<script>alert(1)</script>', 0, {}, [], NaN,
    Array(300).fill('CBD'), 'a,'.repeat(400), ';;;,,,\n\n\n',
  ];
  for (const inp of inputs) {
    let r = null;
    assert.doesNotThrow(() => { r = merged.check(inp); }, `check() threw on ${JSON.stringify(inp)}`);
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.recognised));
    assert.ok(Array.isArray(r.unrecognised));
    assert.ok(Array.isArray(r.findings));
    assert.ok(r.coverage && typeof r.coverage.statement === 'string');
    for (const f of r.findings) {
      assert.ok(f.id && f.severity && f.mechanism, 'a finding is missing its id, severity or mechanism');
      assert.ok(['critical', 'major', 'moderate', 'monitor', 'info'].includes(f.severity), `bad severity ${f.severity}`);
      for (const k of f.cites || []) assert.ok(merged.CITES[k], `finding ${f.id} cites unresolvable ${k}`);
    }
  }
});

test('the extension rules actually fire: CBD + clobazam is a documented CYP2C19 finding', () => {
  const r = merged.check('CBD, clobazam');
  assert.equal(r.recognised.length, 2, 'both CBD and clobazam should resolve');
  assert.ok(r.findings.length >= 1, 'CBD + clobazam produced no finding — the extension rules are not wired');
  const text = JSON.stringify(r.findings).toLowerCase();
  assert.match(text, /2c19|norclobazam|clobazam/, 'the finding does not name the CYP2C19 / norclobazam axis');
  for (const f of r.findings) assert.ok((f.cites || []).length >= 1, `finding ${f.id} carries no citation`);
});

test('a cannabinoid stacked with a CNS depressant produces an additive-depression finding', () => {
  const r = merged.check('THC, alcohol');
  if (r.recognised.length === 2) {
    const text = JSON.stringify(r.findings).toLowerCase();
    assert.ok(r.findings.length >= 1, 'THC + alcohol produced no finding');
    assert.match(text, /depress|sedat|cns/, 'no additive-CNS-depression axis in the result');
  } else {
    // If either name is not in the dataset the honest outcome is an unrecognised entry, not a
    // fabricated finding. Assert THAT instead of silently passing.
    assert.ok(r.unrecognised.length >= 1);
  }
});

test('an unrecognised entry is reported as unchecked, and never folded into a clean result', () => {
  const r = merged.check('CBD, zzqq-not-a-substance');
  assert.deepEqual(r.unrecognised, ['zzqq-not-a-substance']);
  assert.match(r.coverage.unrecognisedMeans, /NOT in this dataset/);
  assert.match(r.coverage.unrecognisedMeans, /zzqq-not-a-substance/);
});

test('severity ordering is worst-first, so the page cannot bury a critical finding', () => {
  const rank = { critical: 5, major: 4, moderate: 3, monitor: 2, info: 1 };
  for (const q of ['CBD, clobazam, grapefruit, kava, alcohol', 'phenelzine, aged cheese, tramadol']) {
    const f = merged.check(q).findings;
    for (let i = 1; i < f.length; i += 1) {
      assert.ok(rank[f[i - 1].severity] >= rank[f[i].severity], `${q}: findings are not sorted worst-first`);
    }
  }
});

test('the core engine still works unchanged after the merge', () => {
  // The canonical core case: an MAOI plus tyramine plus a serotonergic opioid. If the merge broke the
  // core rules, this is where it shows.
  const r = merged.check('phenelzine, aged cheese, tramadol');
  assert.equal(r.recognised.length, 3);
  assert.ok(r.findings.length >= 2);
  assert.equal(r.worst, 'critical');
  const text = JSON.stringify(r.findings).toLowerCase();
  assert.match(text, /tyramine/);
  assert.match(text, /serotonin/);
});

test('clinicianExport produces plain text that names what was not checked', () => {
  const e = merged.clinicianExport('CBD, clobazam, zzqq-nothing');
  assert.equal(typeof e.text, 'string');
  assert.ok(e.text.length > 100);
  assert.match(e.text, /zzqq-nothing/, 'the export must carry the unrecognised entries to the clinician');
  assert.doesNotThrow(() => merged.clinicianExport(null));
  assert.doesNotThrow(() => merged.clinicianExport([]));
});

test('every generated interaction path is unique and well formed', () => {
  const ps = merged.interactionPaths();
  assert.ok(ps.length >= 10);
  assert.equal(new Set(ps).size, ps.length, 'interactionPaths() has duplicates');
  for (const p of ps) assert.match(p, /^\/interactions(\/[a-z0-9-]+)?$/, `malformed path ${p}`);
});

test('LAST_REVIEWED is a real ISO date and travels through the merge', () => {
  assert.match(merged.LAST_REVIEWED, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(merged.LAST_REVIEWED, core.LAST_REVIEWED);
});
