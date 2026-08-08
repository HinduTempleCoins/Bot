// avatar-server.test.mjs — OFFLINE. Pure helpers + handler with injected fetch. Soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAvatarPath, identiconSvg, resolveAvatar, handler, __setFetch } from './avatar-server.mjs';

test('parseAvatarPath handles avatar + sizes, rejects junk', () => {
  assert.deepEqual(parseAvatarPath('/u/rokonn/avatar'), { user: 'rokonn', px: 128 });
  assert.deepEqual(parseAvatarPath('/u/rokonn/avatar/small'), { user: 'rokonn', px: 64 });
  assert.deepEqual(parseAvatarPath('/u/Hathor/avatar/large'), { user: 'hathor', px: 256 });
  assert.equal(parseAvatarPath('/u/rokonn'), null);
  assert.equal(parseAvatarPath('/img/x.png'), null);
  assert.equal(parseAvatarPath('/u/../etc/avatar'), null);
});

test('identiconSvg is deterministic + valid svg', () => {
  const a = identiconSvg('rokonn', 128), b = identiconSvg('rokonn', 128);
  assert.equal(a, b);                                   // deterministic
  assert.notEqual(identiconSvg('rokonn'), identiconSvg('hathor'));
  assert.match(a, /^<svg[^>]*width="128"/);
  assert.match(a, /<\/svg>$/);
});

test('resolveAvatar redirects to a set https profile image, else identicon', () => {
  const withImg = { posting_json_metadata: JSON.stringify({ profile: { profile_image: 'https://melek.salon/img/x.png' } }) };
  assert.deepEqual(resolveAvatar(withImg, 'rokonn', 128), { redirect: 'https://melek.salon/img/x.png' });
  assert.ok(resolveAvatar({ json_metadata: '{}' }, 'rokonn', 128).identicon);   // none set
  assert.ok(resolveAvatar(null, 'rokonn', 128).identicon);                       // no account
  // non-https (http / javascript:) is rejected → identicon, never a redirect
  const httpImg = { json_metadata: JSON.stringify({ profile: { profile_image: 'http://evil/x' } }) };
  assert.ok(resolveAvatar(httpImg, 'rokonn', 128).identicon);
});

test('handler 302-redirects when the account has a profile image (injected fetch)', async () => {
  __setFetch(async () => ({ json: async () => ({ result: [{ posting_json_metadata: JSON.stringify({ profile: { profile_image: 'https://melek.salon/img/a.png' } }) }] }) }));
  const res = mockRes();
  await handler({ url: '/u/rokonn/avatar/small' }, res);
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, 'https://melek.salon/img/a.png');
  __setFetch(null);
});

test('handler soft-fails a dead RPC into an identicon PNG, never throws', async () => {
  __setFetch(async () => { throw new Error('rpc down'); });
  const res = mockRes();
  await handler({ url: '/u/rokonn/avatar' }, res);
  assert.equal(res.code, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.ok(res.body && res.body.length > 0);
  __setFetch(null);
});

test('handler 404s a non-avatar path', async () => {
  const res = mockRes();
  await handler({ url: '/u/rokonn' }, res);
  assert.equal(res.code, 404);
});

function mockRes() {
  return {
    code: 0, headers: {}, body: null,
    writeHead(c, h) { this.code = c; if (h) this.headers = h; },
    end(b) { this.body = b; },
  };
}
