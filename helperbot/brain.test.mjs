// brain.test.mjs — one command brain, same behaviour on every surface; legacy handlers keep anything the
// brain does not claim; the fleetq AI seam is off by default and falls back cleanly. Offline.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { __setFetch } from './live.mjs';
import { handle, parse, helpText, enabled, HELPER_COMMANDS } from './brain.mjs';
import { memoryStore } from './store.mjs';
import { askAI, viaFleetq, fleetqConfig, __setFetch as setAIFetch } from './ai-route.mjs';
import { LINKS } from './addresses.mjs';
import { baseState, fakeFetch } from './test-fakes.mjs';

let st;
beforeEach(() => { st = baseState(); __setFetch(fakeFetch(st)); __setFetch(fakeFetch(st)); });

test('parse accepts ! and / prefixes and Telegram /cmd@BotName', () => {
  assert.deepEqual(parse('!tip @a 2'), { cmd: 'tip', args: ['@a', '2'] });
  assert.deepEqual(parse('/prana@HathorBot'), { cmd: 'prana', args: [] });
  assert.equal(parse('hello'), null);
});

test('off by default; HELPERBOT_ENABLED=1 turns the helper commands on', () => {
  assert.equal(enabled({}), false);
  assert.equal(enabled({ HELPERBOT_ENABLED: '1' }), true);
});

test('the same command gives the same answer on discord, telegram and the troll-box', async () => {
  const store = memoryStore();
  const outs = [];
  for (const [platform, text] of [['discord', '!faucet'], ['telegram', '/faucet'], ['trollbox', '!faucet']]) {
    outs.push((await handle({ platform, userId: 'u', text }, { store })).reply);
  }
  assert.equal(outs[0], outs[1]);
  assert.equal(outs[1], outs[2]);
});

test('unclaimed commands and chat fall through to the legacy handlers', async () => {
  for (const t of ['!sb markets', '!steemd clarity vkbt', '!price VKBT', '!upvote @a/b', '!ask hi', 'hello there', '/generate cat']) {
    assert.equal((await handle({ platform: 'discord', userId: 'u', text: t }, { store: memoryStore() })).handled, false, t);
  }
});

test('help lists every family, links the Discord invite, never mentions Botanica', () => {
  const h = helpText();
  for (const s of ['!tokenomics', '!faucet', '!tip', '!guide', '!verify', LINKS.discord]) assert.ok(h.includes(s), s);
  assert.ok(!/botanica/i.test(h));
  assert.ok(HELPER_COMMANDS.has('tip') && HELPER_COMMANDS.has('guide') && HELPER_COMMANDS.has('apis'));
});

test('stateful commands are refused on the anonymous web chat; tokenomics still work there', async () => {
  const r = await handle({ platform: 'web', userId: 'web', text: '!guide swap' }, { store: memoryStore() });
  assert.match(r.reply, /needs a per-user session/);
  const t = await handle({ platform: 'web', userId: 'web', text: '!apis' }, { store: memoryStore() });
  assert.match(t.reply, /APIS|unavailable/);
});

test('handler errors never escape the brain', async () => {
  const boom = { get() { throw new Error('disk'); }, set() { throw new Error('disk'); }, del() {}, keys: () => [] };
  const r = await handle({ platform: 'discord', userId: 'u', text: '!guide swap' }, { store: boom });
  assert.equal(r.handled, true);
  assert.equal(typeof r.reply, 'string');
});

// ── fleetq seam ────────────────────────────────────────────────────────────────────────────────────
test('fleetq seam is OFF by default → straight to the existing fallback path', async () => {
  assert.equal(fleetqConfig({}).enabled, false);
  setAIFetch(async () => { throw new Error('must not be called'); });
  const r = await askAI('hi', { cfg: fleetqConfig({}), fallback: async () => 'from brain' });
  assert.deepEqual(r, { text: 'from brain', via: 'fallback' });
});

test('fleetq ON: posts an llm.generate job, polls, returns the served output', async () => {
  const calls = [];
  let polls = 0;
  setAIFetch(async (url, init = {}) => {
    calls.push([init.method || 'GET', url, init.headers && init.headers.authorization, init.body && JSON.parse(init.body)]);
    if (url.endsWith('/jobs')) return { ok: true, json: async () => ({ id: 'j1' }) };
    polls += 1;
    return { ok: true, json: async () => (polls < 2 ? { status: 'open' } : { status: 'served', output: { text: 'Namaste from the fleet' } }) };
  });
  let t = 0;
  const cfg = fleetqConfig({ HATHOR_FLEETQ: '1', HATHOR_FLEETQ_URL: 'http://q', HATHOR_FLEETQ_TOKEN: 'tok' });
  const r = await askAI('who are you', { cfg, fallback: async () => 'fallback', now: () => t, wait: async (ms) => { t += ms; } });
  assert.deepEqual(r, { text: 'Namaste from the fleet', via: 'fleetq' });
  assert.equal(calls[0][2], 'Bearer tok');
  assert.equal(calls[0][3].type, 'llm.generate');
  assert.equal(calls[0][3].origin, 'hathor-helper-bot');
});

test('fleetq ON but slow / down / disputed → fallback, nothing goes dark', async () => {
  const cfg = fleetqConfig({ HATHOR_FLEETQ: '1', HATHOR_FLEETQ_URL: 'http://q', HATHOR_FLEETQ_DEADLINE_MS: '1000' });
  let t = 0;
  const clock = { now: () => t, wait: async (ms) => { t += ms; } };
  setAIFetch(async (url) => (url.endsWith('/jobs') ? { ok: true, json: async () => ({ id: 'j' }) } : { ok: true, json: async () => ({ status: 'open' }) }));
  assert.equal((await askAI('x', { cfg, fallback: async () => 'fb', ...clock })).via, 'fallback');
  setAIFetch(async () => { throw new Error('ECONNREFUSED'); });
  assert.equal(await viaFleetq('x', cfg, clock), null);
  setAIFetch(async (url) => (url.endsWith('/jobs') ? { ok: false, status: 401, json: async () => ({}) } : null));
  assert.equal((await askAI('x', { cfg, fallback: async () => 'fb', ...clock })).text, 'fb');
  setAIFetch(async (url) => (url.endsWith('/jobs') ? { ok: true, json: async () => ({ id: 'j' }) } : { ok: true, json: async () => ({ status: 'disputed' }) }));
  assert.equal((await askAI('x', { cfg, fallback: async () => null, ...clock })).via, 'none');
});
