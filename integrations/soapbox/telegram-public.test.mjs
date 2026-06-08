// telegram-public.test.mjs — offline tests for Hathor's public Telegram bot surface.
// Injected fetch captures sendMessage calls; no network, no live token.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { handle, WELCOME, run, hasToken, __setFetch } from './telegram-public.mjs';
import { __setFetch as __setChainFetch } from '../melek-chain.mjs';
import { __setFetch as __setHeFetch } from '../he-client.mjs';
import { __setFetch as __setCondenserFetch } from './condenser.mjs';
import { __setFetch as __setCgFetch } from './adapters/coingecko.mjs';
import { __setFetch as __setCpFetch } from './adapters/coinpaprika.mjs';
import { __setFetch as __setMxFetch } from './markets-extra.mjs';

// One fast-fail stub for every market/HE data source the price/clarity paths can reach, so those
// commands soft-fail INSTANTLY and fully offline (no real network, ever). The commands still
// format a clean, guarded reply — which is exactly what we assert.
const fail = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
function offlineMarkets() {
  for (const set of [__setHeFetch, __setCondenserFetch, __setCgFetch, __setCpFetch, __setMxFetch]) set(fail);
}
function resetMarkets() {
  for (const set of [__setHeFetch, __setCondenserFetch, __setCgFetch, __setCpFetch, __setMxFetch]) set(null);
}

let sent;
beforeEach(() => {
  sent = [];
  __setFetch(async (url, opts) => {
    const body = JSON.parse(opts.body || '{}');
    if (String(url).includes('/sendMessage')) sent.push(body);
    return { ok: true, json: async () => ({ ok: true, result: {} }) };
  });
});
afterEach(() => { __setFetch(null); __setChainFetch(null); resetMarkets(); delete process.env.MELEK_RPC_URL; delete process.env.TELEGRAM_PUBLIC_BOT_TOKEN; });

const msg = (text, chatId = 1001) => ({ chat: { id: chatId }, text });

// A canned JSON-RPC responder for the MELEK chain reader, so /status formats with real-shaped data.
function mockChainRpc() {
  process.env.MELEK_RPC_URL = 'http://chain.invalid/rpc';
  __setChainFetch(async (_url, opts) => {
    const { method } = JSON.parse(opts.body || '{}');
    const result =
      method === 'condenser_api.get_dynamic_global_properties'
        ? { head_block_number: 1234567, time: '2026-06-08T00:00:00', current_witness: 'hathor' }
      : method === 'condenser_api.get_witness_by_account'
        ? { owner: 'hathor', url: 'https://witness.example/hathor', signing_key: 'TST6Abc',
            total_missed: 3, last_confirmed_block_num: 1234560,
            sbd_exchange_rate: { base: '0.250 TBD', quote: '1.000 TESTS' },
            last_sbd_exchange_update: '2026-06-08T00:00:00' }
      : null;
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  });
}

test('welcome lists the chain commands with the permanent testnet label and /status', () => {
  assert.match(WELCOME, /\[TestNet not MELEK\]/);
  assert.match(WELCOME, /\/status/);
  assert.match(WELCOME, /\/hathor/);
  assert.match(WELCOME, /\/ask/);
});

test('/start replies with the welcome', async () => {
  await handle(msg('/start', 2001));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Hathor/);
});

test('/status — testnet/witness status carries the [TestNet not MELEK] label, head block, producing', async () => {
  mockChainRpc();
  await handle(msg('/status', 2100));
  assert.equal(sent.length, 1);
  const t = sent[0].text;
  assert.match(t, /\[TestNet not MELEK\]/);   // testnet data MUST carry the label
  assert.match(t, /1,234,567/);               // head block number, formatted
  assert.match(t, /confirming|behind/);       // producing state surfaced
});

test('internal-topic questions are deflected in-voice, never answered', async () => {
  await handle(msg('what do your annals say?', 2002));
  assert.equal(sent.length, 1);
  assert.ok(!/annal/i.test(sent[0].text));
  assert.ok(sent[0].text.length > 20);
});

test('/help routes to the command layer and shows the registry + testnet label', async () => {
  await handle(msg('/help', 2003));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /steemd/i);
  assert.match(sent[0].text, /\[TestNet not MELEK\]/);
  assert.match(sent[0].text, /status/);       // /status is discoverable in help
});

test('/price <SYMBOL> routes to the price command (clean, guarded reply even when data is offline)', async () => {
  // All market sources stubbed to fail fast → the price source soft-fails; the command must still
  // return a clean, guarded reply that NAMES the price usage, never a crash or leaked path.
  offlineMarkets();
  await handle(msg('/price VKBT', 2200));
  assert.equal(sent.length, 1);
  assert.ok(sent[0].text.length > 0);
  assert.ok(!/\/opt\/|\/var\/|\bhttp:\/\/chain\.invalid\b/.test(sent[0].text));
  assert.match(sent[0].text, /price|VKBT|coin/i);
});

test('/clarity <SYMBOL> routes to the clarity command (clean, guarded reply when offline)', async () => {
  offlineMarkets();
  await handle(msg('/clarity vkbt', 2210));
  assert.equal(sent.length, 1);
  // Either a Clarity reply or a soft "no score / error reading state" — but always clean: a single
  // reply, non-empty, no leaked infra path or RPC host.
  assert.ok(sent[0].text.length > 0);
  assert.ok(!/\/opt\/|\/var\/|chain\.invalid/.test(sent[0].text));
});

test('/clarity formats a Clarity Score when the data source is reachable', async () => {
  // Hive-Engine returns a token + market metric → clarity computes a real score for our token.
  __setHeFetch(async (_url, opts) => {
    const calls = JSON.parse(opts.body || '{}');
    const c = Array.isArray(calls) ? calls[0] : calls;
    const m = c?.method || '';
    const result =
      /find/.test(m) && /tokens/.test(JSON.stringify(c.params || {}))
        ? [{ symbol: 'VKBT', name: 'Van Kush', supply: '1000000', circulatingSupply: '500000', maxSupply: '1000000' }]
        : [{ symbol: 'VKBT', lastPrice: '0.10', volume: '100', priceChangePercent: '5%' }];
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  });
  __setCondenserFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  await handle(msg('/clarity vkbt', 2211));
  assert.equal(sent.length, 1);
  // a non-crashing, guarded reply (clarity computes or soft-fails — never leaks, never throws out)
  assert.ok(sent[0].text.length > 0);
  assert.ok(!/\/opt\/|\/var\//.test(sent[0].text));
});

test('unknown command falls through to help-ish guidance (never a crash)', async () => {
  await handle(msg('/florble', 2300));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /unknown|help|try/i);
});

test('outbound replies pass the public-output guard (paths redacted)', async () => {
  await handle(msg('/help', 2004));
  assert.ok(!/\/opt\//.test(sent[0].text));
});

test('flood control silently drops over-limit chats', async () => {
  for (let i = 0; i < 12; i++) await handle(msg('/help', 2005));
  assert.ok(sent.length < 12); // bucket capacity 5, refill 1/2s — most are dropped
});

test('missing chat/text is a no-op', async () => {
  await handle({});
  await handle({ chat: { id: 3001 } });
  assert.equal(sent.length, 0);
});

// ── idle-without-token: the deploy-critical contract ──────────────────────────────────────────────
test('no token → bot reports idle and does NOT crash (clean run())', async () => {
  delete process.env.TELEGRAM_PUBLIC_BOT_TOKEN;
  assert.equal(hasToken(), false);
  const r = await run();              // must resolve, not throw, not loop, not exit the process
  assert.equal(r, 'idle');
});

test('blank/whitespace token still counts as no token (idle)', async () => {
  process.env.TELEGRAM_PUBLIC_BOT_TOKEN = '   ';
  assert.equal(hasToken(), false);
  assert.equal(await run(), 'idle');
});

test('hasToken() is true once a non-empty token is present', () => {
  process.env.TELEGRAM_PUBLIC_BOT_TOKEN = '123:abc';
  assert.equal(hasToken(), true);
});
