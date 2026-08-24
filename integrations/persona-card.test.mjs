// persona-card.test.mjs — offline proof of the signature-card renderer + aggregator. No network, no
// keys: fetch is injected. Asserts the SVG carries the persona and is well-formed, and that an
// unreachable RPC still yields a valid (name-only) card instead of throwing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MELEK_RPC_URL = 'http://test.invalid/rpc'; // so the chain reader attempts a (mocked) call
process.env.MELEK_NETWORK = 'mainnet';

const { cardSvg, cardJson, handler, __setFetch } = await import('./persona-card.mjs');
const { persona } = await import('./persona.mjs');

// a mock fetch that returns a canned condenser_api.get_accounts result for any account.
function okFetch(account) {
  return async () => ({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ result: [{ name: account, balance: '123.456 MELEK', sbd_balance: '7.000 MBD', vesting_shares: '1000.00 VESTS', post_count: 42, created: '2026-07-12T00:00:00' }] }),
  });
}

test('persona + cardSvg: carries account, balance, well-formed SVG', async () => {
  __setFetch(okFetch('hathor'));
  const p = await persona('hathor');
  assert.equal(p.account, 'hathor');
  assert.equal(p.ok, true);
  assert.equal(p.balances.liquid, '123.456 MELEK');
  const svg = cardSvg(p);
  assert.match(svg, /^<svg[\s\S]+<\/svg>$/);
  assert.match(svg, /hathor/);
  assert.match(svg, /123\.456 MELEK/);
  assert.match(svg, /ALPHA/); // standing alpha-badge rule
});

test('REN name in title, account in subline', async () => {
  __setFetch(okFetch('ryan'));
  const p = await persona('ryan.melek');
  assert.equal(p.account, 'ryan');
  assert.equal(p.renName, 'ryan.melek');
  const svg = cardSvg(p);
  assert.match(svg, /ryan\.melek/);   // title = REN name
  assert.match(svg, /@ryan/);          // subline = account
});

test('RPC down: still a valid card, never throws', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const p = await persona('someone');
  assert.equal(p.ok, false);
  assert.equal(p.balances.liquid, null);
  const svg = cardSvg(p);
  assert.match(svg, /^<svg[\s\S]+<\/svg>$/);
  assert.match(svg, /someone/);
  assert.match(svg, /—/); // balance placeholder
});

test('handler serves svg + json + health, 404 otherwise', async () => {
  __setFetch(okFetch('hathor'));
  const run = async (url) => {
    const res = { code: 0, headers: {}, body: '' };
    res.writeHead = (c, h) => { res.code = c; Object.assign(res.headers, h || {}); };
    res.end = (b) => { res.body = (b || '').toString(); };
    await handler({ url, method: 'GET' }, res);
    return res;
  };
  const svg = await run('/card/hathor.svg');
  assert.equal(svg.code, 200);
  assert.match(svg.headers['content-type'], /image\/svg\+xml/);
  assert.match(svg.body, /hathor/);
  const json = await run('/card/hathor.json');
  assert.equal(json.code, 200);
  const j = JSON.parse(json.body);
  assert.equal(j.account, 'hathor');
  assert.match(j.caption, /hathor/);
  const health = await run('/health');
  assert.equal(health.body, 'ok');
  const nf = await run('/nope');
  assert.equal(nf.code, 404);
});

test('cardJson: caption + cardUrl', () => {
  const j = cardJson({ account: 'hathor', renName: 'hathor.melek', ok: true, balances: {} }, 'https://id.melek.salon');
  assert.match(j.caption, /hathor\.melek on MELEK/);
  assert.equal(j.cardUrl, 'https://id.melek.salon/card/hathor.melek.svg');
});
