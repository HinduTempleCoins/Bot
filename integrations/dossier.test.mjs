// dossier.test.mjs — OFFLINE. Reads the committed knowledge/accountability/*.json. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listDossiers, loadDossier, buildProfile, renderDossierPage } from './dossier.mjs';

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
