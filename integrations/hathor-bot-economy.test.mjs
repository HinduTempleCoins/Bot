// hathor-bot-economy.test.mjs — offline, pure (injected deps). node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlePm, parseCommand, emptyStore } from './hathor-bot-economy.mjs';

const ADDR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const stubKeccak = (s) => { let h = ''; for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(2, '0'); return '0x' + h.repeat(Math.ceil(64 / Math.max(1, h.length))).slice(0, 64); };
const U = 'discord:12345';

test('parseCommand strips !// and splits', () => {
  assert.deepEqual(parseCommand('!claim'), { cmd: 'claim', args: [], raw: 'claim' });
  assert.deepEqual(parseCommand('/link 0xabc'), { cmd: 'link', args: ['0xabc'], raw: 'link 0xabc' });
});

test('help/empty → the menu', async () => {
  const r = await handlePm({ platformUser: U, text: '' }, { store: emptyStore() });
  assert.equal(r.kind, 'help');
  assert.match(r.reply, /link/);
});

test('actions before linking are refused', async () => {
  const r = await handlePm({ platformUser: U, text: 'claim' }, { store: emptyStore() });
  assert.equal(r.kind, 'needs-link');
});

test('link a 0x → stored, with the auto-derived MELEK side absent until a @ is linked', async () => {
  const store = emptyStore(); let saved = null;
  const r = await handlePm({ platformUser: U, text: `link ${ADDR}` }, { store, save: (s) => { saved = s; }, keccak: stubKeccak });
  assert.equal(r.kind, 'linked');
  assert.equal(store.byUser[U].prana, ADDR.toLowerCase());
  assert.equal(saved.byUser[U].prana, ADDR.toLowerCase());
});

test('link a @ → stored + shadow PRANA + the @↔0x registry filled', async () => {
  const store = emptyStore();
  const r = await handlePm({ platformUser: U, text: 'link @alice' }, { store, keccak: stubKeccak });
  assert.equal(store.byUser[U].melek, 'alice');
  assert.match(store.byUser[U].prana, /^0x/);            // shadow
  assert.equal(store.links.alice, store.byUser[U].prana); // registry fed
  assert.match(r.reply, /auto-derived/);
});

test('link rejects garbage', async () => {
  const r = await handlePm({ platformUser: U, text: 'link NOPE!!' }, { store: emptyStore() });
  assert.equal(r.kind, 'link-bad');
});

test('claim: a good-standing user gets a drip Hathor signs, routed/wrapped to their wallet', async () => {
  const store = emptyStore();
  store.byUser[U] = { melek: 'bob', prana: ADDR.toLowerCase() };
  const faucet = () => ({ ok: true, amount: 2.1, reason: 'ok', nextClaimAt: 0 });
  const r = await handlePm({ platformUser: U, text: 'claim' }, { store, faucet, keccak: stubKeccak, tokenChain: 'melek', tokenSymbol: 'APIS' });
  assert.equal(r.kind, 'claim-ok');
  assert.equal(r.action.type, 'faucet-drip');
  assert.equal(r.action.amount, 2.1);
  assert.match(r.reply, /APIS/);
});

test('claim: faucet denials surface friendly reasons (cooldown / taker)', async () => {
  const store = emptyStore(); store.byUser[U] = { prana: ADDR.toLowerCase() };
  const cd = await handlePm({ platformUser: U, text: 'claim' }, { store, faucet: () => ({ ok: false, reason: 'cooldown', nextClaimAt: 1000 }) });
  assert.equal(cd.kind, 'claim-denied');
  assert.match(cd.reply, /once a day/);
  const taker = await handlePm({ platformUser: U, text: 'claim' }, { store, faucet: () => ({ ok: false, reason: 'taker-no-reciprocity' }) });
  assert.match(taker.reply, /giving back/);
});

test('me → reports the Crypt-ology disposition when available', async () => {
  const store = emptyStore(); store.byUser[U] = { melek: 'carol' };
  const r = await handlePm({ platformUser: U, text: 'me' }, { store, dispositionFor: () => ({ stance: 'kindred', closeness: 40, standing: 30 }) });
  assert.match(r.reply, /kindred/);
});

test('stake/spend return unsigned intents (Hathor never signs for the user)', async () => {
  const store = emptyStore(); store.byUser[U] = { prana: ADDR.toLowerCase() };
  const s = await handlePm({ platformUser: U, text: 'stake 50' }, { store });
  assert.equal(s.action.type, 'stake');
  assert.equal(s.action.amount, 50);
  assert.equal(s.action.unsigned, true);
  const sp = await handlePm({ platformUser: U, text: 'spend 10 game-entry' }, { store });
  assert.equal(sp.action.on, 'game-entry');
});

test('vote: spend ALTI for a proportional @soapbox upvote (two unsigned intents)', async () => {
  const store = emptyStore(); store.byUser[U] = { melek: 'bob', prana: ADDR.toLowerCase() };
  const r = await handlePm({ platformUser: U, text: 'vote @alice/great-post 50' }, { store, altiSink: '0xsink' });
  assert.equal(r.kind, 'vote-ok');
  assert.equal(r.action.ok, true);
  assert.equal(r.action.vote.author, 'alice');
  assert.equal(r.action.vote.permlink, 'great-post');
  assert.equal(r.action.vote.voter, 'soapbox');
  assert.equal(r.action.vote.weight, 5000);          // 50 ALTI = 50%
  assert.equal(r.action.spend.to, '0xsink');
  assert.match(r.reply, /50%/);
});

test('vote: bad syntax → usage; out-of-mana → friendly denial', async () => {
  const store = emptyStore(); store.byUser[U] = { prana: ADDR.toLowerCase() };
  assert.equal((await handlePm({ platformUser: U, text: 'vote nope' }, { store })).kind, 'usage');
  const drained = await handlePm({ platformUser: U, text: 'vote @a/p 50' }, { store, voterManaBps: 500 });
  assert.equal(drained.kind, 'vote-denied');
  assert.match(drained.reply, /voting power/);
});

test('balance reports the wallet + balance when a reader is present', async () => {
  const store = emptyStore(); store.byUser[U] = { melek: 'dave', prana: ADDR.toLowerCase() };
  const r = await handlePm({ platformUser: U, text: 'balance' }, { store, balanceOf: async () => 12.5, tokenSymbol: 'APIS' });
  assert.match(r.reply, /@dave/);
  assert.match(r.reply, /12\.5/);
});

// ── REN lookup command (public, injectable resolver) ──────────────────────────────────────────
const renStub = (over = {}) => ({
  lookup: async (name) => ({ name, available: false, registered: true, resolvesTo: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', expiresISO: '2027-06-18T00:00:00.000Z', contenthash: null, ...over }),
  price: async () => '5000000000000000000',
});

test('ren <name> — available shows price + claim URL (no link needed)', async () => {
  const r = await handlePm({ platformUser: U, text: 'ren ryan.melek' }, { store: emptyStore(), ren: renStub({ available: true, registered: false, resolvesTo: null }) });
  assert.equal(r.kind, 'ren-available');
  assert.match(r.reply, /available/);
  assert.match(r.reply, /5 PRANA\/yr/);
  assert.match(r.reply, /ren\.alpha\.soapbox\.community/);
});

test('ren <name> — taken shows owner + expiry', async () => {
  const r = await handlePm({ platformUser: U, text: 'ren test.melek' }, { store: emptyStore(), ren: renStub() });
  assert.equal(r.kind, 'ren-taken');
  assert.match(r.reply, /taken/);
  assert.match(r.reply, /0xf39F/);
  assert.match(r.reply, /2027-06-18/);
});

test('ren — bad name → usage', async () => {
  const r = await handlePm({ platformUser: U, text: 'ren nope' }, { store: emptyStore(), ren: renStub() });
  assert.equal(r.kind, 'usage');
});

test('ren — resolver down → soft-fail message, never throws', async () => {
  const r = await handlePm({ platformUser: U, text: 'ren test.melek' }, { store: emptyStore(), ren: { lookup: async () => { throw new Error('rpc down'); } } });
  assert.equal(r.kind, 'ren-unavailable');
});
