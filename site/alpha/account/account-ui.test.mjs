// account-ui.test.mjs — offline tests: injected fetch, fake DOM bits, no network.
import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  esc, getAccount, chainPubs, faucetCreate, copyButtonHtml, wireCopyButtons,
  keysBlockHtml, keysFileText, __setFetch,
} from './account-ui.mjs';
import { keysFromLogin } from './graphene-keys.mjs';

afterEach(() => __setFetch(null));

test('esc escapes interpolation', () => {
  assert.equal(esc('<b>&"\'x'), '&lt;b&gt;&amp;&quot;&#39;x');
});

test('getAccount reads /rpc and returns the account or null', async () => {
  __setFetch(async (url, opts) => {
    assert.equal(url, '/rpc');
    const body = JSON.parse(opts.body);
    assert.equal(body.method, 'condenser_api.get_accounts');
    return { json: async () => ({ result: body.params[0][0] === 'offgrid' ? [{ name: 'offgrid', owner: { key_auths: [['TSTo', 1]] }, active: { key_auths: [['TSTa', 1]] }, posting: { key_auths: [['TSTp', 1]] }, memo_key: 'TSTm' }] : [] }) };
  });
  const a = await getAccount('OffGrid');
  assert.equal(a.name, 'offgrid');
  assert.deepEqual(chainPubs(a), { owner: ['TSTo'], active: ['TSTa'], posting: ['TSTp'], memo: ['TSTm'] });
  assert.equal(await getAccount('nobody'), null);
});

test('faucetCreate posts ONLY public keys', async () => {
  let sent;
  __setFetch(async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return { json: async () => ({ ok: true }) }; });
  const keys = await keysFromLogin('newuser', 'Pmaster');
  const pubs = { owner: keys.owner.pub, active: keys.active.pub, posting: keys.posting.pub, memo: keys.memo.pub };
  const r = await faucetCreate({ name: 'newuser', pubs });
  assert.equal(r.ok, true);
  assert.equal(sent.url, '/faucet/create');
  const raw = JSON.stringify(sent.body);
  assert.ok(!/5[1-9A-HJ-NP-Za-km-z]{50}/.test(raw), 'no WIF-shaped string crosses the wire');
  assert.match(sent.body.postingPub, /^TST/);
});

test('keysBlockHtml renders a Copy button per credential and escapes values', async () => {
  const keys = await keysFromLogin('u', 'P<script>');
  const html = keysBlockHtml('u', 'P<script>', keys);
  assert.ok(!html.includes('<script>'));
  const copies = html.match(/class="copy-btn"/g) || [];
  assert.equal(copies.length, 6); // account + master + 4 keys
});

test('keysFileText carries the testnet label and the login pointer', async () => {
  const keys = await keysFromLogin('u', 'Px');
  const txt = keysFileText('u', 'Px', keys);
  assert.match(txt, /\[TestNet not MELEK\]/);
  assert.match(txt, /Master password: {2}Px/);
  assert.match(txt, /owner private key/);
});

test('wireCopyButtons copies via injected clipboard', async () => {
  let copied = null;
  const listeners = [];
  const btn = {
    attrs: { 'data-copy': 'SECRET-VALUE' },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener: (ev, fn) => listeners.push(fn),
    set textContent(v) {}, get textContent() { return ''; },
  };
  const root = { querySelectorAll: () => [btn] };
  const n = wireCopyButtons(root, { clipboard: { writeText: async (v) => { copied = v; } }, doc: {} });
  assert.equal(n, 1);
  await listeners[0]();
  assert.equal(copied, 'SECRET-VALUE');
});
