// cheetah/live-loop.mjs — the generic live-chain Cheetah SCAN LOOP (#265).
//
// WHY THIS EXISTS
//   watch.mjs is the concrete read-only testnet watch: it hard-wires the
//   condenser reader, the shingle/Jaccard plagiarism engine, the shared store,
//   and the alpha-report surface. THIS module is the generic, dependency-injected
//   spine underneath that idea: hand it ANY reader, ANY set of detectors, and ANY
//   sink (the flag-pipe), and it will, on each tick:
//
//     1. Pull recent posts via the INJECTED reader (read-only; soft-fails to []).
//     2. Skip posts it has already seen (an in-loop seen-set, so each post is
//        processed exactly once across ticks — idempotent).
//     3. Run each fresh post's text through EVERY injected detector. A detector is
//        anything with a `detect(text) -> flag|null` (or `{flag}`) method — the
//        exact shape scam-detect.mjs / toxicity-detect.mjs already expose. Any
//        detector that throws is skipped; one bad detector never sinks the tick.
//     4. Route every produced flag to the injected sink (the flag-pipe's fileFlag,
//        or any `(flag) -> any` function / `{ file(flag) }` object). The post's
//        identity (author/permlink) is attached as `target` + `reporter` so the
//        flag is self-describing in a review queue.
//
// HARD INVARIANTS
//   - READ-ONLY: the loop never broadcasts / votes / signs / posts. It reads posts
//     and emits advisory flags. Resolution is Hathor's job (CHEETAH_ADVANCED.md).
//   - NO NETWORK / NO KEYS in this file: every outside edge (reader, detectors,
//     sink, clock, timers) is injected. The defaults are inert.
//   - SOFT-FAIL-NEVER-THROW: a down reader, a throwing detector, a throwing sink,
//     a malformed post — none of them escape a tick. They are counted as errors
//     and the loop keeps running.
//   - BOUNDED: at most `maxPerTick` posts processed per tick, and the seen-set is
//     trimmed to `maxSeen` entries so a long-running loop can't grow unbounded.
//
// USAGE
//   import { makeScanLoop } from './cheetah/live-loop.mjs';
//   import { detectScam } from './cheetah/scam-detect.mjs';
//   import { detectToxicity } from './cheetah/toxicity-detect.mjs';
//   const loop = makeScanLoop({
//     reader: { fetchRecentPosts: () => rpcGetRecent() },     // read-only seam
//     detectors: [
//       { kind: 'scam', detect: (t) => detectScam(t).flag },
//       { kind: 'toxicity', detect: (t) => detectToxicity(t).flag },
//     ],
//     sink: (flag) => fileFlag(flag),                          // the flag-pipe
//     intervalMs: 300000,
//   });
//   await loop.tick();   // one pass, returns a summary
//   loop.start();        // poll forever on the interval
//   loop.stop();         // clear the timer

// ── esc(): HTML-escape any value that may be rendered in a review-queue UI ──────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── injectable seams ─────────────────────────────────────────────────────────
// The loop takes everything by constructor injection, but we also expose the
// classic __set* seams for symmetry with the rest of the repo + ad-hoc test
// overrides. These set MODULE-level fallbacks used only when a makeScanLoop()
// call omits the corresponding option.
let _defaultFetch = null;        // __setFetch — unused on the offline path
let _defaultReader = null;       // __setReader
let _defaultStore = null;        // __setStore (a sink-like store; unused by default)
let _defaultClient = null;       // __setClient
let _defaultCrypto = null;       // __setCrypto

export function __setFetch(fn) { _defaultFetch = fn || null; }
export function __setReader(r) { _defaultReader = r || null; }
export function __setStore(s) { _defaultStore = s || null; }
export function __setClient(c) { _defaultClient = c || null; }
export function __setCrypto(c) { _defaultCrypto = c || null; }
export function __resetSeams() {
  _defaultFetch = null;
  _defaultReader = null;
  _defaultStore = null;
  _defaultClient = null;
  _defaultCrypto = null;
}

// ── helpers ──────────────────────────────────────────────────────────────────

// Build a stable identity for a post. Falls back gracefully on odd shapes.
function postKey(p) {
  if (!p || typeof p !== 'object') return null;
  const a = p.author != null ? String(p.author) : '';
  const pl = p.permlink != null ? String(p.permlink) : (p.id != null ? String(p.id) : '');
  if (!a && !pl) return null;
  return `${a}/${pl}`;
}

// Extract the text a detector should look at. Posts may carry `body`, `text`,
// `content`, or be a bare string. Anything else → empty string (no detector run).
function postText(p) {
  if (typeof p === 'string') return p;
  if (!p || typeof p !== 'object') return '';
  for (const k of ['body', 'text', 'content', 'message']) {
    if (typeof p[k] === 'string') return p[k];
  }
  return '';
}

// Normalize whatever a reader returns into an array (read-only; never throws).
function asPostArray(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.posts)) return v.posts;
  if (v && Array.isArray(v.results)) return v.results;
  return [];
}

// Pull recent posts from an injected reader. A reader may be:
//   • a function:               () => posts | {posts} | Promise<…>
//   • { fetchRecentPosts() }    (the watch.mjs / alpha-report shape)
//   • { getRecent() } / { recent() } / { read() }
// Read-only, soft-fails to { posts:[], error } — never throws.
async function readPosts(reader) {
  if (!reader) return { posts: [], error: 'no reader' };
  try {
    let raw;
    if (typeof reader === 'function') raw = await reader();
    else if (typeof reader.fetchRecentPosts === 'function') raw = await reader.fetchRecentPosts();
    else if (typeof reader.getRecent === 'function') raw = await reader.getRecent();
    else if (typeof reader.recent === 'function') raw = await reader.recent();
    else if (typeof reader.read === 'function') raw = await reader.read();
    else return { posts: [], error: 'reader has no recognized read method' };
    return { posts: asPostArray(raw), error: raw && raw.error ? String(raw.error) : null };
  } catch (e) {
    return { posts: [], error: e && e.message ? e.message : String(e) };
  }
}

// Run ONE detector against text. A detector is `{ detect(text) -> flag|null }`
// or a bare `(text) -> flag|null` function. `flag` may itself be `{ flag, ... }`
// (the detectScam/detectToxicity return shape) — we unwrap it. Returns the flag
// object or null. NEVER throws.
function runDetector(detector, text) {
  try {
    const fn = typeof detector === 'function'
      ? detector
      : (detector && typeof detector.detect === 'function' ? detector.detect.bind(detector) : null);
    if (!fn) return null;
    let out = fn(text);
    if (out == null) return null;
    // unwrap the {score, signals, flag} envelope if present
    if (typeof out === 'object' && 'flag' in out && !('kind' in out) && !('severity' in out)) {
      out = out.flag;
    }
    if (out == null) return null;
    if (typeof out !== 'object') return { kind: 'flag', reason: String(out) };
    return out;
  } catch {
    return null; // a throwing detector is simply skipped this tick
  }
}

// Route ONE flag to an injected sink. A sink may be:
//   • a function:        (flag) => any
//   • { file(flag) }     (an object wrapping fileFlag)
//   • { fileFlag(flag) } (the integrations/flag-pipe export shape)
//   • { push(flag) }     (a capturing array-like)
// Returns true on a clean route, false on (swallowed) error. NEVER throws.
async function routeFlag(sink, flag) {
  if (!sink || !flag) return false;
  try {
    if (typeof sink === 'function') { await sink(flag); return true; }
    if (typeof sink.fileFlag === 'function') { await sink.fileFlag(flag); return true; }
    if (typeof sink.file === 'function') { await sink.file(flag); return true; }
    if (typeof sink.push === 'function') { sink.push(flag); return true; }
    return false;
  } catch {
    return false; // a throwing sink must not stop the loop
  }
}

/**
 * Build a live-chain Cheetah scan loop.
 *
 * @param {object} opts
 * @param {Function|object} opts.reader       INJECTED read-only post source.
 * @param {Array} opts.detectors              detectors, each `{detect(text)->flag}` or a fn.
 * @param {Function|object} opts.sink          the flag-pipe (or any sink, see routeFlag).
 * @param {number} [opts.intervalMs=300000]    start()'s poll period in ms.
 * @param {number} [opts.maxPerTick=50]        cap on posts processed per tick (bounded).
 * @param {number} [opts.maxSeen=10000]        cap on the seen-set (trimmed when exceeded).
 * @param {Function} [opts.now]                clock injection (() => Date) for tests.
 * @param {Function} [opts.setTimer]           timer injection (default setInterval).
 * @param {Function} [opts.clearTimer]         timer injection (default clearInterval).
 * @param {Function} [opts.onTick]             optional callback given each tick summary.
 * @returns {{ tick: Function, start: Function, stop: Function, seenSize: Function, running: Function }}
 */
export function makeScanLoop(opts = {}) {
  const {
    reader = _defaultReader,
    detectors = [],
    sink = _defaultStore,
    intervalMs = 300000,
    maxPerTick = 50,
    maxSeen = 10000,
    now = () => new Date(),
    setTimer = (fn, ms) => setInterval(fn, ms),
    clearTimer = (h) => clearInterval(h),
    onTick = null,
  } = opts;

  const dets = Array.isArray(detectors) ? detectors : (detectors ? [detectors] : []);
  const seen = new Set();
  let timer = null;
  let ticking = false;

  function trimSeen() {
    if (seen.size <= maxSeen) return;
    // drop oldest insertions until back under the cap (Set preserves insert order)
    const over = seen.size - maxSeen;
    let i = 0;
    for (const k of seen) {
      if (i++ >= over) break;
      seen.delete(k);
    }
  }

  /**
   * One read-only poll pass. Soft-fails internally; resolves to a summary and
   * never rejects.
   * @returns {Promise<{scanned, fresh, flags, routed, errors, readError, at}>}
   */
  async function tick() {
    const at = (() => { try { return now().toISOString(); } catch { return null; } })();
    const { posts, error: readError } = await readPosts(reader);

    let scanned = 0;
    let fresh = 0;
    let flags = 0;
    let routed = 0;
    let errors = 0;

    // bound the work per tick
    const batch = posts.slice(0, Math.max(0, maxPerTick));

    for (const post of batch) {
      scanned += 1;
      const key = postKey(post);
      // unidentifiable posts can't be deduped safely — skip rather than re-flag forever
      if (key == null) { errors += 1; continue; }
      if (seen.has(key)) continue;
      seen.add(key);
      fresh += 1;

      const text = postText(post);
      if (!text) continue;

      for (const det of dets) {
        const raw = runDetector(det, text);
        if (!raw) continue;
        // attach post identity + a stable reporter so the flag is self-describing.
        const detKind = (typeof det === 'object' && det && det.kind) ? String(det.kind) : (raw.kind || 'flag');
        const flag = {
          ...raw,
          kind: raw.kind || detKind,
          target: raw.target || key,
          reporter: raw.reporter || `cheetah:${detKind}`,
        };
        flags += 1;
        const ok = await routeFlag(sink, flag);
        if (ok) routed += 1; else errors += 1;
      }
    }

    trimSeen();

    const summary = { scanned, fresh, flags, routed, errors, readError: readError || null, at };
    if (typeof onTick === 'function') {
      try { onTick(summary); } catch { /* onTick is advisory; never let it break a tick */ }
    }
    return summary;
  }

  function start() {
    if (timer != null) return false; // already running — idempotent
    ticking = true;
    // guarded tick; the interval keeps calling it. Returns the (caught) promise
    // so a caller that fires it manually can await completion.
    const guarded = () => tick().catch(() => {});
    timer = setTimer(guarded, intervalMs);
    return true;
  }

  function stop() {
    if (timer == null) { ticking = false; return false; }
    try { clearTimer(timer); } catch { /* ignore */ }
    timer = null;
    ticking = false;
    return true;
  }

  return {
    tick,
    start,
    stop,
    seenSize: () => seen.size,
    running: () => ticking && timer != null,
  };
}

// ---- CLI (guarded) ----------------------------------------------------------
// There is no real reader/sink to wire here without keys/network, so the CLI is
// a self-check: it builds a loop over an inert fake reader + capturing sink and
// prints one tick summary. Proves the wiring offline; broadcasts nothing.
async function main() {
  const captured = [];
  const loop = makeScanLoop({
    reader: () => [
      { author: 'alice', permlink: 'p1', body: 'send 1 ETH and get 2 ETH back, DM me now' },
      { author: 'bob', permlink: 'p2', body: 'a perfectly ordinary post about gardening' },
    ],
    detectors: [
      { kind: 'demo', detect: (t) => /2 ETH back/i.test(t) ? { severity: 4, reason: 'doubler bait' } : null },
    ],
    sink: (f) => captured.push(f),
  });
  const r = await loop.tick();
  console.log(`[cheetah-live-loop] ${JSON.stringify(r)}`);
  console.log(`[cheetah-live-loop] captured ${captured.length} flag(s): ${captured.map((f) => esc(f.target)).join(', ')}`);
}

const isCli =
  import.meta.url.startsWith('file:') &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop());

if (isCli) {
  main().catch((err) => {
    console.error(`cheetah/live-loop.mjs fatal: ${err.message}`);
    process.exit(1);
  });
}
