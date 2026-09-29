import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYMBOLS, PINS, groupOf } from './symbol-library-spec.mjs';
import { ENTITIES } from './hierophant-entities.mjs';
import { NODES } from './pantheon-map.mjs';
import { DEITIES, ATTRIBUTES } from './divine-attributes.mjs';

const figureIds = new Set([
  ...ENTITIES.map((e) => e.id), ...NODES.map((n) => n.id),
  ...(Array.isArray(DEITIES) ? DEITIES.map((d) => (typeof d === 'string' ? d : d.id)) : Object.keys(DEITIES || {})),
  ...(ATTRIBUTES || []).map((a) => a.deity),
]);

test('ids are unique slugs and the library is 150–250 symbols', () => {
  const ids = SYMBOLS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
  assert.ok(SYMBOLS.length >= 150 && SYMBOLS.length <= 250, `count ${SYMBOLS.length}`);
});

test('every row has tradition, period, meaning, a source article and a way to get an image', () => {
  for (const s of SYMBOLS) {
    assert.ok(s.tradition.length, s.id);
    assert.ok(s.period && s.meaning && s.wiki.length, s.id);
    assert.ok(['attested', 'disputed', 'modern'].includes(s.status), s.id);
    if (s.status !== 'attested') assert.ok(s.note || /modern|\d{4}|c\./.test(s.period), `${s.id} is ${s.status} but says why nowhere`);
    assert.ok(s.file || s.q || s.cp || s.wiki.length, s.id);
    if (s.font) assert.ok(s.cp, `${s.id} is font-rendered but has no code point`);
  }
});

test('figures resolve to Hierophant registry ids', () => {
  for (const s of SYMBOLS) for (const f of s.figures) assert.ok(figureIds.has(f), `${s.id}: unknown figure ${f}`);
});

test('the flagged histories stay flagged', () => {
  const by = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));
  assert.equal(by.vegvisir.status, 'modern');
  assert.match(by.vegvisir.note, /not viking-age/i);
  assert.equal(by.aegishjalmur.status, 'modern');
  assert.equal(by['star-and-crescent'].status, 'modern');
  assert.match(by['star-and-crescent'].note, /not scriptural/i);
  assert.match(by.swastika.note, /nazi/i);
  assert.equal(by['hunab-ku'].status, 'modern');
  assert.equal(by['troll-cross'].status, 'modern');
});

test('pins point at known rows and groups resolve', () => {
  const ids = new Set(SYMBOLS.map((s) => s.id));
  for (const id of Object.keys(PINS)) assert.ok(ids.has(id), id);
  for (const s of SYMBOLS) assert.notEqual(groupOf(s), 'Other', s.id);
});
