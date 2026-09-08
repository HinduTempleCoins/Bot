import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, createHistory, verifyClaims, draft, plan, handler, FACTS, FORBIDDEN,
} from './solicitation-responder.mjs';

const post = (o) => ({ id: 'p1', author: 'alice', thread: 't1', venue: 'x', ...o });

test('an explicit ask is solicited', () => {
  for (const t of [
    'shill me your bag',
    'Shill me a coin anon',
    "what's the next big coin?",
    'what coins should I buy right now',
    'any good gems out there?',
    'recommend me a project please',
    'drop your bags below',
    'what are you buying this week',
    'tell me about your project',
  ]) {
    assert.equal(classify(t).solicited, true, `should be solicited: ${t}`);
  }
});

test('merely talking about crypto is NOT an invitation', () => {
  for (const t of [
    'bitcoin is up today',
    'I love this community',
    'gm everyone',
    'just bought some ETH',
    'the market is brutal right now',
    'here is my analysis of the fed',
  ]) {
    const c = classify(t);
    assert.equal(c.solicited, false, `should not be solicited: ${t}`);
    assert.match(c.reason, /not an invitation/);
  }
});

test('a thread that excludes promotion is left alone even if it asks', () => {
  const c = classify('what coins should i buy — no shill please');
  assert.equal(c.solicited, false);
  assert.match(c.reason, /explicitly excluded promotion/);
});

test('a fraud thread is not a marketing opportunity', () => {
  const c = classify('any good gems? I just got rugged by a scam token');
  assert.equal(c.solicited, false);
  assert.match(c.reason, /fraud/);
});

test('engagement farming and money requests are declined with reasons', () => {
  assert.match(classify('shill me your coin — follow and retweet to enter').reason, /engagement-farming/);
  assert.match(classify('recommend me a coin, also can you send me some eth').reason, /request for money/);
});

test('empty and article-length text are declined', () => {
  assert.match(classify('').reason, /empty/);
  assert.match(classify('shill me ' + 'x'.repeat(4100)).reason, /likely an article/);
});

test('every generated reply survives the honesty check', () => {
  for (let v = 0; v < 3; v += 1) {
    const d = draft({ post: post({ body: 'shill me your bag' }), variant: v });
    assert.equal(d.ok, true);
    assert.equal(verifyClaims(d.body).ok, true, `variant ${v} must be honest`);
    assert.match(d.body, /testnet/i, 'MELEK is always disclosed as testnet');
    assert.match(d.body, /thin|small|alpha|early/i, 'the downside is always stated');
  }
});

test('hype, guarantees and returns are refused outright', () => {
  for (const bad of [
    'PRANA is a guaranteed 100x, buy now',
    'risk-free 500% APY on KulaSwap',
    'this is going to the moon, last chance',
    'you should buy PRANA, it is financial advice',
  ]) {
    const v = verifyClaims(bad);
    assert.equal(v.ok, false, `must refuse: ${bad}`);
    assert.ok(v.problems.length > 0);
  }
});

test('mentioning MELEK without saying testnet is refused', () => {
  const v = verifyClaims('MELEK is a Graphene chain you should look at.');
  assert.equal(v.ok, false);
  assert.match(v.problems.join(' '), /without saying it is a testnet/);
});

test('the same author is never answered twice', () => {
  const h = createHistory();
  const first = draft({ post: post({ body: 'shill me' }), history: h });
  assert.equal(first.ok, true);
  h.record({ id: 'p1', author: 'alice', thread: 't1', body: first.body });
  const second = draft({ post: post({ id: 'p2', thread: 't2', body: 'shill me again' }), history: h });
  assert.equal(second.ok, false);
  assert.match(second.reason, /already replied to @alice once — never twice/);
});

test('the same thread is never answered twice, even for a different author', () => {
  const h = createHistory();
  const d = draft({ post: post({ body: 'shill me' }), history: h });
  h.record({ id: 'p1', author: 'alice', thread: 't1', body: d.body });
  const other = draft({ post: post({ id: 'p9', author: 'bob', thread: 't1', body: 'shill me too' }), history: h });
  assert.equal(other.ok, false);
  assert.match(other.reason, /already replied in this thread/);
});

test('reusing identical wording is refused — that is what got us flagged', () => {
  const h = createHistory();
  const d = draft({ post: post({ body: 'shill me' }), history: h, variant: 0 });
  h.record({ id: 'p1', author: 'alice', thread: 't1', body: d.body });
  const same = draft({ post: post({ id: 'p2', author: 'carol', thread: 't2', body: 'shill me' }), history: h, variant: 0 });
  assert.equal(same.ok, false);
  assert.match(same.reason, /this exact wording has been used before/);
});

test('a draft is never a send', () => {
  const d = draft({ post: post({ body: 'shill me your project' }) });
  assert.equal(d.action, 'draft');
  assert.equal(d.needsApproval, true);
  assert.match(d.note, /never posts/);
});

test('plan enforces a hard per-run cap', () => {
  const posts = Array.from({ length: 12 }, (_, i) => post({
    id: `p${i}`, author: `a${i}`, thread: `t${i}`, body: 'shill me a coin',
  }));
  const r = plan(posts, { maxPerRun: 3 });
  assert.equal(r.drafts.length, 3);
  assert.equal(r.considered, 12);
  assert.ok(r.skipped.some((s) => /per-run cap of 3/.test(s.reason)));
});

test('plan varies wording across a batch', () => {
  const posts = Array.from({ length: 3 }, (_, i) => post({
    id: `p${i}`, author: `a${i}`, thread: `t${i}`, body: 'shill me a coin',
  }));
  const r = plan(posts, { maxPerRun: 3 });
  const bodies = new Set(r.drafts.map((d) => d.body));
  assert.equal(bodies.size, 3, 'three different messages, not one repeated three times');
});

test('a realistic feed produces a very low reply rate', () => {
  const feed = [
    post({ id: '1', author: 'a', thread: '1', body: 'gm' }),
    post({ id: '2', author: 'b', thread: '2', body: 'bitcoin looking strong' }),
    post({ id: '3', author: 'c', thread: '3', body: 'shill me your bag' }),
    post({ id: '4', author: 'd', thread: '4', body: 'anyone else holding through this' }),
    post({ id: '5', author: 'e', thread: '5', body: 'my portfolio is down bad' }),
    post({ id: '6', author: 'f', thread: '6', body: 'what coins should i buy — no shill please' }),
  ];
  const r = plan(feed);
  assert.equal(r.drafts.length, 1, 'exactly one person actually asked');
  assert.ok(r.replyRate < 0.2);
});

test('history round-trips and dedupes on restart', () => {
  const h = createHistory();
  h.record({ id: 'p1', author: 'Alice', thread: 't1', body: 'hello there friend' });
  const back = createHistory(JSON.parse(JSON.stringify(h.toJSON())));
  assert.equal(back.size, 1);
  assert.equal(back.seenAuthor('alice'), true, 'author matching is case-insensitive');
  assert.equal(back.seenThread('t1'), true);
  assert.equal(createHistory([null, {}, 'x']).size, 0);
});

test('the facts we may state each carry a status', () => {
  for (const k of Object.keys(FACTS)) {
    assert.equal(FACTS[k].status, 'verified');
    assert.ok(FACTS[k].evidence.length > 5);
  }
  assert.match(FACTS.melek.claim, /TESTNET/);
});

test('handler publishes the policy and the forbidden list', () => {
  const res = { statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  handler({ url: '/sr' }, res);
  const j = JSON.parse(res.body);
  assert.match(j.policy, /ONLY to posts that explicitly ask/);
  assert.match(j.policy, /Never posts/);
  assert.equal(j.forbidden.length, FORBIDDEN.length);
});
