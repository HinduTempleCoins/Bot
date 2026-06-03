// hathor-dispatch.test.mjs — offline tests for the Hathor inbound-message dispatcher (Task #65).
//
// Everything runs OFFLINE: downstream handlers (menu / persona / resource) are INJECTED via
// __setHandlers, so no network, no live modules, no keys. We cover: route() classification,
// dispatch() delegation to each injected handler, greeting variation, the rate limiter, the
// privacy-safe log line, and soft-fail on a throwing handler.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dispatch,
  route,
  RateLimiter,
  redactForLog,
  __setHandlers,
  __resetHandlers,
} from './hathor-dispatch.mjs';

// A fixed fake clock helper for the limiter.
function clockFrom(start = 0) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

// Stub set: records calls, returns deterministic markers so we can assert the route.
function stubHandlers({ greetVaries = true } = {}) {
  const calls = { menu: [], persona: { greet: [], shape: [] }, resource: [] };
  __setHandlers({
    menu: {
      handle: async (text, deps) => {
        calls.menu.push({ text, deps });
        return `MENU_REPLY:${text}`;
      },
    },
    persona: {
      dispositionGreeting: ({ user, context, seed }) => {
        calls.persona.greet.push({ user, context, seed });
        // Vary on seed so the variation test can observe distinct outputs.
        return greetVaries ? `GREET:${context}:${seed}` : 'GREET:fixed';
      },
      shapeReply: (text, { tone, seed } = {}) => {
        calls.persona.shape.push({ text, tone, seed });
        return `SHAPED:${tone}:${text}`;
      },
    },
    resource: {
      handleChat: async ({ user, text }, ctx) => {
        calls.resource.push({ user, text, ctx });
        return { reply: `RESOURCE_REPLY:${text}`, kind: 'resource' };
      },
    },
  });
  return calls;
}

// ── route() — the pure classifier ────────────────────────────────────────────────────────────────

test('route() classifies greeting vs !command vs resource-question vs general', () => {
  // greeting / empty / first-contact
  assert.equal(route(''), 'greeting');
  assert.equal(route('   '), 'greeting');
  assert.equal(route('hi'), 'greeting');
  assert.equal(route('Hello there!'), 'greeting');
  assert.equal(route('gm'), 'greeting');

  // !command
  assert.equal(route('!help'), 'command');
  assert.equal(route('!balance @alice'), 'command');
  assert.equal(route('!price btc'), 'command');

  // explicit resource command
  assert.equal(route('!rc gold price'), 'resource');
  assert.equal(route('!resource what should we trade'), 'resource');

  // detected factual / resource question (question shape + resource cue)
  assert.equal(route('what is the price of gold?'), 'resource');
  assert.equal(route('how much is bitcoin worth'), 'resource');
  assert.equal(route('whats the latest news on the market?'), 'resource');

  // general conversation → persona
  assert.equal(route('tell me about the angels'), 'persona');
  assert.equal(route('I think oracles are real'), 'persona');
  // a question with NO resource cue stays persona (conservative heuristic)
  assert.equal(route('who are you?'), 'persona');
});

// ── dispatch() — delegation to each injected handler ─────────────────────────────────────────────

test('dispatch delegates a !command to the injected menu', async () => {
  const calls = stubHandlers();
  try {
    const out = await dispatch({ platform: 'discord', user: 'alice', text: '!balance @bob' });
    assert.equal(out.route, 'command');
    assert.equal(out.platform, 'discord');
    assert.equal(out.reply, 'MENU_REPLY:!balance @bob');
    assert.equal(calls.menu.length, 1);
    assert.equal(calls.menu[0].text, '!balance @bob');
  } finally {
    __resetHandlers();
  }
});

test('dispatch delegates a resource question to the injected resource handler', async () => {
  const calls = stubHandlers();
  try {
    const out = await dispatch({ platform: 'telegram', user: 'carol', text: 'what is the price of gold?' });
    assert.equal(out.route, 'resource');
    assert.equal(out.platform, 'telegram');
    assert.equal(out.reply, 'RESOURCE_REPLY:what is the price of gold?');
    assert.equal(calls.resource.length, 1);
    assert.equal(calls.resource[0].user, 'carol');

    // also via explicit !rc
    const out2 = await dispatch({ platform: 'telegram', user: 'carol', text: '!rc silver price' });
    assert.equal(out2.route, 'resource');
    assert.equal(out2.reply, 'RESOURCE_REPLY:!rc silver price');
  } finally {
    __resetHandlers();
  }
});

test('dispatch delegates a greeting to the persona greeting (varied)', async () => {
  const calls = stubHandlers();
  try {
    const out = await dispatch({ platform: 'discord', user: 'dave', text: 'hello' });
    assert.equal(out.route, 'greeting');
    assert.match(out.reply, /^GREET:open:/);
    assert.equal(calls.persona.greet.length, 1);
    assert.equal(calls.persona.greet[0].context, 'open');
    assert.equal(calls.persona.greet[0].user, 'dave');

    // Variation: different seeds → different greetings (disposition, not a fixed script).
    const a = await dispatch({ platform: 'discord', user: 'dave', text: '' }, { seed: 1 });
    const b = await dispatch({ platform: 'discord', user: 'dave', text: '' }, { seed: 2 });
    assert.notEqual(a.reply, b.reply);
  } finally {
    __resetHandlers();
  }
});

test('dispatch sends general text to shapeReply (persona-shaped voice)', async () => {
  const calls = stubHandlers();
  try {
    const out = await dispatch({ platform: 'discord', user: 'eve', text: 'tell me about the angels' });
    assert.equal(out.route, 'persona');
    assert.equal(out.reply, 'SHAPED:warm:tell me about the angels');
    assert.equal(calls.persona.shape.length, 1);
    assert.equal(calls.persona.shape[0].text, 'tell me about the angels');
  } finally {
    __resetHandlers();
  }
});

// ── rate limiter ─────────────────────────────────────────────────────────────────────────────────

test('rate limiter blocks after burst (injectable clock)', async () => {
  stubHandlers();
  try {
    const now = clockFrom(0);
    const limiter = new RateLimiter({ capacity: 3, windowMs: 1000, now });
    const msg = { platform: 'discord', user: 'frank', text: 'hi' };

    // First 3 pass (the burst).
    for (let i = 0; i < 3; i++) {
      const out = await dispatch(msg, { limiter, now });
      assert.equal(out.route, 'greeting', `call ${i} should pass`);
    }
    // 4th is rate-limited.
    const blocked = await dispatch(msg, { limiter, now });
    assert.equal(blocked.route, 'rate-limited');
    assert.match(blocked.reply, /a little fast/);

    // After the window refills, it passes again.
    now.advance(1000);
    const after = await dispatch(msg, { limiter, now });
    assert.equal(after.route, 'greeting');

    // Different user has an independent bucket.
    const other = await dispatch({ platform: 'discord', user: 'grace', text: 'hi' }, { limiter, now });
    assert.equal(other.route, 'greeting');
  } finally {
    __resetHandlers();
  }
});

// ── privacy-safe logging ─────────────────────────────────────────────────────────────────────────

test('redactForLog omits raw content and user PII', () => {
  const raw = 'what is the price of gold 5KQNabc?';
  const line = redactForLog({ platform: 'Discord', user: 'alice#1234', text: raw });

  // No raw content leaks.
  assert.ok(!line.includes('secret message'), 'must not contain raw content');
  assert.ok(!line.includes('5KQNabc'), 'must not contain message tokens');
  // No raw user id leaks.
  assert.ok(!line.includes('alice#1234'), 'must not contain raw user id');
  // It does carry safe, non-identifying operational fields.
  assert.match(line, /platform=discord/);
  assert.match(line, /user=u[0-9a-z]+/);
  assert.match(line, /len=\d+/);
  assert.match(line, /route=resource/); // "price of gold" → resource

  // Anonymous / missing fields degrade safely.
  const anon = redactForLog({});
  assert.match(anon, /platform=unknown/);
  assert.match(anon, /user=anon/);
  assert.match(anon, /len=0/);
});

// ── soft-fail on a throwing handler ──────────────────────────────────────────────────────────────

test('a thrown handler soft-fails to a graceful reply (no throw)', async () => {
  __setHandlers({
    menu: { handle: async () => { throw new Error('menu boom'); } },
    persona: {
      dispositionGreeting: () => { throw new Error('greet boom'); },
      shapeReply: () => { throw new Error('shape boom'); },
    },
    resource: { handleChat: async () => { throw new Error('rc boom'); } },
  });
  try {
    const cmd = await dispatch({ platform: 'discord', user: 'h', text: '!help' });
    assert.equal(cmd.route, 'command');
    assert.ok(cmd.reply && cmd.reply.length > 0);
    assert.ok(!/boom/.test(cmd.reply));

    const greet = await dispatch({ platform: 'discord', user: 'h', text: 'hi' });
    assert.equal(greet.route, 'greeting');
    assert.ok(greet.reply && greet.reply.length > 0);

    const res = await dispatch({ platform: 'discord', user: 'h', text: 'price of gold?' });
    assert.equal(res.route, 'resource');
    assert.ok(res.reply && res.reply.length > 0);

    const per = await dispatch({ platform: 'discord', user: 'h', text: 'tell me about angels' });
    assert.equal(per.route, 'persona');
    assert.ok(per.reply && per.reply.length > 0);
  } finally {
    __resetHandlers();
  }
});

// ── missing handler module also soft-fails (no inject, no real module shape guaranteed) ───────────

test('dispatch never throws on bad input', async () => {
  __resetHandlers();
  // No handlers injected; real modules may or may not be present — must still resolve gracefully.
  const out = await dispatch({});
  assert.ok(typeof out.reply === 'string' && out.reply.length > 0);
  assert.ok(['greeting', 'command', 'resource', 'persona', 'rate-limited'].includes(out.route));

  const out2 = await dispatch({ platform: 'x', user: null, text: null });
  assert.ok(typeof out2.reply === 'string' && out2.reply.length > 0);
});
