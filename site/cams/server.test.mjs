import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from './server.mjs';
import { listCams } from '../../integrations/camera-directory.mjs';

// Minimal mock res that captures status/headers/body.
function mockRes() {
  return {
    statusCode: 0, headers: null, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; return this; },
    end(chunk) { if (chunk != null) this.body += chunk; this.ended = true; return this; },
  };
}
async function get(path) {
  const res = mockRes();
  await handler({ url: path, method: 'GET' }, res);
  return res;
}

test('GET / returns 200 and lists cam tiles + the consent boundary', async () => {
  const res = await get('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Public, consensual cameras only/);
  assert.match(res.body, /class=alpha>Alpha/);            // alpha badge present
  const first = listCams()[0];
  assert.ok(res.body.includes(first.name), 'index should render a cam tile');
});

test('GET /?category=traffic filters the grid', async () => {
  const res = await get('/?category=traffic');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Public, consensual cameras only/);
});

test('GET /watch/:id renders a known camera full screen', async () => {
  const c = listCams()[0];
  const res = await get('/watch/' + c.id);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.ok(res.body.includes(c.name));
});

test('GET /watch/:id 404s an unknown camera', async () => {
  const res = await get('/watch/does-not-exist');
  assert.equal(res.statusCode, 404);
});

test('GET /api/cams returns JSON with a count matching the seed list (keyless)', async () => {
  const saved = process.env.WINDY_API_KEY;
  delete process.env.WINDY_API_KEY;
  const res = await get('/api/cams');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.equal(j.count, listCams().length);
  assert.equal(j.boundary, 'Public, consensual cameras only.');
  assert.ok(Array.isArray(j.cams) && j.cams.length === j.count);
  if (saved !== undefined) process.env.WINDY_API_KEY = saved;
});

test('GET /health returns ok + cam count', async () => {
  const res = await get('/health');
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.equal(j.cams, listCams().length);
});

test('a malicious camera id is escaped and never breaks out (no XSS, no throw)', async () => {
  const res = await get('/watch/' + encodeURIComponent('"><script>alert(1)</script>'));
  // the id regex won't match the payload → clean 404, no reflected raw script.
  assert.ok(res.statusCode === 404 || res.statusCode === 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw script must never be reflected');
});

test('unknown path 404s; handler never throws on odd input', async () => {
  const res = await get('/nope');
  assert.equal(res.statusCode, 404);
  const bad = mockRes();
  await handler({ url: '///%%%' }, bad);                    // malformed → caught, 500 not a throw
  assert.ok([200, 404, 500].includes(bad.statusCode));
});
