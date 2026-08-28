import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, homePage, promptsPage, esc, CAPABILITIES } from './server.mjs';

function call(path) {
  return new Promise((resolve) => {
    const chunks = [];
    const res = {
      writeHead(code, headers) { this.code = code; this.headers = headers; },
      end(s) { chunks.push(s || ''); resolve({ code: this.code || 200, headers: this.headers || {}, html: chunks.join('') }); },
    };
    handler({ url: path, method: 'GET' }, res);
  });
}

test('esc escapes html', () => assert.equal(esc('<b>&"'), '&lt;b&gt;&amp;&quot;'));

test('homePage groups every capability and names its real module', () => {
  const html = homePage();
  assert.match(html, /Herald/);
  for (const [group, items] of CAPABILITIES) {
    assert.ok(html.includes(esc(group)), `group ${group} present`);
    for (const [t, , m] of items) {
      assert.ok(html.includes(esc(t)), `capability ${t} present`);
      assert.ok(html.includes(esc(m)), `module ${m} named`);
    }
  }
});

test('prompts page renders the live prompt-pack library', () => {
  const html = promptsPage();
  assert.match(html, /Prompt packs/);
  assert.match(html, /← Herald/);
  // pulls real packs from the module — at least one category label should appear
  assert.match(html, /class=pack|loading/);
});

test('/health returns ok', async () => {
  const r = await call('/health');
  assert.equal(r.code, 200);
  assert.equal(r.html, 'ok');
});

test('/ and /prompts render 200', async () => {
  assert.equal((await call('/')).code, 200);
  assert.equal((await call('/prompts')).code, 200);
});

test('unknown route 404s', async () => {
  assert.equal((await call('/nope')).code, 404);
});

test('robots + sitemap serve', async () => {
  const rob = await call('/robots.txt');
  assert.match(rob.html, /Sitemap:/);
  const sm = await call('/sitemap.xml');
  assert.match(sm.html, /\/prompts/);
});

test('/monetize renders 200 with a copy-paste embed snippet + MELEK-optional sign-up', async () => {
  const r = await call('/monetize');
  assert.equal(r.code, 200);
  assert.match(r.html, /Monetize/);
  assert.match(r.html, /&lt;iframe/);              // the escaped snippet to copy
  assert.match(r.html, /\/embed\/unit\?pub=/);     // snippet points at the embed unit
  assert.match(r.html, /MELEK-optional|MELEK-Signer/);
});

test('/advertise renders 200 and builds a keyless, design-only campaign intent', async () => {
  const r = await call('/advertise');
  assert.equal(r.code, 200);
  assert.match(r.html, /Advertise/);
  assert.match(r.html, /CPC/);
  // submitting the form builds an intent, and is explicit that funds do not move
  const built = await call('/advertise?headline=Try&landing=https%3A%2F%2Fexample.com%2Fdeal&cpc=0.25');
  assert.match(built.html, /campaign-intent/);
  assert.match(built.html, /design-only|NOT LIVE/);
});

test('/embed/unit serves a framed ad unit carrying the Ad disclosure label', async () => {
  const r = await call('/embed/unit?pub=melek-salon&slot=sponsored&fmt=mrec');
  assert.equal(r.code, 200);
  assert.match(r.headers['content-type'] || '', /text\/html/);
  assert.match(r.html, />Ad</);                    // disclosure label present even with no fill (house unit)
});
