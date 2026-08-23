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
