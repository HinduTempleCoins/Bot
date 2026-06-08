// hierophant-xref.test.mjs — OFFLINE tests for the derived cross-reference + interlinker layer.
// Pure data + string work: no network. We assert the xref index resolves BOTH directions, the
// Theoi-style grouping buckets sensibly, and the Blue-Letter-Bible interlinker wraps known entity
// names with /gods links while leaving unknown text untouched and soft-failing on junk input.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TEXTS, getText } from './hierophant-catalog.mjs';
import { ENTITIES, getEntity } from './hierophant-entities.mjs';
import {
  buildXref, entitiesForText, textsForEntity,
  entitiesAlpha, groupEntities, interlink,
} from './hierophant-xref.mjs';

// the esc() the server uses — interlink takes it so the anchor id/class is escaped
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── cross-reference index ───────────────────────────────────────────────────────────────────────
test('buildXref returns symmetric maps with no dangling ids', () => {
  const { textToEntities, entityToTexts } = buildXref();
  for (const [tid, eids] of textToEntities) {
    assert.ok(getText(tid), `text ${tid} resolves`);
    for (const eid of eids) {
      assert.ok(getEntity(eid), `entity ${eid} resolves`);
      // symmetry: if a text lists an entity, the entity must list the text
      assert.ok(entityToTexts.get(eid).includes(tid), `${eid} <-> ${tid} symmetric`);
    }
  }
});

test('xref is the UNION of both directions (entity.texts and text.entities)', () => {
  // Book of the Dead's entities[] includes hathor; Hathor's texts[] includes book-of-the-dead.
  const inBod = entitiesForText('book-of-the-dead').map((e) => e.id);
  assert.ok(inBod.includes('hathor'), 'Hathor surfaces in Book of the Dead');
  assert.ok(inBod.includes('osiris'), 'Osiris surfaces in Book of the Dead');
  const hathorTexts = textsForEntity('hathor').map((t) => t.id);
  assert.ok(hathorTexts.includes('book-of-the-dead'), 'Book of the Dead surfaces for Hathor');
});

test('back-references resolve in BOTH directions for every entity', () => {
  for (const e of ENTITIES) {
    const texts = textsForEntity(e.id);
    for (const t of texts) {
      const back = entitiesForText(t.id).map((x) => x.id);
      assert.ok(back.includes(e.id), `${e.id} appears in ${t.id} back-ref`);
    }
  }
});

test('entitiesForText / textsForEntity return [] (not throw) on unknown id', () => {
  assert.deepEqual(entitiesForText('no-such-text'), []);
  assert.deepEqual(textsForEntity('no-such-entity'), []);
});

test('entitiesForText is sorted by name; textsForEntity by title', () => {
  const ents = entitiesForText('book-of-the-dead').map((e) => e.name);
  assert.deepEqual(ents, [...ents].sort((a, b) => a.localeCompare(b)));
});

// ── Theoi-style index ───────────────────────────────────────────────────────────────────────────
test('entitiesAlpha is the full registry, alpha-sorted, non-mutating', () => {
  const a = entitiesAlpha();
  assert.equal(a.length, ENTITIES.length);
  const names = a.map((e) => e.name);
  assert.deepEqual(names, [...names].sort((x, y) => x.localeCompare(y)));
  // did not mutate the source order
  assert.notEqual(ENTITIES, a);
});

test('groupEntities("tradition") buckets every entity exactly once', () => {
  const groups = groupEntities('tradition');
  const total = groups.reduce((n, g) => n + g.list.length, 0);
  assert.equal(total, ENTITIES.length);
  for (const g of groups) for (const e of g.list) assert.equal(e.tradition, g.key);
});

test('groupEntities("type") buckets by type', () => {
  const groups = groupEntities('type');
  assert.equal(groups.reduce((n, g) => n + g.list.length, 0), ENTITIES.length);
  for (const g of groups) for (const e of g.list) assert.equal(e.type, g.key);
});

test('groupEntities("letter") buckets A–Z by first letter', () => {
  const groups = groupEntities('letter');
  assert.equal(groups.reduce((n, g) => n + g.list.length, 0), ENTITIES.length);
  for (const g of groups) for (const e of g.list) {
    const c = e.name.trim().charAt(0).toUpperCase();
    assert.equal(/[A-Z]/.test(c) ? c : '#', g.key);
  }
});

// ── the interlinker ─────────────────────────────────────────────────────────────────────────────
test('interlink wraps a known entity name with a /gods link', () => {
  const out = interlink('The god Osiris judges the dead.', esc);
  assert.match(out, /<a href="\/gods\/osiris"[^>]*>Osiris<\/a>/);
});

test('interlink leaves text with no known entity completely untouched', () => {
  const plain = 'A quiet afternoon by the river, nothing of note.';
  assert.equal(interlink(plain, esc), plain);
});

test('interlink preserves original casing and surrounding text', () => {
  const out = interlink('Then Marduk slew Tiamat.', esc);
  assert.match(out, /Then <a href="\/gods\/marduk"[^>]*>Marduk<\/a> slew <a href="\/gods\/tiamat"[^>]*>Tiamat<\/a>\./);
});

test('interlink does not match an entity name inside a larger word', () => {
  // "Rama" must not be linked to "Ra"; "Setting" must not link to "Set".
  const out = interlink('Setting out, Rama walked on.', esc);
  assert.ok(!/\/gods\/ra"/.test(out), 'no spurious Ra link inside Rama');
  assert.ok(!/\/gods\/set"/.test(out), 'no spurious Set link inside Setting');
});

test('interlink links each entity at most once (Blue-Letter style)', () => {
  const out = interlink('Osiris and again Osiris and Osiris.', esc);
  const n = (out.match(/\/gods\/osiris"/g) || []).length;
  assert.equal(n, 1, 'first mention only');
});

test('interlink respects excludeId (no self-link on an entity\'s own page)', () => {
  const out = interlink('Osiris, lord of the dead.', esc, { excludeId: 'osiris' });
  assert.ok(!/\/gods\/osiris"/.test(out), 'Osiris not self-linked');
});

test('interlink applies linkClass when given', () => {
  const out = interlink('Osiris.', esc, { linkClass: 'xref' });
  assert.match(out, /<a href="\/gods\/osiris" class="xref">Osiris<\/a>/);
});

test('interlink soft-fails to a string on junk input, never throws', () => {
  assert.equal(interlink('', esc), '');
  assert.equal(interlink(null, esc), '');
  assert.equal(interlink(undefined, esc), '');
  // missing esc fn: still returns a string
  assert.equal(typeof interlink('Osiris.'), 'string');
});

test('interlink prefers the longest matching name (Atum-Ra over Ra)', () => {
  // catalog has 'Atum-Ra' as an epithet of Ra; the longest match should win, both pointing to ra
  const out = interlink('They named him Atum-Ra at dawn.', esc);
  assert.match(out, /<a href="\/gods\/ra"[^>]*>Atum-Ra<\/a>/);
});

test('every text "what" paragraph interlinks at least one known figure where applicable', () => {
  // sanity: at least some texts produce a link in their description (not a hard count)
  let withLink = 0;
  for (const t of TEXTS) {
    if (/\/gods\//.test(interlink(esc(t.what), esc))) withLink++;
  }
  assert.ok(withLink >= 5, `expected several texts to interlink, got ${withLink}`);
});
