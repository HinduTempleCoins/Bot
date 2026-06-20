import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFigure, renderGrid, recognize, describeRecognition } from './structure-recognition.mjs';

const cross = [
  { x: 1, y: 0, z: 5, block: 'black_concrete' }, { x: 1, y: 1, z: 5, block: 'black_concrete' },
  { x: 1, y: 2, z: 5, block: 'minecraft:black_concrete' },
  { x: 0, y: 1, z: 5, block: 'black_concrete' }, { x: 2, y: 1, z: 5, block: 'black_concrete' },
  { x: 0, y: 0, z: 5, block: 'air' }, // air ignored
];

test('extractFigure drops air, normalizes, detects a wall plane', () => {
  const f = extractFigure(cross);
  assert.equal(f.cells.length, 5);
  assert.equal(f.plane, 'wall');     // single z
  assert.equal(f.w, 3);
  assert.equal(f.h, 3);
  assert.ok(f.cells.every((c) => c.x >= 0 && c.y >= 0)); // normalized to origin
});

test('renderGrid draws the shape (# blocks), y-up so the top row is the top', () => {
  const g = renderGrid(extractFigure(cross));
  const rows = g.split('\n');
  assert.equal(rows.length, 3);
  assert.equal(rows[1], '###');     // the crossbar (middle row)
  assert.equal(rows[0], ' # ');     // top of the upright
});

test('recognize asks the model and returns what it depicts', async () => {
  const f = extractFigure(cross);
  let sawGrid = false;
  const r = await recognize(f, { recognize: async (p) => { sawGrid = /###/.test(p); return '{"what":"a cross","confidence":0.8}'; } });
  assert.equal(sawGrid, true);
  assert.equal(r.what, 'a cross');
  assert.ok(r.confidence > 0.5);
});

test('recognize grounds in the corpus when confident (she knows the symbol)', async () => {
  const f = extractFigure(cross);
  const r = await recognize(f, {
    recognize: async () => '{"what":"a cross","confidence":0.8}',
    retrieve: async (q) => { assert.match(q, /cross/); return [{ text: 'the cross — sacrifice and redemption.', source: 'knowledge/scripture' }]; },
  });
  assert.ok(r.knows.includes('knowledge/scripture'));
  assert.match(describeRecognition(r), /I see — a cross.*redemption/);
});

test('recognize soft-fails (empty figure, no model, bad output)', async () => {
  assert.equal((await recognize(extractFigure([]))).what, 'nothing there');
  assert.equal((await recognize(extractFigure(cross), {})).what, 'unclear');
  const r = await recognize(extractFigure(cross), { recognize: async () => { throw new Error('vision down'); } });
  assert.equal(r.what, 'unclear');
});

test('describeRecognition speaks plainly when it cannot tell', () => {
  assert.match(describeRecognition({ what: 'nothing recognizable' }), /cannot make out/);
  assert.match(describeRecognition({ what: 'a bat symbol', recalls: [] }), /I see — a bat symbol/);
});

test('a floor figure is detected and rendered on x/z', () => {
  const floor = [
    { x: 0, y: 64, z: 0, block: 'gold_block' }, { x: 1, y: 64, z: 0, block: 'gold_block' }, { x: 0, y: 64, z: 1, block: 'gold_block' },
  ];
  const f = extractFigure(floor);
  assert.equal(f.plane, 'floor');
  assert.ok(renderGrid(f).includes('#'));
});
