import { test } from 'node:test';
import assert from 'node:assert';
import { handler, validName, esc, __setFetch } from './server.mjs';

// minimal res stub
function mkRes() {
  return { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; } };
}
const call = async (url) => { const res = mkRes(); await handler({ url, method: 'GET' }, res); return res; };
const j = (res) => JSON.parse(res.body);

const ADDR = 'f39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const word = (h) => h.replace(/^0x/, '').padStart(64, '0');
const numWord = (n) => BigInt(n).toString(16).padStart(64, '0');
// fake RPC keyed by selector (mirrors resolver selectors)
const SEL = { resolve: '0x461a4478', available: '0xaeb8ce9b', priceOf: '0x67a60f37', nameExpires: '0x05457b3d', contenthashOf: '0x7000ec1e' };
function fakeFetch(map) {
  return async (_u, opts) => { const sel = JSON.parse(opts.body).params[0].data.slice(0, 10); const r = map[sel]; return { json: async () => (r === undefined ? { error: 'x' } : { result: r }) }; };
}

test('validName accepts label.tld, rejects junk', () => {
  assert.strictEqual(validName('ryan.melek'), 'ryan.melek');
  assert.strictEqual(validName('RYAN.MELEK'), 'ryan.melek');
  assert.strictEqual(validName('a.prana'), 'a.prana');
  assert.strictEqual(validName('nodot'), null);
  assert.strictEqual(validName('bad.tld'), null);
  assert.strictEqual(validName('UP CASE.melek'), null);
  assert.strictEqual(validName('two.dots.melek'), null);
});

test('esc neutralizes html', () => {
  assert.strictEqual(esc('<script>'), '&lt;script&gt;');
});

test('healthz reports config', async () => {
  const r = await call('/healthz');
  assert.strictEqual(r.code, 200);
  assert.strictEqual(j(r).ok, true);
});

test('GET / serves the claim page', async () => {
  const r = await call('/');
  assert.strictEqual(r.code, 200);
  assert.match(r.body, /REN/);
  assert.match(r.body, /Claim with wallet/);
});

test('/api/lookup rejects an invalid name (soft-fail shape)', async () => {
  const r = await call('/api/lookup?name=nope');
  assert.strictEqual(j(r).ok, false);
  assert.match(j(r).error, /label\.tld/);
});

test('/api/lookup returns a name card for a taken name', async () => {
  process.env.REN_REGISTRAR = '0x07882Ae1ecB7429a84f1D53048d35c4bB2056877';
  __setFetch(fakeFetch({
    [SEL.available]: '0x' + numWord(0), [SEL.resolve]: '0x' + word(ADDR),
    [SEL.nameExpires]: '0x' + numWord(1813200000), [SEL.contenthashOf]: '0x' + word('0'),
  }));
  const r = await call('/api/lookup?name=test.melek');
  const d = j(r);
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.registered, true);
  assert.strictEqual(d.resolvesTo.toLowerCase(), '0x' + ADDR);
});

test('/api/price returns wei + human', async () => {
  process.env.REN_REGISTRAR = '0x07882Ae1ecB7429a84f1D53048d35c4bB2056877';
  __setFetch(fakeFetch({ [SEL.priceOf]: '0x' + numWord(5n * 10n ** 18n) }));
  const d = j(await call('/api/price?name=test.melek&years=1'));
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.priceWei, '5000000000000000000');
  assert.strictEqual(d.priceHuman, '5');
});

test('/api/register-tx needs a configured registrar (soft-fail otherwise)', async () => {
  delete process.env.REN_REGISTRAR; // unset -> soft-fail with a clear message, never throws
  __setFetch(fakeFetch({ [SEL.priceOf]: '0x' + numWord(5n * 10n ** 18n) }));
  const d = j(await call('/api/register-tx?name=test.melek&years=1'));
  assert.strictEqual(d.ok, false);
  assert.match(d.error, /registrar/);
});

test('/api/register-tx builds an unsigned tx when configured', async () => {
  process.env.REN_REGISTRAR = '0x07882Ae1ecB7429a84f1D53048d35c4bB2056877';
  __setFetch(fakeFetch({ [SEL.priceOf]: '0x' + numWord(5n * 10n ** 18n) }));
  const d = j(await call('/api/register-tx?name=test.melek&years=1'));
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.tx.to, '0x07882Ae1ecB7429a84f1D53048d35c4bB2056877');
  assert.ok(d.tx.data.startsWith('0x9858ddb5')); // register selector
  assert.strictEqual(BigInt(d.tx.value), 5000000000000000000n);
  delete process.env.REN_REGISTRAR;
});

test('unknown path 404s, never throws', async () => {
  const r = await call('/nope');
  assert.strictEqual(r.code, 404);
});
