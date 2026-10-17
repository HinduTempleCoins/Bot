// uptime.mjs — 24/7 plumbing for the helper bot processes (Discord index.js, the public Telegram daemon):
//
//   • startWatchdog({ isHealthy })  — when run under systemd with WatchdogSec= (WATCHDOG_USEC set), pings
//     `systemd-notify WATCHDOG=1` every half-interval ONLY while isHealthy() is true (event loop alive AND
//     the platform client connected). A wedged process stops pinging → systemd kills + restarts it.
//     Sends READY=1 once. NotifyAccess=all in the unit lets the helper binary notify for the main PID.
//   • handler(req, res) — GET /health → 200 {ok:true,…} or 503 {ok:false,…}: process uptime, last inbound
//     message age, chain head + age via the failover RPC, RPC node bench state. GET /ready → plain 200/503.
//   • startHealthServer({ port }) — binds 127.0.0.1 only (put a reverse proxy / uptime monitor in front).
//
// Deterministic commands never depend on the LLM or the fleet queue (see brain.mjs), so /health reports
// "commands OK" whenever the chain answers — the AI path can be down without the bot being "down".

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { melekCallX, nodeHealth } from './live.mjs';
import { enabled } from './brain.mjs';

const STATE = { startedAt: Date.now(), lastInboundAt: null, platformReady: false, lastWatchdogAt: null };
export const markInbound = (now = Date.now()) => { STATE.lastInboundAt = now; };
export const markReady = (ok = true) => { STATE.platformReady = !!ok; };
export const __state = () => STATE;

/** Health snapshot. Chain is "fresh" when head block time is < maxLagS behind now. Never throws. */
export async function health({ now = Date.now(), maxLagS = Number(process.env.HELPERBOT_MAX_CHAIN_LAG_S || 120) } = {}) {
  let chain = { ok: false, head: null, lagS: null, stale: false };
  try {
    const r = await melekCallX('mainnet', 'condenser_api.get_dynamic_global_properties');
    if (r.result) {
      const lag = Math.round((now - Date.parse(r.result.time + 'Z')) / 1000);
      chain = { ok: !r.stale && lag < maxLagS, head: r.result.head_block_number, lagS: lag, stale: !!r.stale, node: r.node };
    }
  } catch { /* stays not-ok */ }
  const ok = STATE.platformReady && chain.ok;
  return {
    ok,
    platformReady: STATE.platformReady,
    helperCommands: enabled() ? 'on' : 'off',
    uptimeS: Math.round((now - STATE.startedAt) / 1000),
    lastInboundAgoS: STATE.lastInboundAt ? Math.round((now - STATE.lastInboundAt) / 1000) : null,
    chain,
    nodes: nodeHealth().mainnet.map((n) => ({ url: n.url, benched: n.benched, ok: n.ok, fail: n.fail })),
    lastWatchdogAgoS: STATE.lastWatchdogAt ? Math.round((now - STATE.lastWatchdogAt) / 1000) : null,
  };
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/ready')) {
      const h = await health();
      if (url.pathname === '/ready') { res.writeHead(h.ok ? 200 : 503, { 'content-type': 'text/plain' }); return res.end(h.ok ? 'ok' : 'degraded'); }
      res.writeHead(h.ok ? 200 : 503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(h));
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end('{"ok":false,"reason":"not-found"}');
  } catch {
    try { res.writeHead(500); res.end('{"ok":false}'); } catch { /* socket gone */ }
  }
}

export function startHealthServer({ port = Number(process.env.HELPERBOT_HEALTH_PORT || 0), host = '127.0.0.1' } = {}) {
  if (!port) return null;
  const srv = createServer(handler);
  srv.on('error', () => { /* port busy → run without the endpoint rather than crash the bot */ });
  srv.listen(port, host);
  return srv;
}

let _notify = (args) => new Promise((resolve) => {
  execFile('systemd-notify', args, { timeout: 5000 }, (err) => resolve(!err));
});
export function __setNotify(fn) { _notify = fn; }

/**
 * startWatchdog({ isHealthy, env, setIntervalFn }) → stop() | null. No-op outside systemd (no WATCHDOG_USEC).
 * isHealthy: () => boolean — default: platform client marked ready.
 */
export function startWatchdog({ isHealthy = () => STATE.platformReady, env = process.env, setIntervalFn = setInterval, clearIntervalFn = clearInterval } = {}) {
  const usec = Number(env.WATCHDOG_USEC || 0);
  if (!usec) return null;
  const pid = String(env.HELPERBOT_MAIN_PID || process.pid);
  const everyMs = Math.max(1000, Math.floor(usec / 1000 / 2));
  _notify([`--pid=${pid}`, 'READY=1']).catch(() => {});
  const t = setIntervalFn(() => {
    let ok = false;
    try { ok = !!isHealthy(); } catch { ok = false; }
    if (!ok) return; // withhold the ping → systemd restarts a wedged/disconnected bot
    STATE.lastWatchdogAt = Date.now();
    _notify([`--pid=${pid}`, 'WATCHDOG=1']).catch(() => {});
  }, everyMs);
  if (t && typeof t.unref === 'function') t.unref();
  return () => clearIntervalFn(t);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  markReady(true);
  const h = await health();
  console.log(JSON.stringify(h, null, 2));
}
