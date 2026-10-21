// kulaswap-health.mjs — is the KulaSwap trading stack actually up?
//
// WHY THIS EXISTS. On 2026-10-20 12:45 the PRANA RPC went away and all four KulaSwap bots failed every
// run for 21 hours without anyone being told. The chain was fine and the bots were fine: a crash-looping
// witness on the PRANA box filled /var/log, the disk hit 100%, and the geth node behind
// rpc.prana.melek.salon could not start. The existing melek-trade-monitor watches the Angelicalist HIVE
// bot only, so nothing was looking at the KulaSwap side at all.
//
// This closes that blind spot. It answers three questions a human would ask:
//   1. Is the RPC answering, on the right chain, and is the head actually advancing?
//   2. Is each bot unit healthy, and has it run recently enough for its own schedule?
//   3. Are the pools still there and quoting?
// A bot that declines to trade is HEALTHY — "profit -119 bps under the 100 bps minimum" is the guard
// working. Only a failed unit, a stalled head, or an unreachable RPC is a problem.
//
// House style: ESM, injectable `fetch` and `readUnits` seams, soft-fail (never throws out of `collect`),
// no top-level network, CLI guarded by process.argv[1].
//
//   node integrations/kulaswap-health.mjs            # human-readable
//   node integrations/kulaswap-health.mjs --json     # machine-readable

const RPC_URL = process.env.PRANA_RPC_URL || 'https://rpc.prana.melek.salon';
const CHAIN_ID = 712217;
const FACTORY = '0xFb5B83ed7F54e5fa45ED528dbe2167bB0b93b1E6';

/** The four KulaSwap bots and how often each is scheduled, so "stale" means something per bot. */
export const BOTS = [
  { unit: 'kulabot-a', what: 'profit-only triangle arbitrage (wVKBT loop)', everyMin: 15 },
  { unit: 'kulabot-b', what: 'daily DCA 10 KULA to WPRANA', everyMin: 24 * 60 },
  { unit: 'kulabot-c', what: 'keep KULA/WPRANA at 50/50 by value', everyMin: 6 * 60 },
  { unit: 'kulabot-d', what: 'KULA/wVKBT grid, 3% steps of 20 KULA', everyMin: 30 },
];

const hex = (n) => '0x' + Number(n).toString(16);

/** One JSON-RPC call. Returns {result} or {error} — never throws. */
export async function rpc(method, params = [], { fetch: f = fetch, rpcUrl = RPC_URL } = {}) {
  try {
    const res = await f(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    });
    const j = await res.json().catch(() => ({}));
    if (j && j.error) return { error: (j.error && j.error.message) || 'rpc error' };
    return { result: j && j.result };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

/**
 * Is the node up, on the right chain, and moving? `prevBlock` (from the last run) turns a single
 * reading into a liveness check: same height twice in a row is a stalled node, which looks identical
 * to a healthy one if you only ask once.
 */
export async function checkRpc({ fetch: f = fetch, rpcUrl = RPC_URL, prevBlock = null } = {}) {
  const [bn, cid, syn] = await Promise.all([
    rpc('eth_blockNumber', [], { fetch: f, rpcUrl }),
    rpc('eth_chainId', [], { fetch: f, rpcUrl }),
    rpc('eth_syncing', [], { fetch: f, rpcUrl }),
  ]);
  if (bn.error) return { ok: false, reason: `RPC unreachable: ${bn.error}`, block: null };
  const block = Number.parseInt(bn.result, 16);
  const chainId = cid.result ? Number.parseInt(cid.result, 16) : null;
  const syncing = syn.result !== false && syn.result != null;
  if (!Number.isFinite(block)) return { ok: false, reason: 'RPC returned no block height', block: null };
  if (chainId !== CHAIN_ID) return { ok: false, reason: `wrong chain: got ${chainId}, want ${CHAIN_ID}`, block, chainId };
  if (prevBlock != null && block <= prevBlock) {
    return { ok: false, reason: `head has not advanced since the last check (still ${block})`, block, chainId, syncing };
  }
  return { ok: true, block, chainId, syncing };
}

/** Pools still deployed and quoting? Reads the factory rather than trusting a hard-coded pair list. */
export async function checkPools({ fetch: f = fetch, rpcUrl = RPC_URL } = {}) {
  const n = await rpc('eth_call', [{ to: FACTORY, data: '0x574f2ba3' }, 'latest'], { fetch: f, rpcUrl });
  if (n.error || !n.result || n.result === '0x') return { ok: false, reason: 'factory did not answer allPairsLength', pairs: 0 };
  const count = Number.parseInt(n.result, 16);
  let withLiquidity = 0;
  for (let i = 0; i < count; i += 1) {
    const p = await rpc('eth_call', [{ to: FACTORY, data: '0x1e3dd18b' + i.toString(16).padStart(64, '0') }, 'latest'], { fetch: f, rpcUrl });
    if (p.error || !p.result) continue;
    const pair = '0x' + p.result.slice(-40);
    const r = await rpc('eth_call', [{ to: pair, data: '0x0902f1ac' }, 'latest'], { fetch: f, rpcUrl });
    if (r.error || !r.result || r.result.length < 130) continue;
    const r0 = BigInt('0x' + r.result.slice(2, 66));
    const r1 = BigInt('0x' + r.result.slice(66, 130));
    if (r0 > 0n && r1 > 0n && r0 > 1000n && r1 > 1000n) withLiquidity += 1;
  }
  return { ok: withLiquidity > 0, pairs: count, withLiquidity, reason: withLiquidity ? null : 'no pair has liquidity' };
}

/**
 * Judge each bot. A unit that ran and chose not to trade is healthy; `failed`, or no run inside twice
 * its own schedule, is not. `now` is injectable so the staleness arithmetic is testable.
 */
export function assessBots(units, { now = Date.now(), bots = BOTS } = {}) {
  const byUnit = new Map((units || []).map((u) => [u.unit, u]));
  return bots.map((b) => {
    const u = byUnit.get(b.unit);
    if (!u) return { ...b, ok: false, reason: 'unit not found on the host' };
    if (u.activeState === 'failed' || u.subState === 'failed') {
      return { ...b, ok: false, reason: `unit failed${u.lastLine ? `: ${String(u.lastLine).slice(0, 160)}` : ''}` };
    }
    const ageMin = u.lastRunMs == null ? null : Math.round((now - u.lastRunMs) / 60000);
    if (ageMin != null && ageMin > b.everyMin * 2 + 10) {
      return { ...b, ok: false, ageMin, reason: `last ran ${ageMin} min ago, schedule is every ${b.everyMin} min` };
    }
    return { ...b, ok: true, ageMin, declined: u.declined === true };
  });
}

/** Everything, in one object. Never throws. */
export async function collect({ fetch: f = fetch, rpcUrl = RPC_URL, readUnits = async () => [], prevBlock = null, now = Date.now() } = {}) {
  const out = { at: new Date(now).toISOString(), rpcUrl, rpc: null, pools: null, bots: [], problems: [] };
  try {
    out.rpc = await checkRpc({ fetch: f, rpcUrl, prevBlock });
    if (!out.rpc.ok) out.problems.push(out.rpc.reason);
    // The pools can only be read through the RPC, so do not bother (or double-report) when it is down.
    if (out.rpc.ok) {
      out.pools = await checkPools({ fetch: f, rpcUrl });
      if (!out.pools.ok) out.problems.push(`pools: ${out.pools.reason}`);
    }
    const units = await readUnits().catch(() => []);
    out.bots = assessBots(units, { now });
    for (const b of out.bots) if (!b.ok) out.problems.push(`${b.unit}: ${b.reason}`);
  } catch (e) {
    out.problems.push(`monitor itself failed: ${String((e && e.message) || e)}`);
  }
  out.ok = out.problems.length === 0;
  return out;
}

/** Short human report — the thing a person reads at 3am. */
export function formatReport(s) {
  const L = [];
  L.push(s.ok ? '✓ KulaSwap trading stack healthy' : `✗ KulaSwap: ${s.problems.length} problem(s)`);
  if (s.rpc) L.push(`  RPC   ${s.rpc.ok ? `block ${s.rpc.block}${s.rpc.syncing ? ' (syncing)' : ''}` : s.rpc.reason}`);
  if (s.pools) L.push(`  pools ${s.pools.withLiquidity}/${s.pools.pairs} with liquidity`);
  for (const b of s.bots || []) {
    L.push(`  ${b.ok ? '·' : '!'} ${b.unit.padEnd(10)} ${b.ok ? `ok${b.ageMin != null ? ` (${b.ageMin}m ago)` : ''}` : b.reason}`);
  }
  for (const p of s.problems || []) L.push(`  → ${p}`);
  return L.join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('kulaswap-health.mjs')) {
  const { execFileSync } = await import('node:child_process');
  // systemd is the source of truth for the units; this seam is what the tests replace.
  const readUnits = async () => BOTS.map((b) => {
    const show = (p) => {
      try { return execFileSync('systemctl', ['show', b.unit, '-p', p, '--value'], { encoding: 'utf8' }).trim(); }
      catch { return ''; }
    };
    const ts = show('ExecMainExitTimestamp');
    let lastLine = '';
    try { lastLine = execFileSync('bash', ['-lc', `journalctl -u ${b.unit} --no-pager -n 1 -o cat 2>/dev/null | tail -1`], { encoding: 'utf8' }).trim(); } catch { /* soft-fail */ }
    return {
      unit: b.unit,
      activeState: show('ActiveState'),
      subState: show('SubState'),
      lastRunMs: ts ? Date.parse(ts.replace(/ [A-Z]{2,5}$/, '')) || null : null,
      lastLine,
    };
  });
  const state = await collect({ readUnits });
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(state, null, 2)}\n` : `${formatReport(state)}\n`);
  process.exitCode = state.ok ? 0 : 1;
}
