import { test } from 'node:test';
import assert from 'node:assert';
import { SERVICES, OPEN_SERVICES, GATED_SERVICES, formatFor, post, broadcast } from './social-connectors.mjs';

// All offline: an injected `send` records what it was handed; nothing touches the network.

test('SERVICES catalog tiers the open vs gated networks', () => {
  assert.ok(OPEN_SERVICES.includes('discord'));
  assert.ok(OPEN_SERVICES.includes('bluesky'));
  assert.ok(OPEN_SERVICES.includes('mastodon'));
  assert.ok(OPEN_SERVICES.includes('nostr'));
  assert.ok(OPEN_SERVICES.includes('telegram'));
  assert.ok(GATED_SERVICES.includes('x'));
  for (const s of OPEN_SERVICES) assert.equal(SERVICES[s].tier, 'open');
  for (const s of GATED_SERVICES) assert.equal(SERVICES[s].tier, 'gated');
});

test('formatFor truncates to each network limit with an ellipsis', () => {
  const long = 'word '.repeat(20000); // ~100000 chars — exceeds every network limit
  for (const s of Object.keys(SERVICES)) {
    const out = formatFor(s, long);
    assert.ok(out.length <= SERVICES[s].limit, `${s} within limit`);
    assert.ok(out.endsWith('…'), `${s} truncated with ellipsis`);
  }
  // short text is untouched
  assert.equal(formatFor('mastodon', 'hello'), 'hello');
  // X is the tightest at 280
  const x = formatFor('x', long);
  assert.ok(x.length <= 280);
  // unknown service passes through
  assert.equal(formatFor('nope', 'verbatim'), 'verbatim');
});

test('post calls the injected send with the formatted payload — and never leaks the grant', async () => {
  let seen = null;
  const send = async (plan) => { seen = plan; return { id: 'remote-123' }; };
  const SECRET = 'cap-OPAQUE-do-not-log';

  const res = await post(
    { service: 'mastodon', text: 'X'.repeat(900) },
    { grant: SECRET, send },
  );

  assert.equal(res.ok, true);
  assert.equal(res.service, 'mastodon');
  // send received a shape descriptor + formatted payload (truncated to Mastodon's 500)
  assert.equal(seen.service, 'mastodon');
  assert.equal(seen.kind, 'mastodon');
  assert.ok(seen.payload.text.length <= 500);
  assert.ok(seen.payload.text.endsWith('…'));
  // the capability is handed to the transport under `grant` (the transport needs it), but it is
  // never echoed back in the returned result, and no raw token/URL is embedded in the plan.
  assert.equal(seen.grant, SECRET, 'transport gets the capability it needs');
  const dumped = JSON.stringify(res);
  assert.ok(!dumped.includes(SECRET), 'grant does not leak into the result');
  assert.ok(!dumped.includes('result') || !JSON.stringify(res.result).includes(SECRET));
});

test('post passes media only when the service supports it', async () => {
  let seen = null;
  const send = async (plan) => { seen = plan; return {}; };
  await post({ service: 'discord', text: 'hi', media: ['img.png'] }, { grant: 'g', send });
  assert.deepEqual(seen.payload.media, ['img.png']);

  seen = null;
  await post({ service: 'nostr', text: 'hi', media: ['img.png'] }, { grant: 'g', send });
  assert.equal(seen.payload.media, undefined, 'nostr (media:false) drops media');
});

test('post soft-fails: unknown service, missing send, missing grant — never throws', async () => {
  const send = async () => ({});
  assert.equal((await post({ service: 'nope', text: 'x' }, { grant: 'g', send })).ok, false);
  assert.equal((await post({ service: 'discord', text: 'x' }, { grant: 'g' })).ok, false); // no send
  const noGrant = await post({ service: 'discord', text: 'x' }, { send });
  assert.equal(noGrant.ok, false);
  assert.equal(noGrant.reason, 'no-grant');
});

test('post soft-fails when the injected send throws', async () => {
  const send = async () => { throw new Error('boom'); };
  const res = await post({ service: 'telegram', text: 'x' }, { grant: 'g', send });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'boom');
});

test('gated service skips without a unified key, posts with one', async () => {
  let called = false;
  const send = async () => { called = true; return { id: 'u1' }; };

  const skipped = await post({ service: 'x', text: 'hello' }, { grant: 'per-service-ignored', send });
  assert.equal(skipped.ok, false);
  assert.equal(skipped.reason, 'no-unified-key');
  assert.equal(called, false, 'never attempts to post a gated service without the unified key');

  const ok = await post({ service: 'x', text: 'hello' }, { send, unified: 'unified-cap' });
  assert.equal(ok.ok, true);
  assert.equal(called, true);
});

test('broadcast fans out to the open tier and skips gated without a unified key', async () => {
  const calls = [];
  const send = async (plan) => { calls.push(plan.service); return { id: plan.service }; };
  const grants = { discord: 'd', bluesky: 'b', mastodon: 'm', nostr: 'n', telegram: 't' };

  // mix open + a gated one; no unified key supplied
  const services = ['discord', 'mastodon', 'nostr', 'x'];
  const res = await broadcast({ text: 'a word to the networks' }, services, { grants, send });

  assert.equal(res.posted, 3, 'three open services posted');
  assert.equal(res.skipped, 1, 'the gated service was skipped');
  assert.ok(res.ok);
  assert.deepEqual(calls.sort(), ['discord', 'mastodon', 'nostr']);
  const xResult = res.results.find((r) => r.service === 'x');
  assert.equal(xResult.ok, false);
  assert.equal(xResult.reason, 'no-unified-key');
});

test('broadcast defaults to all open services and skips legs missing a grant', async () => {
  const calls = [];
  const send = async (plan) => { calls.push(plan.service); return {}; };
  // only provide grants for two of the open services
  const grants = { discord: 'd', telegram: 't' };
  const res = await broadcast({ text: 'hi' }, undefined, { grants, send });

  assert.equal(res.posted, 2);
  assert.equal(res.skipped, OPEN_SERVICES.length - 2);
  assert.deepEqual(calls.sort(), ['discord', 'telegram']);
});

test('broadcast never logs/leaks grants in its results', async () => {
  const send = async () => ({ id: 'ok' });
  const grants = { discord: 'SECRET-DISCORD', telegram: 'SECRET-TELEGRAM' };
  const res = await broadcast({ text: 'hi' }, ['discord', 'telegram'], { grants, send });
  const dumped = JSON.stringify(res);
  assert.ok(!dumped.includes('SECRET-DISCORD'));
  assert.ok(!dumped.includes('SECRET-TELEGRAM'));
});
