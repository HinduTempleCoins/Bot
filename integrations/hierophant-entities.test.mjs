// hierophant-entities.test.mjs — OFFLINE integrity tests for the Hierophant entity registry.
// Pure data: no network. We assert that every entity's type is valid, every text reference resolves
// against the catalog, every relationship target resolves, links are https, Theoi links appear ONLY on
// Greek figures, and Hathor herself is present — so /gods pages never dangle.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TEXT_IDS, getText } from './hierophant-catalog.mjs';
import {
  ENTITIES, ENTITY_TYPES, ENTITY_IDS,
  getEntity, entitiesByTradition, entitiesByType, relationshipsOf, entitiesInText, validateEntities,
} from './hierophant-entities.mjs';

test('validateEntities passes with no errors', () => {
  const { ok, errors } = validateEntities();
  assert.equal(ok, true, `entity errors: ${JSON.stringify(errors)}`);
  assert.deepEqual(errors, []);
});

test('registry is substantial and spans traditions', () => {
  assert.ok(ENTITIES.length >= 60, `expected >=60 entities, got ${ENTITIES.length}`);
  const traditions = new Set(ENTITIES.map((e) => e.tradition));
  assert.ok(traditions.size >= 10, `expected >=10 traditions represented, got ${traditions.size}`);
});

test('every entity id is unique', () => {
  assert.equal(ENTITY_IDS.size, ENTITIES.length);
});

test('every entity has a valid type', () => {
  const types = new Set(ENTITY_TYPES);
  for (const e of ENTITIES) assert.ok(types.has(e.type), `${e.id}: bad type ${e.type}`);
});

test('every entity text reference resolves to a real catalog text', () => {
  for (const e of ENTITIES) {
    for (const tid of (e.texts || [])) {
      assert.ok(TEXT_IDS.has(tid), `${e.id}: text ${tid} does not resolve`);
      assert.ok(getText(tid), `${e.id}: getText(${tid}) null`);
    }
  }
});

test('every relationship target resolves to a real entity', () => {
  for (const e of ENTITIES) {
    for (const r of (e.relationships || [])) {
      assert.ok(ENTITY_IDS.has(r.to), `${e.id}: relationship target ${r.to} dangling`);
    }
  }
});

test('every entity link is https; theoi only on Greek figures; wikipedia always present', () => {
  for (const e of ENTITIES) {
    assert.ok(e.links && e.links.wikipedia, `${e.id}: no wikipedia link`);
    for (const [k, u] of Object.entries(e.links || {})) {
      assert.match(u, /^https:\/\//, `${e.id}: ${k} not https`);
      if (k === 'theoi') assert.equal(e.tradition, 'greek', `${e.id}: theoi link but not Greek`);
    }
  }
});

test('Greek Olympians carry a Theoi link', () => {
  for (const id of ['zeus', 'apollo', 'athena', 'aphrodite']) {
    const e = getEntity(id);
    assert.ok(e, `${id} present`);
    assert.ok(e.links.theoi && /theoi\.com/.test(e.links.theoi), `${id} has theoi link`);
  }
});

test('Hathor is present, Egyptian, and notes her MELEK significance', () => {
  const h = getEntity('hathor');
  assert.ok(h, 'hathor present');
  assert.equal(h.tradition, 'egyptian');
  assert.match(h.desc, /MELEK/, 'hathor desc notes MELEK significance');
});

test('entitiesInText back-references resolve both ways', () => {
  // Book of the Dead lists hathor; entitiesInText must surface her.
  const inBod = entitiesInText('book-of-the-dead').map((e) => e.id);
  assert.ok(inBod.includes('hathor'), 'Hathor appears in Book of the Dead');
  assert.ok(inBod.includes('osiris'), 'Osiris appears in Book of the Dead');
});

test('relationshipsOf resolves to {rel, entity}, skips dangling, never throws', () => {
  const rels = relationshipsOf('osiris');
  assert.ok(rels.length >= 1);
  for (const r of rels) {
    assert.ok(r.entity && r.entity.id, 'resolved relationship has an entity');
    assert.ok(typeof r.rel === 'string' && r.rel.length > 0);
  }
  assert.deepEqual(relationshipsOf('does-not-exist'), []);
});

test('entitiesByTradition + entitiesByType filter correctly', () => {
  const greek = entitiesByTradition('greek');
  assert.ok(greek.length >= 5);
  for (const e of greek) assert.equal(e.tradition, 'greek');
  const gods = entitiesByType('god');
  assert.ok(gods.length >= 5);
  for (const e of gods) assert.equal(e.type, 'god');
});

test('getEntity returns null on miss', () => {
  assert.equal(getEntity('nope'), null);
});
