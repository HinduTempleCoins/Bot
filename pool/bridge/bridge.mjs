// SoapBox pool — WebSocket -> stratum bridge.
//
// Browsers cannot open raw TCP sockets, so the in-page WASM RandomX miner speaks
// newline-delimited JSON-RPC stratum over a WebSocket to this service, which proxies
// it 1:1 to the real Miningcore stratum port over TCP. The bridge is a TRANSPARENT
// passthrough: it does not parse or alter stratum job/share semantics (login passthrough,
// job passthrough, share-submit passthrough). That keeps the miner protocol entirely
// between the page and Miningcore, and means the bridge never manufactures "junk" that
// would trip Miningcore's banOnJunkReceive.
//
// Safety rails (a public endpoint): per-IP connection cap, per-connection message-rate
// cap, max message size, idle timeout, and clean teardown of the paired TCP socket when
// the WS closes (and vice-versa). No keys, no secrets, read-nothing-from-disk.
//
// ESM, dependency = `ws` (already a direct dependency of this repo). Designed to sit
// behind Caddy at the pool site path /ws (Caddy terminates TLS -> ws to 127.0.0.1:8110).

import { WebSocketServer } from 'ws';
import net from 'node:net';

export const DEFAULTS = {
  // The WS listen side (localhost only; Caddy fronts it as wss://…/ws).
  wsHost: process.env.BRIDGE_WS_HOST || '127.0.0.1',
  wsPort: Number(process.env.BRIDGE_WS_PORT || 8110),
  // The stratum target. The dedicated low/fixed-diff browser port is preferred so a weak
  // WASM miner lands shares quickly; falls back to the standard CPU port.
  stratumHost: process.env.BRIDGE_STRATUM_HOST || '127.0.0.1',
  stratumPort: Number(process.env.BRIDGE_STRATUM_PORT || 4446),
  // Caps.
  maxConnPerIp: Number(process.env.BRIDGE_MAX_CONN_PER_IP || 4),
  maxMsgBytes: Number(process.env.BRIDGE_MAX_MSG_BYTES || 8 * 1024),
  // Token-bucket message rate (msgs/sec sustained, with a small burst).
  msgRatePerSec: Number(process.env.BRIDGE_MSG_RATE || 20),
  msgBurst: Number(process.env.BRIDGE_MSG_BURST || 40),
  // Drop a connection that has sent/recv nothing for this long (ms).
  idleMs: Number(process.env.BRIDGE_IDLE_MS || 5 * 60 * 1000),
};

// Extract a client IP from the upgrade request, honoring a single trusted proxy hop
// (Caddy sets X-Forwarded-For). We only use it for the per-IP cap, never for trust.
export function clientIp(req) {
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// A simple token bucket for per-connection message rate limiting.
export function makeBucket({ ratePerSec, burst, now = Date.now }) {
  let tokens = burst;
  let last = now();
  return {
    // returns true if allowed, false if the bucket is empty (over rate)
    take() {
      const t = now();
      const elapsed = (t - last) / 1000;
      last = t;
      tokens = Math.min(burst, tokens + elapsed * ratePerSec);
      if (tokens >= 1) { tokens -= 1; return true; }
      return false;
    },
  };
}

// Create the bridge. Returns { wss, close, counts } for tests + lifecycle.
// `connectStratum` is injectable so tests can supply a fake stratum server factory.
export function createBridge(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const connectStratum = opts.connectStratum || ((host, port, cb) => {
    const sock = net.createConnection({ host, port }, () => cb && cb());
    return sock;
  });
  const log = opts.log || ((...a) => console.log('[bridge]', ...a));

  const perIp = new Map(); // ip -> count
  const wss = new WebSocketServer({
    host: cfg.wsHost,
    port: cfg.wsPort,
    maxPayload: cfg.maxMsgBytes,
    // Reject the upgrade if this IP is already at its connection cap.
    verifyClient: (info, done) => {
      const ip = clientIp(info.req);
      const n = perIp.get(ip) || 0;
      if (n >= cfg.maxConnPerIp) { log('reject ip-cap', ip, n); return done(false, 429, 'Too many connections'); }
      done(true);
    },
  });

  wss.on('connection', (ws, req) => {
    const ip = clientIp(req);
    perIp.set(ip, (perIp.get(ip) || 0) + 1);

    const bucket = makeBucket({ ratePerSec: cfg.msgRatePerSec, burst: cfg.msgBurst });
    let closed = false;
    let lastActivity = Date.now();

    // Open the paired TCP stratum connection.
    const tcp = connectStratum(cfg.stratumHost, cfg.stratumPort, () => {
      log('stratum connected', ip);
    });

    // Buffer stratum -> WS by newline (stratum is line-delimited JSON-RPC); the WS side
    // is message-framed, so we forward each complete line as one WS text message.
    let inbuf = '';
    const onTcpData = (chunk) => {
      lastActivity = Date.now();
      inbuf += chunk.toString('utf8');
      let idx;
      while ((idx = inbuf.indexOf('\n')) >= 0) {
        const line = inbuf.slice(0, idx);
        inbuf = inbuf.slice(idx + 1);
        if (line.trim() && ws.readyState === ws.OPEN) ws.send(line);
        // Guard against an upstream flooding us with an unbounded partial line.
        if (inbuf.length > cfg.maxMsgBytes * 4) { teardown('stratum-overflow'); return; }
      }
    };

    const teardown = (why) => {
      if (closed) return;
      closed = true;
      const n = (perIp.get(ip) || 1) - 1;
      if (n <= 0) perIp.delete(ip); else perIp.set(ip, n);
      try { tcp.destroy(); } catch {}
      try { if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(); } catch {}
      log('teardown', ip, why || '');
    };

    tcp.on('data', onTcpData);
    tcp.on('error', (e) => { log('stratum error', ip, e.message); teardown('stratum-error'); });
    tcp.on('close', () => teardown('stratum-close'));

    // WS -> stratum. Rate-limit, size-limit, and forward each message as a single
    // newline-terminated stratum line. We do NOT inspect the JSON beyond a sanity parse
    // (drop non-JSON to avoid feeding Miningcore junk that would ban the pool's own IP).
    ws.on('message', (data, isBinary) => {
      lastActivity = Date.now();
      if (!bucket.take()) { teardown('rate'); return; }
      if (isBinary) { teardown('binary-not-allowed'); return; }
      const text = data.toString('utf8');
      if (text.length > cfg.maxMsgBytes) { teardown('msg-too-big'); return; }
      // Sanity: must be a single JSON object; reject newlines (one RPC per WS message).
      if (text.includes('\n')) { teardown('multiline'); return; }
      try { JSON.parse(text); } catch { teardown('bad-json'); return; }
      if (!tcp.destroyed) tcp.write(text + '\n');
    });

    ws.on('close', () => teardown('ws-close'));
    ws.on('error', (e) => { log('ws error', ip, e.message); teardown('ws-error'); });

    // Idle reaper for this connection.
    const idle = setInterval(() => {
      if (Date.now() - lastActivity > cfg.idleMs) { teardown('idle'); }
    }, Math.min(cfg.idleMs, 30000));
    idle.unref?.();
    ws.on('close', () => clearInterval(idle));
  });

  // Resolves once the WS server is actually listening (so callers can read its address).
  const ready = new Promise((res, rej) => {
    wss.on('listening', () => res());
    wss.on('error', (e) => rej(e));
  });

  return {
    wss,
    cfg,
    ready,
    counts: () => ({ ips: perIp.size, total: [...perIp.values()].reduce((a, b) => a + b, 0) }),
    close: () => new Promise((res) => wss.close(() => res())),
  };
}

// Run directly: node pool/bridge/bridge.mjs
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const b = createBridge();
  console.log(`[bridge] WS ${b.cfg.wsHost}:${b.cfg.wsPort} -> stratum ${b.cfg.stratumHost}:${b.cfg.stratumPort}`);
  const stop = () => b.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
