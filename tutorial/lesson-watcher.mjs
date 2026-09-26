/**
 * tutorial/lesson-watcher.mjs — the Instructional Series watcher daemon.
 *
 * Streams IRREVERSIBLE blocks from a MELEK RPC, picks every `comment` op that is addressed to Hathor —
 * a comment on one of her lesson posts, a reply under her comment in a lesson thread, or an @hathor
 * mention anywhere — and hands it to tutorial/call.mjs handleLessonComment(), which classifies it,
 * auto-checks the lesson from the account's public activity, and returns the ops to answer it.
 *
 *   DRY-RUN IS THE DEFAULT. It logs the exact ops it WOULD broadcast (JSON lines) and writes nothing to
 *   the chain and nothing to lesson progress. `--broadcast` sends them through MELEK-Signer
 *   (signerBroadcast, scoped bearer token MELEK_SIGNER_TOKEN, role posting: vote + comment) and only
 *   then records the lesson as done. Zero WIF, by construction — this file cannot sign.
 *
 *   Idempotent: a processed-op store keyed by author/permlink (so an EDIT of a comment is not a second
 *   call) plus a block cursor. Backoff on RPC trouble. Soft-fail: one bad op never stops the stream.
 *
 * Env:
 *   MELEK_RPC_URL        default https://melek.salon/rpc
 *   INSTRUCTIONAL_DIR    the (private) lesson drafts directory
 *   LESSON_WATCH_DIR     state dir: cursor, processed ops, lesson progress, review queue, dry-run log
 *   STRICT_ORDER         '1' (default) checks lessons in order
 *   HATHOR_LLM           '1' turns the local brain on (default OFF — the Phase-2 deterministic bot)
 *   LESSON_UPVOTE_WEIGHT default 5000
 *   LESSON_WATCH_FINALITY 'irreversible' (default) | 'head' (head − LESSON_WATCH_HEAD_LAG, for a stalled LIB)
 *   MELEK_SIGNER_TOKEN / MELEK_SIGNER_URL   only read with --broadcast
 *
 * CLI:
 *   node tutorial/lesson-watcher.mjs                  # stream forever, dry-run
 *   node tutorial/lesson-watcher.mjs --once           # catch up to irreversible, then exit
 *   node tutorial/lesson-watcher.mjs --from=1276000   # start at a block
 *   node tutorial/lesson-watcher.mjs --probe --account=alice --lesson=2 --text="done!"
 *        # one synthetic comment on lesson N, checked against alice's REAL chain activity, dry-run
 *   node tutorial/lesson-watcher.mjs --broadcast      # LIVE — operator decision only
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleLessonComment, createCallLimiter, mentionsWitness, normalizeCommentOp } from './call.mjs';
import { loadRegistry } from './instructional.mjs';
import { createLessonBrain } from './lesson-brain.mjs';
import { fetchUserActivity } from './chain-reader.mjs';
import { TutorialState } from './state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- tiny JSON-RPC client (injectable fetch) -------------------------------------------------------

export function makeRpc({ url, fetch: f = (...a) => globalThis.fetch(...a), timeoutMs = 20_000 } = {}) {
  return async function rpc(method, params = []) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctl.signal });
      const j = await r.json();
      if (j && j.error) throw new Error(`${method}: ${j.error.message || 'rpc error'}`);
      return j ? j.result : null;
    } finally { clearTimeout(timer); }
  };
}

// ---- processed-op store + cursor -------------------------------------------------------------------

export function createStore(dir) {
  const file = dir ? path.join(dir, 'watcher.json') : null;
  let data = { cursor: null, processed: [] };
  if (file && existsSync(file)) {
    try { const j = JSON.parse(readFileSync(file, 'utf8')); if (j && Array.isArray(j.processed)) data = j; } catch { /* start clean */ }
  }
  const seen = new Set(data.processed);
  const MAX = 50_000;
  return {
    get cursor() { return data.cursor; },
    setCursor(n) { data.cursor = n; },
    has: (k) => seen.has(k),
    add(k) { if (seen.has(k)) return; seen.add(k); data.processed.push(k); if (data.processed.length > MAX) { const drop = data.processed.splice(0, data.processed.length - MAX); for (const d of drop) seen.delete(d); } },
    save() {
      if (!file) return;
      try { mkdirSync(dir, { recursive: true }); writeFileSync(`${file}.tmp`, JSON.stringify(data)); renameSync(`${file}.tmp`, file); } catch { /* soft */ }
    },
  };
}

/** Comment ops in a block, as { op, trxId, opIndex }. Accepts both node shapes. */
export function commentOpsIn(block) {
  const out = [];
  const txs = Array.isArray(block?.transactions) ? block.transactions : [];
  txs.forEach((tx, ti) => {
    const trxId = tx.transaction_id || (Array.isArray(block.transaction_ids) ? block.transaction_ids[ti] : null) || `tx${ti}`;
    (tx.operations || []).forEach((raw, oi) => {
      let name, payload;
      if (Array.isArray(raw)) [name, payload] = raw;
      else if (raw && raw.type) { name = String(raw.type).replace(/_operation$/, ''); payload = raw.value; }
      if (name === 'comment' && payload) out.push({ op: payload, trxId, opIndex: oi });
    });
  });
  return out;
}

/** Cheap pre-filter before the handler: could this comment be addressed to Hathor at all? */
export function mightConcernWitness(c, witness = 'hathor') {
  return String(c.parent_author || '').toLowerCase() === witness || mentionsWitness(c.body, witness);
}

// ---- the watcher -----------------------------------------------------------------------------------

/**
 * @param {object} cfg
 * @param {Function} cfg.rpc          makeRpc() instance
 * @param {object}   cfg.registry     lesson registry
 * @param {object}   cfg.store        createStore()
 * @param {object}   [cfg.handlerDeps] extra deps merged into handleLessonComment (tests inject everything)
 * @param {boolean}  [cfg.broadcast]  false = dry-run (default)
 * @param {Function} [cfg.broadcastOps] async (ops) => result  (MELEK-Signer; required when broadcast)
 * @param {Function} [cfg.log]        line logger
 * @param {Function} [cfg.logJson]    structured logger for the dry-run/broadcast record
 * @param {Function} [cfg.sleep]
 */
export function createWatcher(cfg) {
  const { rpc, registry, store } = cfg;
  const witness = registry.witness || 'hathor';
  const broadcast = Boolean(cfg.broadcast);
  const log = cfg.log || (() => {});
  const logJson = cfg.logJson || (() => {});
  const sleep = cfg.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const deps = {
    registry,
    limiter: createCallLimiter(),
    resolveRoot: async (author, permlink) => {
      const d = await rpc('condenser_api.get_content', [author, permlink]);
      return d ? { root_author: d.root_author, root_permlink: d.root_permlink } : null;
    },
    ...(cfg.handlerDeps || {}),
  };
  let stopping = false;

  async function handleOne({ op, trxId, opIndex }, blockNum) {
    const c = normalizeCommentOp(op);
    if (!c || !mightConcernWitness(c, witness)) return null;
    const key = `${String(c.author).toLowerCase()}/${c.permlink}`;
    if (store.has(key)) return { skipped: 'already processed', key };
    const out = await handleLessonComment(c, deps);
    const record = {
      at: new Date().toISOString(), block: blockNum, trx: trxId, op: opIndex, key,
      mode: broadcast ? 'broadcast' : 'dry-run',
      kind: out.kind, intent: out.intent ?? null, lang: out.lang ?? null, replyLang: out.replyLang ?? null,
      lesson: out.lessonId ?? null, lessonSource: out.lessonSource ?? null, trigger: out.trigger ?? null,
      check: out.check ?? null, answerVia: out.answerVia ?? null, error: out.error ?? null,
      ops: out.ops || [],
    };
    if (out.kind === 'ignored') { store.add(key); return record; }
    if (!out.ops || !out.ops.length) { store.add(key); logJson(record); return record; }
    if (!broadcast) {
      logJson({ ...record, would_broadcast: true });
      store.add(key);
      return record;
    }
    try {
      const res = await cfg.broadcastOps(out.ops);
      const txId = res && (res.id || res.trx_id || res.tx_id) ? String(res.id || res.trx_id || res.tx_id) : null;
      if (typeof out.commit === 'function') await out.commit({ txId });
      logJson({ ...record, broadcast: true, txId });
      store.add(key);
    } catch (err) {
      // Not marked processed: a transient signer failure is retried on the next pass over this block.
      logJson({ ...record, broadcast: false, error: String(err && err.message ? err.message : err).slice(0, 300) });
      throw err;
    }
    return record;
  }

  // A flaky transport (an SSH-tunnelled node drops the odd connection under catch-up load) should cost a
  // short retry of one block, not a backoff of the whole stream.
  async function fetchBlock(n, attempts = 3) {
    let last = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const block = await rpc('condenser_api.get_block', [n]);
        if (block) return block;
        last = new Error(`block ${n} not available`);
      } catch (err) { last = err; }
      if (i < attempts - 1) await sleep(250 * (i + 1));
    }
    const cause = last && last.cause ? ` (${last.cause.code || last.cause.message})` : '';
    throw new Error(`${last && last.message ? last.message : 'get_block failed'}${cause} at block ${n}`);
  }

  async function processBlock(n, prefetched = null) {
    const block = prefetched || await fetchBlock(n);
    const results = [];
    for (const item of commentOpsIn(block)) {
      try { const r = await handleOne(item, n); if (r) results.push(r); } catch (err) {
        if (broadcast) throw err; // retry the block
        log(`[lesson-watcher] op error in block ${n}: ${String(err && err.message ? err.message : err)}`);
      }
    }
    return results;
  }

  // Finality. 'irreversible' (default) follows last_irreversible_block_num. If the chain's finality has
  // STALLED (LIB far behind head — too few witnesses confirming), that stream goes silent; 'head' follows
  // head − lag instead (a reorg can then drop a block we already answered — harmless for a dry run, and a
  // reply to a vanished comment simply fails on chain). The stall is logged either way.
  const finality = cfg.finality || 'irreversible';
  const headLag = Math.max(0, Number(cfg.headLag ?? 30));
  const stallBlocks = Number(cfg.stallBlocks ?? 1200); // ~1 hour of 3-second blocks
  let lastStallLog = 0;
  async function lastIrreversible() {
    const g = await rpc('condenser_api.get_dynamic_global_properties', []);
    const lib = Number(g && g.last_irreversible_block_num);
    const head = Number(g && g.head_block_number);
    if (!Number.isFinite(lib) || lib <= 0) throw new Error('no last_irreversible_block_num');
    if (Number.isFinite(head) && head - lib > stallBlocks && Date.now() - lastStallLog > 3_600_000) {
      lastStallLog = Date.now();
      log(`[lesson-watcher] WARNING: chain finality stalled — head ${head}, last irreversible ${lib} (${head - lib} blocks behind)${finality === 'head' ? `; following head-${headLag}` : ''}`);
    }
    if (finality === 'head' && Number.isFinite(head)) return Math.max(lib, head - headLag);
    return lib;
  }

  /** Catch up to the current irreversible block. Returns the number of blocks processed. */
  async function catchUp({ from = null, maxBlocks = Infinity } = {}) {
    const lib = await lastIrreversible();
    let n = from ?? (store.cursor != null ? store.cursor + 1 : lib);
    let count = 0;
    // Blocks are FETCHED `concurrency` at a time (catch-up over a tunnel is latency-bound) but always
    // PROCESSED strictly in order, and the cursor only advances past a fully handled block.
    const concurrency = Math.max(1, Number(cfg.concurrency) || 8);
    while (n <= lib && count < maxBlocks && !stopping) {
      const span = Math.min(concurrency, lib - n + 1, maxBlocks - count);
      const blocks = await Promise.all(Array.from({ length: span }, (_, i) => fetchBlock(n + i)));
      for (let i = 0; i < span && !stopping; i++) {
        await processBlock(n, blocks[i]);
        store.setCursor(n);
        count++;
        if (count % 200 === 0) { store.save(); log(`[lesson-watcher] catching up: cursor=${n} target=${lib}`); }
        n++;
      }
    }
    store.save();
    return { processed: count, cursor: store.cursor, lib };
  }

  /** Stream forever with exponential backoff (cap 60 s) on trouble. */
  async function run({ from = null, pollMs = 3000 } = {}) {
    let backoff = 1000;
    let first = true;
    while (!stopping) {
      try {
        const r = await catchUp({ from: first ? from : null });
        first = false;
        backoff = 1000;
        if (r.processed) log(`[lesson-watcher] cursor=${r.cursor} lib=${r.lib} (+${r.processed})`);
        await sleep(pollMs);
      } catch (err) {
        log(`[lesson-watcher] ${String(err && err.message ? err.message : err)} — retry in ${Math.round(backoff / 1000)}s`);
        await sleep(backoff);
        backoff = Math.min(60_000, backoff * 2);
      }
    }
  }

  return { run, catchUp, processBlock, handleOne, stop: () => { stopping = true; }, deps };
}

/**
 * Broadcast ops ONE PER TRANSACTION, the shape the live signer path is proven with (the curation
 * runner's single-op votes; the Studio announcement's single-op comment). The reward is the vote: if the
 * vote lands, the lesson is recorded even when the reply comment fails (a retry would only re-vote,
 * which the chain refuses). With no vote in the set, any failure throws so the block is retried.
 * @param {Array} ops
 * @param {(ops:Array)=>Promise<object>} send
 */
export async function broadcastEach(ops, send) {
  const results = [];
  for (const op of ops) {
    try { results.push({ op: op[0], ok: true, result: await send([op]) }); } catch (err) {
      results.push({ op: op[0], ok: false, error: String(err && err.message ? err.message : err).slice(0, 200) });
    }
  }
  const vote = results.find((r) => r.op === 'vote');
  if (vote && !vote.ok) throw new Error(`vote failed: ${vote.error}`);
  if (!vote && !results.some((r) => r.ok)) throw new Error(`broadcast failed: ${results.map((r) => r.error).join('; ')}`);
  const first = (vote && vote.ok ? vote : results.find((r) => r.ok)) || {};
  return { id: first.result && (first.result.id || first.result.trx_id) || null, results };
}

// ---- CLI -------------------------------------------------------------------------------------------

function arg(name, def = null) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rpcUrl = process.env.MELEK_RPC_URL || 'https://melek.salon/rpc';
  const stateDir = process.env.LESSON_WATCH_DIR || path.join(__dirname, '.lesson-watch');
  const broadcast = process.argv.includes('--broadcast');
  const registry = loadRegistry({ dir: process.env.INSTRUCTIONAL_DIR });
  const log = (m) => process.stdout.write(`${m}\n`);
  const logJson = (o) => {
    const line = JSON.stringify(o);
    process.stdout.write(`${line}\n`);
    try { mkdirSync(stateDir, { recursive: true }); appendFileSync(path.join(stateDir, broadcast ? 'broadcast.jsonl' : 'dry-run.jsonl'), `${line}\n`); } catch { /* soft */ }
  };
  const rpc = makeRpc({ url: rpcUrl });
  const brain = createLessonBrain({ log });
  // Dry-run keeps a SEPARATE progress file so a dry run can never mark a lesson done for real.
  const state = new TutorialState({ path: path.join(stateDir, broadcast ? 'progress.json' : 'progress.dry-run.json') });
  let siteMap = '';
  try { siteMap = readFileSync(process.env.HATHOR_SITE_MAP || path.join(__dirname, '..', 'knowledge', 'ecosystem', 'hathor-site-map.md'), 'utf8'); } catch { /* optional */ }

  let broadcastOps = null;
  if (broadcast) {
    const token = process.env.MELEK_SIGNER_TOKEN;
    if (!token) { log('[lesson-watcher] --broadcast needs MELEK_SIGNER_TOKEN (token NOT logged). Refusing to start.'); process.exit(2); }
    const { signerBroadcast } = await import('../autovote/signer-castvote.mjs');
    broadcastOps = (ops) => broadcastEach(ops, (one) => signerBroadcast({ token, ops: one, signerUrl: process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon', clientId: 'lesson-loop', role: 'posting' }));
  }

  const handlerDeps = {
    brain, state, siteMap,
    fetchUserActivity: (account) => fetchUserActivity(account, { rpcUrl }),
  };
  const store = createStore(stateDir);
  const w = createWatcher({ rpc, registry, store, handlerDeps, broadcast, broadcastOps, log, logJson,
    finality: process.env.LESSON_WATCH_FINALITY || 'irreversible', headLag: Number(process.env.LESSON_WATCH_HEAD_LAG || 30),
    concurrency: Number(process.env.LESSON_WATCH_CONCURRENCY || 8) });
  log(`[lesson-watcher] ${broadcast ? 'BROADCAST' : 'DRY-RUN'} rpc=${rpcUrl} lessons=${registry.size} strict=${String(process.env.STRICT_ORDER ?? '1') !== '0'} llm=${brain.enabled ? 'on' : 'off'}${registry.errors.length ? ` registry-errors=${registry.errors.length}` : ''}`);

  if (process.argv.includes('--probe')) {
    // One synthetic comment on a lesson, checked against the account's REAL chain activity. Dry-run only.
    const account = arg('account');
    const lesson = registry.byNumber(Number(arg('lesson', '1')));
    if (!account || !lesson) { log('usage: --probe --account=NAME --lesson=N [--text=...]'); process.exit(2); }
    const op = { author: account, permlink: `probe-${Date.now()}`, parent_author: registry.witness, parent_permlink: lesson.permlink, body: arg('text', 'done, please check') };
    const probeState = new TutorialState({ path: path.join(stateDir, 'progress.probe.json') });
    const out = await handleLessonComment(op, { ...w.deps, state: probeState, strictOrder: process.argv.includes('--strict') });
    const { commit, ...printable } = out;
    logJson({ probe: true, mode: 'dry-run', account, lesson: lesson.id, kind: out.kind, intent: out.intent, lang: out.lang, check: out.check, ops: out.ops || [] });
    void printable; void commit;
    process.exit(0);
  }

  const stop = () => { w.stop(); store.save(); };
  process.on('SIGTERM', () => { stop(); process.exit(0); });
  process.on('SIGINT', () => { stop(); process.exit(0); });
  const from = arg('from') ? Number(arg('from')) : null;
  if (process.argv.includes('--once')) {
    const r = await w.catchUp({ from, maxBlocks: Number(arg('max', 'Infinity')) });
    log(`[lesson-watcher] once: processed ${r.processed} block(s), cursor=${r.cursor}, lib=${r.lib}`);
  } else {
    await w.run({ from, pollMs: Number(process.env.LESSON_WATCH_POLL_MS || 3000) });
  }
}
