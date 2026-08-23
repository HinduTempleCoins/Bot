// pentecaust/herald/creative-studio.test.mjs — offline, deterministic tests for the Herald creative studio.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planCreatives, renderStatic, videoStoryboard, summary, handler, FORMATS, DEFAULT_STYLES,
} from './creative-studio.mjs';

const INPUT = { brand: 'MELEK', product: 'a chain that is yours', goal: 'get paid to post', count: 6 };

test('planCreatives tailors briefs to the inputs', () => {
  const plan = planCreatives(INPUT);
  assert.ok(Array.isArray(plan));
  assert.equal(plan.length, 6);
  for (const c of plan) {
    assert.ok(c.id && c.headline && c.cta && c.prompt, 'every brief is populated');
    assert.ok(FORMATS.includes(c.format), 'format is a known format');
  }
  // Copy is tailored: brand / product / goal show up across the generated fields.
  const blob = JSON.stringify(plan);
  assert.ok(blob.includes('MELEK'), 'brand appears');
  assert.ok(blob.includes('a chain that is yours'), 'product appears');
  assert.ok(blob.includes('get paid to post'), 'goal appears');
  // Variation for A/B: not every headline is identical.
  assert.ok(new Set(plan.map((c) => c.headline)).size > 1, 'headlines vary by index');
});

test('planCreatives is deterministic given the same inputs', () => {
  assert.deepEqual(planCreatives(INPUT), planCreatives(INPUT));
});

test('planCreatives honors count / formats / styles', () => {
  const plan = planCreatives({ brand: 'X', product: 'p', goal: 'g', count: 3, formats: ['static'], styles: ['egypt'] });
  assert.equal(plan.length, 3);
  assert.ok(plan.every((c) => c.format === 'static'), 'only requested format');
  assert.ok(plan.every((c) => c.style === 'egypt'), 'only requested style');
});

test('planCreatives soft-fails on bad input (no throw)', () => {
  assert.deepEqual(planCreatives(null), []);
  assert.deepEqual(planCreatives(42), []);
  assert.deepEqual(planCreatives('nope'), []);
  // A shaped-but-empty object still yields a sensible default plan.
  const p = planCreatives({});
  assert.ok(Array.isArray(p) && p.length >= 1);
});

test('renderStatic returns a shaped SVG via ad-maker', () => {
  const [brief] = planCreatives({ ...INPUT, formats: ['static'], styles: ['kurdish'], count: 1 });
  const r = renderStatic(brief);
  assert.equal(r.ok, true);
  assert.equal(r.format, 'static');
  assert.equal(r.style, 'kurdish');
  assert.ok(typeof r.svg === 'string' && r.svg.startsWith('<svg'), 'delegated to ad-maker buildAdSvg');
  assert.ok(r.svg.includes(brief.headline) || r.svg.includes('&'), 'headline copy flows into the ad');
});

test('renderStatic coerces an unknown style to a valid ad-maker style', () => {
  const r = renderStatic({ id: 'x', style: 'not-a-real-style', headline: 'Hi', cta: 'Go' });
  assert.equal(r.ok, true);
  assert.ok(DEFAULT_STYLES.includes(r.style), 'fell back to a real ad-maker style');
});

test('renderStatic soft-fails on bad input (no throw)', () => {
  const r = renderStatic(null);
  assert.equal(r.ok, false);
  assert.equal(r.format, 'static');
});

test('videoStoryboard produces ordered scenes summing to a sensible duration', () => {
  const [brief] = planCreatives({ ...INPUT, formats: ['video'], count: 1 });
  const sb = videoStoryboard(brief, { scenes: 5 });
  assert.equal(sb.ok, true);
  assert.equal(sb.format, 'video');
  assert.equal(sb.scenes.length, 5);
  // Ordered 1..5
  assert.deepEqual(sb.scenes.map((s) => s.n), [1, 2, 3, 4, 5]);
  // Each scene fully shaped
  for (const s of sb.scenes) {
    assert.ok(s.shot && s.onScreenText && s.voiceover, 'scene populated');
    assert.ok(Number.isFinite(s.seconds) && s.seconds > 0, 'positive seconds');
  }
  // Sensible short-ad duration and the reported total matches the sum.
  const sum = sb.scenes.reduce((a, s) => a + s.seconds, 0);
  assert.equal(sb.totalSeconds, sum);
  assert.ok(sb.totalSeconds >= 5 && sb.totalSeconds <= 45, 'short-ad length');
});

test('videoStoryboard defaults + clamps scene count and is deterministic', () => {
  const [brief] = planCreatives({ ...INPUT, count: 1 });
  assert.equal(videoStoryboard(brief).scenes.length, 4, 'defaults to 4 scenes');
  assert.ok(videoStoryboard(brief, { scenes: 999 }).scenes.length <= 6, 'clamped to the arc length');
  assert.deepEqual(videoStoryboard(brief, { scenes: 3 }), videoStoryboard(brief, { scenes: 3 }));
});

test('videoStoryboard soft-fails on bad input (no throw)', () => {
  const sb = videoStoryboard(null);
  assert.equal(sb.ok, false);
  assert.deepEqual(sb.scenes, []);
  assert.equal(sb.totalSeconds, 0);
});

test('summary counts by format and style', () => {
  const plan = planCreatives(INPUT);
  const s = summary(plan);
  assert.equal(s.total, plan.length);
  const fmtTotal = Object.values(s.byFormat).reduce((a, b) => a + b, 0);
  const styTotal = Object.values(s.byStyle).reduce((a, b) => a + b, 0);
  assert.equal(fmtTotal, plan.length);
  assert.equal(styTotal, plan.length);
});

test('summary soft-fails on bad input (no throw)', () => {
  assert.deepEqual(summary(null), { total: 0, byFormat: {}, byStyle: {} });
  assert.deepEqual(summary('x'), { total: 0, byFormat: {}, byStyle: {} });
  // Accepts a { creatives } wrapper too.
  assert.equal(summary({ creatives: planCreatives(INPUT) }).total, 6);
});

// ── handler ─────────────────────────────────────────────────────────────────────────────────────────────

function mockRes() {
  return {
    code: 0, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers; return this; },
    end(b) { this.body = b || ''; return this; },
  };
}

test('handler GET /health returns ok', async () => {
  const res = mockRes();
  await handler({ url: '/health', method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, service: 'herald-creative-studio' });
});

test('handler POST /api/creatives returns a plan + summary', async () => {
  const res = mockRes();
  await handler({ url: '/api/creatives', method: 'POST', body: INPUT }, res);
  assert.equal(res.code, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.ok, true);
  assert.equal(out.count, 6);
  assert.equal(out.creatives.length, 6);
  assert.equal(out.summary.total, 6);
});

test('handler unknown route soft-fails with escaped error', async () => {
  const res = mockRes();
  await handler({ url: '/nope', method: 'GET' }, res);
  assert.equal(res.code, 404);
  const out = JSON.parse(res.body);
  assert.equal(out.ok, false);
  assert.ok(typeof out.error === 'string');
});
