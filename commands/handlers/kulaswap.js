/**
 * !kulaswap [pool] — deterministic Phase-2 pool-stats summary for the KulaSwap
 * mining pool. Read-only, keyless. Reads the Miningcore stats API via
 * integrations/pool-stats.mjs (pools() / poolStats(id)) and formats a short
 * one-pool or menu summary: pool name, hashrate, miners, and the stratum port.
 *
 *   !kulaswap            -> the multi-coin pool menu (one line per pool)
 *   !kulaswap prana      -> a single pool's stats + stratum connect line
 *
 * Soft-fail-never-throw: an unreachable API or malformed data yields an honest
 * "no pools" / "not found" reply, never an exception. All interpolation is
 * esc()'d so a hostile coin/port string can't break the rendered reply.
 */

import { pools, poolStats, stratumUrl } from '../../integrations/pool-stats.mjs';

// Minimal HTML/markup escaper — mirrors commands/alpha-report.mjs esc().
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Humanize a raw hash-per-second figure into H/s, KH/s, MH/s, GH/s, TH/s.
export function humanHashrate(hps) {
  const n = Number.isFinite(+hps) ? +hps : 0;
  if (n <= 0) return '0 H/s';
  const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i += 1; }
  const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${s} ${units[i]}`;
}

// The lowest non-TLS port is the canonical "connect here" port for the summary.
function primaryPort(p) {
  const ports = Array.isArray(p.ports) ? p.ports : [];
  const plain = ports.find((x) => !x.tls);
  return (plain || ports[0] || null);
}

// One-line summary of a normalized pool record.
function poolLine(p) {
  const port = primaryPort(p);
  const portStr = port ? esc(String(port.port)) : '—';
  return `**${esc(p.coin)}** (\`${esc(p.id)}\`) — ${esc(humanHashrate(p.hashrate))}, `
    + `${esc(String(p.connectedMiners))} miner${p.connectedMiners === 1 ? '' : 's'}, port ${portStr}`;
}

export async function kulaswap(parsed, ctx) {
  const want = String((parsed && parsed.args && parsed.args[0]) || '').trim().replace(/^[#$@]/, '');

  try {
    // Single-pool view.
    if (want) {
      const p = await poolStats(want);
      if (!p) {
        return { ok: true, reply: `KulaSwap: no pool "${esc(want)}" right now. Try !kulaswap for the full menu.` };
      }
      const port = primaryPort(p);
      const lines = [
        `**KulaSwap — ${esc(p.coin)}** (\`${esc(p.id)}\`)`,
        `Hashrate: ${esc(humanHashrate(p.hashrate))}`,
        `Miners: ${esc(String(p.connectedMiners))}`,
      ];
      if (port) {
        lines.push(`Stratum: \`${esc(stratumUrl(port.port, { tls: port.tls }))}\``);
      } else {
        lines.push('Stratum: (no port advertised)');
      }
      return { ok: true, reply: lines.join('\n') };
    }

    // Menu view — all pools.
    const list = await pools();
    if (!list.length) {
      return { ok: true, reply: 'KulaSwap: no pools are reporting right now. Check back shortly.' };
    }
    const lines = ['**KulaSwap pools**', ...list.map(poolLine)];
    return { ok: true, reply: lines.join('\n') };
  } catch (e) {
    // Soft-fail: never throw to the dispatcher.
    return { ok: true, reply: 'KulaSwap: pool stats are unavailable right now. Check back shortly.' };
  }
}
