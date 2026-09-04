// pentecaust/herald/enrichment-providers.test.mjs — offline unit tests for the real provider adapters.
// Fully offline: every provider is handed a FAKE fetch (via ctx.fetch or __setFetch); no network is touched.
// Covers: happy-path field mapping, env-gating soft-fail-to-null, HTTP/parse-error soft-fail, key precedence,
// injected-fetch preference, and end-to-end wiring into the real enrichment.mjs waterfall.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hunterProvider, clearbitProvider, clayProvider, defaultProviders, __setFetch, esc,
} from './enrichment-providers.mjs';
import { enrichLead, __setProviders } from './enrichment.mjs';

// A fake fetch factory: returns a response whose json() yields `payload`, recording the requested URL/opts.
function fakeFetch(payload, calls) {
  return async (url, opts) => { if (calls) calls.push({ url: String(url), opts }); return { json: async () => payload }; };
}
const ctx = (fn) => ({ fetch: fn });

// ── esc ─────────────────────────────────────────────────────────────────────────────────────────────────
test('esc escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
});

// ── hunterProvider ──────────────────────────────────────────────────────────────────────────────────────
test('hunterProvider maps email/title/company + verified from data.verification.status', async () => {
  const calls = [];
  const p = hunterProvider({ apiKey: 'k' });
  const out = await p({ name: 'Ada Lovelace', domain: 'analytical.co' }, ctx(fakeFetch(
    { data: { email: 'ada@analytical.co', position: 'Founder', company: 'Analytical Engines',
              verification: { status: 'valid' } } }, calls)));
  assert.deepEqual(out, { email: 'ada@analytical.co', title: 'Founder', company: 'Analytical Engines',
                          verified: true, source: 'hunter' });
  // URL carries domain + split name + key.
  assert.match(calls[0].url, /api\.hunter\.io\/v2\/email-finder/);
  assert.match(calls[0].url, /domain=analytical\.co/);
  assert.match(calls[0].url, /first_name=Ada&last_name=Lovelace/);
  assert.match(calls[0].url, /api_key=k/);
});

test('hunterProvider drops verified when status is not valid', async () => {
  const p = hunterProvider({ apiKey: 'k' });
  const out = await p({ name: 'A B', domain: 'x.co' }, ctx(fakeFetch(
    { data: { email: 'a@x.co', verification: { status: 'accept_all' } } })));
  assert.equal(out.email, 'a@x.co');
  assert.equal(out.verified, undefined);   // pruned — not asserted
});

test('hunterProvider soft-fails to null with no key (env-gated)', async () => {
  delete process.env.HUNTER_API_KEY;
  const p = hunterProvider();
  assert.equal(await p({ name: 'Ada', domain: 'x.co' }, ctx(fakeFetch({ data: { email: 'a@x.co' } }))), null);
});

test('hunterProvider reads key from env when cfg omits it', async () => {
  process.env.HUNTER_API_KEY = 'env-key';
  const p = hunterProvider();
  const out = await p({ name: 'Ada', domain: 'x.co' }, ctx(fakeFetch({ data: { email: 'a@x.co' } })));
  assert.equal(out.email, 'a@x.co');
  delete process.env.HUNTER_API_KEY;
});

test('hunterProvider soft-fails to null with no domain', async () => {
  const p = hunterProvider({ apiKey: 'k' });
  assert.equal(await p({ name: 'Ada' }, ctx(fakeFetch({ data: { email: 'a@x.co' } }))), null);
});

test('hunterProvider soft-fails to null on empty data and on throw', async () => {
  const p = hunterProvider({ apiKey: 'k' });
  assert.equal(await p({ domain: 'x.co' }, ctx(fakeFetch({}))), null);         // no data → null
  const boom = ctx(async () => { throw new Error('network down'); });
  assert.equal(await p({ domain: 'x.co' }, boom), null);                       // throw contained
});

// ── clearbitProvider ────────────────────────────────────────────────────────────────────────────────────
test('clearbitProvider maps person.employment.title/phone + company.name, sends bearer', async () => {
  const calls = [];
  const p = clearbitProvider({ apiKey: 'cb' });
  const out = await p({ email: 'ada@analytical.co' }, ctx(fakeFetch(
    { person: { email: 'ada@analytical.co', employment: { title: 'CEO' }, phone: '+1-555-0100' },
      company: { name: 'Analytical Engines' } }, calls)));
  assert.deepEqual(out, { email: 'ada@analytical.co', title: 'CEO', company: 'Analytical Engines',
                          phone: '+1-555-0100', source: 'clearbit' });
  assert.match(calls[0].url, /person\.clearbit\.com\/v2\/combined\/find\?email=ada%40analytical\.co/);
  assert.equal(calls[0].opts.headers.authorization, 'Bearer cb');
});

test('clearbitProvider soft-fails to null with no key and with no email', async () => {
  delete process.env.CLEARBIT_API_KEY;
  assert.equal(await clearbitProvider()({ email: 'a@x.co' }, ctx(fakeFetch({ person: {} }))), null);
  assert.equal(await clearbitProvider({ apiKey: 'cb' })({}, ctx(fakeFetch({ person: {} }))), null);
});

test('clearbitProvider soft-fails to null when neither person nor company present', async () => {
  const out = await clearbitProvider({ apiKey: 'cb' })({ email: 'a@x.co' }, ctx(fakeFetch({})));
  assert.equal(out, null);
});

// ── clayProvider ────────────────────────────────────────────────────────────────────────────────────────
test('clayProvider POSTs { email, domain } and maps person.company_name/phone/title', async () => {
  const calls = [];
  const p = clayProvider({ apiKey: 'cl' });
  const out = await p({ email: 'ada@analytical.co', domain: 'analytical.co' }, ctx(fakeFetch(
    { person: { email: 'ada@analytical.co', title: 'Founder', company_name: 'Analytical Engines',
                phone: '+1-555-0199' } }, calls)));
  assert.deepEqual(out, { email: 'ada@analytical.co', title: 'Founder',
                          company: 'Analytical Engines', phone: '+1-555-0199', source: 'clay' });
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.authorization, 'Bearer cl');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { email: 'ada@analytical.co', domain: 'analytical.co' });
});

test('clayProvider soft-fails to null with no key and with neither email nor domain', async () => {
  delete process.env.CLAY_API_KEY;
  assert.equal(await clayProvider()({ email: 'a@x.co' }, ctx(fakeFetch({ person: {} }))), null);
  assert.equal(await clayProvider({ apiKey: 'cl' })({}, ctx(fakeFetch({ person: {} }))), null);
});

// ── module-level __setFetch fallback (no ctx supplied) ──────────────────────────────────────────────────
test('provider uses module __setFetch when called without a ctx', async () => {
  __setFetch(fakeFetch({ data: { email: 'a@x.co', position: 'Eng' } }));
  const out = await hunterProvider({ apiKey: 'k' })({ name: 'A B', domain: 'x.co' });
  assert.equal(out.email, 'a@x.co');
  assert.equal(out.title, 'Eng');
  __setFetch(null);   // reset
});

// ── end-to-end: real enrichment.mjs waterfall with these adapters ───────────────────────────────────────
test('enrichLead waterfall merges hunter (email/verified) then clearbit (title/company/phone)', async () => {
  const hunter = hunterProvider({ apiKey: 'k' });
  const clearbit = clearbitProvider({ apiKey: 'cb' });
  // Route the injected ctx.fetch by URL so both providers see their own payload.
  const routed = async (url, opts) => ({
    json: async () => (String(url).includes('hunter')
      ? { data: { email: 'ada@analytical.co', verification: { status: 'valid' } } }
      : { person: { employment: { title: 'CEO' }, phone: '+1-555-0100' }, company: { name: 'Analytical Engines' } }),
  });
  __setProviders([ (l, c) => hunter(l, { fetch: routed }), (l, c) => clearbit(l, { fetch: routed }) ]);
  const lead = await enrichLead({ name: 'Ada Lovelace', domain: 'analytical.co' });
  assert.equal(lead.email, 'ada@analytical.co');
  assert.equal(lead.verified, true);
  assert.equal(lead.title, 'CEO');
  assert.equal(lead.company, 'Analytical Engines');
  assert.equal(lead.phone, '+1-555-0100');
  assert.equal(lead.enriched, true);
  assert.deepEqual(lead.sources, ['hunter', 'clearbit']);
  __setProviders([]);
});

test('defaultProviders returns three functions and soft no-ops when unconfigured', async () => {
  delete process.env.HUNTER_API_KEY; delete process.env.CLEARBIT_API_KEY; delete process.env.CLAY_API_KEY;
  const provs = defaultProviders();
  assert.equal(provs.length, 3);
  for (const p of provs) assert.equal(typeof p, 'function');
  // All unconfigured → each returns null → enrichLead reports not enriched (no throw).
  __setProviders(provs);
  const lead = await enrichLead({ name: 'Ada', domain: 'x.co' });
  assert.equal(lead.enriched, false);
  __setProviders([]);
});
