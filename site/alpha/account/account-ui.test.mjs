// account-ui.test.mjs — offline tests: injected fetch, fake DOM bits, no network.
import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  esc, getAccount, chainPubs, faucetCreate, copyButtonHtml, wireCopyButtons,
  keysBlockHtml, keysFileText, createdReminderHtml, __setFetch,
} from './account-ui.mjs';
import {
  newGateState, markDelivered, setConfirmInput, confirmMatches, canCreate, gateReason,
} from './account-gate.mjs';
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

test('wireCopyButtons copies via injected clipboard and fires onCopySuccess', async () => {
  let copied = null;
  let copySuccessFired = 0;
  const listeners = [];
  const btn = {
    attrs: { 'data-copy': 'SECRET-VALUE' },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener: (ev, fn) => listeners.push(fn),
    set textContent(v) {}, get textContent() { return ''; },
  };
  // selector-aware: the copy-btn matches the .copy-btn query; no .kval element in this fixture.
  const root = { querySelectorAll: (sel) => (String(sel).includes('copy-btn') ? [btn] : []) };
  const n = wireCopyButtons(root, {
    clipboard: { writeText: async (v) => { copied = v; } }, doc: {},
    onCopySuccess: () => { copySuccessFired++; },
  });
  assert.equal(n, 1);
  await listeners[0]();
  assert.equal(copied, 'SECRET-VALUE');
  assert.equal(copySuccessFired, 1);
});

// ── delivery-guarantee gate (operator HARD requirement 2026-06-07) ────────────

test('gate: Create stays disabled until BOTH delivered AND password matches', () => {
  const pw = 'P5JmasterPasswordExactly';
  let s = newGateState();
  assert.equal(canCreate(s, pw), false, 'fresh gate is closed');

  // only delivered, no confirm → still closed
  s = markDelivered(s);
  assert.equal(canCreate(s, pw), false, 'delivery alone is not enough');

  // confirm but mismatched → still closed
  s = setConfirmInput(s, 'P5Jwrong');
  assert.equal(confirmMatches(s, pw), false);
  assert.equal(canCreate(s, pw), false, 'mismatch keeps it closed');

  // exact match + delivered → open
  s = setConfirmInput(s, pw);
  assert.equal(confirmMatches(s, pw), true);
  assert.equal(canCreate(s, pw), true, 'delivered + exact match opens the gate');
});

test('gate: exact password but NOT delivered stays disabled (no skip path)', () => {
  const pw = 'PabcDEF123';
  let s = setConfirmInput(newGateState(), pw);
  assert.equal(confirmMatches(s, pw), true);
  assert.equal(canCreate(s, pw), false, 'match without download/copy is still closed');
});

test('gate: match is exact (no trim, case-sensitive) and empty never matches', () => {
  const pw = 'P5JsecretCase';
  let s = markDelivered(newGateState());
  assert.equal(canCreate(setConfirmInput(s, ' P5JsecretCase '), pw), false, 'whitespace differs');
  assert.equal(canCreate(setConfirmInput(s, 'p5jsecretcase'), pw), false, 'case differs');
  assert.equal(confirmMatches(setConfirmInput(newGateState(), ''), ''), false, 'empty never matches');
});

test('gate: gateReason explains why the gate is closed, then is empty when open', () => {
  const pw = 'P5JreasonTest';
  let s = newGateState();
  assert.match(gateReason(s, pw), /Download or copy/);
  s = markDelivered(s);
  assert.match(gateReason(s, pw), /Re-type/);
  s = setConfirmInput(s, 'nope');
  assert.match(gateReason(s, pw), /does not match/);
  s = setConfirmInput(s, pw);
  assert.equal(gateReason(s, pw), '');
});

test('createdReminderHtml shows the password again with verify + welcome links, escaped', () => {
  const keys = { owner: { wif: 'x', pub: 'TSTx' } };
  const html = createdReminderHtml('off<grid', 'P5J<pw>', keys);
  assert.ok(!html.includes('<grid'), 'name is escaped');
  assert.ok(!html.includes('<pw>'), 'password is escaped');
  assert.match(html, /keycheck\.html/);
  assert.match(html, /welcome\.html\?name=off%3Cgrid/);
  assert.match(html, /\[TestNet not MELEK\]/);
});
