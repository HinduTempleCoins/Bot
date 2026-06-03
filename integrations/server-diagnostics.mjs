// server-diagnostics.mjs — READ-ONLY system + service diagnostics aggregator for the admin
// portal's diagnostics page. No secrets, no infra leakage: only generic role names, local OS
// metrics, and soft-failed health pings. Everything soft-fails and NEVER throws.
//
//   import { systemInfo, serviceHealth, diskUsage, diagnostics } from './server-diagnostics.mjs'
//   await diagnostics()   -> { ts, system, services, disk }
//
//   node integrations/server-diagnostics.mjs            # human-readable
//   node integrations/server-diagnostics.mjs --json     # machine-readable

import os from 'node:os';
import fs from 'node:fs';

// systemInfo() — purely local node:os / process metrics. All values are safe to surface:
// uptime, load average, memory totals, cpu count, node version. No hostname, no IP, no paths.
export function systemInfo() {
  try {
    const cpus = os.cpus() || [];
    const total = os.totalmem();
    const free = os.freemem();
    return {
      ok: true,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model ? String(cpus[0].model).trim() : null,
      loadavg: os.loadavg(),                       // [1m, 5m, 15m]
      uptimeSec: Math.round(os.uptime()),          // OS uptime
      processUptimeSec: Math.round(process.uptime()),
      memTotalBytes: total,
      memFreeBytes: free,
      memUsedBytes: total - free,
      memUsedPct: total > 0 ? Math.round(((total - free) / total) * 100) : null,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// diskUsage() — best-effort filesystem stats via node:fs statfs (Node 18.15+). Returns null when
// statfs is unavailable or errors. Reports only sizes/percentages for a generic mount, never paths
// beyond the neutral root marker.
export async function diskUsage(path = '/') {
  try {
    if (typeof fs.statfs !== 'function' && typeof fs.promises?.statfs !== 'function') return null;
    const statfs = fs.promises?.statfs
      ? fs.promises.statfs.bind(fs.promises)
      : (p) => new Promise((res, rej) => fs.statfs(p, (err, s) => (err ? rej(err) : res(s))));
    const s = await statfs(path);
    const blockSize = Number(s.bsize) || 0;
    const totalBytes = Number(s.blocks) * blockSize;
    const freeBytes = Number(s.bfree) * blockSize;
    const availBytes = Number(s.bavail) * blockSize;
    const usedBytes = totalBytes - freeBytes;
    return {
      ok: true,
      totalBytes,
      freeBytes,
      availBytes,
      usedBytes,
      usedPct: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : null,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// serviceHealth() — reuses integrations/health.mjs when present, via dynamic import + soft-fail.
// health.mjs runs its checks at import time and calls process.exit, so we don't import it directly;
// instead we ping the read-only readers it wraps, each independently soft-failed. When the readers /
// network are absent, every check reports down and the function still resolves (never throws).
// `deps` is injectable for testing so the call-outs can be stubbed without hitting the network.
export async function serviceHealth(deps = {}) {
  const readers = deps.readers || defaultReaders;
  let entries;
  try {
    entries = await readers();
  } catch (e) {
    return { ok: false, error: e?.message || String(e), checks: [] };
  }
  const checks = await Promise.all(
    entries.map(async ([name, fn]) => {
      const t0 = process.hrtime.bigint();
      try {
        const sample = await fn();
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        return { name, ok: true, ms: Math.round(ms), sample: String(sample).slice(0, 60) };
      } catch (e) {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        return { name, ok: false, ms: Math.round(ms), sample: (e?.message || String(e)).slice(0, 60) };
      }
    })
  );
  const up = checks.filter((c) => c.ok).length;
  return { ok: checks.length > 0 && up === checks.length, up, total: checks.length, checks };
}

// defaultReaders — dynamically import the read-only reader modules and map each to a generic
// service role name (no infra leakage). Soft-fails to an empty list if a module is missing.
async function defaultReaders() {
  const out = [];
  try {
    const { priceUsd } = await import('./price-oracle.mjs');
    out.push(['price-feed', async () => { const p = await priceUsd('hive'); return `${p.sources} src`; }]);
  } catch { /* module/network absent — skip */ }
  try {
    const { chain } = await import('./chain-explorer.mjs');
    out.push(['chain-reader', async () => { const c = await chain(); return `head ${c.headBlock}`; }]);
  } catch { /* skip */ }
  try {
    const { market } = await import('./hive-engine-market.mjs');
    out.push(['market-reader', async () => { const m = await market.metrics('VKBT'); return m ? 'ok' : 'no metrics'; }]);
  } catch { /* skip */ }
  return out;
}

// diagnostics() — fuse the three views with a single timestamp. Soft-fails each part so the page
// always renders something. `deps` is forwarded to serviceHealth for injectable testing.
export async function diagnostics(deps = {}) {
  const ts = new Date().toISOString();
  const [system, services, disk] = await Promise.all([
    Promise.resolve().then(systemInfo).catch((e) => ({ ok: false, error: e?.message || String(e) })),
    serviceHealth(deps).catch((e) => ({ ok: false, error: e?.message || String(e), checks: [] })),
    diskUsage(deps.diskPath || '/').catch(() => null),
  ]);
  return { ts, system, services, disk };
}

// ── CLI ────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('server-diagnostics.mjs')) {
  const d = await diagnostics();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(d, null, 2));
  } else {
    const s = d.system;
    console.log(`Server diagnostics — ${d.ts}\n${'─'.repeat(60)}`);
    if (s?.ok) {
      console.log(`node ${s.nodeVersion}  ${s.platform}/${s.arch}  ${s.cpuCount} cpu`);
      console.log(`load ${s.loadavg.map((x) => x.toFixed(2)).join(' ')}  uptime ${s.uptimeSec}s`);
      console.log(`mem  ${s.memUsedPct}% used (${(s.memUsedBytes / 1e9).toFixed(2)}/${(s.memTotalBytes / 1e9).toFixed(2)} GB)`);
    } else {
      console.log(`system: unavailable (${s?.error})`);
    }
    if (d.disk?.ok) console.log(`disk ${d.disk.usedPct}% used (${(d.disk.usedBytes / 1e9).toFixed(1)}/${(d.disk.totalBytes / 1e9).toFixed(1)} GB)`);
    const svc = d.services;
    console.log(`services ${svc.up ?? 0}/${svc.total ?? 0} up`);
    for (const c of svc.checks || []) console.log(`  ${c.ok ? '✅' : '❌'} ${String(c.name).padEnd(16)} ${String(c.ms + 'ms').padStart(7)}  ${c.sample}`);
  }
}
