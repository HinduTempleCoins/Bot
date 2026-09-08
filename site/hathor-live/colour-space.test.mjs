import test from 'node:test';
import assert from 'node:assert/strict';
import {
  D65, hexToRgb, rgbToHex, srgbToLinear, rgbToXyz, rgbToLab, rgbToLuv,
  deltaLab, deltaLuv, deltaRgbUnit, MAX_RGB_UNIT_DISTANCE,
} from './colour-space.mjs';

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} !≈ ${b}`);

test('hex parsing takes both forms and never throws on rubbish', () => {
  assert.deepEqual(hexToRgb('#ff0000'), [255, 0, 0]);
  assert.deepEqual(hexToRgb('f00'), [255, 0, 0]);
  assert.deepEqual(hexToRgb('  #00FF80 '), [0, 255, 128]);
  assert.deepEqual(hexToRgb('not a colour'), [0, 0, 0]);
  assert.deepEqual(hexToRgb(null), [0, 0, 0]);
  assert.equal(rgbToHex([255, 0, 128]), '#ff0080');
  assert.equal(rgbToHex('nope'), '#000000');
});

test('the sRGB transfer function has its linear segment near black, not a plain 2.2 gamma', () => {
  near(srgbToLinear(0), 0, 1e-9);
  near(srgbToLinear(255), 1, 1e-9);
  // At 10/255 the linear segment applies; a naive (c)^2.2 would give a visibly smaller number.
  const c = 10 / 255;
  near(srgbToLinear(10), c / 12.92, 1e-9);
  assert.ok(srgbToLinear(10) > c ** 2.2);
});

test('white maps to the D65 white point and to L*=100 with no chroma', () => {
  const xyz = rgbToXyz([255, 255, 255]);
  near(xyz.X, D65.X, 0.001);
  near(xyz.Y, D65.Y, 0.001);
  near(xyz.Z, D65.Z, 0.001);
  const lab = rgbToLab([255, 255, 255]);
  near(lab.L, 100); near(lab.a, 0, 0.02); near(lab.b, 0, 0.02);
  const luv = rgbToLuv([255, 255, 255]);
  near(luv.L, 100); near(luv.u, 0, 0.02); near(luv.v, 0, 0.02);
});

test('black is finite in CIELUV rather than NaN — a divide-by-zero here would lose a whole sitting', () => {
  const luv = rgbToLuv([0, 0, 0]);
  assert.ok(Number.isFinite(luv.L) && Number.isFinite(luv.u) && Number.isFinite(luv.v));
  near(luv.L, 0); near(luv.u, 0); near(luv.v, 0);
});

test('known sRGB primaries land where CIELAB says they should', () => {
  const red = rgbToLab([255, 0, 0]);
  near(red.L, 53.24, 0.05); near(red.a, 80.09, 0.1); near(red.b, 67.20, 0.1);
  const green = rgbToLab([0, 255, 0]);
  near(green.L, 87.73, 0.05);
  const blue = rgbToLab([0, 0, 255]);
  near(blue.L, 32.30, 0.05);
});

test('identical colours are zero distance in every space', () => {
  for (const c of [[0, 0, 0], [255, 255, 255], [123, 45, 200]]) {
    near(deltaLab(c, c), 0, 1e-9);
    near(deltaLuv(c, c), 0, 1e-9);
    near(deltaRgbUnit(c, c), 0, 1e-9);
  }
});

test('unit-RGB distance is bounded by root three — the Eagleman normalisation', () => {
  near(deltaRgbUnit([0, 0, 0], [255, 255, 255]), MAX_RGB_UNIT_DISTANCE, 1e-9);
  near(MAX_RGB_UNIT_DISTANCE, Math.sqrt(3), 1e-12);
});

test('RGB distance is perceptually non-uniform — which is exactly why it is not the primary metric', () => {
  // Two pairs the same distance apart in RGB, in different regions of the cube. If RGB were
  // perceptually uniform their CIELAB distances would match. They do not, by a wide margin, and
  // that gap is the reason scoreSitting() reports CIELUV and CIELAB alongside the RGB landmark.
  const darkPair = [[0, 0, 0], [0, 40, 0]];
  const lightPair = [[215, 215, 215], [255, 215, 215]];
  near(deltaRgbUnit(...darkPair), deltaRgbUnit(...lightPair), 1e-9);
  const dDark = deltaLab(...darkPair);
  const dLight = deltaLab(...lightPair);
  assert.ok(dDark / dLight > 1.5 || dLight / dDark > 1.5,
    `CIELAB distances ${dDark} vs ${dLight} — expected them to differ substantially`);
});

test('distance is symmetric', () => {
  const a = [10, 200, 30];
  const b = [220, 40, 150];
  near(deltaLuv(a, b), deltaLuv(b, a), 1e-9);
  near(deltaLab(a, b), deltaLab(b, a), 1e-9);
});
