// chatSurface.test.js — tests for the Library of Ashurbanipal Discord/Telegram chat surface (#96).
//
// Fully OFFLINE: backends (search / factCheck / liveData) are INJECTED via __setBackends, so there is
// no disk, no network, no LLM. Asserts the grounded-or-honest invariant (never fabricates), the live
// price path, !help, the unknown nudge, the rate limiter, and the privacy-safe log line.
//
// Run: node --test test/chatSurface.test.js   (node:test + node:assert/strict, no new deps)

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleCommand,
  formatAnswer,
  COMMANDS,
  RateLimiter,
  redactForLog,
  sanitize,
  NO_SOURCE_REPLY,
  __setBackends,
  __resetBackends,
} from '../src/chatSurface.js';

// A grounded search backend: returns rows with a citable source for known topics, nothing otherwise.
function groundedSearch() {
  return async (query) => {
    const q = String(query).toLowerCase();
    if (q.includes('oilahuasca')) {
      return [
        { title: 'Oilahuasca', excerpt: 'Oilahuasca is an oral DMT preparation framework.', source: 'oilahuasca.json' },
        { title: 'Headcones', excerpt: 'Related delivery method.', source: 'headcones.json' },
      ];
    }
    if (q.includes('phoenix protocol')) {
      return [{ title: 'Phoenix Protocol', excerpt: 'A canonical operator document.', url: 'https://wiki.example/Phoenix_Protocol' }];
    }
    return []; // ungrounded query → no sources
  };
}

// A live-data backend mimicking steemd runCommand's { ok, text, data } shape.
function fakeLiveData() {
  return async (cmd) => {
    if (/^price\s+vkbt/i.test(cmd)) {
      return { ok: true, text: '**Van Kush** (VKBT) — $0.42 (+1.20% 24h)', data: { symbol: 'VKBT', price_usd: 0.42 } };
    }
    return { ok: false, text: 'no coin', data: null };
  };
}

test.afterEach(() => __resetBackends());

// ── !ask: grounded answer with citations ──────────────────────────────────────
test('!ask returns a grounded answer with citations from injected search', async () => {
  __setBackends({ search: groundedSearch() });
  const out = await handleCommand({ user: 'alice', text: '!ask what is oilahuasca' });
  assert.equal(out.kind, 'ask');
  assert.match(out.reply, /Oilahuasca/);
  assert.match(out.reply, /Sources:/);
  assert.match(out.reply, /oilahuasca\.json/);
  // grounded, not the honest-fallback
  assert.notEqual(out.reply, NO_SOURCE_REPLY);
});

// ── !ask: ungrounded → honest no-source, NEVER a fabrication ───────────────────
test('an ungrounded query returns the honest no-grounded-source reply (no fabrication)', async () => {
  __setBackends({ search: groundedSearch() }); // returns [] for unknown topics
  const out = await handleCommand({ user: 'bob', text: '!ask what is the airspeed of an unladen swallow' });
  assert.equal(out.kind, 'ask');
  assert.equal(out.reply, NO_SOURCE_REPLY);
  assert.doesNotMatch(out.reply, /Sources:/); // no invented citations
});

// ── formatAnswer is grounded-or-honest in isolation ───────────────────────────
test('formatAnswer returns the honest fallback when there are no citable rows', () => {
  assert.equal(formatAnswer([]), NO_SOURCE_REPLY);
  assert.equal(formatAnswer([{ excerpt: 'a claim with no source' }]), NO_SOURCE_REPLY);
  const grounded = formatAnswer([{ title: 'X', excerpt: 'fact', source: 'x.json' }]);
  assert.match(grounded, /Sources:/);
  assert.match(grounded, /x\.json/);
});

// ── !library: article summary + link ──────────────────────────────────────────
test('!library returns an article summary with a source link', async () => {
  __setBackends({ search: groundedSearch() });
  const out = await handleCommand({ user: 'alice', text: '!library Phoenix Protocol' });
  assert.equal(out.kind, 'library');
  assert.match(out.reply, /Phoenix Protocol/);
  assert.match(out.reply, /Source: https:\/\/wiki\.example/);
});

test('!wiki is an alias of !library', async () => {
  __setBackends({ search: groundedSearch() });
  const out = await handleCommand({ user: 'alice', text: '!wiki oilahuasca' });
  assert.equal(out.kind, 'library');
  assert.match(out.reply, /Oilahuasca/);
});

// ── !price: live fact via injected liveData ───────────────────────────────────
test('!price returns a live fact via injected liveData', async () => {
  __setBackends({ liveData: fakeLiveData() });
  const out = await handleCommand({ user: 'carol', text: '!price VKBT' });
  assert.equal(out.kind, 'price');
  assert.match(out.reply, /VKBT/);
  assert.match(out.reply, /\$0\.42/);
});

// ── !help: lists commands ─────────────────────────────────────────────────────
test('!help lists the commands', async () => {
  const out = await handleCommand({ user: 'dan', text: '!help' });
  assert.equal(out.kind, 'help');
  assert.match(out.reply, /!ask/);
  assert.match(out.reply, /!library/);
  assert.match(out.reply, /!price/);
  // COMMANDS export drives the list
  assert.ok(Array.isArray(COMMANDS) && COMMANDS.length >= 4);
});

// ── unknown → nudge ───────────────────────────────────────────────────────────
test('unknown command nudges toward !help', async () => {
  const out = await handleCommand({ user: 'eve', text: '!frobnicate stuff' });
  assert.equal(out.kind, 'nudge');
  assert.match(out.reply, /!help/);
});

test('non-command text nudges toward a command', async () => {
  const out = await handleCommand({ user: 'eve', text: 'hello there' });
  assert.equal(out.kind, 'nudge');
  assert.match(out.reply, /!ask|!help/);
});

// ── rate limiter blocks after burst ───────────────────────────────────────────
test('rate limiter blocks after burst', async () => {
  let clock = 0;
  const limiter = new RateLimiter({ capacity: 3, windowMs: 10000, now: () => clock });
  const ctx = { limiter };
  const kinds = [];
  for (let i = 0; i < 5; i++) {
    const out = await handleCommand({ user: 'spammer', text: '!help' }, ctx);
    kinds.push(out.kind);
  }
  // first 3 allowed (help), then rate-limited
  assert.deepEqual(kinds.slice(0, 3), ['help', 'help', 'help']);
  assert.equal(kinds[3], 'rate-limited');
  assert.equal(kinds[4], 'rate-limited');
  // after the window refills, allowed again
  clock += 10000;
  const after = await handleCommand({ user: 'spammer', text: '!help' }, ctx);
  assert.equal(after.kind, 'help');
});

// ── redactForLog omits raw content ────────────────────────────────────────────
test('redactForLog omits the raw question body and keeps only the verb', () => {
  const line = redactForLog({ user: 'alice', text: '!ask my secret address is 123 Main St and ssn 000-00-0000' });
  assert.match(line, /user=alice/);
  assert.match(line, /cmd="!ask"/);
  assert.doesNotMatch(line, /Main St/);
  assert.doesNotMatch(line, /000-00-0000/);
});

test('redactForLog scrubs a WIF-shaped token even if it leaks into the verb position', () => {
  const wif = '5' + 'K'.repeat(51);
  const line = redactForLog({ user: 'x', text: wif });
  assert.doesNotMatch(line, new RegExp(wif));
});

// ── soft-fail: a throwing backend never throws out, never fabricates ───────────
test('a throwing search backend soft-fails to the honest no-source reply', async () => {
  __setBackends({ search: async () => { throw new Error('backend down'); } });
  const out = await handleCommand({ user: 'alice', text: '!ask anything' });
  assert.equal(out.reply, NO_SOURCE_REPLY);
  assert.equal(out.kind, 'error');
});

// ── sanitize basics (caps length, strips control chars) ───────────────────────
test('sanitize strips control chars and caps length', () => {
  assert.equal(sanitize('a\x00b\tc'), 'a b c');
  assert.equal(sanitize('x'.repeat(1000)).length, 500);
  assert.equal(sanitize(null), '');
});

// ── empty input nudges ────────────────────────────────────────────────────────
test('empty input nudges', async () => {
  const out = await handleCommand({ user: 'z', text: '' });
  assert.equal(out.kind, 'nudge');
});
