// ryan-mind/mind.mjs — the engine that turns the operator's own material into Hathor's "weights"
// without him hand-picking: ingest (dated sources → claims) → reconcile (the bounce, written as annals)
// → positions (per-category briefs) → export (RAG / training / eval candidates).
//
//   node integrations/ryan-mind/mind.mjs ingest <path...> [--kind writing|chat|email|thread] [--date YYYY-MM-DD]
//                                          [--privacy public|private] [--title T] [--max N] [--force]
//   node integrations/ryan-mind/mind.mjs reconcile [--limit N] [--k N] [--embed] [--no-checker]
//   node integrations/ryan-mind/mind.mjs positions [--full]
//   node integrations/ryan-mind/mind.mjs export [--public-only]
//   node integrations/ryan-mind/mind.mjs review [<review-id> --decide slip_confirmed|hold|keep|both [--keep <claim-id>] [--note ...]]
//   node integrations/ryan-mind/mind.mjs status
// Common flags: --data DIR (else RYAN_MIND_DIR, else <repo>/.local/ryan-mind) · --dry-run (write nothing)
//               --llm (use the LOCAL Ollama model; RYAN_MIND_OLLAMA_URL / --ollama URL, --model NAME)
// Order of learning: writing first → chat export → emails (read against the chats) → forum threads.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, readClaims, REPO_ROOT } from './store.mjs';
import { KINDS, loadRegistry, saveRegistry, makeSourceRecord, dateWriting, gitFirstAdd, readSource, loadSourceText } from './sources.mjs';
import { loadTaxonomy, suggestCategories, categorize } from './taxonomy.mjs';
import { extractClaims } from './extract.mjs';
import { reconcile, decideReview, deriveState, splitReview } from './reconcile.mjs';
import { rebuildPositions } from './positions.mjs';
import { runExports } from './exports.mjs';
import { hierophantChecker } from './checker.mjs';
import { ollamaLlm, ollamaEmbed, probeOllama } from './adapters.mjs';

/** Expand directories into their .md/.json documents (skips generated _* files and code). */
export function expandPaths(paths) {
  const out = [];
  const walk = (p) => {
    let st; try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) { for (const e of fs.readdirSync(p).sort()) walk(path.join(p, e)); return; }
    const b = path.basename(p);
    if (b.startsWith('_') || !/\.(md|json|zip)$/i.test(b)) return;
    out.push(path.resolve(p));
  };
  for (const p of paths) walk(p);
  return [...new Set(out)];
}

/**
 * Ingest files as sources and extract their claims. Soft-fails per file (reported in `errors`).
 * @param {Store} store
 * @param {string[]} paths
 * @param {{kind?:string, date?:string, privacy?:string, title?:string, llm?:Function, maxPerSource?:number,
 *          force?:boolean, gitDate?:Function, includeAssistant?:boolean, now?:()=>Date}} opts
 */
export async function ingest(store, paths, opts = {}) {
  const kind = KINDS.includes(opts.kind) ? opts.kind : 'writing';
  const reg = loadRegistry(store);
  const config = store.readJson('config.json', {}) || {};
  if (kind === 'email' && !opts.force && !reg.some((s) => s.kind === 'chat')) {
    return { ok: false, reason: 'emails are read AGAINST the chats — ingest the chat export first (or pass --force)', sources: 0, claims: 0 };
  }
  let tax = loadTaxonomy(store);
  const existing = new Set(store.readJsonl('claims.jsonl').map((c) => c.id));
  const files = expandPaths(paths);
  const report = { ok: true, files: files.length, sources: 0, unchanged: 0, claims: 0, errors: [], per_source: [] };
  for (const f of files) {
    const text = loadSourceText(f);
    if (text == null) { report.errors.push({ path: f, reason: 'unreadable' }); continue; }
    const read = readSource(kind, f, text, config, { includeAssistant: !!opts.includeAssistant });
    if (!read.ok) { report.errors.push({ path: f, reason: read.reason }); continue; }
    let date = opts.date || null, date_basis = opts.date ? 'explicit' : null, title = opts.title || read.title || null, author = null;
    if (!date && kind === 'writing') {
      const d = dateWriting(f, text, { gitDate: opts.gitDate === undefined ? gitFirstAdd : opts.gitDate, statMtime: (p) => { try { return fs.statSync(p).mtime.toISOString(); } catch { return null; } } });
      date = d.date; date_basis = d.date ? d.date_basis : 'unknown'; title = title || d.title; author = d.author || null;
    }
    if (!date && read.segments.length) {
      const ds = read.segments.map((s) => s.at || s.date).filter(Boolean).sort();
      if (ds.length) { date = ds[0].slice(0, 10); date_basis = 'segments:earliest'; }
    }
    const rec = makeSourceRecord({ path: f, kind, date, date_basis, title, privacy: opts.privacy, author, text }, { now: opts.now ? opts.now() : new Date() });
    const prior = reg.find((s) => s.id === rec.id);
    if (prior && prior.content_hash === rec.content_hash && !opts.force) { report.unchanged++; continue; }
    if (prior) { rec.versions = [...(prior.versions || []), { content_hash: prior.content_hash, added: prior.added }]; reg.splice(reg.indexOf(prior), 1); }
    reg.push(rec); report.sources++;
    const claims = (await extractClaims(rec, read.segments, tax, { llm: opts.llm || null, maxPerSource: opts.maxPerSource ?? Infinity })).filter((c) => !existing.has(c.id));
    for (const c of claims) existing.add(c.id);
    store.appendJsonl('claims.jsonl', claims);
    report.claims += claims.length;
    report.per_source.push({ id: rec.id, title: rec.title, date: rec.date, date_basis: rec.date_basis, privacy: rec.privacy, segments: read.segments.length, claims: claims.length });
  }
  saveRegistry(store, reg);
  // let the taxonomy grow from what the uncategorised claims keep talking about
  const all = readClaims(store);
  const { taxonomy, proposals } = suggestCategories(all, tax);
  if (proposals.length) {
    tax = taxonomy; store.writeJson('taxonomy.json', tax);
    const ts = new Date().toISOString();
    store.appendJsonl('taxonomy-log.jsonl', proposals.map((p) => ({ ts, event: 'proposed', category: p.id, keywords: p.keywords, weak_keywords: p.weak_keywords, evidence: p.evidence, by: 'ryan-mind:suggestCategories' })));
    const moves = [];
    for (const c of all) {
      if (c.category !== 'uncategorized') continue;
      const r = categorize(c.text, `${c.context} ${c.source_title}`, tax);
      if (r.category !== 'uncategorized') moves.push({ ts, claim_id: c.id, category: r.category, categories: r.categories, by: `taxonomy:${r.category}` });
    }
    store.appendJsonl('recategorized.jsonl', moves);
    report.proposed_categories = proposals.map((p) => ({ id: p.id, evidence: p.evidence.claims })); report.recategorized = moves.length;
  }
  return report;
}

export function status(store) {
  const claims = readClaims(store); const annals = store.readJsonl('annals.jsonl'); const rq = store.readJsonl('review_queue.jsonl');
  const st = deriveState(claims, annals, rq); const { items, decisions } = splitReview(rq);
  const byCat = {}; for (const c of claims) byCat[c.category] = (byCat[c.category] || 0) + 1;
  const rel = {}; for (const a of annals) rel[a.relation] = (rel[a.relation] || 0) + 1;
  const cls = {}; for (const s of st.values()) cls[s.class] = (cls[s.class] || 0) + 1;
  return {
    dir: store.dir, sources: loadRegistry(store).length, claims: claims.length,
    superseded: [...st.values()].filter((s) => s.status === 'superseded').length, classes: cls,
    reconciled: (store.readJson('state.json', { reconciled: [] })?.reconciled || []).length,
    annals: annals.length, relations: rel, review_open: items.filter((i) => !decisions.has(i.id)).length,
    categories: Object.entries(byCat).sort((a, b) => b[1] - a[1]),
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) { const k = t.slice(2); const n = argv[i + 1]; if (n != null && !n.startsWith('--')) { a[k] = n; i++; } else a[k] = true; } else a._.push(t);
  }
  return a;
}

async function main(argv) {
  const args = parseArgs(argv); const cmd = args._[0];
  const opened = openStore({ dir: args.data, dryRun: !!args['dry-run'] });
  if (!opened.ok) { console.error(opened.reason); process.exitCode = 2; return; }
  const store = opened.store;
  const llmOn = !!args.llm;
  let llm = null, embed = null;
  if (llmOn || args.embed) {
    const p = await probeOllama({ url: args.ollama });
    if (!p.ok) console.error(`[ryan-mind] local ollama unavailable (${p.reason}) — deterministic fallback`);
    else {
      if (llmOn) llm = ollamaLlm({ url: args.ollama, model: args.model });
      if (args.embed) embed = ollamaEmbed({ url: args.ollama, model: args['embed-model'] });
    }
  }
  const log = (o) => console.log(JSON.stringify(o, null, 2));
  const progress = (label) => (i, n) => { if (i === n || i % 25 === 0) process.stderr.write(`\r[${label}] ${i}/${n}`); if (i === n) process.stderr.write('\n'); };
  let out;
  if (cmd === 'ingest') out = await ingest(store, args._.slice(1), { kind: args.kind, date: args.date, privacy: args.privacy, title: args.title, llm, maxPerSource: args.max ? Number(args.max) : undefined, force: !!args.force, includeAssistant: !!args['include-assistant'] });
  else if (cmd === 'reconcile') out = await reconcile(store, { llm, embed, checkers: args['no-checker'] ? [] : [hierophantChecker()], k: args.k ? Number(args.k) : undefined, limit: args.limit ? Number(args.limit) : undefined, onProgress: progress('reconcile') });
  else if (cmd === 'positions') out = await rebuildPositions(store, { tax: loadTaxonomy(store), llm, full: !!args.full });
  else if (cmd === 'export') out = runExports(store, { publicOnly: !!args['public-only'] });
  else if (cmd === 'review') {
    if (args._[1]) out = decideReview(store, args._[1], args.decide, { keep: args.keep || null, note: typeof args.note === 'string' ? args.note : '' });
    else { const { items, decisions } = splitReview(store.readJsonl('review_queue.jsonl')); out = items.filter((i) => !decisions.has(i.id)).map((i) => ({ id: i.id, type: i.type, question: i.question })); }
  } else if (cmd === 'status') out = status(store);
  else { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); return; }
  if (store.dryRun) out = { dry_run: true, would_write: store.writes, result: out };
  log(out);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((e) => { console.error(`[ryan-mind] ${e?.message || e}`); process.exitCode = 1; });

export { REPO_ROOT };
