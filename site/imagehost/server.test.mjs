// site/imagehost/server.test.mjs — offline, mocked backend (never hits the real melek-imagehoster / network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';

// Small cap so the oversize path is cheap to exercise. Set BEFORE importing the module (read at load).
process.env.IMAGEHOST_MAX_BYTES = '2000';
process.env.IMAGEHOST_SERVE_BASE = 'https://melek.salon/img';

const { handler, __setFetch, sniffImage, decodeUpload, esc, safeHref } = await import('./server.mjs');

// A minimal valid PNG-header buffer (magic bytes + padding) — sniffs as image/png.
function pngBytes(len = 64) {
  const b = Buffer.alloc(len, 0);
  b[0] = 0x89; b[1] = 0x50; b[2] = 0x4e; b[3] = 0x47; b[4] = 0x0d; b[5] = 0x0a; b[6] = 0x1a; b[7] = 0x0a;
  return b;
}
const b64 = (buf) => buf.toString('base64');

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
async function post(path, bodyStr) {
  const res = mockRes();
  const req = Readable.from([Buffer.from(bodyStr)]);
  req.url = path; req.method = 'POST';
  await handler(req, res);
  return res;
}
// A backend that echoes a fixed hosted URL (never a real network call).
function fakeBackend(url = 'https://img.melek.salon/deadbeef.png') {
  __setFetch(async () => ({ json: async () => ({ url }) }));
}

test('GET / renders the uploader + all four embed-code labels + Alpha badge', async () => {
  const res = await get('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Drop an image here/);
  assert.match(res.body, /class=alpha>Alpha/);
  // the embed-code UI scaffold (built client-side by field(...) — labels live in the script)
  for (const label of ['Direct link', 'HTML', 'BBCode', 'Markdown']) assert.ok(res.body.includes(label), `page mentions ${label}`);
  assert.match(res.body, /Public host/);           // abuse-posture note
});

test('POST /upload happy path returns {ok,url,hash} with a correct sha256 of the bytes', async () => {
  fakeBackend('https://img.melek.salon/deadbeef.png');
  const bytes = pngBytes(200);
  const res = await post('/upload', JSON.stringify({ filename: 'cat.png', data: b64(bytes) }));
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.equal(j.hash, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(j.bytes, 200);
  assert.equal(j.type, 'image/png');
  // serve-base rewrite applied: backend host swapped for the public path, filename preserved
  assert.equal(j.url, 'https://melek.salon/img/deadbeef.png');
});

test('POST /upload accepts a data: URL prefixed base64 payload', async () => {
  fakeBackend();
  const bytes = pngBytes(48);
  const res = await post('/upload', JSON.stringify({ filename: 'x.png', data: 'data:image/png;base64,' + b64(bytes) }));
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.equal(j.hash, crypto.createHash('sha256').update(bytes).digest('hex'));
});

test('POST /upload rejects a non-image payload with {ok:false} (no throw)', async () => {
  fakeBackend();
  const res = await post('/upload', JSON.stringify({ filename: 'evil.txt', data: b64(Buffer.from('this is not an image at all!!')) }));
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, false);
  assert.match(j.error, /images only/i);
});

test('POST /upload rejects oversize with {ok:false} (no throw)', async () => {
  fakeBackend();
  const res = await post('/upload', JSON.stringify({ filename: 'big.png', data: b64(pngBytes(3000)) })); // > 2000 cap
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, false);
  assert.match(j.error, /too large/i);
});

test('a malicious backend URL is stripped by safeHref -> {ok:false} (no javascript: url leaks out)', async () => {
  __setFetch(async () => ({ json: async () => ({ url: 'javascript:alert(1)' }) }));
  const res = await post('/upload', JSON.stringify({ filename: 'ok.png', data: b64(pngBytes(40)) }));
  const j = JSON.parse(res.body);
  assert.equal(j.ok, false);
  assert.ok(!res.body.includes('javascript:'), 'no javascript: URL is ever reflected');
});

test('a crafted XSS filename is never reflected into the response JSON', async () => {
  fakeBackend();
  const evil = '"><img src=x onerror=alert(1)>.png';
  const res = await post('/upload', JSON.stringify({ filename: evil, data: b64(pngBytes(40)) }));
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.ok(!res.body.includes('onerror='), 'the crafted filename is not echoed back');
  // esc() neutralizes the payload if it were ever interpolated into HTML
  assert.ok(!esc(evil).includes('<img'), 'esc escapes angle brackets');
});

test('backend refusal is surfaced as {ok:false} with the backend message', async () => {
  __setFetch(async () => ({ json: async () => ({ error: 'image too large (max 12 MB)' }) }));
  const res = await post('/upload', JSON.stringify({ filename: 'ok.png', data: b64(pngBytes(40)) }));
  const j = JSON.parse(res.body);
  assert.equal(j.ok, false);
  assert.match(j.error, /12 MB/);
});

test('backend unreachable is caught, never throws', async () => {
  __setFetch(async () => { throw new Error('ECONNREFUSED'); });
  const res = await post('/upload', JSON.stringify({ filename: 'ok.png', data: b64(pngBytes(40)) }));
  const j = JSON.parse(res.body);
  assert.equal(j.ok, false);
  assert.match(j.error, /unreachable/i);
});

test('POST /upload with malformed (non-JSON) body -> {ok:false}, no throw', async () => {
  fakeBackend();
  const res = await post('/upload', 'not json at all');
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, false);
});

test('GET /health returns ok JSON', async () => {
  const res = await get('/health');
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.equal(j.max_bytes, 2000);
});

test('GET /robots.txt disallows /upload', async () => {
  const res = await get('/robots.txt');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Disallow: \/upload/);
});

test('unknown route 404s, handler never throws on odd input', async () => {
  const res = await get('/nope/../%zz');
  assert.equal(res.statusCode, 404);
});

test('unit: sniffImage / decodeUpload / safeHref behave', () => {
  assert.equal(sniffImage(pngBytes(20)).type, 'image/png');
  assert.equal(sniffImage(Buffer.from('hello world!!')), null);
  assert.equal(sniffImage(null), null);
  assert.equal(decodeUpload('{bad json').error !== undefined, true);
  assert.equal(safeHref('https://x/y'), 'https://x/y');
  assert.equal(safeHref('javascript:alert(1)'), '');
});
