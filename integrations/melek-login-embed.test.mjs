// melek-login-embed.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedScript, postbackHtml, handler, DEFAULT_SIGNER, POSTBACK_PATH } from './melek-login-embed.mjs';

test('embedScript is self-contained browser JS pointing at the signer, no eval', () => {
  const js = embedScript({ signer: 'https://signer.example.com/' });
  assert.match(js, /"https:\/\/signer\.example\.com"/);        // trailing slash trimmed, JSON-encoded
  assert.match(js, /\/oauth2\/authorize\?response_type=code/);
  assert.match(js, /addEventListener\('message'/);
  assert.doesNotMatch(js, /\beval\(/);
  assert.doesNotMatch(js, /<\/script>/i);                       // config is </script>-defanged
});

test('the popup listener trusts ONLY the signer origin (no identity from a stray window)', () => {
  const js = embedScript({ signer: 'https://signer.example.com' });
  assert.match(js, /if \(ev\.origin !== SIGNER\) return;/);
  assert.match(js, /d\.type !== 'melek:login'/);
  assert.match(js, /d\.state !== state/);                       // CSRF: state must match
});

test('embedScript defaults to the configured signer and renders a labelled button', () => {
  const js = embedScript();
  assert.ok(js.includes(JSON.stringify(DEFAULT_SIGNER)));
  assert.match(js, /Log in with MELEK/);
  assert.match(js, /data-melek-login/);                         // auto-mounts for each tag
});

test('postbackHtml postMessages the verified identity to the opener, scoped, then closes', () => {
  const html = postbackHtml({ account: 'Judge', onchain: true, state: 'n1', targetOrigin: 'https://site.example' });
  assert.match(html, /window\.opener\.postMessage/);
  assert.match(html, /"https:\/\/site\.example"/);              // targetOrigin scoped, not '*'
  assert.match(html, /window\.close/);
  assert.match(html, /melek:login/);
  assert.match(html, /Judge/);
  assert.doesNotMatch(html, /<\/script><script>/i);             // payload can't break out of the tag
});

test('postbackHtml carries an error through instead of a fake account', () => {
  const html = postbackHtml({ error: 'denied', state: 'n1' });
  assert.match(html, /denied/);
});

test('handler serves the SDK as JavaScript at both paths, 404s the rest', async () => {
  function fakeRes() { return { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { this.body = b || ''; } }; }
  for (const path of ['/melek-login.js', '/widgets/melek-login-embed.js']) {
    const res = fakeRes();
    await handler({ url: path, headers: { host: 'soapy.blog' } }, res);
    assert.equal(res.code, 200);
    assert.match(res.headers['Content-Type'], /javascript/);
    assert.match(res.body, /oauth2\/authorize/);
  }
  const r404 = fakeRes();
  await handler({ url: '/nope', headers: {} }, r404);
  assert.equal(r404.code, 404);
});

test('POSTBACK_PATH is the signer bridge path', () => {
  assert.equal(POSTBACK_PATH, '/oauth2/postback');
});
