import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composePrompt, labelRefs, normRole, buildReferenceSheet } from './genai-compose.mjs';

test('normRole clamps to a known role', () => {
  assert.equal(normRole('CHARACTER'), 'character');
  assert.equal(normRole('bogus'), 'object');
});

test('labelRefs numbers repeats per role', () => {
  const l = labelRefs([{ role: 'character' }, { role: 'character' }, { role: 'scene' }]);
  assert.equal(l[0].slot, 'CHARACTER 1');
  assert.equal(l[1].slot, 'CHARACTER 2');
  assert.equal(l[2].slot, 'SCENE'); // single → no number
});

test('composePrompt names slots, stays compact, forbids grid/text', () => {
  const p = composePrompt([{ role: 'character', label: 'Ava' }, { role: 'object', label: 'gold ring' }, { role: 'scene', label: 'temple' }], 'golden hour');
  assert.match(p, /CHARACTER Ava/);
  assert.match(p, /gold ring/);
  assert.match(p, /temple/);
  assert.match(p, /golden hour/);
  assert.match(p, /no panels, no text/);
  assert.ok(p.length <= 300, 'prompt is capped for URL-safe conditioning');
});

test('composePrompt strips newlines and caps very long user prompts', () => {
  const p = composePrompt([{ role: 'character', label: 'A' }], 'x\n\ny '.repeat(200));
  assert.ok(!/[\r\n]/.test(p));
  assert.ok(p.length <= 300);
});

test('buildReferenceSheet makes one PNG from several refs, skips unreadable', async () => {
  const sharp = (await import('sharp')).default;
  const red = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
  const blue = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 40, g: 40, b: 200 } } }).png().toBuffer();
  const out = await buildReferenceSheet([
    { buffer: red, role: 'character', label: 'A' },
    { buffer: blue, role: 'object', label: 'ring' },
    { buffer: Buffer.from('not an image'), role: 'scene', label: 'x' }, // unreadable → skipped, no throw
  ], { sharp });
  assert.ok(Buffer.isBuffer(out) && out.length > 100);
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'png');
  assert.ok(meta.width > 0 && meta.height > 0);
});

test('buildReferenceSheet throws only when nothing is usable', async () => {
  const sharp = (await import('sharp')).default;
  await assert.rejects(() => buildReferenceSheet([], { sharp }));
});
