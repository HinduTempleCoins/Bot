// site/status/server.mjs — live MELEK/PRANA/KULA ecosystem status board (the consolidated e2e health check).
//
// One page that probes every live subsystem and renders green/red: the public home, the chains' RPCs, the
// faucet, the APIS paymaster, SoapBox staking, the explorer, Akasha, the tokens portal, and the bridge
// contracts (on-chain). Each probe SOFT-FAILS to red — a down service never throws and never breaks the page.
//
// House style: ESM .mjs, injectable fetch (__setFetch) so the offline suite asserts pass/fail/soft-fail
// without network, esc() all HTML, handler(req,res), CLI-guarded. Offline node:test alongside.

let _fetch = (typeof fetch !== 'undefined') ? fetch : null;
export function __setFetch(fn) { _fetch = fn || ((typeof fetch !== 'undefined') ? fetch : null); }

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// keccak256("MELEK") — the bridge tokenId we probe the bridge registry for.
const MELEK_TOKEN_ID = '0x5a212ca60cafcdb5cfc9e9346ad12c4cccef6de33ea38bffbac8e3fd9091aa24';
const BRIDGE = '0x04C89607413713Ec9775E14b954286519d836FEf';
const WRAPPED_TOKEN_SEL = '0xdb110aac'; // wrappedToken(bytes32)

// The probe set. Each: { name, group, kind, ...}. kind drives how the result is judged.
//   http       — GET url, ok if response.ok (2xx)
//   contains   — GET url, ok if the body contains `needle`
//   json-prop  — POST jsonrpc {method,params}, ok if result satisfies `check(result)`
export const CHECKS = [
  { name: 'Ecosystem home', group: 'Web', kind: 'contains', url: 'https://soapbox.community/', needle: 'SoapBox' },
  { name: 'Tokens portal', group: 'Web', kind: 'http', url: 'https://tokens.alpha.melek.salon/' },
  { name: 'Akasha wallet', group: 'Web', kind: 'http', url: 'https://akasha.alpha.soapbox.community/' },
  { name: 'PRANAScan explorer', group: 'Web', kind: 'http', url: 'https://pranascan.alpha.soapbox.community/' },
  { name: 'MELEK social app', group: 'Web', kind: 'http', url: 'https://alpha.melek.salon/' },
  { name: 'KulaSwap DEX', group: 'DeFi', kind: 'contains', url: 'https://alpha.kula.money/', needle: 'KulaSwap' },
  { name: 'Auto / SoapBox', group: 'Social', kind: 'http', url: 'https://auto.alpha.melek.salon/' },
  { name: 'Mining pool', group: 'Chain', kind: 'http', url: 'https://pool.soapbox.community/' },
  { name: 'Witness school', group: 'Social', kind: 'http', url: 'https://witness.melek.salon/' },
  { name: 'SoapBox Staking', group: 'DeFi', kind: 'contains', url: 'https://staking.alpha.melek.salon/api/state', needle: '"ok":true' },
  { name: 'APIS Paymaster', group: 'DeFi', kind: 'contains', url: 'https://paymaster.alpha.melek.salon/api/manifest', needle: 'SIGNS nothing' },
  { name: 'PRANA gas faucet', group: 'Chain', kind: 'http', url: 'https://faucet.alpha.soapbox.community/' },
  { name: 'PRANA RPC', group: 'Chain', kind: 'json-prop', rpc: 'https://rpc.prana.alpha.melek.salon', method: 'eth_chainId', params: [], want: '0x1a751' },
  { name: 'MELEK RPC', group: 'Chain', kind: 'json-prop', rpc: 'https://alpha.melek.salon/rpc', method: 'condenser_api.get_dynamic_global_properties', params: [], want: 'head_block_number' },
  { name: 'Bridge (wMELEK registered)', group: 'Bridge', kind: 'eth-call', rpc: 'https://rpc.prana.alpha.melek.salon', to: BRIDGE, data: WRAPPED_TOKEN_SEL + MELEK_TOKEN_ID.slice(2), want: 'nonzero-address' },
];

async function probe(check, timeoutMs = 8000) {
  if (!_fetch) return { ...meta(check), ok: false, detail: 'no-fetch' };
  try {
    if (check.kind === 'http' || check.kind === 'contains') {
      const res = await _fetch(check.url, { signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined });
      if (!res.ok) return { ...meta(check), ok: false, detail: `HTTP ${res.status}` };
      if (check.kind === 'contains') {
        const body = await res.text();
        return body.includes(check.needle)
          ? { ...meta(check), ok: true, detail: 'ok' }
          : { ...meta(check), ok: false, detail: `missing "${check.needle}"` };
      }
      return { ...meta(check), ok: true, detail: `HTTP ${res.status}` };
    }
    if (check.kind === 'json-prop' || check.kind === 'eth-call') {
      const body = check.kind === 'eth-call'
        ? { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: check.to, data: check.data }, 'latest'] }
        : { jsonrpc: '2.0', id: 1, method: check.method, params: check.params };
      const res = await _fetch(check.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (j.error) return { ...meta(check), ok: false, detail: j.error.message || 'rpc-error' };
      return judge(check, j.result);
    }
    return { ...meta(check), ok: false, detail: 'unknown-kind' };
  } catch (e) { return { ...meta(check), ok: false, detail: String(e && e.message || e).slice(0, 80) }; }
}

function meta(c) { return { name: c.name, group: c.group }; }

function judge(check, result) {
  if (check.kind === 'eth-call') {
    // want nonzero-address: a 32-byte word whose low 20 bytes are nonzero
    const hex = String(result || '').replace(/^0x/, '');
    const nonzero = hex.length >= 40 && /[1-9a-f]/.test(hex.slice(-40));
    return { ...meta(check), ok: nonzero, detail: nonzero ? `→ 0x…${hex.slice(-6)}` : 'zero/unregistered' };
  }
  // json-prop
  if (check.want && check.want.startsWith('0x')) {
    return { ...meta(check), ok: result === check.want, detail: `${result}` };
  }
  // want = a property name present on the result object
  const ok = result != null && (typeof result === 'object' ? (check.want in result) : true);
  const detail = ok && typeof result === 'object' && check.want in result ? `${check.want}=${result[check.want]}` : 'ok';
  return { ...meta(check), ok, detail: ok ? detail : 'missing ' + check.want };
}

/** Run every probe concurrently. Never throws. Returns { results, summary }. */
export async function runAll(checks = CHECKS) {
  const results = await Promise.all(checks.map((c) => probe(c)));
  const up = results.filter((r) => r.ok).length;
  return { results, summary: { up, total: results.length, allUp: up === results.length } };
}

function page({ results, summary }) {
  const groups = {};
  for (const r of results) (groups[r.group] = groups[r.group] || []).push(r);
  const dot = (ok) => `<span class="dot ${ok ? 'up' : 'down'}"></span>`;
  const rows = Object.entries(groups).map(([g, rs]) => `
    <div class="grp"><h2>${esc(g)}</h2>${rs.map((r) => `
      <div class="row">${dot(r.ok)}<span class="nm">${esc(r.name)}</span>
        <span class="st ${r.ok ? 'okc' : 'badc'}">${r.ok ? 'UP' : 'DOWN'}</span>
        <span class="dt">${esc(r.detail)}</span></div>`).join('')}</div>`).join('');
  const banner = summary.allUp ? 'All systems operational' : `${summary.up}/${summary.total} operational`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>MELEK ecosystem status</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%23d4a23c'/%3E%3C/svg%3E">
<style>
:root{--bg:#0b0e14;--panel:#131826;--gold:#d4a23c;--fg:#e7e3d8;--mut:#8a8f9c;--up:#3fb950;--down:#f85149}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:30px 20px}
h1{color:var(--gold);font-size:22px;margin:0 0 2px}
.badge{font-size:11px;border:1px solid var(--gold);color:var(--gold);border-radius:4px;padding:1px 6px;margin-left:8px}
.banner{margin:10px 0 18px;font-weight:700}.banner.ok{color:var(--up)}.banner.bad{color:var(--down)}
.grp{background:var(--panel);border:1px solid #232a3a;border-radius:10px;padding:6px 16px 12px;margin:14px 0}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:12px 0 6px}
.row{display:flex;align-items:center;gap:10px;padding:5px 0;border-top:1px solid #1b2230}
.row:first-of-type{border-top:none}
.dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}.dot.up{background:var(--up)}.dot.down{background:var(--down)}
.nm{flex:1}.st{font-size:11px;font-weight:700}.okc{color:var(--up)}.badc{color:var(--down)}
.dt{color:var(--mut);font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.foot{color:var(--mut);font-size:12px;margin-top:16px}
</style></head><body><div class="wrap">
<h1>MELEK ecosystem status <span class="badge">Alpha</span></h1>
<div class="banner ${summary.allUp ? 'ok' : 'bad'}">${esc(banner)}</div>
${rows}
<div class="foot">Live probes across MELEK, PRANA, and KULA. Refresh to re-check.</div>
</div></body></html>`;
}

export async function handler(req, res) {
  const url = (req.url || '/').split('?')[0];
  if (req.method === 'GET' && url === '/api/status') {
    const out = await runAll();
    res.writeHead(out.summary.allUp ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
    return;
  }
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    const out = await runAll();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page(out));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, reason: 'not-found' }));
}

if (typeof process !== 'undefined' && process.argv[1]) {
  const { fileURLToPath } = await import('node:url');
  if (fileURLToPath(import.meta.url) === process.argv[1]) {
    const http = await import('node:http');
    const PORT = +(process.env.PORT || 8149);
    http.createServer((req, res) => handler(req, res)).listen(PORT, () => process.stdout.write(`[status] :${PORT}\n`));
  }
}
