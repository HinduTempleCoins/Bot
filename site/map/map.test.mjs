// map.test.mjs — offline tests for the Frontier map surface. node --test, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Prove the handler does ZERO request-time network: install a throwing fetch before importing.
const _realFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('network called at request time'); };

const { handler, homePage, esc, safeHref, SITEMAP_PATHS } = await import('./server.mjs');

// tiny res double
function mockRes() {
  return {
    code: 0, headers: null, body: '',
    writeHead(c, h) { this.code = c; this.headers = h; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path) {
  const res = mockRes();
  await handler({ url: path }, res);
  return res;
}

test('/ renders 200 with server-rendered SVG hexes', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /<svg class=board/);
  const polys = res.body.match(/<polygon class=hex/g) || [];
  assert.equal(polys.length, 19, 'a radius-2 board renders 19 hex polygons');
  assert.match(res.body, /data-affinity=/);
});

test('/ carries the claim / collect interaction UI + config', async () => {
  const res = await get('/');
  assert.match(res.body, /Claim/);          // claim affordance copy
  assert.match(res.body, /Collect|collect/); // collect action
  assert.match(res.body, /id=cfg/);          // embedded state config for the client
  assert.match(res.body, /Selected tile/);   // tile inspector panel
});

test('claim is off-chain first: deed mint labelled "will settle on-chain", never broadcast', async () => {
  const res = await get('/');
  assert.match(res.body, /will settle on-chain/);
  assert.match(res.body, /broadcast:false|broadcast":false/);
  // utility framing, never a return/appreciation PROMISE (the disclaimer itself may name "appreciation")
  assert.match(res.body, /not a price bet|utility deed/);
  assert.match(res.body, /not an investment|not a return or appreciation promise/i);
  assert.doesNotMatch(res.body, /guaranteed return|price will (?:go|rise)|to the moon/i);
});

test('Alpha badge present (live-surface convention)', async () => {
  const res = await get('/');
  assert.match(res.body, /class=alpha/);
  assert.match(res.body, />Alpha</);
});

test('/health returns ok json', async () => {
  const res = await get('/health');
  assert.equal(res.code, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test('robots.txt / sitemap.xml / sitemap-index.xml / llms.txt serve', async () => {
  const robots = await get('/robots.txt');
  assert.equal(robots.code, 200);
  assert.match(robots.body, /Sitemap:/);

  const sm = await get('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.headers['content-type'], /xml/);
  assert.match(sm.body, /<urlset/);

  const idx = await get('/sitemap-index.xml');
  assert.equal(idx.code, 200);
  assert.match(idx.body, /<sitemapindex/);

  const llms = await get('/llms.txt');
  assert.equal(llms.code, 200);
  assert.match(llms.body, /Frontier/);
});

test('hostile <script> in the path is escaped, not reflected raw', async () => {
  // raw (unencoded) injection attempt in the request path
  const res = await get('/<script>alert(1)</script>');
  assert.equal(res.code, 404);
  // the injected script tag never appears executable in the response (URL-encoded + esc()'d)
  assert.doesNotMatch(res.body, /<script>alert\(1\)<\/script>/);
  // and the echoed path is HTML-escaped inside the <code> block
  assert.match(res.body, /There's nothing at <code>/);
});

test('unknown path → 404 (never 500)', async () => {
  const res = await get('/no-such-page');
  assert.equal(res.code, 404);
  assert.match(res.body, /Not found/);
});

test('handler never throws and does NO request-time network', async () => {
  // fetch is a throwing stub for the whole file; if any route fetched, these would 500/throw.
  for (const p of ['/', '/health', '/robots.txt', '/sitemap.xml', '/llms.txt', '/whatever', '/']) {
    const res = await get(p);
    assert.ok(res.code >= 200 && res.code < 500, `route ${p} did not 500 (got ${res.code})`);
  }
});

test('esc() and safeHref() enforce house-style escaping', () => {
  assert.equal(esc('<b>&"'), '&lt;b&gt;&amp;&quot;');
  assert.equal(safeHref('https://x.example/y'), 'https://x.example/y');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref(null), '');
});

test('SITEMAP_PATHS includes the root', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
});

// ── BASE_PATH awareness: default unchanged; prefixed when set ────────────────────────────────────────
// Re-import the module in a child process with BASE_PATH set, and compare emitted self-URLs.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));

function renderWith(env) {
  const script = `import('${join(HERE, 'server.mjs').replace(/\\/g, '/')}').then(async m=>{const c=[];const res={writeHead(){},end(s){c.push(s);}};await m.handler({url:'/'},res);process.stdout.write(c.join(''));});`;
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ...env }, encoding: 'utf8' });
}

test('BASE_PATH default ("") leaves self-URLs at root', () => {
  const html = renderWith({ BASE_PATH: '' });
  assert.match(html, /href="\/"/, 'brand/home link points at "/"');
  assert.doesNotMatch(html, /href="\/hudmap\//);
});

test('BASE_PATH set → emitted self-URLs are prefixed', () => {
  const html = renderWith({ BASE_PATH: '/hudmap' });
  assert.match(html, /href="\/hudmap\/"/, 'self links carry the mount prefix');
});

// restore
test.after(() => { globalThis.fetch = _realFetch; });
