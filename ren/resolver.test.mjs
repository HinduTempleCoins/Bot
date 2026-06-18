import { test } from 'node:test';
import assert from 'node:assert';
import * as ren from './resolver.mjs';

const ADDR = 'f39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const word = (hex) => hex.replace(/^0x/, '').padStart(64, '0');
const numWord = (n) => BigInt(n).toString(16).padStart(64, '0');
const strRet = (s) => { // ABI string return: offset + len + padded data
  const hex = Buffer.from(s, 'utf8').toString('hex');
  const len = hex.length / 2;
  const data = hex + '0'.repeat((Math.ceil(hex.length / 64) * 64) - hex.length);
  return '0x' + numWord(32) + numWord(len) + data;
};

// fake RPC keyed by the call's 4-byte selector
function fakeFetch(map) {
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const data = body.params[0].data;
    const sel = data.slice(0, 10);
    const result = map[sel];
    return { json: async () => (result === undefined ? { error: 'unknown' } : { result }) };
  };
}

const OPTS = { rpcUrl: 'http://x', contract: '0x07882Ae1ecB7429a84f1D53048d35c4bB2056877' };

test('resolve decodes the addr record', async () => {
  ren.__setFetch(fakeFetch({ [ren.SEL.resolve]: '0x' + word(ADDR) }));
  assert.strictEqual((await ren.resolve('test.melek', OPTS)).toLowerCase(), '0x' + ADDR);
});

test('resolve returns null for the zero address', async () => {
  ren.__setFetch(fakeFetch({ [ren.SEL.resolve]: '0x' + word('0') }));
  assert.strictEqual(await ren.resolve('nobody.melek', OPTS), null);
});

test('available decodes bool', async () => {
  ren.__setFetch(fakeFetch({ [ren.SEL.available]: '0x' + numWord(1) }));
  assert.strictEqual(await ren.available('free.melek', OPTS), true);
  ren.__setFetch(fakeFetch({ [ren.SEL.available]: '0x' + numWord(0) }));
  assert.strictEqual(await ren.available('test.melek', OPTS), false);
});

test('price decodes uint to a wei string', async () => {
  ren.__setFetch(fakeFetch({ [ren.SEL.priceOf]: '0x' + numWord(5n * 10n ** 18n) }));
  assert.strictEqual(await ren.price('test.melek', 1, false, OPTS), '5000000000000000000');
});

test('expires decodes a unix timestamp', async () => {
  ren.__setFetch(fakeFetch({ [ren.SEL.nameExpires]: '0x' + numWord(1813200000) }));
  assert.strictEqual(await ren.expires('test.melek', OPTS), 1813200000);
});

test('textRecord decodes a string', async () => {
  ren.__setFetch(fakeFetch({ [ren.SEL.text]: strRet('https://soapbox.community') }));
  assert.strictEqual(await ren.textRecord('site.melek', 'url', OPTS), 'https://soapbox.community');
});

test('owner chains id() -> ownerOf()', async () => {
  ren.__setFetch(fakeFetch({ [ren.SEL.id]: '0x' + numWord(12345), [ren.SEL.ownerOf]: '0x' + word(ADDR) }));
  assert.strictEqual((await ren.owner('test.melek', OPTS)).toLowerCase(), '0x' + ADDR);
});

test('lookup aggregates a name card', async () => {
  ren.__setFetch(fakeFetch({
    [ren.SEL.available]: '0x' + numWord(0),
    [ren.SEL.resolve]: '0x' + word(ADDR),
    [ren.SEL.nameExpires]: '0x' + numWord(1813200000),
    [ren.SEL.contenthashOf]: '0x' + word('0'),
  }));
  const c = await ren.lookup('test.melek', OPTS);
  assert.strictEqual(c.registered, true);
  assert.strictEqual(c.available, false);
  assert.strictEqual(c.resolvesTo.toLowerCase(), '0x' + ADDR);
  assert.strictEqual(c.contenthash, null);
  assert.ok(c.expiresISO.startsWith('20'));
});

test('buildRegisterTx encodes selector + sends PRANA value', () => {
  const tx = ren.buildRegisterTx({ contract: OPTS.contract, name: 'test.melek', years: 1, inKula: false, priceWei: '5000000000000000000' });
  assert.strictEqual(tx.to, OPTS.contract);
  assert.ok(tx.data.startsWith(ren.SEL.register));
  assert.strictEqual(BigInt(tx.value), 5000000000000000000n);
});

test('buildRegisterTx KULA path sends no native value', () => {
  const tx = ren.buildRegisterTx({ contract: OPTS.contract, name: 'test.melek', years: 2, inKula: true, priceWei: '0' });
  assert.strictEqual(tx.value, '0x0');
  assert.ok(tx.data.startsWith(ren.SEL.register));
});

test('soft-fail: fetch throws -> null, never throws', async () => {
  ren.__setFetch(() => { throw new Error('network down'); });
  assert.strictEqual(await ren.resolve('test.melek', OPTS), null);
  assert.strictEqual(await ren.available('test.melek', OPTS), null);
});

test('soft-fail: no contract configured -> null', async () => {
  ren.__setFetch(fakeFetch({ [ren.SEL.resolve]: '0x' + word(ADDR) }));
  assert.strictEqual(await ren.resolve('test.melek', { rpcUrl: 'http://x', contract: '' }), null);
});

test('string ABI encoding round-trips length + offset', () => {
  const enc = ren._internal.encString(ren.SEL.resolve, 'test.melek');
  assert.ok(enc.startsWith(ren.SEL.resolve));
  // offset word = 0x20, then length word = 10 (bytes in "test.melek")
  assert.strictEqual(enc.slice(10, 74), numWord(32));
  assert.strictEqual(enc.slice(74, 138), numWord(10));
});
