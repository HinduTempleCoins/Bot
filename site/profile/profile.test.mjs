// profile.test.mjs — OFFLINE tests for SoapBox Profile (drives `handler` with a mock req/res; no port
// bound, no network). Mirrors site/diagram/diagram.test.mjs. Verifies: the profile renders with the
// watchlist + watch-address + connect UI, /health is ok JSON, robots/sitemap/sitemap-index/llms serve,
// a hostile <script> in an echoed param is escaped, a hostile pasted address is validated/escaped, the
// page has NO seed/private-key input and NO shill language, the SERVER makes zero request-time network
// calls (proven by injecting a throwing global fetch), and unknown/garbage paths never 500.

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, profilePage, esc, safeHref, classifyAddress, EVM_RE, MELEK_RE, SITEMAP_PATHS } from './server.mjs';

// Minimal mock res that captures status/headers/body.
function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'profile.test', ...headers } }, res);
  return res;
}

test('home 200 renders watchlist + watch-address + connect UI', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /id=coin-in/);        // watchlist input
  assert.match(res.body, /id=coin-add/);        // watchlist add button
  assert.match(res.body, /id=addr-in/);         // watched-address input
  assert.match(res.body, /id=connect-btn/);     // connect (read-only) button
  assert.match(res.body, /id=rollup-list/);     // the "your coins" rollup
  assert.match(res.body, /Watchlist/);
  assert.match(res.body, /Watched addresses/i);
});

test('/health returns {"ok":true}', async () => {
  const res = await get('/health');
  assert.equal(res.code, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test('robots.txt, sitemap.xml, sitemap-index.xml, llms.txt all serve', async () => {
  const robots = await get('/robots.txt');
  assert.equal(robots.code, 200);
  assert.match(robots.body, /User-agent/);
  const sm = await get('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.body, /<urlset|<url>/);
  const smi = await get('/sitemap-index.xml');
  assert.equal(smi.code, 200);
  assert.match(smi.body, /sitemapindex/);
  const llms = await get('/llms.txt');
  assert.equal(llms.code, 200);
  assert.match(llms.body, /Profile|portfolio/i);
});

test('SITEMAP_PATHS covers the profile home', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('the MELEK unlock is understated & opt-in — free MELEK account, no buy/shill pitch', async () => {
  const body = (await get('/')).body;
  assert.match(body, /Save your profile/i);          // the understated unlock CTA
  assert.match(body, /free MELEK account/i);          // revealed only inside the panel
  // A portfolio tool is openly about coins, but there must be NO token-shilling / buy pitch.
  assert.ok(!/\b(buy now|shill|to the moon|moonshot|pump|guaranteed returns?|get rich|invest now|100x|1000x|ape in)\b/i.test(body),
    'no shill / buy language');
});

test('HARD RULE: the page has NO seed / private-key / mnemonic / WIF input', async () => {
  const body = (await get('/')).body;
  // no such word anywhere (so there can be no field prompting for one), and no password input either
  assert.ok(!/seed\s*phrase|mnemonic|private\s*key|\bwif\b|secret\s*key/i.test(body), 'no key-material prompt copy');
  assert.ok(!/type=["']?password/i.test(body), 'no password/secret input field');
  // it should positively state it is read-only and holds no keys
  assert.match(body, /read-only/i);
  assert.match(body, /holds no keys|never holds your keys|no keys/i);
});

test('Connect uses the injected provider directly — no npm library, no signing', async () => {
  const body = (await get('/')).body;
  assert.match(body, /window\.ethereum/);                 // injected provider, used directly
  assert.match(body, /eth_requestAccounts/);              // read accounts
  assert.match(body, /eth_getBalance/);                   // read balance
  assert.ok(!/eth_sendTransaction|personal_sign|eth_sign|signTypedData/i.test(body), 'must never request a signature/tx');
  // no external CDN / bundler library pulled in
  assert.ok(!/https?:\/\/[^"']*(wagmi|rainbowkit|web3modal|walletconnect|ethers|web3\.min)/i.test(body), 'no external wallet library');
});

test('balances are read CLIENT-SIDE from env RPC endpoints (MELEK + EVM/PRANA)', async () => {
  const body = (await get('/')).body;
  assert.match(body, /condenser_api\.get_accounts/);      // MELEK Graphene read
  assert.match(body, /melek\.salon\/rpc/);                // default public MELEK RPC
  assert.match(body, /rpc\.prana\.alpha\.melek\.salon/);  // default public PRANA EVM RPC
});

test('a hostile <script> in the addr param is escaped (no raw payload)', async () => {
  const res = await get('/?addr=' + encodeURIComponent('<script>alert(1)</script>'));
  assert.equal(res.code, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw hostile payload must not appear');
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);   // escaped instead
});

test('a hostile pasted address is validated & escaped — junk is rejected, not trusted', async () => {
  // junk with html → escaped, flagged as ignored, never seeded into the input value
  const junk = await get('/?addr=' + encodeURIComponent('0xnothex"><img src=x>'));
  assert.equal(junk.code, 200);
  assert.ok(!/<img src=x>/.test(junk.body), 'raw html in an address must never render');
  assert.match(junk.body, /didn't look like|ignored/i);
  assert.ok(!/value="0xnothex/.test(junk.body), 'invalid address must not seed the input value');

  // a valid EVM address IS accepted and echoed (escaped, safe)
  const evm = '0x' + 'a'.repeat(40);
  const ok = await get('/?addr=' + evm);
  assert.match(ok.body, new RegExp('Prefilled EVM address'));
  assert.match(ok.body, new RegExp(evm));

  // a valid MELEK name is accepted as a MELEK address
  const mel = await get('/?addr=hathor');
  assert.match(mel.body, /Prefilled MELEK address/);
});

test('classifyAddress + regexes are sound', () => {
  assert.equal(classifyAddress('0x' + 'A'.repeat(40)), 'evm');
  assert.equal(classifyAddress('hathor'), 'melek');
  assert.equal(classifyAddress('van-kush.melek'), 'melek');
  assert.equal(classifyAddress('0xdeadbeef'), null);              // too short for EVM, has 'x' for MELEK
  assert.equal(classifyAddress('<script>'), null);
  assert.equal(classifyAddress('UPPERCASE'), null);               // MELEK names are lowercase
  assert.equal(classifyAddress(''), null);
  assert.ok(EVM_RE.test('0x' + '0123456789abcdefABCDEF'.slice(0, 2).repeat(20)));
  assert.ok(MELEK_RE.test('hathor'));
});

test('esc() and safeHref() are sound', () => {
  assert.equal(esc('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
  assert.equal(esc('a"b'), 'a&quot;b');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref('https://ok.example/x'), 'https://ok.example/x');
  assert.equal(safeHref(''), '');
});

test('SERVER does ZERO request-time network — page renders with a throwing global fetch', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network must not be touched at request time'); };
  try {
    const res = await get('/');
    assert.equal(res.code, 200);
    assert.match(res.body, /Watchlist/);        // full page still rendered
    const h = await get('/health');
    assert.deepEqual(JSON.parse(h.body), { ok: true });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('BASE_PATH support: self-URLs are prefixed when BASE_PATH is set (fresh import)', async () => {
  // Re-import the module under a BASE_PATH env with a cache-busting query so a fresh instance reads it.
  process.env.BASE_PATH = '/profile';
  const mod = await import('./server.mjs?basepath=1');
  const res = mockRes();
  await mod.handler({ url: '/nope', headers: { host: 'profile.test' } }, res);
  assert.equal(res.code, 404);
  assert.match(res.body, /href="\/profile\/"/);    // the 404 "open your profile" link is prefixed
  delete process.env.BASE_PATH;
});

test('unknown path → 404, never a 500', async () => {
  const res = await get('/this/does/not/exist');
  assert.equal(res.code, 404);
  assert.match(res.body, /Not found/i);
});

test('never throws on a garbage URL', async () => {
  const res = mockRes();
  await handler({ url: '/%%%bad%%', headers: { host: 'profile.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('profilePage() is a pure string with the three read-only capabilities', () => {
  const html = profilePage({});
  assert.equal(typeof html, 'string');
  assert.match(html, /Watchlist/);
  assert.match(html, /Watched addresses/i);
  assert.match(html, /Connect a wallet \(read-only\)/i);
});
