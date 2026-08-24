// market-watch.test.mjs — offline tests for the MELEK own-economy Market Watch board.
// Injects pool reserves + supply (no network); asserts the pool-ratio price, TVL rollup, market cap,
// soft-fail sections, wMELEK-only discipline (never a $ figure), and the HTML/JSON handler.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { economyBoard, headline, renderBoard, handler, config, configured } from './market-watch.mjs';

let saved;
beforeEach(() => {
  saved = { rpc: process.env.KULA_RPC_URL, pair: process.env.KULA_PAIR_ADDR, sup: process.env.KULA_SUPPLY, max: process.env.KULA_MAX_SUPPLY };
  delete process.env.KULA_RPC_URL; delete process.env.KULA_PAIR_ADDR; delete process.env.KULA_SUPPLY; delete process.env.KULA_MAX_SUPPLY;
});
afterEach(() => {
  for (const [k, v] of [['KULA_RPC_URL', saved.rpc], ['KULA_PAIR_ADDR', saved.pair], ['KULA_SUPPLY', saved.sup], ['KULA_MAX_SUPPLY', saved.max]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

// Pool: 1,000,000 KULA / 50,000 wMELEK → 1 KULA = 0.05 wMELEK. Supply 2,000,000 KULA (max 5,000,000).
const POOL = { reservesKula: 1_000_000, reservesWmelek: 50_000 };
const SUPPLY = { circulating: 2_000_000, max: 5_000_000 };

test('price section: pool ratio computed from injected reserves', async () => {
  const b = await economyBoard({ pool: POOL });
  assert.equal(b.sections.price.ok, true);
  assert.equal(b.price.priceKulaInWmelek, 0.05);
  assert.equal(b.price.priceWmelekInKula, 20);
});

test('tvl section: pool reserves valued in wMELEK terms', async () => {
  const b = await economyBoard({ pool: POOL });
  assert.equal(b.sections.tvl.ok, true);
  // 50,000 wMELEK + 1,000,000 KULA × 0.05 = 50,000 + 50,000 = 100,000 wMELEK
  assert.equal(b.tvl.totalValueInWmelek, 100000);
  assert.equal(b.tvl.priced, true);
});

test('cap section: market cap + FDV from supply × pool price', async () => {
  const b = await economyBoard({ pool: POOL, supply: SUPPLY });
  assert.equal(b.sections.cap.ok, true);
  // 2,000,000 × 0.05 = 100,000 wMELEK ; FDV 5,000,000 × 0.05 = 250,000
  assert.equal(b.cap.marketCapWmelek, 100000);
  assert.equal(b.cap.fdvWmelek, 250000);
});

test('cap soft-fails when no supply provided (price/tvl still ok)', async () => {
  const b = await economyBoard({ pool: POOL });
  assert.equal(b.sections.cap.ok, false);
  assert.equal(b.cap, null);
  assert.equal(b.sections.price.ok, true);
  assert.equal(b.sections.tvl.ok, true);
});

test('empty pool → all sections soft-fail, never throws', async () => {
  const b = await economyBoard({ pool: { reservesKula: 0, reservesWmelek: 0 } });
  assert.equal(b.sections.price.ok, false);
  assert.equal(b.price, null);
  assert.equal(b.sections.tvl.ok, false);
  assert.equal(b.sections.cap.ok, false);
});

test('no config, no injection → board assembles with all sections off (no network)', async () => {
  assert.equal(configured(), false);
  const b = await economyBoard();
  assert.equal(b.sections.price.ok, false);
  assert.ok(b.note.length > 0);
});

test('headline is one plain-English wMELEK line', async () => {
  const b = await economyBoard({ pool: POOL, supply: SUPPLY });
  const h = headline(b);
  assert.match(h, /1 KULA = 0\.05 wMELEK/);
  assert.match(h, /TVL/);
  assert.match(h, /cap/);
});

test('NEVER shows a dollar figure — wMELEK/native terms only', async () => {
  const b = await economyBoard({ pool: POOL, supply: SUPPLY });
  const html = renderBoard(b);
  assert.ok(!html.includes('$'), 'no dollar sign allowed (no external USD market yet)');
  assert.match(html, /wMELEK terms/);
});

test('renderBoard emits escaped HTML with all three cards', async () => {
  const b = await economyBoard({ pool: POOL, supply: SUPPLY });
  const html = renderBoard(b);
  assert.match(html, /market-watch/);
  assert.match(html, /KULA \/ wMELEK price/);
  assert.match(html, /Total Value Locked/);
  assert.match(html, /Market Cap/);
});

test('handler serves HTML dashboard', async () => {
  process.env.KULA_RPC_URL = ''; // ensure no live fetch
  const chunks = [];
  const res = { writeHead(c, h) { this.code = c; this.headers = h; }, end(s) { chunks.push(s); } };
  await handler({ url: '/', headers: { host: 'x' } }, res);
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(chunks.join(''), /Market Watch/);
});

test('handler serves JSON on /api', async () => {
  const chunks = [];
  const res = { writeHead(c, h) { this.code = c; this.headers = h; }, end(s) { chunks.push(s); } };
  await handler({ url: '/api', headers: { host: 'x' } }, res);
  assert.match(res.headers['content-type'], /application\/json/);
  const board = JSON.parse(chunks.join(''));
  assert.equal(board.numeraire, 'wMELEK');
  assert.ok('sections' in board);
});

test('config() reads env by name only (no hard-coded hosts)', () => {
  process.env.KULA_RPC_URL = 'http://ex.invalid';
  process.env.KULA_PAIR_ADDR = '0xabc';
  const c = config();
  assert.equal(c.rpcUrl, 'http://ex.invalid');
  assert.equal(c.pairAddr, '0xabc');
  assert.equal(configured(), true);
});
