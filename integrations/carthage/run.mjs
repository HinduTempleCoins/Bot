// run.mjs — walk the Carthage expansion backlog: parse the source, build a dossier per Type E
// bulletpoint, keep the Metatron scene board up to date. Safe to re-run at any point.
//
// RESUMABLE BY CONSTRUCTION. Each dossier is one file on disk; a bulletpoint whose dossier already
// exists is skipped unless --force. Board cards are upserted, so a card a human has already moved
// to Writing/Review/Done keeps its column. Every step soft-fails: one bad bulletpoint is recorded
// in `errors` and the walk continues.
//
// It does NOT draft. draft.mjs is imported for the brief assembly only, and its engine is unwired.
//
//   node integrations/carthage/run.mjs --limit 20
//   node integrations/carthage/run.mjs --book 7 --ingest
//   node integrations/carthage/run.mjs --report

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAll, loadSource, CORPUS_ROOT, esc } from './parse.mjs';
import { buildDossier, renderDossier } from './research.mjs';
import { makeCard, upsertCard, loadBoard, saveBoard, totals, renderBoard, nextCard, BOARD_FILE } from './board.mjs';

export const DATA_DIR = () =>
  process.env.CARTHAGE_DATA || path.join(process.cwd(), 'data', 'carthage');
export const dossierDir = (dataDir = DATA_DIR()) => path.join(dataDir, 'dossiers');
export const dossierPath = (id, dataDir = DATA_DIR()) =>
  path.join(dossierDir(dataDir), `${String(id).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);

function writeJson(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
    return true;
  } catch { return false; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Has this bulletpoint already been researched? */
export function hasDossier(id, dataDir = DATA_DIR()) {
  try { return fs.statSync(dossierPath(id, dataDir)).isFile(); } catch { return false; }
}

/**
 * Walk the backlog.
 * @param {object} [opts]
 *   root        corpus root
 *   dataDir     where dossiers and the board live (default ./data/carthage)
 *   boardFile   board path (default dataDir/board.json via CARTHAGE_BOARD)
 *   limit       max bulletpoints to research this run (0 = all)
 *   book        only this book number
 *   include     confidence levels to queue (default ['inventoried','strong'])
 *   force       re-research bulletpoints that already have a dossier
 *   ingest      let booklore ingest missing reference pages (rate-limited)
 *   dryRun      compute and board everything, write nothing
 * @returns {Promise<{ok,books,bulletpoints,queued,researched,skipped,errors,board,totals,reasons}>}
 */
export async function runBacklog(opts = {}) {
  const {
    root = CORPUS_ROOT(),
    dataDir = DATA_DIR(),
    boardFile = process.env.CARTHAGE_BOARD || path.join(dataDir, 'board.json'),
    limit = 0,
    book = null,
    include = ['inventoried', 'strong'],
    force = false,
    ingest = false,
    dryRun = false,
  } = opts || {};

  const parsed = parseAll({ root });
  const errors = [];
  if (!parsed.ok) {
    return {
      ok: false, books: [], bulletpoints: 0, queued: 0, researched: 0, skipped: 0,
      errors, board: loadBoard(boardFile), totals: totals(loadBoard(boardFile)),
      reasons: parsed.reasons,
    };
  }

  const sourceText = loadSource(root).text;   // read once, reused by every dossier
  let board = loadBoard(boardFile);

  const queue = parsed.bulletpoints
    .filter((b) => include.includes(b.confidence))
    .filter((b) => (book == null ? true : b.bookNumber === Number(book)));

  // Every queued bulletpoint gets a card immediately, whether or not we research it this run — the
  // board is the backlog, and the backlog is known in full after the parse.
  for (const bp of queue) {
    try { board = upsertCard(board, makeCard(bp)); }
    catch (e) { errors.push({ id: bp.id, step: 'card', error: e && e.message ? e.message : String(e) }); }
  }

  let researched = 0, skipped = 0;
  for (const bp of queue) {
    if (limit && researched >= limit) break;
    const file = dossierPath(bp.id, dataDir);
    if (!force && hasDossier(bp.id, dataDir)) {
      skipped++;
      const existing = readJson(file);
      board = upsertCard(board, {
        ...makeCard(bp),
        dossier: file,
        researchedAt: existing?.generatedAt || null,
      });
      continue;
    }
    try {
      const d = await buildDossier(bp, { root, sourceText, ingest });
      if (!dryRun) writeJson(file, d);
      board = upsertCard(board, { ...makeCard(bp), dossier: dryRun ? null : file, researchedAt: d.generatedAt });
      researched++;
    } catch (e) {
      errors.push({ id: bp.id, step: 'dossier', error: e && e.message ? e.message : String(e) });
    }
  }

  if (!dryRun) saveBoard(board, boardFile);

  return {
    ok: true,
    root,
    books: parsed.books,
    inventory: parsed.inventory.length,
    coverage: parsed.coverage,
    bulletpoints: parsed.bulletpoints.length,
    queued: queue.length,
    researched,
    skipped,
    errors,
    board,
    totals: totals(board),
    boardFile,
    dataDir,
    reasons: parsed.reasons,
  };
}

/** One-screen status: books, backlog size, story points, what the drafting bot would pull next. */
export function report(result) {
  const t = result?.totals || { cards: 0, points: 0, words: 0, paragraphs: 0, byBook: {} };
  const lines = [
    `Carthage Bible — ${esc(String((result?.books || []).length))} books parsed` +
    (result?.coverage ? ` · inventory located ${esc(String(result.coverage.located))}/${esc(String(result.coverage.inventory))}` : ''),
    `Type E bulletpoints: ${esc(String(result?.bulletpoints ?? 0))} found · ${esc(String(result?.queued ?? 0))} queued as cards`,
    `Backlog: ${esc(String(t.cards))} cards · ${esc(String(t.points))} story points · ~${esc(t.words.toLocaleString('en-US'))} words · ~${esc(String(t.paragraphs))} paragraphs`,
    `This run: ${esc(String(result?.researched ?? 0))} researched · ${esc(String(result?.skipped ?? 0))} already had dossiers · ${esc(String((result?.errors || []).length))} errors`,
    '',
  ];
  const nxt = result?.board ? nextCard(result.board) : null;
  if (nxt) lines.push(`Next up: [${esc(nxt.id)}] ${esc(nxt.text)} — ${esc(String(nxt.pts))} pt (dossier: ${esc(nxt.dossier || 'none')})`);
  lines.push('', 'Per book:');
  for (const [bk, s] of Object.entries(t.byBook)) {
    lines.push(`  ${esc(bk).padEnd(16)} ${esc(String(s.cards)).padStart(4)} cards  ${esc(String(s.points)).padStart(4)} pts`);
  }
  return lines.join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (n, d = null) => {
    const i = argv.indexOf(`--${n}`);
    if (i < 0) return d;
    const v = argv[i + 1];
    return v && !v.startsWith('--') ? v : true;
  };
  if (argv.includes('--report')) {
    const b = loadBoard(process.env.CARTHAGE_BOARD || path.join(DATA_DIR(), 'board.json'));
    console.log(renderBoard(b));
    process.exit(0);
  }
  if (flag('show')) {
    const d = readJson(dossierPath(String(flag('show'))));
    console.log(d ? renderDossier(d) : 'no dossier for that id');
    process.exit(0);
  }
  const res = await runBacklog({
    limit: Number(flag('limit', 0)) || 0,
    book: flag('book', null),
    force: argv.includes('--force'),
    ingest: argv.includes('--ingest'),
    dryRun: argv.includes('--dry-run'),
    include: argv.includes('--weak') ? ['inventoried', 'strong', 'weak'] : ['inventoried', 'strong'],
  });
  console.log(report(res));
  if (!res.ok) { console.error((res.reasons || []).join('; ')); process.exit(1); }
}
