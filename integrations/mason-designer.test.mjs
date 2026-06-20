import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDesignPrompt, parseDesign, designStructure, addToLibrary, designJob,
  buildMosaicPrompt, parseMosaic, designMosaic, inspire, ALLOWED_BLOCKS,
} from './mason-designer.mjs';

const structJson = (extra = []) => JSON.stringify({
  name: 'Lapis Shrine', description: 'a lapis-and-gold shrine',
  blocks: [
    { x: 0, y: 0, z: 0, block: 'gold_block' }, { x: 0, y: 1, z: 0, block: 'lapis_block' },
    { x: 0, y: 2, z: 0, block: 'amethyst_block' }, { x: 0, y: 3, z: 0, block: 'sea_lantern' }, ...extra,
  ],
});

test('parseDesign validates into a Mason spec', () => {
  const d = parseDesign(structJson());
  assert.equal(d.spec.length, 4);
  assert.ok(d.spec.every((b) => ALLOWED_BLOCKS.has(b.block)));
  assert.equal(d.name, 'Lapis Shrine');
});

test('parseDesign DROPS illegal blocks (no TNT/lava/command) + out-of-bounds', () => {
  const d = parseDesign(structJson([
    { x: 1, y: 0, z: 0, block: 'tnt' },              // illegal
    { x: 1, y: 0, z: 1, block: 'command_block' },    // illegal
    { x: 99, y: 0, z: 0, block: 'gold_block' },      // out of bounds
  ]));
  assert.equal(d.dropped, 3);
  assert.ok(!d.spec.some((b) => b.block === 'tnt' || b.block === 'command_block'));
});

test('parseDesign rejects junk / too-small designs', () => {
  assert.equal(parseDesign('not json'), null);
  assert.equal(parseDesign(JSON.stringify({ name: 'x', blocks: [{ x: 0, y: 0, z: 0, block: 'gold_block' }] })), null);
});

test('buildDesignPrompt grounds in annals + corpus inspiration + locks the palette', () => {
  const p = buildDesignPrompt({ ask: 'a gate', annals: ['a pylon gateway at 0 68 30'], inspiration: [{ text: 'Anubis weighs the heart', source: 'theoi' }] });
  assert.match(p, /already raised/);
  assert.match(p, /Anubis/);          // inspiration drawn in
  assert.match(p, /ONLY these blocks/);
  assert.match(p, /compact JSON/);
});

test('designStructure draws inspiration via retrieve, then designs', async () => {
  let askedCorpus = false;
  const retrieve = async () => { askedCorpus = true; return [{ text: 'the obelisk caught the first sun', source: 'sacred-texts' }]; };
  const gpu = async (prompt) => { assert.match(prompt, /obelisk/); return structJson(); };
  const d = await designStructure({ ask: 'a monument' }, { gpu, retrieve });
  assert.equal(askedCorpus, true);
  assert.ok(d.spec.length >= 4);
  assert.ok(d.drewFrom.includes('sacred-texts'));
});

test('designStructure soft-fails (no gpu, gpu throws, bad output)', async () => {
  assert.equal(await designStructure({ ask: 'x' }, {}), null);
  assert.equal(await designStructure({ ask: 'x' }, { gpu: async () => { throw new Error('cold'); } }), null);
  assert.equal(await designStructure({ ask: 'x' }, { gpu: async () => 'garbage' }), null);
});

test('addToLibrary keys a validated design for the Mason to build', () => {
  const lib = addToLibrary({}, parseDesign(structJson()));
  assert.ok(lib['lapis-shrine']);
  assert.equal(lib['lapis-shrine'].blocks, 4);
  assert.ok(Array.isArray(lib['lapis-shrine'].spec));
});

test('designJob produces a gpu-scheduler payload', () => {
  const j = designJob('a sun shrine', ['a gateway']);
  assert.equal(j.kind, 'mason-design');
  assert.match(j.prompt, /sun shrine/);
});

test('inspire queries the corpus and soft-fails without a retriever', async () => {
  assert.deepEqual(await inspire(undefined, {}), []);
  const got = await inspire(async (q, { k }) => { assert.ok(q && k); return [{ text: 'Ra', source: 'theoi' }]; }, { ask: 'sun god' });
  assert.equal(got[0].source, 'theoi');
});

test('MOSAIC: parseMosaic builds flat pixel-art, drops non-color blocks', () => {
  const raw = JSON.stringify({ name: 'Eye of Ra', subject: 'the sun eye', blocks: [
    { x: 0, y: 0, z: 0, block: 'gold_block' }, { x: 1, y: 0, z: 0, block: 'yellow_concrete' },
    { x: 2, y: 0, z: 0, block: 'orange_concrete' }, { x: 0, y: 1, z: 0, block: 'black_concrete' },
    { x: 1, y: 1, z: 0, block: 'tnt' },           // illegal -> dropped
    { x: 2, y: 1, z: 0, block: 'air' },           // air -> skipped
  ] });
  const m = parseMosaic(raw);
  assert.equal(m.kind, 'mosaic');
  assert.equal(m.spec.length, 4);
  assert.ok(m.spec.every((b) => b.dz === 0));
  assert.ok(!m.spec.some((b) => b.block === 'tnt'));
});

test('MOSAIC: designMosaic depicts a subject, grounded in the corpus', async () => {
  const retrieve = async () => [{ text: 'Hathor, the cow goddess, wears the sun disk', source: 'theoi' }];
  const gpu = async (prompt) => { assert.match(prompt, /sun disk|Hathor/); return JSON.stringify({ name: 'Hathor', subject: 'the goddess', blocks: [
    { x: 0, y: 0, z: 0, block: 'gold_block' }, { x: 1, y: 0, z: 0, block: 'brown_concrete' }, { x: 0, y: 1, z: 0, block: 'white_concrete' }, { x: 1, y: 1, z: 0, block: 'lapis_block' },
  ] }); };
  const m = await designMosaic({ subject: 'Hathor the goddess' }, { gpu, retrieve });
  assert.equal(m.spec.length, 4);
  assert.ok(m.drewFrom.includes('theoi'));
});

test('STATUE: designStatue sculpts a figure of a named subject, corpus-grounded', async () => {
  const { designStatue, statueJob } = await import('./mason-designer.mjs');
  const retrieve = async () => [{ text: 'Anubis: jackal-headed, holds the ankh, guides the dead', source: 'theoi' }];
  const gpu = async (prompt) => { assert.match(prompt, /Anubis|jackal/); return JSON.stringify({ name: 'Anubis', description: 'the jackal-headed guide', blocks: [
    { x: 0, y: 0, z: 0, block: 'smooth_quartz' }, { x: 0, y: 1, z: 0, block: 'smooth_quartz' }, { x: 0, y: 2, z: 0, block: 'polished_blackstone' }, { x: 0, y: 3, z: 0, block: 'gold_block' },
  ] }); };
  const s = await designStatue({ subject: 'Anubis' }, { gpu, retrieve });
  assert.equal(s.kind, 'statue');
  assert.equal(s.subject, 'Anubis');
  assert.ok(s.spec.length >= 4);
  assert.ok(s.drewFrom.includes('theoi'));
  const j = statueJob('Saint Michael');
  assert.equal(j.kind, 'mason-statue');
});
