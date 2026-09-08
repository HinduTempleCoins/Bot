import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SURFACE, MAX_REPLY_CHARS, isAddressed, isQuestion, shouldSpeak,
  createHistory, draft, truncate, sweep, handler,
} from './hathor-bridge.mjs';
import { SURFACES } from '../../integrations/hathor-agency.mjs';

const post = (o) => ({ author: 'alice', permlink: 'p1', body: 'hello world', ...o });
const fakeHathor = (reply = 'A gateway is a threshold.') => ({
  perceive: async () => ({ reply, recalled: [1, 2], drewFrom: ['knowledge/architecture'] }),
});

test('congress is a registered Hathor surface with its own compartment', () => {
  assert.ok(SURFACES.includes('congress'));
  assert.equal(SURFACE, 'congress');
});

test('an @mention of her counts as being addressed', () => {
  assert.equal(isAddressed(post({ body: 'hey @hathor what is this' })), true);
  assert.equal(isAddressed(post({ body: 'HEY @HATHOR' })), true);
  assert.equal(isAddressed(post({ body: 'talking about hathor generally' })), false);
  assert.equal(isAddressed(post({ body: 'ask @hathorlive instead' })), false, 'a longer handle is a different account');
});

test('a reply to her own post counts as being addressed', () => {
  assert.equal(isAddressed(post({ parent_author: 'hathor', body: 'thanks' })), true);
});

test('rhetorical questions are not questions', () => {
  assert.equal(isQuestion('what is a witness?'), true);
  assert.equal(isQuestion('this is great, right?'), false);
  assert.equal(isQuestion('nice huh?'), false);
  assert.equal(isQuestion('no question here.'), false);
});

test('silence is the default on a public timeline', () => {
  const d = shouldSpeak(post({ body: 'just posting my lunch' }));
  assert.equal(d.speak, false);
  assert.match(d.why, /silence is the default/);
});

test('she never replies to herself', () => {
  const d = shouldSpeak(post({ author: 'hathor', body: '@hathor hi' }));
  assert.equal(d.speak, false);
  assert.match(d.why, /her own post/);
});

test('she never replies twice to the same post', () => {
  const h = createHistory();
  const p = post({ body: '@hathor hello' });
  assert.equal(shouldSpeak(p, { history: h }).speak, true);
  h.record({ author: 'alice', permlink: 'p1', at: 1000 });
  const again = shouldSpeak(p, { history: h, now: 10 ** 9 });
  assert.equal(again.speak, false);
  assert.match(again.why, /already replied/);
});

test('a cooldown stops her answering three posts in a minute', () => {
  const h = createHistory();
  h.record({ author: 'bob', permlink: 'x', at: 1000 });
  const soon = shouldSpeak(post({ body: '@hathor hi' }), { history: h, now: 1000 + 60000 });
  assert.equal(soon.speak, false);
  assert.match(soon.why, /cooldown/);
  const later = shouldSpeak(post({ body: '@hathor hi' }), { history: h, now: 1000 + 600000 });
  assert.equal(later.speak, true);
});

test('a draft is produced when addressed, and never broadcast', async () => {
  const d = await draft(post({ body: '@hathor what is a witness?' }), { hathor: fakeHathor() });
  assert.equal(d.ok, true);
  assert.equal(d.reply, 'A gateway is a threshold.');
  assert.equal(d.needsSigner, true);
  assert.match(d.note, /holds no key/);
  assert.deepEqual(d.parent, { author: 'alice', permlink: 'p1' });
  assert.equal(d.recalled, 2);
});

test('no Hathor instance is refused rather than faked', async () => {
  const d = await draft(post({ body: '@hathor hi' }), {});
  assert.equal(d.ok, false);
  assert.match(d.why, /does not create one/);
});

test('a perceive failure degrades to a reason, not a throw', async () => {
  const bad = { perceive: async () => { throw new Error('model down'); } };
  const d = await draft(post({ body: '@hathor hi' }), { hathor: bad });
  assert.equal(d.ok, false);
  assert.match(d.why, /perceive failed: model down/);
});

test('an empty reply is not posted', async () => {
  const d = await draft(post({ body: '@hathor hi' }), { hathor: fakeHathor('   ') });
  assert.equal(d.ok, false);
  assert.match(d.why, /nothing to say/);
});

test('over-long replies are cut on a sentence boundary, not mid-word', () => {
  const long = `${'A gateway is a threshold. '.repeat(40)}`;
  const t = truncate(long, 100);
  assert.ok(t.length <= 100);
  assert.ok(t.endsWith('.'), 'cuts at a sentence');
  assert.ok(!/\s$/.test(t));
  const nospace = truncate('x'.repeat(200), 50);
  assert.ok(nospace.length <= 50);
});

test('a long reply is flagged as truncated so it is not silently mangled', async () => {
  const d = await draft(post({ body: '@hathor hi' }), { hathor: fakeHathor('word. '.repeat(200)) });
  assert.equal(d.truncated, true);
  assert.ok(d.reply.length <= MAX_REPLY_CHARS);
});

test('a sweep replies to few posts and says why it skipped the rest', async () => {
  const posts = [
    post({ author: 'a', permlink: '1', body: 'gm' }),
    post({ author: 'b', permlink: '2', body: '@hathor what is a witness?' }),
    post({ author: 'c', permlink: '3', body: 'my lunch' }),
    post({ author: 'd', permlink: '4', body: 'how does staking work?' }),
  ];
  const r = await sweep(posts, { hathor: fakeHathor(), history: createHistory(), maxPerRun: 3, now: 10 ** 9 });
  assert.equal(r.considered, 4);
  assert.ok(r.drafts.length >= 1 && r.drafts.length <= 3);
  assert.ok(r.skipped.every((s) => typeof s.why === 'string' && s.why.length > 0));
  assert.match(r.note, /Nothing broadcast/);
});

test('history round-trips', () => {
  const h = createHistory();
  h.record({ author: 'alice', permlink: 'p1', at: 5, reply: 'hi' });
  const back = createHistory(JSON.parse(JSON.stringify(h.toJSON())));
  assert.equal(back.repliedTo('Alice', 'p1'), true);
  assert.equal(createHistory([null, {}]).size, 0);
});

test('handler states that it never posts on a timer', () => {
  const res = { statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  handler({ url: '/hb' }, res);
  const j = JSON.parse(res.body);
  assert.match(j.policy, /Never on a timer/);
  assert.match(j.policy, /Drafts only/);
});
