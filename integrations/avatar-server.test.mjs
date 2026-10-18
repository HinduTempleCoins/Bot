// avatar-server.test.mjs — OFFLINE. Pure helpers + handler with injected fetch. Soft-fail.
// The identicon is a PNG where sharp is installed (the live host) and the SVG itself where it is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAvatarPath, identiconSvg, resolveAvatar, profileImageFrom, handler, __setFetch } from './avatar-server.mjs';

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

test('resolveAvatar: posting_json_metadata wins, json_metadata is the per-field fallback', () => {
  const pj = (img) => JSON.stringify({ profile: img ? { profile_image: img, name: 'x' } : { name: 'x' } });
  // both set → posting wins
  assert.deepEqual(resolveAvatar({ posting_json_metadata: pj('https://a/p.png'), json_metadata: pj('https://a/j.png') }, 'u', 64), { redirect: 'https://a/p.png' });
  // posting set WITHOUT a picture (e.g. only a name) → json_metadata picture still shows
  assert.deepEqual(resolveAvatar({ posting_json_metadata: pj(''), json_metadata: pj('https://a/j.png') }, 'u', 64), { redirect: 'https://a/j.png' });
  // posting is '' (never set) → json_metadata
  assert.deepEqual(resolveAvatar({ posting_json_metadata: '', json_metadata: pj('https://a/j.png') }, 'u', 64), { redirect: 'https://a/j.png' });
  // garbage posting metadata → json_metadata
  assert.deepEqual(resolveAvatar({ posting_json_metadata: '{oops', json_metadata: pj('https://a/j.png') }, 'u', 64), { redirect: 'https://a/j.png' });
  // neither → identicon
  assert.ok(resolveAvatar({ posting_json_metadata: '', json_metadata: '' }, 'u', 64).identicon);
});

test('profileImageFrom rejects non-https and injection-shaped URLs', () => {
  assert.equal(profileImageFrom(JSON.stringify({ profile: { profile_image: 'javascript:alert(1)' } })), '');
  assert.equal(profileImageFrom(JSON.stringify({ profile: { profile_image: 'https://x/a.png) ; background:url(evil' } })), '');
  assert.equal(profileImageFrom(JSON.stringify({ profile: { profile_image: 42 } })), '');
  assert.equal(profileImageFrom(JSON.stringify({ profile: { profile_image: ' https://melek.salon/img/a.png ' } })), 'https://melek.salon/img/a.png');
});

test('handler reads database_api.find_accounts (which carries posting_json_metadata)', async () => {
  const seen = [];
  __setFetch(async (_u, init) => {
    const b = JSON.parse(init.body); seen.push(b.method);
    return { json: async () => ({ result: { accounts: [{ name: 'seshat', json_metadata: '', posting_json_metadata: JSON.stringify({ profile: { profile_image: 'https://melek.salon/img/s.png' } }) }] } }) };
  });
  const res = mockRes();
  await handler({ url: '/u/seshat/avatar/large' }, res);
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, 'https://melek.salon/img/s.png');
  assert.deepEqual(seen, ['database_api.find_accounts']);
  __setFetch(null);
});

test('handler falls back to condenser_api.get_accounts when database_api is unavailable', async () => {
  __setFetch(async (_u, init) => {
    const b = JSON.parse(init.body);
    if (b.method === 'database_api.find_accounts') return { json: async () => ({ error: { message: 'Could not find API database_api' } }) };
    return { json: async () => ({ result: [{ posting_json_metadata: JSON.stringify({ profile: { profile_image: 'https://melek.salon/img/a.png' } }) }] }) };
  });
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
  assert.match(res.headers['content-type'], /^image\/(png|svg\+xml)$/);
  assert.ok(res.body && res.body.length > 0);
  __setFetch(null);
});

test('every size answers an image when no picture is set (identicon PNG at 64/128/256)', async () => {
  __setFetch(async () => ({ json: async () => ({ result: { accounts: [{ name: 'nopic', json_metadata: '', posting_json_metadata: '' }] } }) }));
  for (const size of ['small', 'medium', 'large']) {
    const res = mockRes();
    await handler({ url: `/u/nopic/avatar/${size}` }, res);
    assert.equal(res.code, 200, size);
    const px = { small: 64, medium: 128, large: 256 }[size];
    if (res.headers['content-type'] === 'image/png') assert.equal(res.body.readUInt32BE(16), px);   // PNG IHDR width
    else { assert.equal(res.headers['content-type'], 'image/svg+xml'); assert.match(String(res.body), new RegExp(`^<svg[^>]*width="${px}"`)); }
  }
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
