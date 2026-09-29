// speeches.test.mjs — famous speeches & debates: every entry documented, registered as cleared, grouped. Offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPEECHES, KINDS, LEADS, EXCLUDED, speechesByKind, speechById, speechTile } from './speeches.mjs';
import { licenseLabel, looksLikeRip } from './archive-video.mjs';

test('every speech has a valid IA id, year, kind and a documented public-domain basis', () => {
  const ids = new Set();
  const kinds = new Set(KINDS.map((k) => k.id));
  for (const s of SPEECHES) {
    assert.match(s.id, /^[A-Za-z0-9._-]+$/, s.id);
    assert.ok(!ids.has(s.id), `duplicate ${s.id}`); ids.add(s.id);
    assert.ok(s.title && s.title.length > 3, s.id);
    assert.ok(Number.isInteger(s.year) && s.year >= 1900 && s.year <= 2026, s.id);
    assert.ok(kinds.has(s.kind), `${s.id} kind ${s.kind}`);
    assert.match(s.why, /public domain|17 U\.S\.C\. § 105|CC0/, `${s.id} needs a documented basis`);
    assert.equal(looksLikeRip(s.id, s.title), false, s.id);
    if (s.transcript) assert.match(s.transcript, /^https:\/\/(www\.|er\.jsc\.)?(archives\.gov|nasa\.gov|trumanlibrary\.gov|eisenhowerlibrary\.gov|lbjlibrary\.org|loc\.gov)\//, `${s.id} transcript must be an official source`);
  }
  assert.ok(SPEECHES.length >= 25);
});

test('speeches are cleared at the licence check; excluded and lead-only titles are not played', () => {
  for (const s of SPEECHES) assert.equal(licenseLabel('', [], { id: s.id, title: s.title }).token, 'public-domain', s.id);
  const titles = SPEECHES.map((s) => s.title.toLowerCase()).join(' | ');
  assert.doesNotMatch(titles, /i have a dream/);
  assert.match(EXCLUDED[0].title, /I Have a Dream/);
  assert.ok(LEADS.some((l) => /Kennedy–Nixon/.test(l.title)));
  for (const l of LEADS) assert.match(l.href, /^https:\/\//);
});

test('grouping, lookup and tiles', () => {
  const groups = speechesByKind();
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), SPEECHES.length);
  const moon = groups.find((g) => g.id === 'moon');
  assert.ok(moon.items.every((x, i, a) => i === 0 || a[i - 1].year <= x.year));
  const rice = speechById('1962-09-13_Kennedy_Tour');
  assert.match(rice.transcript, /ricetalk/);
  const t = speechTile(rice);
  assert.equal(t.streamUrl, 'https://archive.org/embed/1962-09-13_Kennedy_Tour');
  assert.equal(t.licenseToken, 'public-domain');
  assert.equal(t.transcript, rice.transcript);
  assert.equal(speechById('nope'), null);
});
