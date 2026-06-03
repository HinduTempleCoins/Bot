import { test } from 'node:test';
import assert from 'node:assert';
import {
  supports, honestCaveat, ENGINES, engineReady,
  shapeGotenbergToPdf, shapeStirlingPdfToOffice, shapeTikaExtract, shapePandocConvert,
  toPdf, extractText, convert, __setFetch,
} from './docconvert.mjs';

// ---------------------------------------------------------------------------
// PURE capability map — supports() / honestCaveat(). No network, no env.
// ---------------------------------------------------------------------------

test('supports: Office/markup → PDF', () => {
  assert.ok(supports('docx', 'pdf'));
  assert.ok(supports('doc', 'pdf'));
  assert.ok(supports('xlsx', 'pdf'));
  assert.ok(supports('pptx', 'pdf'));
  assert.ok(supports('html', 'pdf'));
  assert.ok(supports('md', 'pdf'));
});

test('supports: PDF → editable Office (best-effort)', () => {
  assert.ok(supports('pdf', 'docx'));
  assert.ok(supports('pdf', 'doc'));
  assert.ok(supports('pdf', 'odt'));
});

test('supports: markup ↔ markup via Pandoc', () => {
  assert.ok(supports('md', 'html'));
  assert.ok(supports('html', 'latex'));
  assert.ok(supports('rst', 'docx'));
});

test('supports: identity and case/dot-insensitivity', () => {
  assert.ok(supports('pdf', 'pdf'));
  assert.ok(supports('.DOCX', 'PDF'));
});

test('supports: rejects unsupported / empty pairs', () => {
  assert.equal(supports('pdf', 'xlsx'), false, 'no PDF → spreadsheet');
  assert.equal(supports('jpg', 'docx'), false);
  assert.equal(supports('', 'pdf'), false);
  assert.equal(supports('pdf', ''), false);
});

test('honestCaveat: DOC→PDF is high-fidelity', () => {
  assert.equal(honestCaveat('doc', 'pdf'), 'high-fidelity');
  assert.equal(honestCaveat('docx', 'pdf'), 'high-fidelity');
});

test('honestCaveat: PDF→DOCX is best-effort reflow', () => {
  assert.match(honestCaveat('pdf', 'docx'), /best-effort reflow/);
  assert.match(honestCaveat('pdf', 'doc'), /best-effort reflow/);
});

test('honestCaveat: markup and identity and unsupported', () => {
  assert.match(honestCaveat('md', 'html'), /markup/);
  assert.match(honestCaveat('pdf', 'pdf'), /identity/);
  assert.equal(honestCaveat('jpg', 'docx'), null, 'unsupported → null');
});

// ---------------------------------------------------------------------------
// Engine config — soft-fail when env unset (PURE-ish, reads env).
// ---------------------------------------------------------------------------

test('ENGINES map covers the four engines with env names', () => {
  assert.deepEqual(Object.keys(ENGINES).sort(), ['gotenberg', 'pandoc', 'stirling', 'tika']);
  assert.equal(ENGINES.gotenberg.env, 'GOTENBERG_URL');
  assert.equal(ENGINES.stirling.env, 'STIRLING_URL');
  assert.equal(ENGINES.tika.env, 'TIKA_URL');
  assert.equal(ENGINES.pandoc.env, 'PANDOC_URL');
});

test('engineReady is false when env unset, true when set', () => {
  const saved = process.env.GOTENBERG_URL;
  delete process.env.GOTENBERG_URL;
  assert.equal(engineReady('gotenberg'), false);
  process.env.GOTENBERG_URL = 'http://gotenberg:3000';
  assert.equal(engineReady('gotenberg'), true);
  if (saved === undefined) delete process.env.GOTENBERG_URL; else process.env.GOTENBERG_URL = saved;
});

test('soft-fail: toPdf throws clearly when Gotenberg unset', async () => {
  const saved = process.env.GOTENBERG_URL;
  delete process.env.GOTENBERG_URL;
  await assert.rejects(() => toPdf({ input: 'x', format: 'docx' }), /not configured.*GOTENBERG_URL/);
  if (saved !== undefined) process.env.GOTENBERG_URL = saved;
});

// ---------------------------------------------------------------------------
// Request shaping — with env set, no network (we only inspect the shaped request).
// ---------------------------------------------------------------------------

test('shapeGotenbergToPdf targets libreoffice convert + POST multipart', () => {
  process.env.GOTENBERG_URL = 'http://gotenberg:3000/';
  const { url, options } = shapeGotenbergToPdf({ input: 'hello', filename: 'document.docx' });
  assert.equal(url, 'http://gotenberg:3000/forms/libreoffice/convert', 'trailing slash stripped');
  assert.equal(options.method, 'POST');
  assert.ok(options.body instanceof FormData);
});

test('shapeStirlingPdfToOffice maps docx→word endpoint', () => {
  process.env.STIRLING_URL = 'http://stirling:8080';
  const { url, options } = shapeStirlingPdfToOffice({ input: 'pdfbytes', to: 'docx' });
  assert.equal(url, 'http://stirling:8080/api/v1/convert/pdf/word');
  assert.equal(options.method, 'POST');
  assert.ok(options.body instanceof FormData);
});

test('shapeTikaExtract PUTs raw bytes asking for text/plain', () => {
  process.env.TIKA_URL = 'http://tika:9998';
  const { url, options } = shapeTikaExtract({ input: 'rawbytes' });
  assert.equal(url, 'http://tika:9998/tika');
  assert.equal(options.method, 'PUT');
  assert.equal(options.headers.accept, 'text/plain');
  assert.equal(options.body, 'rawbytes');
});

test('shapePandocConvert sends JSON with from/to/text', () => {
  process.env.PANDOC_URL = 'http://pandoc:80';
  const { url, options } = shapePandocConvert({ input: '# Hi', from: 'md', to: 'html' });
  assert.equal(url, 'http://pandoc:80/convert');
  assert.equal(options.headers['content-type'], 'application/json');
  const body = JSON.parse(options.body);
  assert.deepEqual(body, { from: 'md', to: 'html', text: '# Hi' });
});

// ---------------------------------------------------------------------------
// Network API with INJECTED fetch — confirms routing + caveat plumbing, no real I/O.
// ---------------------------------------------------------------------------

test('convert routes md→html through Pandoc (injected fetch)', async () => {
  process.env.PANDOC_URL = 'http://pandoc:80';
  let hitUrl = null;
  __setFetch(async (url) => { hitUrl = url; return { ok: true, status: 200, text: async () => '<p>Hi</p>' }; });
  const { data, caveat } = await convert({ input: '# Hi', from: 'md', to: 'html' });
  assert.equal(hitUrl, 'http://pandoc:80/convert');
  assert.equal(data, '<p>Hi</p>');
  assert.match(caveat, /markup/);
  __setFetch(null);
});

test('convert routes docx→pdf through Gotenberg with high-fidelity caveat (injected fetch)', async () => {
  process.env.GOTENBERG_URL = 'http://gotenberg:3000';
  let hitUrl = null;
  __setFetch(async (url) => { hitUrl = url; return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) }; });
  const { data, caveat } = await convert({ input: 'docbytes', from: 'docx', to: 'pdf' });
  assert.equal(hitUrl, 'http://gotenberg:3000/forms/libreoffice/convert');
  assert.ok(data instanceof ArrayBuffer);
  assert.equal(caveat, 'high-fidelity');
  __setFetch(null);
});

test('convert routes pdf→docx through Stirling with best-effort caveat (injected fetch)', async () => {
  process.env.STIRLING_URL = 'http://stirling:8080';
  let hitUrl = null;
  __setFetch(async (url) => { hitUrl = url; return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }; });
  const { caveat } = await convert({ input: 'pdfbytes', from: 'pdf', to: 'docx' });
  assert.equal(hitUrl, 'http://stirling:8080/api/v1/convert/pdf/word');
  assert.match(caveat, /best-effort reflow/);
  __setFetch(null);
});

test('extractText calls Tika and returns text (injected fetch)', async () => {
  process.env.TIKA_URL = 'http://tika:9998';
  __setFetch(async () => ({ ok: true, status: 200, text: async () => 'extracted body' }));
  assert.equal(await extractText({ input: 'anybytes' }), 'extracted body');
  __setFetch(null);
});

test('convert rejects unsupported pair before any fetch', async () => {
  let called = false;
  __setFetch(async () => { called = true; return { ok: true, status: 200 }; });
  await assert.rejects(() => convert({ input: 'x', from: 'jpg', to: 'docx' }), /not supported/);
  assert.equal(called, false, 'no network for unsupported pair');
  __setFetch(null);
});

test('network API surfaces non-OK responses as errors (injected fetch)', async () => {
  process.env.TIKA_URL = 'http://tika:9998';
  __setFetch(async () => ({ ok: false, status: 503, text: async () => '' }));
  await assert.rejects(() => extractText({ input: 'x' }), /503/);
  __setFetch(null);
});
