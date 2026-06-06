// decades-brain.test.mjs — offline tests for the layered 1960s→2020s AI brain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrain, cfCombine, cfAll, naiveBayes, tfidfIndex, ERAS } from './decades-brain.mjs';

test('cfCombine follows the classic MYCIN rules', () => {
  assert.ok(Math.abs(cfCombine(0.6, 0.4) - 0.76) < 1e-9);          // both positive
  assert.ok(Math.abs(cfCombine(-0.6, -0.4) - (-0.76)) < 1e-9);      // both negative
  assert.ok(Math.abs(cfCombine(0.6, -0.4) - (0.2 / 0.6)) < 1e-9);   // mixed
  assert.equal(cfAll([{ cf: 0.5 }, { cf: 0.5 }]), 0.75);
});

test('naiveBayes learns and classifies with confidence', () => {
  const nb = naiveBayes();
  nb.train('how to register a new account signup', 'signup');
  nb.train('create account join the chain', 'signup');
  nb.train('what is the price market value', 'price');
  const c = nb.classify('how do I signup for an account');
  assert.equal(c.label, 'signup');
  assert.ok(c.confidence > 0.5);
  // state round-trips as plain JSON
  const nb2 = naiveBayes(JSON.parse(JSON.stringify(nb.state)));
  assert.equal(nb2.classify('market price today').label, 'price');
});

test('tfidfIndex retrieves the right doc and declines on garbage', () => {
  const idx = tfidfIndex();
  idx.add('witness', 'what is a witness block producer dpos voting schedule', 'witness answer');
  idx.add('pool', 'mining pool stratum hashrate miners connect', 'pool answer');
  assert.equal(idx.query('how does a witness produce a block in the dpos schedule').answer, 'witness answer');
  assert.equal(idx.query('zzqx qqzz'), null);
});

test('the brain answers at the CHEAPEST capable layer — LLM never wakes', async () => {
  let llmCalls = 0;
  const brain = createBrain({ llm: async () => { llmCalls++; return 'llm says hi'; } });
  brain.teachPattern('greet', /\bhello\b/i, 'Hello!');
  brain.teachExample('signup register account new user', 'signup', 'Use !signup.');
  brain.teachExample('price market value worth', 'price', 'TESTS has no value.');
  brain.teachDoc('witness', 'witness block producer dpos votes', 'See witness.melek.salon.');

  const a = await brain.think('hello there');
  assert.equal(a.era, '1960s'); assert.equal(a.answer, 'Hello!');
  const b = await brain.think('how do i register a new account');
  assert.equal(b.era, '1990s'); assert.equal(b.answer, 'Use !signup.');
  const c = await brain.think('who are the block producer witness votes');
  assert.ok(['1990s', '2000s'].includes(c.era));
  assert.equal(llmCalls, 0, 'no lower layer answered → still no LLM call needed here');
});

test('LLM is the last resort and only fires when wired in', async () => {
  const silent = createBrain(); // no llm injected — the zero-GPU floor
  const none = await silent.think('completely unknown gibberish qqq');
  assert.equal(none.answer, null);
  assert.ok(none.trace.some((t) => t.era === '1960s'));

  const brain = createBrain({ llm: async (q) => `smol: ${q}` });
  const r = await brain.think('completely unknown gibberish qqq');
  assert.equal(r.era, '2020s');
  assert.match(r.answer, /^smol:/);
});

test('1970s MYCIN layer combines evidence into a confident answer', async () => {
  const brain = createBrain();
  brain.teachCf('spam', (input) => [
    { cf: /free money/i.test(input) ? 0.6 : 0 },
    { cf: /click here/i.test(input) ? 0.5 : 0 },
  ], 'Flagged as likely spam.');
  const r = await brain.think('FREE MONEY click here now');
  assert.equal(r.era, '1970s');
  assert.ok(r.confidence >= 0.55);
});

test('1980s BRE layer answers via rules-engine outcomes', async () => {
  const brain = createBrain();
  await brain.teachRules(
    [{ name: 'new-account', when: [{ fact: 'accountAgeDays', op: 'lt', value: 7 }], then: 'welcome' }],
    { welcome: 'Welcome! Start the tutorial.' });
  const r = await brain.think('anything', { facts: { accountAgeDays: 2 } });
  assert.equal(r.era, '1980s');
  assert.equal(r.answer, 'Welcome! Start the tutorial.');
});

test('2010s embedding layer uses the injected embedder (no network)', async () => {
  // toy embedder: 2-dim "topic space"
  const emb = async (t) => [/pool|mining/i.test(t) ? 1 : 0, /witness|block/i.test(t) ? 1 : 0];
  const brain = createBrain({ embedder: emb, threshold: 0.5 });
  await brain.remember('mining pool info', 'Pool: pool.soapbox.community');
  const r = await brain.think('tell me about mining');
  assert.equal(r.era, '2010s');
  assert.match(r.answer, /Pool:/);
});

test('feedback() learns: wrong answers raise the bar, weights stay bounded', async () => {
  const brain = createBrain();
  const w0 = brain.weights['1990s'];
  brain.feedback('1990s', false); brain.feedback('1990s', false);
  assert.ok(brain.weights['1990s'] < w0);
  for (let i = 0; i < 50; i++) brain.feedback('1990s', false);
  assert.equal(brain.weights['1990s'], 0.5); // floor
  for (let i = 0; i < 100; i++) brain.feedback('1990s', true);
  assert.equal(brain.weights['1990s'], 1.5); // ceiling
});

test('snapshot() persists weights + bayes and reloads via store', async () => {
  const a = createBrain();
  a.teachExample('signup register account', 'signup', 'Use !signup.');
  a.feedback('1990s', true);
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  const b = createBrain({ store: snap });
  assert.equal(b.weights['1990s'], a.weights['1990s']);
  const r = await b.think('how to register an account signup');
  assert.equal(r.era, '1990s');
  assert.equal(r.answer, 'Use !signup.');
});

test('ERAS covers the seven decades in order', () => {
  assert.deepEqual(ERAS, ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s']);
});
