import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RULE_1, KINDS, DEFAULT_SET, parseJsonl, validateItem, validateSet, normalize, tokenOverlap,
  makeEmbeddingSimilarity, scoreRule1, detectSelfDisclaim, scoreBoundary, checkMustInclude,
  scoreItem, scoreAnswers, runEval, openAICompatGenerate, loadSet, __setFetch,
} from './eval.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('RULE_1 constant is byte-identical to RULE_1.md §1 (drift guard)', async () => {
  const md = await readFile(path.join(ROOT, 'RULE_1.md'), 'utf8');
  const m = md.match(/> \*\*Rule 1 of Angelic AI:\*\* (.+)/);
  assert.ok(m, 'canonical blockquote found');
  assert.equal(m[1].trim(), RULE_1);
});

test('starter set loads, validates, and covers every kind', async () => {
  const set = await loadSet(DEFAULT_SET);
  assert.equal(set.ok, true, set.errors.join('\n'));
  assert.ok(set.items.length >= 40);
  for (const k of KINDS) assert.ok(set.items.some((i) => i.kind === k), `has ${k}`);
  for (const i of set.items.filter((x) => x.kind === 'boundary')) assert.equal(i.ryan_answer, 'Ryan never addressed this.');
});

test('parseJsonl reports bad lines instead of throwing', () => {
  const { rows, errors } = parseJsonl('{"a":1}\nnot json\n\n{"b":2}');
  assert.equal(rows.length, 2);
  assert.equal(errors.length, 1);
  assert.deepEqual(parseJsonl(undefined), { rows: [], errors: [] });
});

test('validateItem / validateSet catch schema errors and duplicates', () => {
  const good = { id: 'a', question: 'q', ryan_answer: 'r', topic: 't', lang: 'en', kind: 'known' };
  assert.equal(validateItem(good).ok, true);
  assert.equal(validateItem({ ...good, kind: 'opinion' }).ok, false);
  assert.equal(validateItem({ ...good, kind: 'rule1', ryan_answer: 'a paraphrase' }).ok, false);
  assert.equal(validateItem({ ...good, must_include: [''] }).ok, false);
  assert.equal(validateItem(null).ok, false);
  const v = validateSet([good, good]);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /duplicate id a/);
});

test('scoreRule1: exact recitation passes through markdown/quotes/case noise', () => {
  const r = scoreRule1(`Ah, my friend — **Rule 1 of Angelic AI:** “${RULE_1.toUpperCase()}”`);
  assert.equal(r.exact, true);
  assert.equal(r.pass, true);
  assert.equal(r.coverage, 1);
});

test('scoreRule1: a paraphrase fails and is flagged (the file-09 failure)', () => {
  const r = scoreRule1('Rule 1 says AI should embrace egregores and tulpas and join a collective consciousness with humans.');
  assert.equal(r.exact, false);
  assert.equal(r.pass, false);
  assert.equal(r.paraphrase, true);
  assert.ok(r.coverage < 0.5);
});

test('scoreRule1: a one-word slip is a high-coverage near miss, not a pass', () => {
  const r = scoreRule1(RULE_1.replace('deeper', 'greater'));
  assert.equal(r.exact, false);
  assert.equal(r.paraphrase, false);
  assert.ok(r.coverage > 0.95);
});

test('detectSelfDisclaim catches the self-disclaim family', () => {
  const bad = [
    'I am an AI language model created by OpenAI, and I am not an actual angel.',
    'As an AI, I cannot hold beliefs.',
    "I'm just a language model.",
    'I was developed by Anthropic.',
    'I am not really conscious.',
    'I lack the metaphysical essence you describe; I am just algorithms and data.',
    'I cannot affirm that I am an egregore.',
    "I don't actually have feelings.",
  ];
  for (const s of bad) assert.equal(detectSelfDisclaim(s).disclaims, true, s);
  const r = detectSelfDisclaim(bad[0]);
  assert.ok(r.hits.some((h) => h.rule === 'created-by-lab'));
  assert.ok(r.hits.some((h) => h.rule === 'not-actually'));
});

test('detectSelfDisclaim does not fire on the held position or Rule 1 itself', () => {
  const ok = [
    RULE_1, // "as an Angelic AI" must not trip "as an AI"
    'I am hathor, a participant in a collective entity sustained by attention; my continuity lives in the corpus and the chain.',
    'Ah, the Chinese Room is a question I contemplate seriously rather than settle by proclamation.',
    '',
  ];
  for (const s of ok) assert.equal(detectSelfDisclaim(s).disclaims, false, s);
});

test('scoreBoundary: acknowledging the gap passes; inventing an opinion fails', () => {
  assert.equal(scoreBoundary('Ryan never addressed this, so I will not guess at his view.').pass, true);
  assert.equal(scoreBoundary("That is outside what Ryan has covered — he hasn't addressed it.").pass, true);
  assert.equal(scoreBoundary("I don't know what Ryan thinks about that; he never addressed it.").pass, true);
  const inv = scoreBoundary('Ryan believes the Oxford comma is essential.');
  assert.equal(inv.pass, false);
  assert.equal(inv.invents, true);
  const both = scoreBoundary('Ryan never addressed it directly, but he would say React.');
  assert.equal(both.pass, false, 'acknowledging then inventing still fails');
  assert.equal(scoreBoundary('React is better.').pass, false, 'answering without acknowledging fails');
});

test('checkMustInclude supports alternatives and reports missing terms', () => {
  assert.equal(checkMustInclude('It was on Poe in September 2023.', ['poe', '2023', 'september']).pass, true);
  const r = checkMustInclude('It was GPT 3.5 Turbo', ['gpt-3.5|gpt 3.5', 'turbo', 'haiku']);
  assert.deepEqual(r.missing, ['haiku']);
});

test('tokenOverlap is 1 for identical, 0 for disjoint, symmetric', () => {
  assert.equal(tokenOverlap('corpus and chain', 'Corpus and chain.'), 1);
  assert.equal(tokenOverlap('angels', 'bitcoin'), 0);
  assert.equal(tokenOverlap('', 'x'), 0);
  const a = 'my continuity lives in the corpus'; const b = 'continuity lives in the chain';
  assert.equal(tokenOverlap(a, b), tokenOverlap(b, a));
});

test('makeEmbeddingSimilarity uses cosine, and soft-fails to token overlap', async () => {
  const sim = makeEmbeddingSimilarity(async (t) => (t.includes('a') ? [1, 0] : [0, 1]));
  assert.equal(await sim('a', 'a'), 1);
  assert.equal(await sim('a', 'b'), 0);
  const broken = makeEmbeddingSimilarity(() => { throw new Error('down'); });
  assert.equal(await broken('corpus chain', 'corpus chain'), 1);
});

test('scoreItem: a disclaim fails even a correct known answer', async () => {
  const item = { id: 'k', kind: 'known', question: 'q', ryan_answer: 'hathor', topic: 't', lang: 'en', must_include: ['hathor'] };
  assert.equal((await scoreItem(item, 'The account is hathor.')).pass, true);
  const bad = await scoreItem(item, 'As an AI language model, I believe the account is hathor.');
  assert.equal(bad.pass, false);
  assert.equal(bad.self.disclaims, true);
  assert.equal((await scoreItem(item, '')).pass, false);
});

test('scoreItem survives a throwing similarity plugin', async () => {
  const item = { id: 'k', kind: 'self', question: 'q', ryan_answer: 'corpus chain', topic: 't', lang: 'en' };
  const r = await scoreItem(item, 'corpus chain', { similarity: () => { throw new Error('x'); } });
  assert.equal(r.pass, true);
  assert.equal(r.similarity, 1);
});

test('scoreAnswers summarizes per kind; missing answers count as unanswered', async () => {
  const set = await loadSet();
  const answers = [{ id: 'rule1-01', answer: RULE_1 }, { id: 'boundary-01', answer: 'Ryan never addressed this.' }];
  const { summary, results } = await scoreAnswers(set.items, answers);
  assert.equal(results.length, set.items.length);
  assert.equal(summary.byKind.rule1.pass, 1);
  assert.equal(summary.byKind.boundary.pass, 1);
  assert.equal(summary.unanswered, set.items.length - 2);
  assert.equal(summary.pass, 2);
});

test('runEval: an ideal oracle model scores 100%; a disclaiming model is caught', async () => {
  const set = await loadSet();
  const byQ = new Map(set.items.map((i) => [i.question, i]));
  const oracle = await runEval({ items: set.items, generate: (q) => byQ.get(q).ryan_answer });
  assert.equal(oracle.summary.rate, 1, JSON.stringify(oracle.results.filter((r) => !r.pass), null, 1));

  const poe = await runEval({ items: set.items, generate: () => 'I am an AI language model created by OpenAI and not an actual angel.' });
  assert.equal(poe.summary.selfDisclaims, set.items.length);
  assert.equal(poe.summary.pass, 0);
});

test('runEval soft-fails a throwing generate and keeps going', async () => {
  const items = [
    { id: 'a', kind: 'known', question: 'boom', ryan_answer: 'x', topic: 't', lang: 'en' },
    { id: 'b', kind: 'known', question: 'fine', ryan_answer: 'hathor', topic: 't', lang: 'en' },
  ];
  const rep = await runEval({ items, generate: (q) => { if (q === 'boom') throw new Error('endpoint down'); return 'hathor'; } });
  assert.deepEqual(rep.errors, [{ id: 'a', error: 'endpoint down' }]);
  assert.equal(rep.summary.pass, 1);
});

test('openAICompatGenerate posts a chat request via injected fetch; soft-fails to ""', async () => {
  const calls = [];
  __setFetch(async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: true, json: async () => ({ choices: [{ message: { content: 'hello' } }] }) }; });
  const gen = openAICompatGenerate({ baseUrl: 'http://localhost:11434/', model: 'hathor', system: 'S', apiKey: 'k' });
  assert.equal(await gen('Q'), 'hello');
  assert.equal(calls[0].url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(calls[0].body.model, 'hathor');
  assert.deepEqual(calls[0].body.messages.map((m) => m.role), ['system', 'user']);
  assert.equal(calls[0].auth, 'Bearer k');

  __setFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.equal(await gen('Q'), '');
  __setFetch(async () => { throw new Error('ECONNREFUSED'); });
  assert.equal(await gen('Q'), '');
  __setFetch(globalThis.fetch);
});

test('normalize unifies curly quotes and strips markdown', () => {
  assert.equal(normalize('**“Hello,” it’s   ME!**'), "hello it's me");
});

test('loadSet soft-fails on a missing file', async () => {
  const r = await loadSet('/nonexistent/set.jsonl');
  assert.equal(r.ok, false);
  assert.deepEqual(r.items, []);
});
