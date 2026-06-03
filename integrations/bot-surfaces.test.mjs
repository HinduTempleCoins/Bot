import { test } from 'node:test';
import assert from 'node:assert';
import { SURFACES, register, dispatch, route } from './bot-surfaces.mjs';

test('registry seeds the built-in surfaces', () => {
  for (const name of ['melek', 'telegram', 'discord', 'matrix', 'nostr', 'farcaster']) {
    assert.ok(SURFACES.has(name), `missing surface: ${name}`);
    const a = SURFACES.get(name);
    assert.equal(a.name, name);
    assert.equal(typeof a.normalize, 'function');
    assert.equal(typeof a.send, 'function');
  }
});

test('register validates the common interface', () => {
  assert.throws(() => register({}), /non-empty string name/);
  assert.throws(() => register({ name: 'x' }), /normalize\(\) and send\(\)/);
  const added = register({ name: 'matrix-test', normalize: (e) => e, send: (m) => ({ m }) });
  assert.ok(SURFACES.has('matrix-test'));
  assert.equal(added.name, 'matrix-test');
});

test('dispatch normalizes a Telegram event to the common shape', () => {
  const out = dispatch({
    surface: 'telegram',
    message: { from: { username: 'ryan' }, chat: { id: 42 }, text: '  hello  ' },
  });
  assert.deepEqual(out, {
    surface: 'telegram',
    user: 'ryan',
    text: 'hello',
    replyTo: { chatId: 42 },
  });
});

test('dispatch normalizes a Discord event to the common shape', () => {
  const out = dispatch({
    surface: 'discord',
    author: { username: 'satoshi' },
    content: 'gm',
    channel_id: 'c1',
  });
  assert.deepEqual(out, {
    surface: 'discord',
    user: 'satoshi',
    text: 'gm',
    replyTo: { channelId: 'c1' },
  });
});

test('dispatch normalizes a MELEK/Graphene comment to the common shape', () => {
  const out = dispatch({
    surface: 'melek',
    author: 'punicwax',
    parent_author: 'hathor',
    permlink: 're-intro',
    body: 'how do I sign up?',
  });
  assert.deepEqual(out, {
    surface: 'melek',
    user: 'punicwax',
    text: 'how do I sign up?',
    replyTo: { author: 'hathor', permlink: 're-intro' },
  });
});

test('route returns a correct DRY-RUN send-intent for telegram', () => {
  const intent = route('welcome', 'telegram', { replyTo: { chatId: 42 } });
  assert.equal(intent.surface, 'telegram');
  assert.equal(intent.kind, 'send-intent');
  assert.equal(intent.dryRun, true);
  assert.equal(intent.to, 42);
  assert.equal(intent.text, 'welcome');
  assert.equal(intent.method, 'sendMessage');
  // scoped grant via vault, never a raw key
  assert.equal(intent.grant.source, 'vault');
  assert.equal(intent.grant.key, null);
  assert.equal(intent.grant.grantKind, 'bot-token');
});

test('route on MELEK yields a comment op with a posting-key delegation grant (no raw key)', () => {
  const intent = route('reply on chain', 'melek', { replyTo: { author: 'hathor', permlink: 'p1' } });
  assert.equal(intent.op, 'comment');
  assert.equal(intent.dryRun, true);
  assert.deepEqual(intent.to, { author: 'hathor', permlink: 'p1' });
  assert.equal(intent.grant.grantKind, 'posting-key-delegation');
  assert.equal(intent.grant.key, null);
});

test('unknown surface soft-fails (no throw) on both dispatch and route', () => {
  assert.equal(dispatch({ surface: 'myspace', text: 'hi' }), null);
  assert.equal(route('hi', 'myspace'), null);
  assert.equal(dispatch({}), null);
});

test('round-trip: dispatch then route across surfaces', () => {
  const inbound = dispatch({
    surface: 'nostr',
    pubkey: 'npub1abc',
    content: 'hey',
    id: 'evt1',
  });
  assert.equal(inbound.surface, 'nostr');
  assert.equal(inbound.user, 'npub1abc');
  const intent = route('hello back', inbound.surface, { replyTo: inbound.replyTo });
  assert.equal(intent.surface, 'nostr');
  assert.equal(intent.method, 'publishEvent');
  assert.deepEqual(intent.to, { eventId: 'evt1', pubkey: 'npub1abc' });
});
