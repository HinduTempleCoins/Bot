// cfpb.test.mjs — OFFLINE guards for the SoapBox Scams reader (task #103). Fake fetch only; asserts
// normalization + soft-fail + key-gating. No network. Run: node --test integrations/soapbox/cfpb.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invalidate } from './cache.mjs';
import {
  __setFetch, complaints, secLitigation, secEdgar, cryptoScamDB, cryptoScams, chainabuse, scamSummary,
} from './cfpb.mjs';

// minimal Response-like stub
const res = (body, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

// route a fake fetch by URL substring; reset cache each time so calls actually hit the stub.
function route(map) {
  invalidate();
  __setFetch(async (url) => {
    const u = String(url);
    for (const [needle, body] of Object.entries(map)) {
      if (u.includes(needle)) return typeof body === 'function' ? body(u) : res(body);
    }
    return res({}, false); // unmatched → not-ok → source soft-fails to []
  });
}

const restore = () => { __setFetch(null); invalidate(); delete process.env.CHAINABUSE_KEY; };

test('complaints() normalizes CFPB hits', async () => {
  route({
    'consumerfinance.gov': {
      hits: { hits: [
        { _source: { complaint_id: '123', date_received: '2026-05-01', product: 'Money transfer, virtual currency, or money service', sub_product: 'Virtual currency', issue: 'Fraud or scam', company: 'ACME CRYPTO', state: 'CA', complaint_what_happened: 'lost funds', company_response: 'Closed', timely: 'Yes' } },
        { _source: { complaint_id: '124', issue: 'Unauthorized transactions', company: 'ACME CRYPTO' } },
      ] },
    },
  });
  const c = await complaints({ company: 'ACME CRYPTO', product: 'Money transfer' });
  assert.equal(c.length, 2);
  assert.equal(c[0].id, '123');
  assert.equal(c[0].issue, 'Fraud or scam');
  assert.equal(c[0].company, 'ACME CRYPTO');
  assert.equal(c[0].source, 'CFPB');
  restore();
});

test('complaints() soft-fails to [] on bad response', async () => {
  route({}); // everything unmatched → not-ok
  assert.deepEqual(await complaints({ company: 'whatever' }), []);
  restore();
});

test('secEdgar() normalizes EFTS hits and skips empty query', async () => {
  route({
    'efts.sec.gov': {
      hits: { hits: [
        { _id: '0001-25-000001:doc.htm', _source: { display_names: ['ACME INC (CIK 0000123)'], file_type: '8-K', file_date: '2026-04-02', ciks: ['0000123'] } },
      ] },
    },
  });
  assert.deepEqual(await secEdgar(''), []); // empty query, no network
  const e = await secEdgar('ACME');
  assert.equal(e.length, 1);
  assert.equal(e[0].form, '8-K');
  assert.equal(e[0].cik, '0000123');
  assert.equal(e[0].source, 'SEC EDGAR');
  restore();
});

test('secLitigation() parses release anchors and filters by query', async () => {
  const html = `
    <ul>
      <li><a href="/litigation/litreleases/lr-25001">SEC Charges ACME Crypto With Fraud</a></li>
      <li><a href="/litigation/litreleases/lr-25002">SEC v. Widget Co</a></li>
      <li><a href="/about">not a release</a></li>
    </ul>`;
  route({ 'litreleases': html });
  const all = await secLitigation('');
  assert.equal(all.length, 2, 'two release anchors parsed, non-release skipped');
  const filtered = await secLitigation('acme');
  assert.equal(filtered.length, 1);
  assert.match(filtered[0].title, /ACME/);
  assert.match(filtered[0].url, /^https:\/\/www\.sec\.gov\/litigation/);
  assert.equal(filtered[0].source, 'SEC Litigation');
  restore();
});

test('cryptoScamDB() normalizes and matches by address + free text', async () => {
  route({
    'CryptoScamDB/blacklist': [
      { name: 'FakeAirdrop', url: 'fake-airdrop.xyz', category: 'phishing', addresses: ['0xABCDEF0000000000000000000000000000000001'], description: 'drains wallets' },
      { id: 'Other', hostname: 'other.example', type: 'scam', description: 'unrelated' },
    ],
  });
  const byText = await cryptoScamDB('airdrop');
  assert.equal(byText.length, 1);
  assert.equal(byText[0].name, 'FakeAirdrop');
  assert.equal(byText[0].source, 'CryptoScamDB');
  const byAddr = await cryptoScamDB('0xABCDEF0000000000000000000000000000000001');
  assert.equal(byAddr.length, 1);
  const all = await cryptoScamDB('');
  assert.equal(all.length, 2, 'empty query returns all (capped)');
  restore();
});

test('chainabuse() soft-fails to [] without a key (no network)', async () => {
  delete process.env.CHAINABUSE_KEY;
  let called = false;
  __setFetch(async () => { called = true; return res({}); });
  invalidate();
  const r = await chainabuse('0xdead');
  assert.deepEqual(r, []);
  assert.equal(called, false, 'must NOT hit the network without a key');
  restore();
});

test('chainabuse() reads reports when a key is present', async () => {
  process.env.CHAINABUSE_KEY = 'test-key';
  route({ 'api.chainabuse.com': { reports: [{ scamCategory: 'phishing', description: 'reported scam', createdAt: '2026-05-10' }] } });
  const r = await chainabuse('0xdead');
  assert.equal(r.length, 1);
  assert.equal(r[0].category, 'phishing');
  assert.equal(r[0].address, '0xdead');
  assert.equal(r[0].source, 'Chainabuse');
  restore();
});

test('cryptoScams() merges sources and flags + detects addresses', async () => {
  route({
    'CryptoScamDB/blacklist': [
      { name: 'FakeAirdrop', url: 'fake.xyz', category: 'phishing', addresses: ['0x000000000000000000000000000000000000dEaD'] },
    ],
  });
  const r = await cryptoScams('0x000000000000000000000000000000000000dEaD');
  assert.equal(r.isAddress, true);
  assert.equal(r.flagged, true);
  assert.equal(r.count, 1);
  assert.equal(r.cryptoScamDB.length, 1);
  assert.deepEqual(r.chainabuse, []); // no key
  restore();
});

test('scamSummary() assembles every section, computes signals, carries disclaimer', async () => {
  route({
    'consumerfinance.gov': { hits: { hits: [{ _source: { complaint_id: '1', company: 'ACME', issue: 'Fraud or scam' } }] } },
    'litreleases': '<a href="/litigation/litreleases/lr-1">SEC Charges ACME</a>',
    'efts.sec.gov': { hits: { hits: [{ _id: 'a:b', _source: { display_names: ['ACME'], file_type: '10-K', file_date: '2026-01-01', ciks: ['9'] } }] } },
    'CryptoScamDB/blacklist': [{ name: 'ACME scam', url: 'acme.xyz', category: 'phishing' }],
  });
  const s = await scamSummary('ACME');
  assert.equal(s.query, 'ACME');
  assert.equal(s.isAddress, false);
  assert.equal(s.complaints.length, 1);
  assert.equal(s.secLitigation.length, 1);
  assert.equal(s.secEdgar.length, 1);
  assert.equal(s.cryptoScams.count, 1);
  assert.ok(s.signals >= 2);
  assert.equal(s.riskFlagged, true, 'a litigation hit flags risk');
  assert.match(s.disclaimer, /Not financial or legal advice/);
  assert.ok(s.sources.some((x) => /CFPB/.test(x)));
  assert.ok(s.sources.some((x) => /no key — skipped/.test(x)), 'Chainabuse marked skipped without a key');
  restore();
});

test('scamSummary() never throws when all sources fail', async () => {
  route({}); // everything not-ok
  const s = await scamSummary('nothing-here');
  assert.equal(s.signals, 0);
  assert.equal(s.riskFlagged, false);
  assert.deepEqual(s.complaints, []);
  restore();
});
