// site/gallery/server.test.mjs — offline node --test for the Hathor gallery surface.
// Uses the real files on disk under character/reference/ (they exist in the repo). No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, esc, resolveImage } from './server.mjs';

// Minimal mock response that captures status / headers / body.
function mockRes() {
  return {
    statusCode: 0, headers: null, chunks: [], ended: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; return this; },
    end(chunk) { if (chunk != null) this.chunks.push(chunk); this.ended = true; return this; },
    get body() { return Buffer.concat(this.chunks.map((c) => Buffer.isBuffer(c) ? c : Buffer.from(String(c)))); },
    get text() { return this.body.toString('utf8'); },
  };
}
async function get(path) {
  const res = mockRes();
  await handler({ url: path, method: 'GET' }, res);
  return res;
}

test('esc escapes html metacharacters', () => {
  assert.equal(esc(`<img src=x onerror="alert('x')">`), '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;');
  assert.equal(esc(null), '');
});

test('landing page lists BOTH galleries with links', async () => {
  const res = await get('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  const t = res.text;
  assert.match(t, /LoRA reference set/);
  assert.match(t, /design lineage/i);
  assert.match(t, /href="\/reference"/);
  assert.match(t, /href="\/lineage"/);
  assert.match(t, />Alpha</); // alpha badge present
});

test('/reference returns 200 and references real, existing image paths', async () => {
  const res = await get('/reference');
  assert.equal(res.statusCode, 200);
  const t = res.text;
  // canonical iconography summary shown
  assert.match(t, /VR \/ oculus headset/);
  // every /img/ src on the page must resolve to a real file on disk
  const srcs = [...t.matchAll(/\/img\/([^"?]+)/g)].map((m) => decodeURIComponent(m[1]));
  assert.ok(srcs.length > 0, 'reference gallery has at least one image');
  for (const rel of srcs) assert.ok(resolveImage(rel), `reference image resolves: ${rel}`);
  // reference gallery must NOT pull from the lineage/ or video/ subtrees
  for (const rel of srcs) {
    assert.ok(!rel.startsWith('lineage/'), `reference excludes lineage: ${rel}`);
    assert.ok(!rel.startsWith('video/'), `reference excludes video: ${rel}`);
  }
});

test('/lineage returns 200, all six sections, real image paths', async () => {
  const res = await get('/lineage');
  assert.equal(res.statusCode, 200);
  const t = res.text;
  for (const title of ['Pop-art origin', 'Transitional', 'Antler', 'Deity-graphic', 'Descent', 'Concept sketches']) {
    assert.match(t, new RegExp(title), `section present: ${title}`);
  }
  const srcs = [...t.matchAll(/\/img\/([^"?]+)/g)].map((m) => decodeURIComponent(m[1]));
  assert.ok(srcs.length > 0, 'lineage gallery has images');
  for (const rel of srcs) {
    assert.ok(rel.startsWith('lineage/'), `lineage src is under lineage/: ${rel}`);
    assert.ok(resolveImage(rel), `lineage image resolves: ${rel}`);
  }
});

test('/img/ serves real image bytes with an image content-type', async () => {
  // pick a real reference file from the page
  const page = (await get('/reference')).text;
  const rel = decodeURIComponent(page.match(/\/img\/([^"?]+)/)[1]);
  const res = await get('/img/' + rel);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^image\//);
  assert.ok(res.body.length > 0, 'served non-empty bytes');
});

test('/img/ REJECTS path traversal with 404', async () => {
  for (const p of [
    '/img/../../BRIEF.md',
    '/img/..%2f..%2fBRIEF.md',
    '/img/../../package.json',
    '/img//workspaces/Bot/BRIEF.md',
    '/img/../README.md',
  ]) {
    const res = await get(p);
    assert.equal(res.statusCode, 404, `traversal blocked: ${p}`);
  }
});

test('/img/ REJECTS non-image extensions and missing files with 404', async () => {
  for (const p of ['/img/lineage/README.md', '/img/README.md', '/img/nope.png', '/img/hathor-original-source.gif']) {
    const res = await get(p);
    assert.equal(res.statusCode, 404, `rejected: ${p}`);
  }
});

test('resolveImage direct unit checks', () => {
  assert.equal(resolveImage('../../BRIEF.md'), null);
  assert.equal(resolveImage('/etc/passwd'), null);
  assert.equal(resolveImage('lineage/../../BRIEF.md'), null);
  assert.equal(resolveImage('hathor-original-source.txt'), null);
  assert.equal(resolveImage('\0.png'), null);
  const ok = resolveImage('hathor-original-source.png');
  assert.ok(ok && /image\//.test(ok.ctype), 'real png resolves');
});

test('a crafted malicious filename cannot inject markup (esc on captions)', () => {
  // esc() is applied to every filename in thumb(); confirm the escaper neutralizes a scripted name.
  const evil = `"><script>alert(1)</script>.png`;
  const out = esc(evil);
  assert.ok(!out.includes('<script>'), 'script tag escaped');
  assert.ok(out.includes('&lt;script&gt;'), 'angle brackets encoded');
});

test('handler never throws on a bad / weird request', async () => {
  for (const url of ['/img/%', '/img/%zz', '/does-not-exist', '/img/', '///', '/reference?x=%']) {
    await assert.doesNotReject(async () => {
      const res = await get(url);
      assert.ok(res.ended, `response ended for ${url}`);
    });
  }
});

test('/health reports counts for both galleries', async () => {
  const res = await get('/health');
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.text);
  assert.equal(j.ok, true);
  assert.ok(j.reference > 0 && j.lineage > 0, 'both galleries counted');
});
