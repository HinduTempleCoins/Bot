// site/console/server.test.mjs — offline. `node --test`. No network; handler is exercised with mocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, esc, safeHref, launchUrl } from './server.mjs';

function call(pathAndQuery, method = 'GET') {
  return new Promise((resolve) => {
    const req = { url: pathAndQuery, method };
    const res = {
      _code: 200, _headers: {}, _body: '',
      writeHead(code, headers) { this._code = code; this._headers = headers || {}; },
      end(body) { this._body = body || ''; resolve({ code: this._code, headers: this._headers, body: this._body }); },
    };
    handler(req, res);
  });
}

test('GET / renders the console with MELEK Move featured and all games', async () => {
  const r = await call('/');
  assert.equal(r.code, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  assert.match(r.body, /MELEK Game Console/);
  assert.match(r.body, /Featured/);
  assert.match(r.body, /MELEK Move/);
  for (const nm of ['Kush Farm', 'Kush Genetics', 'Pass a Joint', 'Quick Farm', 'KULA Arcade', 'Creatures', 'Tribulum']) {
    assert.ok(r.body.includes(nm), `missing tile: ${nm}`);
  }
  assert.match(r.body, /ALPHA/);
  assert.match(r.body, /108369/);        // testnet chain id label
});

test('GET /health reports testnet chain + game counts', async () => {
  const r = await call('/health');
  assert.equal(r.code, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.ok, true);
  assert.equal(j.chainId, 108369);
  assert.equal(j.games, 8);
  assert.equal(j.counts.total, 8);
});

test('GET /api/directory returns the grouped directory JSON', async () => {
  const r = await call('/api/directory');
  const j = JSON.parse(r.body);
  assert.equal(j.counts.total, 8);
  assert.equal(j.counts.realValue, 4);
  assert.equal(j.counts.play, 4);
  assert.ok(j.byCategory['move-to-earn'].some((g) => g.id === 'melek-move'));
});

test('GET /api/launch?game=melek-move returns the unified handshake + testnet chain', async () => {
  const r = await call('/api/launch?game=melek-move');
  assert.equal(r.code, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.identity.provider, 'melek-signer');
  assert.equal(j.chainId, 108369);
  assert.equal(j.game.id, 'melek-move');
  assert.ok(j.launchUrl.startsWith('http'));
  assert.equal(j.lane, 'real-value');
});

test('GET /api/launch for an unknown game 404s', async () => {
  const r = await call('/api/launch?game=nope');
  assert.equal(r.code, 404);
});

test('robots.txt and sitemap.xml serve', async () => {
  assert.equal((await call('/robots.txt')).code, 200);
  const sm = await call('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.headers['content-type'], /xml/);
});

test('unknown path 404s as JSON (soft-fail, never throws)', async () => {
  const r = await call('/nope');
  assert.equal(r.code, 404);
  assert.match(r.headers['content-type'], /json/);
});

test('esc escapes HTML and safeHref allows only http(s)/absolute paths', () => {
  assert.equal(esc('<b>&"'), '&lt;b&gt;&amp;&quot;');
  assert.equal(safeHref('https://kula.money'), 'https://kula.money');
  assert.equal(safeHref('/farm'), '/farm');
  assert.equal(safeHref('javascript:alert(1)'), null);
});

test('launchUrl falls back to a safe href per game', () => {
  const url = launchUrl({ id: 'melek-move', entry: '/move' });
  assert.ok(url.startsWith('http'));
});
