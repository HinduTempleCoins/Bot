// dossier.test.mjs — OFFLINE. Reads the committed knowledge/accountability/*.json. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listDossiers, loadDossier, buildProfile, renderDossierPage, buildXrefResolver, normEntity } from './dossier.mjs';

test('listDossiers finds the committed dossiers', async () => {
  const list = await listDossiers();
  assert.ok(list.length >= 2, 'at least paxton + menendez on disk');
  assert.ok(list.some((d) => d.slug === 'ken-paxton'));
  assert.ok(list.some((d) => d.slug === 'bob-menendez'));
});

test('loadDossier rejects bad/path-traversal slugs', async () => {
  assert.equal(await loadDossier('../../etc/passwd'), null);
  assert.equal(await loadDossier('Has Spaces'), null);
  assert.equal(await loadDossier('nope-not-real'), null);
});

test('buildProfile renders Paxton with holdings + sourced events, no verdicts', async () => {
  const p = await buildProfile('ken-paxton');
  assert.ok(p && p.person.name === 'Ken Paxton');
  assert.ok(p.map.holdings.length >= 1, 'WatchGuard holding present');
  assert.ok(p.map.events.length >= 8, 'a full event record');
  // the resignation call + the impeachment + the charge are all present
  assert.ok(p.map.events.some((e) => e.kind === 'resignation-call'));
  assert.ok(p.map.events.some((e) => e.kind === 'impeachment'));
  assert.ok(p.map.events.some((e) => e.kind === 'charge'));
  assert.match(p.html, /Texas Monthly|Associated Press/);
  assert.match(p.html, /we do not render verdicts/, 'no-verdicts discipline line present');
  assert.doesNotMatch(p.html, /class="(verdict|score|rating)"|"score":/i, 'no judgement fields');
});

test('buildProfile renders Menendez (Congress example) with conviction + resignation', async () => {
  const p = await buildProfile('bob-menendez');
  assert.ok(p && p.person.name === 'Bob Menendez');
  assert.ok(p.map.events.some((e) => e.kind === 'resignation'));
  assert.ok(p.map.events.some((e) => e.outcome && /convicted/i.test(e.outcome)));
});

test('renderDossierPage shows the pending-verification banner while unverified', async () => {
  const html = await renderDossierPage('ken-paxton');
  assert.match(html, /pending Resource Center/i);
  const none = await renderDossierPage('no-such-person');
  assert.match(none, /No dossier on file/i);
});

test('normEntity keys names past punctuation and parentheticals', () => {
  assert.equal(normEntity('Defend Texas Liberty PAC'), 'defend texas liberty pac');
  assert.equal(normEntity('Defend Texas Liberty PAC (funded by X & Y)'), 'defend texas liberty pac');
  assert.equal(normEntity('Ken  Paxton.'), 'ken paxton');
  assert.equal(normEntity(null), '');
});

test('buildXrefResolver links known entities and never links a page to itself', async () => {
  const r = await buildXrefResolver('ken-paxton');
  assert.equal(r('Defend Texas Liberty PAC'), '?who=defend-texas-liberty');
  assert.equal(r('Ken Paxton'), null, 'self never links');
  assert.equal(r('Some Unknown LLC'), null, 'no dossier → no link');
});

test('dossier pages cross-link to connected dossiers (who is doing what with who)', async () => {
  // Dunn → DTL → Paxton, and Paxton ↔ DTL, all render as ?who= cross-links.
  const paxton = await buildProfile('ken-paxton');
  assert.match(paxton.html, /class="ent xref" href="\?who=defend-texas-liberty"/,
    'Paxton page links to the PAC that funded him');
  const dtl = await buildProfile('defend-texas-liberty');
  assert.match(dtl.html, /class="ent xref" href="\?who=ken-paxton"/,
    'PAC page links to its beneficiary');
  const dunn = await buildProfile('tim-dunn');
  assert.match(dunn.html, /class="ent xref" href="\?who=defend-texas-liberty"/,
    'Dunn page links to the PAC he funds');
  // a connected entity with no dossier stays plain text (no dangling link)
  assert.doesNotMatch(paxton.html, /href="\?who=watchguard/i);
});
