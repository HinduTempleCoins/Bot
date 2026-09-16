import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSignet, renderSignet, verifyLink, safeUrl, handleFromUrl, esc } from './signet.mjs';

const CONN = [
  { provider: 'github', healthy: true, identity: { name: 'hindutemplecoins', sub: '1' } },
  { provider: 'x', healthy: true, identity: { name: 'vankushfamily', sub: '2' } },
  { provider: 'discord', healthy: false, identity: { name: 'melek', sub: '3' } },
];

test('safeUrl allows only http and https', () => {
  assert.ok(safeUrl('https://github.com/x'));
  assert.ok(safeUrl('http://example.com'));
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'vbscript:x', 'file:///etc/passwd', '', null, 'not a url']) {
    assert.equal(safeUrl(bad), null, `${bad} must be rejected`);
  }
});

test('a javascript: link never reaches the page', () => {
  const { signet } = buildSignet({ account: 'a', links: [{ label: 'x', url: 'javascript:alert(1)' }, { label: 'ok', url: 'https://x.com/a' }] });
  assert.equal(signet.links.length, 1);
  assert.ok(!renderSignet(signet).includes('javascript:'));
});

test('a connected account proves its own link', () => {
  const v = verifyLink({ url: 'https://github.com/hindutemplecoins' }, CONN);
  assert.equal(v.verified, true);
  assert.equal(v.provider, 'github');
});

test('a link to someone ELSE on a connected provider is not proven', () => {
  // Connecting GitHub proves your GitHub, not every GitHub.
  const v = verifyLink({ url: 'https://github.com/someone-else' }, CONN);
  assert.equal(v.verified, false);
  assert.equal(v.reason, 'handle-mismatch');
});

test('an unconnected provider is listed, never verified', () => {
  const v = verifyLink({ url: 'https://www.reddit.com/user/whoever' }, CONN);
  assert.equal(v.verified, false);
  assert.equal(v.reason, 'not-connected');
});

test('an expired connection stops proving anything', () => {
  const v = verifyLink({ url: 'https://discord.com/users/melek' }, CONN);
  assert.equal(v.verified, false);
  assert.equal(v.reason, 'connection-expired');
});

test('a plain website is listed, not verified — and that is not a failure', () => {
  const v = verifyLink({ url: 'https://example.com/me' }, CONN);
  assert.equal(v.verified, false);
  assert.equal(v.reason, 'not-verifiable');
});

test('handleFromUrl reads the account out of provider URLs', () => {
  assert.equal(handleFromUrl('github', 'https://github.com/HinduTempleCoins'), 'hindutemplecoins');
  assert.equal(handleFromUrl('x', 'https://x.com/VanKushFamily'), 'vankushfamily');
  assert.equal(handleFromUrl('reddit', 'https://www.reddit.com/u/someone'), 'someone');
  assert.equal(handleFromUrl('github', 'https://example.com'), null);
});

test('buildSignet counts proven links separately from listed ones', () => {
  const { ok, signet } = buildSignet({
    account: 'hathor', display: 'Hathor', bio: 'MELEK witness',
    links: [
      { label: 'GitHub', url: 'https://github.com/hindutemplecoins' },
      { label: 'X', url: 'https://x.com/vankushfamily' },
      { label: 'Site', url: 'https://example.com' },
    ],
    connections: CONN,
  });
  assert.equal(ok, true);
  assert.equal(signet.total, 3);
  assert.equal(signet.verifiedCount, 2);
});

test('an account is required', () => {
  assert.equal(buildSignet({}).ok, false);
  assert.match(buildSignet({}).error, /account/);
});

test('the link count is capped so one page cannot be a denial of service', () => {
  const links = Array.from({ length: 500 }, (_, i) => ({ label: `l${i}`, url: `https://example.com/${i}` }));
  const { signet } = buildSignet({ account: 'a', links });
  assert.ok(signet.total <= 100);
});

test('render escapes every field a user controls', () => {
  const { signet } = buildSignet({
    account: '<script>a</script>', display: '"><img src=x onerror=1>', bio: '</style><script>',
    links: [{ label: '<b>bold</b>', url: 'https://example.com/?a=1&b=2' }],
  });
  const html = renderSignet(signet);
  assert.ok(!html.includes('<script>'));
  // The payload may survive as ESCAPED TEXT — that is correct and harmless. What must never appear
  // is executable markup, so assert on the tag, not on the substring.
  assert.ok(!/<img[^>]*onerror/i.test(html), 'no live img/onerror tag');
  assert.ok(html.includes('&lt;img src=x onerror=1&gt;'), 'it survives inert, as escaped text');
  assert.ok(!html.includes('<b>bold</b>'));
  assert.ok(html.includes('&amp;b=2'), 'query strings survive escaped, not broken');
});

test('the page shows which links are proven and which are merely listed', () => {
  const { signet } = buildSignet({
    account: 'hathor',
    links: [{ label: 'GitHub', url: 'https://github.com/hindutemplecoins' }, { label: 'Blog', url: 'https://example.com' }],
    connections: CONN,
  });
  const html = renderSignet(signet);
  assert.match(html, /sig-mark ok/, 'a proven link is marked proven');
  assert.match(html, /sig-mark no/, 'an unproven link is marked listed');
  assert.match(html, /1 of 2 proven/);
});

test('unverified links carry nofollow; verified ones carry rel=me', () => {
  const { signet } = buildSignet({
    account: 'a',
    links: [{ label: 'gh', url: 'https://github.com/hindutemplecoins' }, { label: 'rando', url: 'https://example.com' }],
    connections: CONN,
  });
  const html = renderSignet(signet);
  assert.match(html, /rel="noopener noreferrer me"/);
  assert.match(html, /rel="noopener noreferrer nofollow ugc"/);
  // Exactly one rel per anchor — two would let the browser pick, and it picks the first.
  for (const a of html.match(/<a class=sig-link[^>]*>/g) || []) {
    assert.equal((a.match(/\brel=/g) || []).length, 1, `one rel per link: ${a}`);
  }
});

test('no token or credential can reach the page, even if one is handed in', () => {
  const dirty = [{ provider: 'github', healthy: true, refreshToken: 'rt_SECRET', identity: { name: 'hindutemplecoins' } }];
  const { signet } = buildSignet({ account: 'a', links: [{ label: 'gh', url: 'https://github.com/hindutemplecoins' }], connections: dirty });
  const html = renderSignet(signet);
  assert.ok(!html.includes('rt_SECRET'));
  assert.ok(!JSON.stringify(signet).includes('rt_SECRET'));
});

test('esc handles the obvious injection characters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});
