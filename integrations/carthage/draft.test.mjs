// draft.test.mjs — the seam stays unwired. Fully offline; no model is ever called.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { draft, assembleBrief, renderBrief, isWired, __setEngine, VOICE, QC_CHECKLIST } from './draft.mjs';

afterEach(() => __setEngine(null));

const BP = {
  id: 'B1-L3424',
  text: 'Sacred Tales',
  note: 'looks like Header, but I need my own Words between the Quotes',
  book: 1,
  bookTitle: 'The Book of Tanit',
  line: 3424,
  contextBefore: ['…the Temple Culture and what came after it.'],
  contextAfter: ['"In the Sacred Tales, Aelius Aristides records the dreams…"'],
  estimate: { minParagraphs: 10, maxParagraphs: 12, points: 3, basis: 'guides: "Some need: 10-12 paragraphs"' },
};
const DOSSIER = {
  bulletpoint: BP,
  entries: [{
    tier: 1, tierName: 'local', title: 'emails/king-phoenix.md',
    quote: 'The Sacred Tales of Aelius Aristides are the thing I keep coming back to',
    date: '2024-05-02',
    provenance: { kind: 'local', corpus: 'emails', file: '/growth/emails/king-phoenix.md', line: 9 },
  }],
};

test('the drafting engine is NOT wired', () => {
  assert.equal(isWired(), false);
});

test('draft() returns the brief and refuses to invent prose', async () => {
  const r = await draft({ bulletpoint: BP, dossier: DOSSIER });
  assert.equal(r.ok, false);
  assert.equal(r.unwired, true);
  assert.equal(r.text, null);
  assert.match(r.reason, /operator is choosing the model/);
  assert.equal(r.brief.ok, true);
});

test('assembleBrief carries the placeholder, the note, the placement and the target', () => {
  const b = assembleBrief({ bulletpoint: BP, dossier: DOSSIER });
  assert.equal(b.placeholder, 'Sacred Tales');
  assert.equal(b.note, 'looks like Header, but I need my own Words between the Quotes');
  assert.equal(b.placement.book, 1);
  assert.equal(b.placement.line, 3424);
  assert.equal(b.target.minParagraphs, 10);
  assert.equal(b.target.storyPoints, 3);
  assert.ok(b.placement.contextAfter.length > 0);
});

test('every passage in the brief keeps its provenance', () => {
  const b = assembleBrief({ bulletpoint: BP, dossier: DOSSIER });
  assert.equal(b.passages.length, 1);
  assert.equal(b.passages[0].provenance.file, '/growth/emails/king-phoenix.md');
  assert.equal(b.passages[0].provenance.line, 9);
  assert.ok(b.passages[0].quote);
});

test("the brief carries the guides' voice rules and QC checklist verbatim", () => {
  const b = assembleBrief({ bulletpoint: BP, dossier: DOSSIER });
  assert.ok(b.voice.never.includes('It is important to note…'));
  assert.ok(b.voice.always.includes('We can see this represented in…'));
  assert.ok(b.voice.register.some((s) => s.includes('You are not explaining')));
  assert.ok(b.qc.includes('No academic tone'));
  assert.equal(QC_CHECKLIST.length > 10, true);
  assert.throws(() => { VOICE.never.push('x'); });   // frozen
});

test('assembleBrief soft-fails on nothing', () => {
  assert.equal(assembleBrief().ok, false);
  assert.equal(assembleBrief({}).ok, false);
  assert.equal(renderBrief(null), '');
});

test('renderBrief escapes and still writes no prose', () => {
  const out = renderBrief(assembleBrief({ bulletpoint: { ...BP, text: '<i>Sacred Tales</i>' }, dossier: DOSSIER }));
  assert.ok(out.includes('&lt;i&gt;'));
  assert.ok(!out.includes('<i>'));
  assert.ok(out.includes('PLACEHOLDER:'));
});

test('once an engine IS installed, draft() hands it the brief and returns its text', async () => {
  let seen = null;
  __setEngine(async ({ brief }) => { seen = brief; return { text: 'expansion goes here' }; });
  assert.equal(isWired(), true);
  const r = await draft({ bulletpoint: BP, dossier: DOSSIER });
  assert.equal(r.ok, true);
  assert.equal(r.unwired, false);
  assert.equal(r.text, 'expansion goes here');
  assert.equal(seen.placeholder, 'Sacred Tales');
});

test('an engine that throws is a soft failure, not a crash', async () => {
  __setEngine(async () => { throw new Error('model unavailable'); });
  const r = await draft({ bulletpoint: BP, dossier: DOSSIER });
  assert.equal(r.ok, false);
  assert.equal(r.unwired, false);
  assert.equal(r.reason, 'model unavailable');
  assert.equal(r.text, null);
});
