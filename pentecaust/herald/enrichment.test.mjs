// pentecaust/herald/enrichment.test.mjs — offline, deterministic tests for the lead-enrichment waterfall.
// NO network: providers are injected fakes; the injectable fetch is never actually needed by the core.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichLead, verifyEmail, esc, __setProviders, __setFetch, getProviders } from './enrichment.mjs';

// Always leave the module in the unconfigured (no-provider) state after each test group.
function reset() { __setProviders([]); __setFetch(null); }

// ── verifyEmail: deterministic format check ─────────────────────────────────────────────────────────────
test('verifyEmail accepts well-formed and rejects malformed / oversized', () => {
  assert.equal(verifyEmail('a@b.com'), true);
  assert.equal(verifyEmail('  Ada@Analytical.CO '), true);        // trimmed + lowercased
  assert.equal(verifyEmail('not-an-email'), false);
  assert.equal(verifyEmail('a@b'), false);                        // no dotted TLD
  assert.equal(verifyEmail('a b@c.com'), false);                  // whitespace
  assert.equal(verifyEmail(''), false);
  assert.equal(verifyEmail(null), false);
  assert.equal(verifyEmail(`${'x'.repeat(250)}@b.com`), false);   // > 254 chars
});

// ── unconfigured → soft no-op ───────────────────────────────────────────────────────────────────────────
test('enrichLead with no providers soft-fails to { ...input, enriched:false }', async () => {
  reset();
  const r = await enrichLead({ name: 'Ada Lovelace', domain: 'analytical.co', email: 'ADA@analytical.co' });
  assert.equal(r.enriched, false);
  assert.deepEqual(r.sources, []);
  assert.equal(r.name, 'Ada Lovelace');
  assert.equal(r.domain, 'analytical.co');
  assert.equal(r.email, 'ada@analytical.co');                     // normalized
  assert.equal(r.verified, true);                                 // given email still format-verified
  assert.equal(r.title, '');
});

// ── the waterfall: first non-empty value per field wins ─────────────────────────────────────────────────
test('enrichLead merges first non-empty per field across ordered providers', async () => {
  const p1 = async () => ({ email: 'ada@found.co', source: 'hunter' });
  const p2 = async () => ({ email: 'IGNORED@late.co', title: 'Countess', company: 'Analytical Engines', source: 'clay' });
  const p3 = async () => ({ phone: '+1-555-0100', source: 'apollo' });
  __setProviders([p1, p2, p3]);
  const r = await enrichLead({ name: 'Ada Lovelace', domain: 'found.co' });
  assert.equal(r.email, 'ada@found.co');                          // p1 won; p2's email ignored (already set)
  assert.equal(r.title, 'Countess');                              // filled by p2
  assert.equal(r.company, 'Analytical Engines');
  assert.equal(r.phone, '+1-555-0100');                           // filled by p3
  assert.equal(r.enriched, true);
  assert.deepEqual(r.sources, ['hunter', 'clay', 'apollo']);
  assert.equal(r.verified, true);                                 // format-verified from resolved email
  reset();
});

test('enrichLead short-circuits once every waterfall field is filled', async () => {
  let p2Called = false;
  const p1 = async () => ({ email: 'a@b.com', title: 'CEO', company: 'B Inc', phone: '555', source: 'one' });
  const p2 = async () => { p2Called = true; return { title: 'later' }; };
  __setProviders([p1, p2]);
  const r = await enrichLead({ name: 'X', domain: 'b.com' });
  assert.equal(p2Called, false);                                  // all fields filled → p2 never invoked
  assert.deepEqual(r.sources, ['one']);
  reset();
});

test('enrichLead honors a provider-asserted verified flag even for an unparseable email', async () => {
  __setProviders([async () => ({ company: 'NoEmail Co', verified: true, source: 'firmographic' })]);
  const r = await enrichLead({ name: 'Y', domain: 'noemail.co' });
  assert.equal(r.email, '');
  assert.equal(r.verified, true);                                 // provider asserted deliverability
  assert.equal(r.enriched, true);
  reset();
});

// ── soft-fail: a throwing / garbage provider is contained ───────────────────────────────────────────────
test('a throwing provider is skipped; the waterfall continues (never throws)', async () => {
  const boom = async () => { throw new Error('provider down'); };
  const good = async () => ({ email: 'z@z.com', source: 'good' });
  __setProviders([boom, good, async () => null, async () => 'garbage']);
  const r = await enrichLead({ name: 'Z', domain: 'z.com' });
  assert.equal(r.email, 'z@z.com');
  assert.deepEqual(r.sources, ['good']);
  assert.equal(r.enriched, true);
  reset();
});

test('enrichLead never throws on garbage input', async () => {
  reset();
  const r1 = await enrichLead();
  assert.equal(r1.enriched, false);
  const r2 = await enrichLead({ name: null, domain: 123, email: {} });
  assert.equal(r2.enriched, false);
  assert.equal(typeof r2.email, 'string');
});

// ── provider receives normalized lead + injected fetch (offline) ────────────────────────────────────────
test('providers receive the merged lead and an injected fetch via ctx', async () => {
  let seenCtx = null; let seenLead = null;
  let fetchInjected = false;
  __setFetch(async () => { fetchInjected = true; return { json: async () => ({}) }; });
  __setProviders([async (leadArg, ctx) => { seenLead = leadArg; seenCtx = ctx; return { title: 'T', source: 's' }; }]);
  const r = await enrichLead({ name: '  Grace Hopper ', domain: 'NAVY.mil', email: 'GRACE@navy.mil' });
  assert.equal(seenLead.name, 'Grace Hopper');                    // cleaned
  assert.equal(seenLead.domain, 'NAVY.mil');
  assert.equal(seenLead.email, 'grace@navy.mil');                 // lowercased
  assert.equal(typeof seenCtx.fetch, 'function');
  // core never needs fetch, but a provider CAN call it — prove the injected one is wired
  await seenCtx.fetch('https://example.test');
  assert.equal(fetchInjected, true);
  assert.equal(r.title, 'T');
  reset();
});

// ── helpers + introspection ─────────────────────────────────────────────────────────────────────────────
test('esc escapes, __setProviders filters non-functions, getProviders is a copy', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  __setProviders([async () => ({}), 'not-a-fn', null, 42]);
  assert.equal(getProviders().length, 1);
  const copy = getProviders(); copy.push(() => {});
  assert.equal(getProviders().length, 1);                         // mutating the copy doesn't affect internal
  reset();
});
