// run.test.mjs — fully offline. The runner is exercised against the fixture corpus with every
// external tier stubbed out, writing into a scratch directory inside this module.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBacklog, report, hasDossier, dossierPath } from './run.mjs';
import { __setDeps, __setFetch, __clearCorpusCache } from './research.mjs';
import { loadBoard, moveCard, saveBoard, totals } from './board.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, 'fixtures', 'growth');
const SCRATCH = [];

function scratch() {
  const d = fs.mkdtempSync(path.join(HERE, '.scratch-run-'));
  SCRATCH.push(d);
  return d;
}
after(() => { for (const d of SCRATCH) fs.rmSync(d, { recursive: true, force: true }); });

beforeEach(() => {
  __clearCorpusCache();
  __setFetch(async () => { throw new Error('no network in tests'); });
  __setDeps({
    publicDomain: { classify: () => ({ status: 'unknown', reason: 'stub', entersPdYear: null }) },
    grounding: { rankSources: (l) => [...l] },
    ourSearch: { search: async () => ({ hits: [] }) },
    booklore: { search: async () => [], ingestMany: async () => [] },
    seeds: { allSeedUrls: () => [] },
    bookApis: {},
  });
});

test('a run parses the books, cards the backlog and writes dossiers', async () => {
  const dataDir = scratch();
  const r = await runBacklog({ root: ROOT, dataDir, boardFile: path.join(dataDir, 'board.json') });
  assert.equal(r.ok, true);
  assert.equal(r.books.length, 19);
  assert.ok(r.queued > 0);
  assert.equal(r.researched, r.queued);
  assert.equal(r.errors.length, 0);
  assert.equal(r.board.cards.length, r.queued);
  for (const c of r.board.cards) {
    assert.ok(c.dossier, 'every researched card links its dossier');
    assert.ok(fs.existsSync(c.dossier), 'and the dossier is on disk');
    assert.equal(c.column, 'Backlog');
  }
  assert.ok(totals(r.board).points > 0);
});

test('re-running is idempotent and resumable: nothing is redone, nothing is lost', async () => {
  const dataDir = scratch();
  const boardFile = path.join(dataDir, 'board.json');
  const first = await runBacklog({ root: ROOT, dataDir, boardFile });
  assert.ok(first.researched > 0);

  // a human moves a card on and marks another done
  let b = loadBoard(boardFile);
  const moved = b.cards[0].id;
  b = moveCard(b, moved, 'Writing');
  b = moveCard(b, b.cards[1].id, 'Done');
  saveBoard(b, boardFile);

  const second = await runBacklog({ root: ROOT, dataDir, boardFile });
  assert.equal(second.researched, 0, 'every dossier already existed');
  assert.equal(second.skipped, first.researched);
  assert.equal(second.board.cards.length, first.board.cards.length, 'no duplicate cards');

  const after = loadBoard(boardFile);
  assert.equal(after.cards.find((c) => c.id === moved).column, 'Writing', 'progress survived');
  assert.equal(after.cards.filter((c) => c.column === 'Done').length, 1);
  assert.ok(after.cards.every((c) => c.dossier), 'dossier links survived');
});

test('--force re-researches, --dry-run writes nothing', async () => {
  const dataDir = scratch();
  const boardFile = path.join(dataDir, 'board.json');
  const first = await runBacklog({ root: ROOT, dataDir, boardFile, limit: 2 });
  assert.equal(first.researched, 2);
  const forced = await runBacklog({ root: ROOT, dataDir, boardFile, limit: 2, force: true });
  assert.equal(forced.researched, 2);

  const dry = scratch();
  const dryBoard = path.join(dry, 'board.json');
  const r = await runBacklog({ root: ROOT, dataDir: dry, boardFile: dryBoard, dryRun: true });
  assert.ok(r.queued > 0);
  assert.equal(fs.existsSync(dryBoard), false, 'a dry run leaves no board behind');
  assert.equal(fs.existsSync(path.join(dry, 'dossiers')), false);
});

test('limit and book filters narrow the walk', async () => {
  const dataDir = scratch();
  const boardFile = path.join(dataDir, 'board.json');
  const r = await runBacklog({ root: ROOT, dataDir, boardFile, limit: 1 });
  assert.equal(r.researched, 1);
  assert.ok(r.queued > 1, 'the whole backlog is still carded, only the research is limited');
  assert.equal(r.board.cards.filter((c) => c.dossier).length, 1);

  const d2 = scratch();
  const one = await runBacklog({ root: ROOT, dataDir: d2, boardFile: path.join(d2, 'board.json'), book: 1 });
  assert.ok(one.queued > 0);
  assert.ok(one.board.cards.every((c) => c.book === 1));
});

test('weak candidates stay out of the queue unless asked for', async () => {
  const d1 = scratch();
  const base = await runBacklog({ root: ROOT, dataDir: d1, boardFile: path.join(d1, 'board.json'), dryRun: true });
  const d2 = scratch();
  const wide = await runBacklog({
    root: ROOT, dataDir: d2, boardFile: path.join(d2, 'board.json'), dryRun: true,
    include: ['inventoried', 'strong', 'weak'],
  });
  assert.ok(wide.queued > base.queued);
  assert.ok(base.board.cards.every((c) => c.confidence !== 'weak'));
});

test('dossiers written by the runner carry provenance on every entry', async () => {
  const dataDir = scratch();
  const r = await runBacklog({ root: ROOT, dataDir, boardFile: path.join(dataDir, 'board.json'), limit: 3 });
  const withDossier = r.board.cards.filter((c) => c.dossier);
  assert.ok(withDossier.length > 0);
  for (const c of withDossier) {
    const d = JSON.parse(fs.readFileSync(c.dossier, 'utf8'));
    assert.equal(d.id, c.id);
    assert.ok(d.generatedAt);
    for (const e of d.entries) {
      assert.ok(e.provenance && (e.provenance.file || e.provenance.url));
      assert.ok(e.tier >= 1);
    }
  }
});

test('hasDossier / dossierPath sanitise ids', () => {
  const dataDir = scratch();
  assert.equal(hasDossier('B1-L1', dataDir), false);
  assert.ok(dossierPath('../../etc/passwd', dataDir).startsWith(path.join(dataDir, 'dossiers')));
  assert.ok(!dossierPath('../../etc/passwd', dataDir).includes('..'));
});

test('a missing corpus is reported, not thrown', async () => {
  const dataDir = scratch();
  const r = await runBacklog({ root: path.join(HERE, 'no-such-corpus'), dataDir, boardFile: path.join(dataDir, 'board.json') });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.length > 0);
  assert.equal(r.board.cards.length, 0);
});

test('report renders and escapes', async () => {
  const dataDir = scratch();
  const r = await runBacklog({ root: ROOT, dataDir, boardFile: path.join(dataDir, 'board.json'), limit: 1 });
  const out = report(r);
  assert.ok(out.includes('19 books parsed'));
  assert.ok(out.includes('story points'));
  assert.ok(!out.includes('<script>'));
  assert.equal(typeof report(null), 'string');
});
