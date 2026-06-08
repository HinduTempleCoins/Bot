// server.test.mjs — offline tests for the GenAI page: routes render, generate path with an injected
// adapter, rate limit, esc on nasty input, image serving + path-traversal guard. No network, no real keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// point DATA_DIR + a low rate limit BEFORE importing the server (read at module load)
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'genai-test-'));
process.env.GENAI_RATE_PER_HOUR = '3';

const srv = await import('./server.mjs');
const { handler, homePage, templatesIndexView, templateDetailView, galleryView, promptFromParams, esc, __setGenerator, __resetRate,
  comfyIndexView, comfyDetailView, colabIndexView, reelIndexView, reelDetailView, reelSpecFromParams } = srv;

const B64 = Buffer.from('a-real-enough-image-payload').toString('base64');
// canned adapter — never touches the network
function cannedAdapter() {
  __setGenerator(async ({ prompt, size, seed }) => ({
    ok: true, provider: 'pollinations', mime: 'image/png', base64: B64,
    bytes: 100, prompt, size, seed, note: 'Pollinations.ai (free, keyless)',
  }));
}

// minimal mock req/res
function mockReq({ method = 'GET', url = '/', body = '', headers = {} } = {}) {
  const listeners = {};
  const req = {
    method, url, headers, socket: { remoteAddress: headers['x-test-ip'] || '1.2.3.4' },
    on(ev, cb) { listeners[ev] = cb; return req; },
    _emit() { if (body && listeners.data) listeners.data(Buffer.from(body)); if (listeners.end) listeners.end(); },
  };
  return req;
}
function mockRes() {
  return {
    statusCode: 0, headers: {}, body: null, _buf: [],
    writeHead(code, h) { this.statusCode = code; if (h) Object.assign(this.headers, h); },
    end(d) { if (d != null) this._buf.push(d); this.body = this._buf.map((b) => (Buffer.isBuffer(b) ? b : Buffer.from(String(b)))).reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0)); this._done = true; },
    text() { return this.body ? this.body.toString('utf8') : ''; },
  };
}
async function call(opts) {
  const req = mockReq(opts);
  const res = mockRes();
  const p = handler(req, res);
  req._emit();
  await p;
  // give async handlers a tick
  await new Promise((r) => setTimeout(r, 5));
  return res;
}

test('home page renders with prompt box and templates', () => {
  const html = homePage();
  assert.ok(html.includes('<h1>Generative AI'));
  assert.ok(html.includes('name=prompt'));
  assert.ok(html.includes('/api/generate'));
});

test('templates index lists all categories', () => {
  const html = templatesIndexView();
  assert.ok(html.includes('Templates'));
  assert.ok(html.includes('egyptian-temple-poster'));
});

test('template detail renders slot fields', () => {
  const html = templateDetailView('coin-token-logo');
  assert.ok(html.includes('Coin name'));
  assert.ok(html.includes('name=template value="coin-token-logo"'));
  assert.ok(html.includes('slot_name'));
});

test('unknown template detail → not-found page', () => {
  const html = templateDetailView('nope');
  assert.ok(html.includes('Template not found'));
});

test('promptFromParams builds prompt from template + slots', () => {
  const p = new URLSearchParams({ template: 'coin-token-logo', slot_name: 'MELEK', slot_symbol: 'ankh', slot_metal: 'gold' });
  const r = promptFromParams(p);
  assert.ok(r.prompt.includes('MELEK'));
  assert.ok(r.prompt.includes('ankh'));
});

test('promptFromParams uses explicit prompt when no template', () => {
  const r = promptFromParams(new URLSearchParams({ prompt: 'a cat', size: '512x512' }));
  assert.equal(r.prompt, 'a cat');
  assert.equal(r.size, '512x512');
});

test('GET / returns 200 html', async () => {
  const res = await call({ url: '/' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.text().includes('Generative AI'));
});

test('/health reports templates + providers ok', async () => {
  const res = await call({ url: '/health' });
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.text());
  assert.equal(j.ok, true);
  assert.ok(j.templates >= 12);
  assert.ok(Array.isArray(j.providers));
});

test('robots/sitemap/llms routes respond', async () => {
  assert.equal((await call({ url: '/robots.txt' })).statusCode, 200);
  assert.equal((await call({ url: '/sitemap.xml' })).statusCode, 200);
  assert.equal((await call({ url: '/llms.txt' })).statusCode, 200);
});

test('POST /api/generate with injected adapter stores + serves image', async () => {
  __resetRate(); cannedAdapter();
  const res = await call({
    method: 'POST', url: '/api/generate',
    headers: { 'x-test-ip': '10.0.0.1', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'prompt=' + encodeURIComponent('an Egyptian temple'),
  });
  assert.equal(res.statusCode, 200);
  const html = res.text();
  assert.ok(html.includes('Your image'));
  assert.ok(html.includes('Pollinations'));
  // the result references an /img/ file we can now fetch
  const m = html.match(/\/img\/([\w.-]+\.png)/);
  assert.ok(m, 'result page links to a stored image');
  const img = await call({ url: '/img/' + m[1], headers: { 'x-test-ip': '10.0.0.1' } });
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers['content-type'], 'image/png');
});

test('GET /api/generate is 405', async () => {
  const res = await call({ url: '/api/generate', method: 'GET' });
  assert.equal(res.statusCode, 405);
});

test('empty prompt → 400 with note', async () => {
  __resetRate(); cannedAdapter();
  const res = await call({
    method: 'POST', url: '/api/generate',
    headers: { 'x-test-ip': '10.0.0.2', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'prompt=' + encodeURIComponent('   '),
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.text().includes('Please enter a prompt'));
});

test('rate limit kicks in after the per-hour cap', async () => {
  __resetRate(); cannedAdapter();
  const ip = '10.0.0.99';
  for (let i = 0; i < 3; i++) {
    const r = await call({ method: 'POST', url: '/api/generate', headers: { 'x-test-ip': ip, 'content-type': 'application/x-www-form-urlencoded' }, body: 'prompt=cat' });
    assert.equal(r.statusCode, 200);
  }
  const blocked = await call({ method: 'POST', url: '/api/generate', headers: { 'x-test-ip': ip, 'content-type': 'application/x-www-form-urlencoded' }, body: 'prompt=cat' });
  assert.equal(blocked.statusCode, 429);
});

test('esc() neutralises nasty input in the result page', async () => {
  __resetRate(); cannedAdapter();
  const nasty = '<script>alert(1)</script>';
  const res = await call({
    method: 'POST', url: '/api/generate',
    headers: { 'x-test-ip': '10.0.0.7', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'prompt=' + encodeURIComponent(nasty),
  });
  const html = res.text();
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must not appear');
  assert.ok(html.includes('&lt;script&gt;'), 'should be escaped');
});

test('esc helper escapes the basics', () => {
  assert.equal(esc('<a>&"'), '&lt;a&gt;&amp;&quot;');
});

test('/img path-traversal is blocked', async () => {
  const res = await call({ url: '/img/' + encodeURIComponent('../../../etc/passwd') });
  assert.equal(res.statusCode, 404);
});

test('/img rejects non-image extensions', async () => {
  const res = await call({ url: '/img/notes.json' });
  assert.equal(res.statusCode, 404);
});

test('gallery view renders', async () => {
  const html = galleryView();
  assert.ok(html.includes('Gallery'));
});

test('unknown path redirects to /', async () => {
  const res = await call({ url: '/whatever' });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

// ── the open competitor directory (operator 2026-06-06: Bing & friends on the page) ──
test('/directory renders the full generator directory — Bing, CapCut, zero-signup lane', async () => {
  const res = await call({ url: '/directory' });
  assert.equal(res.statusCode, 200);
  const html = res.text();
  for (const name of ['Bing Image Creator', 'CapCut', 'Ideogram', 'Craiyon']) {
    assert.ok(html.includes(name), `directory missing ${name}`);
  }
  assert.ok(html.includes('Zero signup'), 'zero-signup lane present');
  assert.ok(html.includes('rel="noopener nofollow"'), 'external links carry noopener nofollow');
});

test('homepage teases the directory ("More ways to make images")', () => {
  const html = homePage();
  assert.ok(html.includes('More ways to make images'));
  assert.ok(html.includes('/directory'));
});

// ── GenAI phase 2: ComfyUI / Colab / reel maker ──
test('/comfyui lists workflows and a kind heading', async () => {
  const res = await call({ url: '/comfyui' });
  assert.equal(res.statusCode, 200);
  const html = res.text();
  assert.ok(html.includes('ComfyUI'));
  assert.ok(html.includes('sd15-txt2img-basic') || html.includes('Text to Image'));
  assert.ok(html.includes('workflow JSON'));
});

test('/comfyui/:id detail renders the workflow JSON', async () => {
  const res = await call({ url: '/comfyui/sdxl-txt2img' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.text().includes('CheckpointLoaderSimple'));
});

test('/comfyui/:id.json downloads valid workflow JSON with attachment header', async () => {
  const res = await call({ url: '/comfyui/sd15-txt2img-basic.json' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers['content-type'].includes('application/json'));
  assert.ok(String(res.headers['content-disposition']).includes('attachment'));
  const parsed = JSON.parse(res.text());
  assert.ok(parsed['9'].class_type.includes('Save'));
});

test('/comfyui unknown id → 404 page, unknown .json → 404', async () => {
  assert.equal((await call({ url: '/comfyui/nope' })).statusCode, 404);
  assert.equal((await call({ url: '/comfyui/nope.json' })).statusCode, 404);
});

test('/colab lists notebooks with Open-in-Colab links', async () => {
  const res = await call({ url: '/colab' });
  assert.equal(res.statusCode, 200);
  const html = res.text();
  assert.ok(html.includes('Colab'));
  assert.ok(html.includes('colab.research.google.com'));
  assert.ok(html.includes('rel="noopener nofollow"'));
});

test('/reel-maker lists templates', async () => {
  const res = await call({ url: '/reel-maker' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.text().includes('Reel template maker'));
});

test('/reel-maker/:id renders a fill form + example storyboard', async () => {
  const res = await call({ url: '/reel-maker/hook-explainer' });
  assert.equal(res.statusCode, 200);
  const html = res.text();
  assert.ok(html.includes('f_topic'));
  assert.ok(html.includes('Build storyboard'));
});

test('POST /reel-maker/:id downloads a storyboard JSON with shotlist', async () => {
  const res = await call({
    method: 'POST', url: '/reel-maker/hook-explainer',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'f_hook=' + encodeURIComponent('STOP scrolling') + '&aspect=1:1',
  });
  assert.equal(res.statusCode, 200);
  assert.ok(String(res.headers['content-disposition']).includes('attachment'));
  const spec = JSON.parse(res.text());
  assert.equal(spec.kind, 'reel-storyboard');
  assert.equal(spec.aspect, '1:1');
  assert.ok(typeof spec.shotlist === 'string' && spec.shotlist.length > 0);
  assert.ok(spec.scenes.some((s) => s.caption.includes('STOP scrolling')));
});

test('POST /reel-maker/:id unknown id → 404', async () => {
  const res = await call({ method: 'POST', url: '/reel-maker/nope',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'f_hook=x' });
  assert.equal(res.statusCode, 404);
});

test('reelSpecFromParams embeds the shotlist', () => {
  const p = new URLSearchParams({ 'f_hook': 'hi' });
  const r = reelSpecFromParams('hook-explainer', p);
  assert.equal(r.ok, true);
  assert.ok(r.spec.shotlist.includes('Hook'));
});

test('view exports render without throwing', () => {
  assert.ok(comfyIndexView().includes('ComfyUI'));
  assert.ok(comfyDetailView('flux-txt2img').includes('FLUX'));
  assert.ok(colabIndexView().includes('Colab'));
  assert.ok(reelIndexView().includes('Reel'));
  assert.ok(reelDetailView('quote-card').includes('Quote'));
});

test('/health includes the phase-2 libraries', async () => {
  const res = await call({ url: '/health' });
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.text());
  assert.ok(j.comfyTemplates >= 6);
  assert.ok(j.colabTemplates >= 6);
  assert.ok(j.reelTemplates >= 4);
});

test('homepage teases the phase-2 sections', () => {
  const html = homePage();
  assert.ok(html.includes('/comfyui'));
  assert.ok(html.includes('/colab'));
  assert.ok(html.includes('/reel-maker'));
});

test('sitemap includes the new sections', async () => {
  const xml = (await call({ url: '/sitemap.xml' })).text();
  assert.ok(xml.includes('/comfyui'));
  assert.ok(xml.includes('/colab'));
  assert.ok(xml.includes('/reel-maker'));
});
