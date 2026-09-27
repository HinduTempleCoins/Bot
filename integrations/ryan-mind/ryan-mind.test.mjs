// ryan-mind — offline tests. No network: model adapters get a fake fetch; the checker gets fixture
// entities + a fixture retrieve; stores are dry-run (in-memory) or temp dirs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseLooseDate, parseTimestamp, splitSentences, hasNegation, polarityConflict, extractJson } from './util.mjs';
import { Store, resolveDataDir, readClaims, REPO_ROOT } from './store.mjs';
import { readChat, readEmail, readThread, readWritingJson, readWritingMarkdown, dateWriting, makeSourceRecord, stripQuoted } from './sources.mjs';
import { seedTaxonomy, categorize, suggestCategories } from './taxonomy.mjs';
import { extractClaims, extractDeterministic, locateQuote, isCorrection } from './extract.mjs';
import { __setFetch, ollamaLlm, ollamaEmbed, isLocalUrl, probeOllama } from './adapters.mjs';
import { reconcile, deriveState, decideReview, judgeDeterministic, applyRules, RELATIONS } from './reconcile.mjs';
import { hierophantChecker, findIdentifications, checkFact } from './checker.mjs';
import { rebuildPositions } from './positions.mjs';
import { buildExports, runExports, questionFor } from './exports.mjs';
import { ingest, parseArgs, expandPaths, status } from './mind.mjs';

const TS = () => '2026-09-27T00:00:00.000Z';
const mem = () => new Store('/nonexistent/ryan-mind-test', { dryRun: true });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ryan-mind-'));

let n = 0;
function claim(text, o = {}) {
  n++;
  const kind = o.kind || 'writing';
  const own = o.own ?? true;
  return {
    id: o.id || `c-t${n}`, text, quote: text, source_id: o.source_id || `${kind}:s${n}`, source_kind: kind, source_title: o.title || `src ${n}`,
    date: o.date || '2026-01-01', at: o.at || null, date_basis: 'explicit', category: o.category || 'ancient_egypt', categories: [o.category || 'ancient_egypt'],
    confidence: o.confidence ?? 0.7, speaker: own ? 'operator' : (o.speaker || 'someone'), own,
    can_supersede: own && ['writing', 'chat', 'email'].includes(kind), class: 'neutral', context: o.context || '', locator: o.locator || `L${n}`,
    extractor: 'test', correction_marker: o.correction ?? isCorrection(text, o.context || ''),
  };
}

const ENTITIES = [
  { name: 'Wadjet', tradition: 'egyptian', summary: 'cobra goddess of Lower Egypt', source: 'Herodotus 2.155' },
  { name: 'Theia', tradition: 'greek', summary: 'Titaness, mother of Helios', source: 'Hesiod, Theogony 371' },
  { name: 'Leto', tradition: 'greek', summary: 'mother of Apollo and Artemis', source: 'Hesiod' },
  { name: 'Osiris', tradition: 'egyptian', summary: 'lord of the dead', source: 'Plutarch' },
  { name: 'Dionysus', tradition: 'greek', summary: 'wine and ecstasy', source: 'Homeric Hymns' },
  { name: 'Zeus', tradition: 'greek', summary: 'king of the gods', source: 'Hesiod' },
];
const fixtureChecker = (retrieve = async () => []) => hierophantChecker({ entities: ENTITIES, retrieve });

// ── util ────────────────────────────────────────────────────────────────────────────────────────────
test('parseLooseDate handles the corpus date shapes; parseTimestamp keeps exact times only', () => {
  assert.equal(parseLooseDate('January 17, 2026'), '2026-01-17');
  assert.equal(parseLooseDate('January 2026'), '2026-01-01');
  assert.equal(parseLooseDate('2016 (STEEM Era)'), '2016-01-01');
  assert.equal(parseLooseDate('2026-05-23T10:00:00Z'), '2026-05-23');
  assert.equal(parseLooseDate('Consciousness Activation Framework'), null);
  assert.equal(parseTimestamp('2024-03-05T14:22:10.123456Z'), '2024-03-05T14:22:10.123Z');
  assert.equal(parseTimestamp('2024-03-05'), null);
  assert.equal(parseTimestamp(1709648530000), '2024-03-05T14:22:10.000Z');
});

test('rhetorical "not X but Y" is not a negation; a real denial conflicts only on what it denies', () => {
  assert.equal(hasNegation('The wax is not merely symbolic—it is the interface.'), false);
  assert.equal(hasNegation('The Bible is not fairy tales — it is documentation.'), false);
  assert.equal(hasNegation('Wadjet was never a cobra.'), true);
  assert.equal(polarityConflict('Wadjet is not Leto, Wadjet is THEIA', 'Wadjet = Theia (mother of Sun/Moon)'), null);
  assert.equal(polarityConflict('Wadjet is not Theia at all', 'Wadjet = Theia (mother of Sun/Moon)'), 'theia');
  assert.deepEqual(splitSentences('One claim is here. Another claim is there!'), ['One claim is here.', 'Another claim is there!']);
  assert.deepEqual(extractJson('sure: ```{"a":1}```'), { a: 1 });
});

// ── store ───────────────────────────────────────────────────────────────────────────────────────────
test('data dir: refused inside the public repo, allowed under .local/ or outside the repo', () => {
  assert.equal(resolveDataDir({ dir: path.join(REPO_ROOT, 'integrations', 'ryan-mind', 'data') }).ok, false);
  assert.equal(resolveDataDir({ dir: path.join(REPO_ROOT, 'knowledge') }).ok, false);
  assert.equal(resolveDataDir({ dir: path.join(REPO_ROOT, '.local', 'ryan-mind') }).ok, true);
  assert.equal(resolveDataDir({ dir: path.join(os.tmpdir(), 'ryan-mind-elsewhere') }).ok, true);
  assert.equal(resolveDataDir({ env: {} }).dir, path.join(REPO_ROOT, '.local', 'ryan-mind'));
});

test('dry-run store never touches disk but later reads see the overlay', () => {
  const d = tmp(); const s = new Store(d, { dryRun: true });
  s.appendJsonl('a.jsonl', [{ x: 1 }]); s.appendJsonl('a.jsonl', [{ x: 2 }]); s.writeJson('b.json', { y: 1 });
  assert.deepEqual(s.readJsonl('a.jsonl'), [{ x: 1 }, { x: 2 }]);
  assert.deepEqual(s.readJson('b.json'), { y: 1 });
  assert.deepEqual(fs.readdirSync(d), []);
  assert.equal(s.writes.length, 3);
});

// ── sources ─────────────────────────────────────────────────────────────────────────────────────────
const CHAT = JSON.stringify([{
  uuid: 'conv1', name: 'Wax and bread', created_at: '2024-03-05T14:00:00Z',
  chat_messages: [
    { uuid: 'm1', sender: 'human', text: 'The wax loaf is the bread loaf of the temple offering.', created_at: '2024-03-05T14:22:10.000Z' },
    { uuid: 'm2', sender: 'assistant', text: 'That is an interesting reading of the offering tables.', created_at: '2024-03-05T14:22:30.000Z' },
    { uuid: 'm3', sender: 'human', text: '', content: [{ type: 'text', text: 'Wadjet is Theia, the mother of light.' }], created_at: '2024-03-05T14:25:00.000Z' },
  ],
}]);

test('chat reader: only the human side is his, with exact timestamps; assistant opt-in and never own', () => {
  const r = readChat(CHAT);
  assert.equal(r.ok, true); assert.equal(r.segments.length, 2);
  assert.ok(r.segments.every((s) => s.own && s.speaker === 'operator'));
  assert.equal(r.segments[0].at, '2024-03-05T14:22:10.000Z');
  assert.equal(r.segments[1].text, 'Wadjet is Theia, the mother of light.');
  const withA = readChat(CHAT, { includeAssistant: true });
  const a = withA.segments.find((s) => s.speaker === 'assistant');
  assert.equal(a.own, false);
  assert.equal(readChat('{"nope":1}').ok, false);
  assert.equal(readChat('not json').ok, false);
});

const GMAIL = JSON.stringify({ threads: [{ id: 't1', subject: 'Zeus', messages: [
  { id: 'e1', date: 'Tue, 05 Mar 2024 16:00:00 -0600', subject: 'Zeus', from: 'Ryan <ryan@example.org>', body: 'Zeus was born on Crete, in the cave.\n\nOn Tue someone wrote:\n> quoted text that is not his' },
  { id: 'e2', internalDate: '1709676000000', from: 'other@example.net', body: 'I think Zeus was born somewhere else entirely.' },
] }] });

test('email reader: Gmail-shaped, quoted replies stripped, own only for self addresses, exact timestamps', () => {
  const r = readEmail(GMAIL, { selfEmails: ['ryan@example.org'] });
  assert.equal(r.ok, true); assert.equal(r.segments.length, 2);
  assert.equal(r.segments[0].own, true); assert.equal(r.segments[0].text, 'Zeus was born on Crete, in the cave.');
  assert.equal(r.segments[0].at, '2024-03-05T22:00:00.000Z');
  assert.equal(r.segments[1].own, false); assert.equal(r.segments[1].at, '2024-03-05T22:00:00.000Z');
  assert.equal(readEmail(GMAIL).segments[0].own, false, 'no self list → nothing is his');
  assert.equal(stripQuoted('mine\n-- \nsig'), 'mine');
});

test('thread reader: own only for his handles', () => {
  const r = readThread(JSON.stringify({ title: 'VKRW', posts: [{ author: '@vankush', date: '2018-01-02T03:04:05Z', body: 'Temple Coin is the first token of the temple.' }, { author: 'troll', body: 'Temple Coin is not a real token.' }] }), { selfHandles: ['vankush'] });
  assert.deepEqual(r.segments.map((s) => s.own), [true, false]);
  assert.equal(r.segments[0].at, '2018-01-02T03:04:05.000Z');
});

test('writing readers: JSON key-path context, markdown heading trail; dating says HOW it knows', () => {
  const j = readWritingJson(JSON.stringify({ title: 'T', keywords: ['skip me please this is long enough'], part_1_wax: { finding: 'The headcone was made of beeswax and resin, not fat.' } }));
  assert.equal(j.segments.length, 1); assert.match(j.segments[0].context, /part 1: wax › finding/);
  const m = readWritingMarkdown('# Title\n\n## Wax\n\nThe headcone was made of beeswax and resin.\n');
  assert.equal(m.segments[0].context, 'Title › Wax');
  assert.deepEqual(dateWriting('/x/a.json', JSON.stringify({ date: 'January 15, 2026', title: 'A' })).date_basis, 'metadata:date');
  const noDate = dateWriting('/x/b.json', JSON.stringify({ title: 'B' }), { gitDate: () => '2026-01-16T10:00:00+00:00' });
  assert.equal(noDate.date, '2026-01-16'); assert.equal(noDate.date_basis, 'git:first-add');
  assert.equal(dateWriting('/x/c.md', '# C\n', { gitDate: () => '', statMtime: () => '2026-02-02T00:00:00Z' }).date_basis, 'mtime');
});

test('registry: knowledge/ writings default public; chats/emails/threads and outside files default private', () => {
  const k = makeSourceRecord({ path: path.join(REPO_ROOT, 'knowledge', 'vankush', 'x.json'), kind: 'writing', text: '{}' });
  assert.equal(k.privacy, 'public'); assert.equal(k.stage, 0); assert.equal(k.path, 'knowledge/vankush/x.json');
  assert.equal(makeSourceRecord({ path: path.join(REPO_ROOT, 'knowledge', 'c.json'), kind: 'chat' }).privacy, 'private');
  assert.equal(makeSourceRecord({ path: '/home/x/notes.md', kind: 'writing' }).privacy, 'private');
  assert.equal(makeSourceRecord({ path: '/home/x/mail.json', kind: 'email' }).stage, 2);
});

// ── taxonomy ────────────────────────────────────────────────────────────────────────────────────────
const TAX = seedTaxonomy({
  folders: ['ancient_egypt', 'phoenician', 'synthesis'],
  architecture: { folder_structure: { phoenician: { description: 'Wax headcones' } }, primary_keywords_by_folder: { phoenician: ['headcone', 'wax', 'Carthage'], ancient_egypt: ['Egypt', 'Wadjet', 'pharaoh'] } },
  catalog: { byDomain: { knowledge: [{ path: 'knowledge/phoenician/a.json', keywords: ['beeswax', 'punic'] }, { path: 'knowledge/phoenician/b.json', keywords: ['beeswax'] }] } },
});

test('taxonomy is seeded from corpus structure (container folders excluded) and is data', () => {
  assert.deepEqual(TAX.categories.map((c) => c.id), ['ancient_egypt', 'phoenician']);
  const ph = TAX.categories.find((c) => c.id === 'phoenician');
  assert.ok(ph.keywords.includes('headcone')); assert.ok(ph.weak_keywords.includes('beeswax'));
  assert.equal(categorize('The headcone of wax from Carthage', '', TAX).category, 'phoenician');
  assert.equal(categorize('Nothing relevant here at all', '', TAX).category, 'uncategorized');
});

test('suggestCategories proposes a category from what uncategorised claims share, never edits seeds', () => {
  const cs = [1, 2, 3, 4, 5].map((i) => ({ id: `u${i}`, source_id: `s${i % 2}`, category: 'uncategorized', text: `The ancient Kenites of Midian forged iron number ${i} for Jael.` }));
  const { taxonomy, proposals } = suggestCategories(cs, TAX);
  assert.ok(proposals.length >= 1);
  assert.ok(proposals.some((p) => /kenite|midian|jael/i.test(p.label)));
  assert.equal(taxonomy.categories.length, TAX.categories.length + proposals.length);
  assert.ok(proposals.every((p) => p.status === 'proposed'));
});

// ── extraction ──────────────────────────────────────────────────────────────────────────────────────
const SRC = { id: 'writing:t:1', kind: 'writing', title: 'Test paper', date: '2026-01-15', date_basis: 'metadata:date' };
const SEGS = [{ text: 'The headcone was made of beeswax from Carthage. Is it? Short.', context: 'wax', locator: 'L1', speaker: 'operator', own: true }];

test('deterministic extraction keeps assertions with verbatim quotes, dated from the source', () => {
  const cs = extractDeterministic(SRC, SEGS, TAX);
  assert.equal(cs.length, 1);
  assert.equal(cs[0].quote, 'The headcone was made of beeswax from Carthage.');
  assert.ok(SEGS[0].text.includes(cs[0].quote));
  assert.equal(cs[0].date, '2026-01-15'); assert.equal(cs[0].category, 'phoenician');
  assert.equal(cs[0].own, true); assert.equal(cs[0].can_supersede, true);
});

test('LLM extraction drops quotes that are not verbatim; junk output falls back to deterministic', async () => {
  const good = async () => JSON.stringify({ claims: [
    { claim: 'Headcones were beeswax.', quote: 'The headcone was made of beeswax from Carthage.', category: 'phoenician', confidence: 0.9 },
    { claim: 'Invented', quote: 'This sentence is nowhere in the source text at all.', category: 'phoenician' },
  ] });
  good.modelName = 'ollama:test';
  const cs = await extractClaims(SRC, SEGS, TAX, { llm: good });
  assert.equal(cs.length, 1); assert.equal(cs[0].extractor, 'ollama:test'); assert.equal(cs[0].confidence, 0.9);
  const junk = async () => 'I cannot do that';
  const fb = await extractClaims(SRC, SEGS, TAX, { llm: junk });
  assert.equal(fb.length, 1); assert.equal(fb[0].extractor, 'deterministic-v1');
  assert.equal(locateQuote('beeswax  from\nCarthage.  The', 'x beeswax from Carthage. The y'), 'beeswax from Carthage. The');
});

// ── adapters ────────────────────────────────────────────────────────────────────────────────────────
test('ollama adapters: local only, injectable fetch, soft-fail', async () => {
  const calls = [];
  __setFetch(async (url, init) => { calls.push({ url, body: init?.body && JSON.parse(init.body) }); if (url.endsWith('/api/embed')) return { ok: true, json: async () => ({ embeddings: [[0.1, 0.2]] }) }; if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'llama3.2:1b' }] }) }; return { ok: true, json: async () => ({ response: '{"x":1}' }) }; });
  try {
    const llm = ollamaLlm({ url: 'http://127.0.0.1:11434', model: 'llama3.2:1b' });
    assert.equal(await llm('hi'), '{"x":1}'); assert.equal(calls[0].body.model, 'llama3.2:1b'); assert.equal(llm.modelName, 'ollama:llama3.2:1b');
    assert.deepEqual(await ollamaEmbed({ url: 'http://localhost:11434' })('x'), [0.1, 0.2]);
    assert.deepEqual((await probeOllama({ url: 'http://127.0.0.1:11434' })).models, ['llama3.2:1b']);
    const before = calls.length;
    assert.equal(await ollamaLlm({ url: 'https://api.example.com' })('private text'), '');
    assert.equal(await ollamaEmbed({ url: 'https://api.example.com' })('private text'), null);
    assert.equal(calls.length, before, 'a non-local endpoint is never called');
    __setFetch(async () => { throw new Error('down'); });
    assert.equal(await ollamaLlm({ url: 'http://127.0.0.1:1' })('x'), '');
    assert.equal((await probeOllama({ url: 'http://127.0.0.1:1' })).ok, false);
  } finally { __setFetch(null); }
  assert.equal(isLocalUrl('http://10.0.0.5:11434'), true); assert.equal(isLocalUrl('http://8.8.8.8'), false);
});

// ── checker ─────────────────────────────────────────────────────────────────────────────────────────
test('Hierophant checker: divergent identification, mainstream identification, denial, fact slip', async () => {
  assert.equal(findIdentifications('Wadjet = Theia (mother of light)', ENTITIES)[0].mainstream_source, null);
  assert.ok(findIdentifications('Osiris is Dionysus', ENTITIES)[0].mainstream_source);
  assert.equal(findIdentifications('Wadjet is not Leto', ENTITIES).length, 0);
  assert.equal(findIdentifications('the worship of Zeus was learned from the Libyans, that Osiris', ENTITIES).length, 0);
  assert.equal(checkFact('Zeus was born on Malta').stance, 'differs');
  assert.equal(checkFact('Zeus was born on Crete').stance, 'agrees');
  const ch = fixtureChecker(async () => [{ title: 'Paper', source: 'synthesis/x.json', passage: 'Zeus was born in a cave on Crete.' }]);
  const div = await ch.check({ text: 'Wadjet = Theia, the mother of light.' });
  assert.equal(div.stance, 'differs'); assert.equal(div.kind, 'identification');
  assert.ok(div.mainstream.some((m) => /Leto/.test(m.text)), 'mainstream identification (Wadjet ~ Leto) supplied as context');
  const slip = await ch.check({ text: 'Zeus was born on Malta.', quote: 'Zeus was born on Malta.' });
  assert.equal(slip.kind, 'fact'); assert.equal(slip.stance, 'differs'); assert.match(slip.tradition_says, /Crete/); assert.equal(slip.elsewhere.length, 1);
  const broken = hierophantChecker({ entities: ENTITIES, retrieve: async () => { throw new Error('x'); } });
  assert.equal((await broken.check({ text: 'Zeus was born on Malta.' })).stance, 'differs', 'retrieve failure soft-fails');
  assert.equal((await ch.check({ text: 'nothing to see' })).stance, 'none');
});

// ── the bounce: the operator's rules ────────────────────────────────────────────────────────────────
async function runWith(claims, opts = {}, store = mem()) {
  if (opts.config) store.writeJson('config.json', opts.config);
  store.appendJsonl('claims.jsonl', claims);
  const r = await reconcile(store, { now: TS, minLex: 0.1, ...opts });
  const annals = store.readJsonl('annals.jsonl'); const rq = store.readJsonl('review_queue.jsonl');
  return { r, store, annals, rq, state: deriveState(readClaims(store), annals, rq) };
}

test('RULE: consensus / third parties never supersede an operator claim', async () => {
  const his = claim('Wadjet is Theia the mother of light in the temple.', { date: '2024-01-01' });
  const troll = claim('Correction: Wadjet is not Theia the mother of light in the temple.', { kind: 'thread', own: false, date: '2025-01-01' });
  const { annals, state } = await runWith([his, troll]);
  const a = annals.find((x) => x.claim_b && [x.claim_a, x.claim_b].includes(his.id));
  assert.equal(a.relation, 'contradicts'); assert.equal(a.rule, 'external-never-supersedes');
  assert.equal(state.get(his.id).status, 'active');
  assert.ok(!annals.some((x) => x.relation === 'self_corrected' || x.relation === 'supersedes'));
  // the checker's consensus is context, not correction
  const div = await runWith([claim('Wadjet = Theia, the mother of light.', { date: '2024-01-01' })], { checkers: [fixtureChecker()] });
  const d = div.annals.find((x) => x.relation === 'diverges_from_consensus');
  assert.ok(d); assert.equal(d.claim_b, null); assert.ok(d.consensus.length >= 2);
  const st = [...div.state.values()][0];
  assert.equal(st.status, 'active'); assert.equal(st.class, 'position');
});

test('RULE: a later operator claim worded as a correction supersedes his earlier one (kept, linked)', async () => {
  const early = claim('The temple offering loaf was made of bread and honey.', { date: '2024-01-01', kind: 'chat', at: '2024-01-01T10:00:00.000Z' });
  const late = claim('Correction: the temple offering loaf was not made of bread and honey, it was wax.', { date: '2024-06-01', kind: 'email', at: '2024-06-01T09:00:00.000Z' });
  const { annals, state, store } = await runWith([early, late]);
  const sc = annals.find((x) => x.relation === 'self_corrected');
  assert.ok(sc, JSON.stringify(annals)); assert.equal(sc.claim_a, late.id); assert.equal(sc.claim_b, early.id); assert.equal(sc.supersedes, early.id);
  assert.equal(state.get(early.id).status, 'superseded'); assert.equal(state.get(early.id).superseded_by, late.id);
  assert.equal(state.get(late.id).status, 'active');
  assert.ok(readClaims(store).some((c) => c.id === early.id && c.text === early.text), 'the earlier claim is kept verbatim, not erased');
});

test('RULE: an unmarked contradiction between his own claims goes to review; nothing changes', async () => {
  const early = claim('The temple offering loaf was made of wax and honey.', { date: '2024-01-01' });
  const late = claim('The temple offering loaf was never made of wax and honey.', { date: '2024-06-01' });
  const { annals, rq, state } = await runWith([early, late]);
  assert.equal(annals.find((x) => x.claim_b).relation, 'contradicts');
  assert.equal(rq.length, 1); assert.equal(rq[0].type, 'inconsistency'); assert.match(rq[0].question, /Which stands/);
  assert.ok([...state.values()].every((s) => s.status === 'active'));
  // his ruling closes it: keep the later one → recorded as an operator self-correction
  const store = mem(); store.appendJsonl('claims.jsonl', [early, late]);
  await reconcile(store, { now: TS, minLex: 0.1 });
  const id = store.readJsonl('review_queue.jsonl')[0].id;
  assert.equal(decideReview(store, id, 'keep', { keep: late.id, now: TS }).ok, true);
  assert.equal(decideReview(store, id, 'keep', { keep: late.id }).ok, false, 'decided once');
  const st = deriveState(readClaims(store), store.readJsonl('annals.jsonl'), store.readJsonl('review_queue.jsonl'));
  assert.equal(st.get(early.id).status, 'superseded');
  assert.equal(store.readJsonl('annals.jsonl').at(-1).model, 'operator');
  // config can opt into "later own always wins"
  const auto = await runWith([claim('The temple offering loaf was made of wax and honey.', { date: '2024-01-01' }), claim('The temple offering loaf was never made of wax and honey.', { date: '2024-06-01' })], { config: { auto_self_correct: 'later' } });
  assert.ok(auto.annals.some((x) => x.relation === 'self_corrected' && x.rule === 'later-own-wins'));
});

test('RULE: a probable slip ONLY enters the review queue', async () => {
  const good = claim('Zeus was born on Crete in the Dictaean cave.', { date: '2023-01-01', category: 'mystery_schools' });
  const slip = claim('Zeus was born on Malta and raised by bees.', { date: '2024-01-01', category: 'mystery_schools' });
  const { annals, rq, state } = await runWith([good, slip], { checkers: [fixtureChecker()] });
  assert.ok(!annals.some((x) => x.claim_a === slip.id && ['self_corrected', 'supersedes', 'diverges_from_consensus'].includes(x.relation)));
  assert.ok(!annals.some((x) => x.claim_b === slip.id && x.relation === 'self_corrected'));
  const item = rq.find((x) => x.type === 'slip');
  assert.ok(item); assert.deepEqual(item.claim_ids, [slip.id]);
  assert.match(item.question, /Malta/); assert.match(item.question, /Crete/);
  assert.equal(item.elsewhere[0].claim_id, good.id, 'said X here, Y elsewhere');
  assert.equal(state.get(slip.id).status, 'active'); assert.equal(state.get(slip.id).class, 'slip_candidate');
  assert.equal(state.get(good.id).status, 'active');
  // his confirmation is what changes things
  const s1 = mem(); s1.appendJsonl('claims.jsonl', [good, slip]); await reconcile(s1, { now: TS, minLex: 0.1, checkers: [fixtureChecker()] });
  const rid = s1.readJsonl('review_queue.jsonl').find((x) => x.type === 'slip').id;
  decideReview(s1, rid, 'slip_confirmed', { keep: good.id, now: TS });
  const st1 = deriveState(readClaims(s1), s1.readJsonl('annals.jsonl'), s1.readJsonl('review_queue.jsonl'));
  assert.equal(st1.get(slip.id).status, 'superseded'); assert.equal(st1.get(slip.id).superseded_by, good.id);
  const s2 = mem(); s2.appendJsonl('claims.jsonl', [good, slip]); await reconcile(s2, { now: TS, minLex: 0.1, checkers: [fixtureChecker()] });
  decideReview(s2, rid, 'hold', { now: TS });
  const st2 = deriveState(readClaims(s2), s2.readJsonl('annals.jsonl'), s2.readJsonl('review_queue.jsonl'));
  assert.equal(st2.get(slip.id).class, 'position'); assert.equal(st2.get(slip.id).status, 'active');
});

test('annals are append-only and each claim is bounced once', async () => {
  const store = mem();
  const a = claim('Beeswax headcones were worn at Egyptian banquets.'); const b = claim('Beeswax headcones were worn at Egyptian banquets and festivals.');
  store.appendJsonl('claims.jsonl', [a, b]);
  await reconcile(store, { now: TS, minLex: 0.1 });
  const first = store.readText('annals.jsonl');
  const again = await reconcile(store, { now: TS, minLex: 0.1 });
  assert.equal(again.examined, 0); assert.equal(store.readText('annals.jsonl'), first);
  store.appendJsonl('claims.jsonl', [claim('Beeswax headcones were worn at Egyptian banquets by the priests.')]);
  const third = await reconcile(store, { now: TS, minLex: 0.1 });
  assert.equal(third.examined, 1);
  assert.ok(store.readText('annals.jsonl').startsWith(first), 'earlier lines untouched');
  for (const x of store.readJsonl('annals.jsonl')) { assert.ok(RELATIONS.includes(x.relation)); for (const k of ['ts', 'claim_a', 'claim_b', 'relation', 'reason', 'model']) assert.ok(k in x, k); }
});

test('LLM judge is used when wired; bad output falls back to the deterministic judge', async () => {
  const llm = async () => '{"relation":"refines","reason":"adds the festival detail"}'; llm.modelName = 'ollama:judge';
  const { annals } = await runWith([claim('Beeswax headcones were worn at Egyptian banquets.'), claim('Beeswax headcones were worn at Egyptian banquets and festivals.')], { llm });
  assert.equal(annals[0].relation, 'refines'); assert.equal(annals[0].model, 'ollama:judge');
  const bad = async () => '{"relation":"maybe"}';
  const r2 = await runWith([claim('Beeswax headcones were worn at Egyptian banquets.'), claim('Beeswax headcones were worn at Egyptian banquets and festivals.')], { llm: bad });
  assert.equal(r2.annals[0].model, 'deterministic-v1');
});

test('embedder retrieval is used when wired and cached', async () => {
  const vec = { a: [1, 0], b: [0.99, 0.05], c: [0, 1] };
  let calls = 0;
  const embed = async (t) => { calls++; return t.includes('apple') ? vec.a : t.includes('pear') ? vec.b : vec.c; }; embed.modelName = 'ollama:nomic-embed-text';
  const store = mem();
  store.appendJsonl('claims.jsonl', [claim('The apple orchard was planted by the temple.'), claim('The pear orchard was planted by the priests.'), claim('Something about completely other matters here.')]);
  const r = await reconcile(store, { now: TS, embed });
  assert.equal(r.retrieval, 'embed:ollama:nomic-embed-text');
  assert.equal(store.readJsonl('annals.jsonl').length, 1);
  assert.equal(store.readJsonl('embeddings.jsonl').length, 3); assert.equal(calls, 3);
});

test('email is read against the chats: refused before a chat is ingested; chat claims retrieved first', async () => {
  const d = tmp(); const store = new Store(path.join(d, 'data'));
  fs.writeFileSync(path.join(d, 'conversations.json'), CHAT);
  fs.writeFileSync(path.join(d, 'mail.json'), JSON.stringify({ messages: [{ id: 'e1', date: '2024-04-01T08:00:00Z', from: 'ryan@example.org', body: 'Correction: the wax loaf is not the bread loaf of the temple offering.' }] }));
  store.writeJson('config.json', { self_emails: ['ryan@example.org'] });
  const refused = await ingest(store, [path.join(d, 'mail.json')], { kind: 'email' });
  assert.equal(refused.ok, false); assert.match(refused.reason, /chat/);
  const c = await ingest(store, [path.join(d, 'conversations.json')], { kind: 'chat' });
  assert.equal(c.ok, true); assert.ok(c.claims >= 1);
  const e = await ingest(store, [path.join(d, 'mail.json')], { kind: 'email' });
  assert.equal(e.ok, true); assert.equal(e.claims, 1);
  const reg = store.readJson('sources.json');
  assert.ok(reg.every((s) => s.privacy === 'private'));
  const r = await reconcile(store, { now: TS, minLex: 0.1 });
  assert.ok(r.ok);
  const sc = store.readJsonl('annals.jsonl').find((x) => x.relation === 'self_corrected');
  assert.ok(sc, 'the later email corrects the earlier chat');
  const cl = new Map(readClaims(store).map((x) => [x.id, x]));
  assert.equal(cl.get(sc.claim_a).source_kind, 'email'); assert.equal(cl.get(sc.claim_b).source_kind, 'chat');
  assert.equal(cl.get(sc.claim_b).at, '2024-03-05T14:22:10.000Z');
});

// ── positions + exports ─────────────────────────────────────────────────────────────────────────────
async function mindWithHistory() {
  const store = mem();
  const early = claim('The temple offering loaf was made of bread and honey.', { date: '2024-01-01', id: 'c-early' });
  const late = claim('Correction: the temple offering loaf was not made of bread and honey, it was wax.', { date: '2024-06-01', id: 'c-late' });
  const held = claim('Wadjet = Theia, the mother of light.', { date: '2024-02-01', id: 'c-held' });
  const slip = claim('Zeus was born on Malta and raised by bees.', { date: '2024-03-01', id: 'c-slip', category: 'mystery_schools' });
  store.appendJsonl('claims.jsonl', [early, late, held, slip]);
  store.writeJson('sources.json', [...new Set([early, late, held, slip].map((c) => c.source_id))].map((id) => ({ id, privacy: id === slip.source_id ? 'private' : 'public', path: `knowledge/${id}.md` })));
  await reconcile(store, { now: TS, minLex: 0.1, checkers: [fixtureChecker()] });
  return store;
}

test('positions: current position with citations, history of his corrections, held divergences, open reviews; incremental', async () => {
  const store = await mindWithHistory();
  const r = await rebuildPositions(store, { tax: TAX, now: TS });
  assert.equal(r.incremental, false);
  const p = store.readJson('positions/ancient_egypt.json');
  assert.ok(p.current_position.claims.some((c) => c.id === 'c-late'));
  assert.ok(!p.current_position.claims.some((c) => c.id === 'c-early'), 'superseded claim is not current');
  assert.equal(p.history.length, 1); assert.equal(p.history[0].superseded.id, 'c-early'); assert.equal(p.history[0].by.id, 'c-late');
  assert.equal(p.held_positions[0].id, 'c-held'); assert.equal(p.held_positions[0].relation_to_consensus, 'diverges_from_consensus');
  assert.ok(p.held_positions[0].mainstream_context.length);
  const ms = store.readJson('positions/mystery_schools.json');
  assert.equal(ms.review_open.length, 1);
  assert.match(store.readText('positions/ancient_egypt.md'), /History \(his own corrections\)/);
  const again = await rebuildPositions(store, { tax: TAX, now: TS });
  assert.equal(again.rebuilt, 0); assert.equal(again.incremental, true);
  decideReview(store, ms.review_open[0].id, 'hold', { now: TS });
  const third = await rebuildPositions(store, { tax: TAX, now: TS });
  assert.deepEqual(third.categories, ['mystery_schools']);
});

test('LLM position summary must cite the claims it summarises', async () => {
  const store = await mindWithHistory();
  const llm = async (p) => JSON.stringify({ statement: `The loaf was wax [c-late].` }); llm.modelName = 'ollama:s';
  await rebuildPositions(store, { tax: TAX, llm, now: TS });
  assert.equal(store.readJson('positions/ancient_egypt.json').current_position.statement, 'The loaf was wax [c-late].');
  const s2 = await mindWithHistory();
  await rebuildPositions(s2, { tax: TAX, llm: async () => '{"statement":"uncited invention"}', now: TS });
  assert.notEqual(s2.readJson('positions/ancient_egypt.json').current_position.statement, 'uncited invention');
});

test('exports: training never teaches superseded claims or open slips; eval rows fit hathor-eval; public-only filter', async () => {
  const store = await mindWithHistory();
  await rebuildPositions(store, { tax: TAX, now: TS });
  const r = runExports(store, {});
  assert.ok(r.rag > 0 && r.train > 0);
  const train = store.readJsonl('exports/train.jsonl');
  const taught = train.filter((t) => t.type === 'quote').flatMap((t) => t.provenance.claim_ids);
  assert.ok(!taught.includes('c-early')); assert.ok(!taught.includes('c-slip')); assert.ok(taught.includes('c-late'));
  assert.ok(train.some((t) => t.type === 'self_correction'));
  assert.ok(train.some((t) => t.type === 'held_position' && /deliberate position/.test(t.messages[1].content)));
  assert.ok(train.every((t) => t.weight > 0 && t.provenance && t.privacy));
  const evalc = store.readJsonl('exports/eval-candidates.jsonl');
  const ids = new Set();
  for (const it of evalc) {
    for (const k of ['id', 'question', 'topic', 'lang', 'kind']) assert.ok(typeof it[k] === 'string' && it[k].trim(), k);
    assert.equal(typeof it.ryan_answer, 'string'); assert.ok(['known', 'boundary', 'rule1', 'self'].includes(it.kind));
    assert.equal(it.status, 'pending-operator'); assert.ok(!ids.has(it.id)); ids.add(it.id);
  }
  const rag = store.readJsonl('exports/rag.jsonl');
  assert.equal(rag.find((x) => x.id === 'c-early').status, 'superseded');
  assert.equal(rag.find((x) => x.id === 'c-early').superseded_by, 'c-late');
  runExports(store, { publicOnly: true });
  assert.ok(!store.readJsonl('exports/rag.public.jsonl').some((x) => x.id === 'c-slip'));
  assert.ok(!store.readJsonl('exports/review-open.public.jsonl').length, 'the slip item cites a private source');
  assert.equal(questionFor('The headcone was made of beeswax.'), 'What was the headcone?');
  assert.equal(questionFor('It is what it is.'), null);
  assert.deepEqual(buildExports({ claims: [], annals: [], reviewRows: [] }), { rag: [], train: [], eval: [] });
});

// ── CLI / pipeline ──────────────────────────────────────────────────────────────────────────────────
test('ingest end-to-end on a fixture dir; unchanged files are skipped; dry-run writes nothing', async () => {
  const d = tmp(); const docs = path.join(d, 'docs'); fs.mkdirSync(docs);
  fs.writeFileSync(path.join(docs, 'paper.json'), JSON.stringify({ title: 'Wax Paper', date: 'January 15, 2026', part_1: { finding: 'The headcone was made of beeswax from Carthage. Wadjet = Theia, the mother of light.' } }));
  fs.writeFileSync(path.join(docs, '_index.json'), '{}');
  fs.writeFileSync(path.join(docs, 'code.mjs'), 'x');
  assert.deepEqual(expandPaths([docs]).map((p) => path.basename(p)), ['paper.json']);
  const dry = new Store(path.join(d, 'dry'), { dryRun: true });
  const r0 = await ingest(dry, [docs], { gitDate: null });
  assert.equal(r0.ok, true); assert.ok(r0.claims >= 2); assert.equal(fs.existsSync(path.join(d, 'dry')), false);
  const store = new Store(path.join(d, 'data'));
  const r1 = await ingest(store, [docs], { gitDate: null });
  assert.equal(r1.per_source[0].date, '2026-01-15'); assert.equal(r1.per_source[0].date_basis, 'metadata:date');
  const r2 = await ingest(store, [docs], { gitDate: null });
  assert.equal(r2.unchanged, 1); assert.equal(r2.claims, 0);
  const s = status(store); assert.equal(s.sources, 1); assert.ok(s.claims >= 2);
  assert.deepEqual(parseArgs(['ingest', 'a', '--kind', 'chat', '--dry-run']), { _: ['ingest', 'a'], kind: 'chat', 'dry-run': true });
});

test('judgeDeterministic + applyRules are pure and explain themselves', () => {
  const a = claim('Beeswax headcones were worn at banquets.'), b = claim('Beeswax headcones were worn at banquets.');
  const j = judgeDeterministic(a, b); assert.equal(j.relation, 'supports'); assert.match(j.reason, /restatement/);
  const out = applyRules(a, b, { ...j, model: 'm' }, { ts: TS() });
  assert.equal(out.annal.relation, 'supports'); assert.equal(out.review, undefined);
});
