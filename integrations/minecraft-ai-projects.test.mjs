import { test } from 'node:test';
import assert from 'node:assert/strict';
import { all, byKind, dropIn, stealList, summary, handler, PROJECTS } from './minecraft-ai-projects.mjs';

test('catalog covers frameworks, plugins, and research', () => {
  assert.ok(all().length >= 12);
  assert.ok(byKind('framework').length >= 3);
  assert.ok(byKind('plugin').length >= 5);
  assert.ok(byKind('research').length >= 3);
});

test('Mindcraft is present as the top drop-in framework', () => {
  const m = PROJECTS.find((p) => p.name === 'Mindcraft');
  assert.ok(m);
  assert.equal(m.mc, 'yes');
  assert.match(m.steal, /persona|profile/i);
});

test('Project Sid (the AI-society one) is catalogued', () => {
  const s = PROJECTS.find((p) => p.name.includes('Project Sid'));
  assert.ok(s);
  assert.match(s.steal, /society|agents/i);
});

test('dropIn returns only mineflayer-ready projects', () => {
  for (const p of dropIn()) assert.equal(p.mc, 'yes');
  assert.ok(dropIn().some((p) => p.name === 'mineflayer-pathfinder'));
});

test('stealList is ordered by priority and leads with Mindcraft persona', () => {
  const s = stealList();
  assert.equal(s[0].from, 'Mindcraft');
  const ps = s.map((x) => x.priority);
  assert.deepEqual(ps, [...ps].sort((a, b) => a - b));
});

test('summary counts are coherent', () => {
  const s = summary();
  assert.equal(s.total, PROJECTS.length);
  assert.ok(s.dropInNow > 0);
  assert.ok(s.topSteal.includes('Mindcraft'));
});

test('handler returns the catalog + steal list', () => {
  let body = '';
  const res = { writeHead() {}, end(b) { body = b; } };
  handler({ url: '/api/mc-ai?kind=plugin' }, res);
  const j = JSON.parse(body);
  assert.ok(j.projects.every((p) => p.kind === 'plugin'));
  assert.ok(Array.isArray(j.stealList));
});

test('downloadable AI-friend mods are catalogued', async () => {
  const { downloadableMods, DOWNLOADABLE_MODS } = await import('./minecraft-ai-projects.mjs');
  assert.ok(downloadableMods().length >= 4);
  assert.ok(DOWNLOADABLE_MODS.some((m) => m.name.includes('AI-Player') && /your keys|ollama/i.test(m.byok)));
  assert.ok(DOWNLOADABLE_MODS.some((m) => /Player2/.test(m.name)));
});
