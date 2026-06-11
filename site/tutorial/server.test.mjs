// server.test.mjs — offline tests for the read-only tutorial page (site/tutorial/server.mjs).
// No network, no chain, no LLM: the reader seam is injected with fixture lesson data.
// Asserts the page lists lesson titles/summaries and that HTML in lesson fields is escaped.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, renderTutorialHtml, loadLessons, esc, __setReader } from './server.mjs';

// minimal fake req/res that captures what the handler writes
function fakeReqRes(reqUrl = '/') {
  const res = {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; return this; },
    end(chunk) { if (chunk != null) this.body += chunk; return this; },
  };
  return { req: { url: reqUrl }, res };
}

const FIXTURE = {
  _meta: { version: 2 },
  stages: [
    { id: 1, key: 'intro_post', tier: 'A', label: 'Post an introduction', description: 'New user publishes a top-level post introducing themselves.' },
    { id: 2, key: 'engage_three_posts', tier: 'A', label: 'Comment on three posts', description: 'Leave substantive comments on three distinct authors.' },
    { id: 7, key: 'curation', tier: 'B', label: 'Earn a curation reward', description: 'Vote early on a post that does well.' },
    { id: 14, key: 'converse', tier: 'C', label: 'Talk with the Witness', description: 'Hold a real conversation in the Angelic register.' },
  ],
};

test('renderTutorialHtml lists every lesson title and summary', () => {
  const html = renderTutorialHtml(FIXTURE.stages);
  for (const s of FIXTURE.stages) {
    assert.ok(html.includes(esc(s.label)), `missing title: ${s.label}`);
    assert.ok(html.includes(esc(s.description)), `missing summary: ${s.description}`);
  }
  // tier badges rendered
  assert.ok(html.includes('Tier A'));
  assert.ok(html.includes('Tier B'));
  assert.ok(html.includes('Tier C'));
});

test('renderTutorialHtml escapes HTML in lesson fields', () => {
  const evil = [{ id: 1, tier: 'A', label: '<script>alert(1)</script>', description: 'a & b < c > "d"' }];
  const html = renderTutorialHtml(evil);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag leaked');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'title not escaped');
  assert.ok(html.includes('a &amp; b &lt; c &gt; &quot;d&quot;'), 'summary not escaped');
});

test('renderTutorialHtml soft-fails on non-array / empty input', () => {
  assert.ok(renderTutorialHtml(null).includes('temporarily unavailable'));
  assert.ok(renderTutorialHtml([]).includes('temporarily unavailable'));
  assert.ok(renderTutorialHtml(undefined).includes('temporarily unavailable'));
});

test('renderTutorialHtml tolerates missing fields', () => {
  const html = renderTutorialHtml([{}, { id: 5 }, { label: 'Only a label' }]);
  assert.ok(html.includes('Only a label'));
  assert.ok(html.includes('Lesson')); // fallback title for the empty object
});

test('handler GET / serves a full HTML page listing lesson titles (escaped)', async () => {
  __setReader(() => FIXTURE);
  try {
    const { req, res } = fakeReqRes('/');
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(res.body.startsWith('<!doctype html>'));
    assert.ok(res.body.includes('Post an introduction'));
    assert.ok(res.body.includes('Talk with the Witness'));
    assert.ok(res.body.includes('New user publishes a top-level post introducing themselves.'));
  } finally {
    __setReader(null); // reset to default loader
  }
});

test('handler GET / soft-fails to placeholder when reader throws (still 200, no throw)', async () => {
  __setReader(() => { throw new Error('disk gone'); });
  try {
    const { req, res } = fakeReqRes('/');
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('temporarily unavailable'));
  } finally {
    __setReader(null);
  }
});

test('handler GET /health returns ok', async () => {
  const { req, res } = fakeReqRes('/health');
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('handler unknown path redirects to /', async () => {
  const { req, res } = fakeReqRes('/does-not-exist');
  await handler(req, res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

test('loadLessons returns the real committed 19 stages through the default loader', () => {
  __setReader(null); // default = tutorial/composers.mjs loadStagesDoc()
  const lessons = loadLessons();
  assert.ok(Array.isArray(lessons));
  assert.ok(lessons.length >= 19, `expected >=19 stages, got ${lessons.length}`);
  assert.ok(lessons.every((s) => s && s.label));
});
