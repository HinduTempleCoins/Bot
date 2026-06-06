// measure.mjs — "Measure my device" 30-second hashrate benchmark + honest earnings estimate.
//
// REUSES the existing miner stack: it spawns the SAME Web Workers (miner-worker.mjs) that
// real mining uses and runs them against a synthetic-but-real RandomX job for a fixed
// window. It does LOCAL-ONLY hashing — there is no WebSocket, no stratum login, no share
// submission, and therefore no payout address is required. The worker just hashes and
// reports periodic `hashrate` samples; we aggregate them into a steady H/s for the device.
//
// Honest by construction: nothing here mines to anyone or claims a share. It only measures
// how fast THIS device computes RandomX, then translates that into an openly-labelled,
// fractions-of-a-cent earnings estimate using the live pool/network numbers from the stats
// API. Facts, not hype.
//
// Pure helpers (benchmark math + earnings formula + a synthetic job builder) are exported
// for unit tests and have no DOM/Worker dependency. The DOM hook (initMeasure) is a no-op
// when its card is absent, so the module imports cleanly under node --test.

// ---- pure: a synthetic-but-real RandomX job for local hashing ------------------------
// The worker needs { blob, seed_hash, target, job_id, lane }. For a benchmark we want it
// to NEVER find a share (so it never tries to post one and we measure raw hashing), so we
// hand it the hardest possible target (0). The blob/seed are real-shaped (valid hex of the
// right lengths) so randomx initialises and hashes exactly as in production.
export function syntheticJob({ lane = { offset: 0, stride: 1 } } = {}) {
  return {
    blob: 'ab'.repeat(76),        // 152 hex chars = 76-byte hashing blob (Monero shape)
    seed_hash: 'cd'.repeat(32),   // 64 hex chars = 32-byte RandomX key
    target: 0,                    // uint32 already-parsed; 0 = impossible to beat => no shares
    job_id: 'benchmark',
    lane,
  };
}

// ---- pure: benchmark aggregation -----------------------------------------------------
// Given the per-worker latest H/s readings, return total H/s and thread count. Mirrors the
// aggregation BrowserMiner does, kept pure here so the benchmark math is unit-tested.
export function aggregateHashrate(byWorker) {
  const vals = byWorker instanceof Map ? [...byWorker.values()] : Object.values(byWorker || {});
  const total = vals.reduce((s, v) => s + (Number(v) || 0), 0);
  return { total, threads: vals.length };
}

// Take a series of total-H/s samples collected over the benchmark window and return a
// stable figure: the median of the steady-state samples (drop the first sample, which is
// warm-up while the RandomX cache builds). Median resists a single spiky reading.
export function steadyHashrate(samples) {
  const xs = (samples || []).map(Number).filter((x) => Number.isFinite(x) && x >= 0);
  if (xs.length === 0) return 0;
  const steady = xs.length > 2 ? xs.slice(1) : xs; // drop warm-up sample when we have enough
  const sorted = [...steady].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---- pure: the honest earnings estimate ---------------------------------------------
// Expected coin earnings per day for a miner doing `myHashrate` H/s on a network of
// `networkHashrate` H/s, given the per-block `blockReward` (in coin units), the average
// seconds between blocks (`blockTime`), and the pool fee (percent). Returns coin/day.
//
//   blocks/day              = 86400 / blockTime
//   coins minted/day        = blocksPerDay * blockReward
//   your share of network   = myHashrate / networkHashrate
//   your gross coins/day    = mintedPerDay * yourShare
//   after pool fee          = gross * (1 - feePercent/100)
//
// Any missing/zero input that would make the estimate meaningless yields null (we then say
// "can't estimate yet" rather than inventing a number).
export function estimateEarnings({ myHashrate, networkHashrate, blockReward, blockTime, poolFeePercent = 0, priceUsd = null }) {
  const h = Number(myHashrate);
  const net = Number(networkHashrate);
  const reward = Number(blockReward);
  const bt = Number(blockTime);
  if (!(h > 0) || !(net > 0) || !(reward > 0) || !(bt > 0)) return null;
  const blocksPerDay = 86400 / bt;
  const mintedPerDay = blocksPerDay * reward;
  const share = h / net;
  const grossCoinPerDay = mintedPerDay * share;
  const fee = Math.min(100, Math.max(0, Number(poolFeePercent) || 0));
  const coinPerDay = grossCoinPerDay * (1 - fee / 100);
  const out = {
    sharePpm: share * 1e6,            // your share of the network, parts-per-million
    coinPerDay,
    coinPerMonth: coinPerDay * 30,
    usdPerDay: null,
    usdPerMonth: null,
  };
  const p = Number(priceUsd);
  if (p > 0) {
    out.usdPerDay = coinPerDay * p;
    out.usdPerMonth = out.coinPerDay * p * 30;
  }
  return out;
}

// Format a tiny USD amount honestly: fractions of a cent get shown as such, never rounded
// up to "$0.00" (which reads as "nothing") or hyped. e.g. 0.0003 -> "$0.0003 (about 0.03¢)".
export function fmtUsd(usd) {
  if (usd == null || !Number.isFinite(Number(usd))) return null;
  const n = Number(usd);
  if (n === 0) return '$0';
  if (n < 0.01) {
    const cents = n * 100;
    return `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} (about ${cents.toFixed(cents < 0.01 ? 4 : 2)}¢)`;
  }
  return `$${n.toFixed(2)}`;
}

export function fmtHs(h) {
  h = Number(h) || 0;
  const u = ['H/s', 'KH/s', 'MH/s', 'GH/s'];
  let i = 0;
  while (h >= 1000 && i < u.length - 1) { h /= 1000; i++; }
  return `${h.toFixed(2)} ${u[i]}`;
}

// ---- pure: pull network numbers out of a pool stats payload --------------------------
// Tolerates Miningcore's nested {pool:{...}} and a flat shape. Returns the inputs
// estimateEarnings needs, with nulls where the API doesn't give them.
export function networkInputsFromPool(poolPayload) {
  const p = (poolPayload && (poolPayload.pool || poolPayload)) || {};
  const net = p.networkStats || {};
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (v != null && Number.isFinite(Number(v)) ? Number(v) : null));
  return {
    networkHashrate: num(net.networkHashrate),
    blockReward: num(net.reward) ?? num(p.blockReward) ?? num(net.blockReward),
    blockTime: num(net.blockTime) ?? num(p.coin && p.coin.blockTime),
    poolFeePercent: num(p.poolFeePercent) ?? 0,
    poolHashrate: num(p.poolStats && p.poolStats.poolHashrate),
    symbol: (p.coin && (p.coin.symbol || p.coin.type) || '').toUpperCase() || null,
  };
}

// =====================================================================================
// DOM hook — runs the real worker pool locally for a fixed window, then renders the
// readout + earnings estimate. No WebSocket, no address, no submission.
// =====================================================================================

const BENCH_MS = 30000;       // fixed 30-second window
const WORKER_URL = new URL('./miner-worker.mjs', import.meta.url).href;

function pickThreads(requested) {
  if (requested > 0) return requested;
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(hc - 1, 8)); // same policy as BrowserMiner.threadCount()
}

// Run the benchmark: spawn N module workers, feed each the synthetic job + start, collect
// total-H/s samples for durationMs, then stop+terminate. Returns { hashrate, threads }.
// `deps` lets tests inject a fake Worker + timers; defaults use the real ones.
export function runBenchmark({ threads = 0, durationMs = BENCH_MS, onSample, deps = {} } = {}) {
  const WorkerImpl = deps.WorkerImpl || (typeof Worker !== 'undefined' ? Worker : null);
  const now = deps.now || (() => Date.now());
  const setTimer = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const setInt = deps.setInterval || ((fn, ms) => setInterval(fn, ms));
  const clrInt = deps.clearInterval || ((id) => clearInterval(id));
  if (!WorkerImpl) return Promise.reject(new Error('Web Workers unavailable in this environment'));

  const n = pickThreads(threads);
  const byWorker = new Map();
  const samples = [];
  const workers = [];

  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      for (const w of workers) { try { w.postMessage({ type: 'stop' }); w.terminate(); } catch {} }
    };
    try {
      for (let i = 0; i < n; i++) {
        const w = new WorkerImpl(WORKER_URL, { type: 'module' });
        const idx = i;
        w.onmessage = (e) => {
          const m = e.data || {};
          if (m.type === 'hashrate') byWorker.set(idx, m.hs);
          // benchmark never finds shares (target=0); ignore any 'share' just in case.
        };
        w.postMessage({ type: 'throttle', value: 1 }); // full speed for a true measurement
        w.postMessage({ type: 'job', job: syntheticJob({ lane: { offset: i, stride: n } }) });
        w.postMessage({ type: 'start' });
        workers.push(w);
      }
    } catch (e) { cleanup(); reject(e); return; }

    const startedAt = now();
    const sampler = setInt(() => {
      const { total } = aggregateHashrate(byWorker);
      samples.push(total);
      if (onSample) { try { onSample({ total, threads: n, elapsedMs: now() - startedAt }); } catch {} }
    }, 1000);

    setTimer(() => {
      if (finished) return;
      finished = true;
      clrInt(sampler);
      cleanup();
      resolve({ hashrate: steadyHashrate(samples), threads: n, samples });
    }, durationMs);
  });
}

const $ = (s) => (typeof document !== 'undefined' ? document.querySelector(s) : null);

// Fetch one pool's live stats so we can build an honest earnings estimate. Best-effort:
// returns null on any failure (the UI then says it can't estimate yet).
async function fetchPoolStats(poolId, { fetchImpl, apiBase = '/api' } = {}) {
  const f = fetchImpl || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  if (!f || !poolId) return null;
  try {
    const res = await f(`${apiBase}/pools/${encodeURIComponent(poolId)}`, { headers: { accept: 'application/json' } });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export function initMeasure() {
  const runBtn = $('#mm-run');
  if (!runBtn) return; // card not on this page

  const statusEl = $('#mm-status');
  const hashEl = $('#mm-hashrate');
  const threadsEl = $('#mm-threads');
  const barEl = $('#mm-bar');
  const earnEl = $('#mm-earnings');

  const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    setStatus('measuring… (30s — keep this tab in front)');
    if (hashEl) hashEl.textContent = '…';
    if (earnEl) earnEl.innerHTML = '';

    let result;
    try {
      result = await runBenchmark({
        onSample: ({ total, threads, elapsedMs }) => {
          if (hashEl) hashEl.textContent = fmtHs(total);
          if (threadsEl) threadsEl.textContent = String(threads);
          if (barEl) barEl.style.width = `${Math.min(100, Math.round((elapsedMs / BENCH_MS) * 100))}%`;
        },
      });
    } catch (e) {
      setStatus('could not run the benchmark here: ' + (e.message || 'unknown'));
      runBtn.disabled = false;
      return;
    }

    if (hashEl) hashEl.textContent = fmtHs(result.hashrate);
    if (threadsEl) threadsEl.textContent = String(result.threads);
    if (barEl) barEl.style.width = '100%';
    setStatus(`measured on ${result.threads} thread${result.threads === 1 ? '' : 's'}`);

    // Honest earnings estimate from the live Monero pool numbers (the browser miner's coin).
    const poolId = runBtn.getAttribute('data-pool-id') || 'xmr-mainnet';
    const payload = await fetchPoolStats(poolId);
    const net = payload ? networkInputsFromPool(payload) : null;
    if (earnEl) earnEl.innerHTML = renderEstimateHtml(result.hashrate, net);
    runBtn.disabled = false;
  });
}

// Build the estimate block as HTML, clearly labelled as an estimate. Exported for tests.
export function renderEstimateHtml(hashrate, net) {
  if (!net || !net.networkHashrate || !net.blockReward || !net.blockTime) {
    return `<p class="muted" style="font-size:12.5px;margin:6px 0 0">` +
      `Live network numbers aren’t available right now, so we won’t guess what this earns. ` +
      `What we can say honestly: a browser miner is for <strong>participation</strong>, and any ` +
      `earnings are <strong>fractions of a cent a day</strong>.</p>`;
  }
  const est = estimateEarnings({ myHashrate: hashrate, ...net });
  if (!est) {
    return `<p class="muted" style="font-size:12.5px;margin:6px 0 0">Not enough live data to estimate earnings yet.</p>`;
  }
  const sym = net.symbol || 'coin';
  const coinDay = est.coinPerDay;
  const coinTxt = coinDay >= 0.000001 ? coinDay.toPrecision(2) : coinDay.toExponential(1);
  return `<div class="warn" style="margin-top:6px;font-size:12.5px">` +
    `<b>Estimate (not a promise):</b> at <strong>${fmtHs(hashrate)}</strong> you would be about ` +
    `<strong>${est.sharePpm.toFixed(3)} ppm</strong> of the ${sym} network. ` +
    `That works out to roughly <strong>${coinTxt} ${sym}/day</strong>` +
    ` &mdash; ` +
    `<strong>fractions of a cent</strong>. This is real participation, not a payday; actual ` +
    `payout depends on luck, pool fee, and the network changing constantly.</div>`;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMeasure);
  else initMeasure();
}
