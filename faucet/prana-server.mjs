// faucet/prana-server.mjs — PRANA testnet gas faucet.
//
// TESTNET ON PURPOSE. Every id, RPC and explorer link here is the alpha chain — chainId 108369
// (0x1a751), rpc.prana.alpha.melek.salon, pranascan.alpha.*. A faucet that handed out MAINNET
// (712217) gas would be giving away real value. Everything else in the repo defaults to mainnet;
// this file and melek-alti-cdp.mjs (Market 2, never deployed to mainnet) are the deliberate
// exceptions. Do not "correct" these to 712217.
//
// Drips test-PRANA so anyone can pay gas to deploy/interact with contracts. The faucet account is
// node-managed (in the geth keystore) and funded by ongoing Etchash mining (etherbase points at it);
// signing happens via the node's LOCAL personal_sendTransaction (the public RPC blocks personal_*).
// This service therefore runs ON the PRANA box and talks to 127.0.0.1:8545.
//
// House style: handler(req,res) exported for tests, esc() all interpolation, soft-fail-never-throw,
// injectable fetch (__setFetch), CLI guard. Env: PRANA_RPC, FAUCET_ADDR, FAUCET_PASSWORD,
// DRIP_PRANA (whole PRANA per drip), RATE_HOURS (per-address cooldown), PORT.

import { fileURLToPath } from 'node:url';

const RPC = process.env.PRANA_RPC || 'http://127.0.0.1:8545';
const FAUCET_ADDR = (process.env.FAUCET_ADDR || '').toLowerCase();
const FAUCET_PASSWORD = process.env.FAUCET_PASSWORD || '';
const DRIP_PRANA = Number(process.env.DRIP_PRANA || 5);
const RATE_HOURS = Number(process.env.RATE_HOURS || 24);
const PORT = +(process.env.PORT || process.env.FAUCET_PORT || 8550);

let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// per-address cooldown (in-memory; fine for a testnet faucet). exported for tests to reset.
export const _seen = new Map();
export function _resetSeen() { _seen.clear(); }

export const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)); };
const toWeiHex = (whole) => '0x' + (BigInt(Math.round(whole * 1e6)) * (10n ** 12n)).toString(16); // whole PRANA -> wei hex (6dp safe)

async function rpc(method, params) {
  try {
    const r = await _fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (!r || !r.ok) return { error: `rpc http ${r && r.status}` };
    return await r.json();
  } catch (e) { return { error: 'node unreachable' }; }
}

/**
 * Drip DRIP_PRANA to `address`, signing via the node's local personal_sendTransaction.
 * Pure-ish: rate-limit + validation here; the actual send is the injectable rpc().
 * @returns {Promise<{ok:boolean, txHash?:string, error?:string, retryInHours?:number}>}
 */
export async function dripPrana(address, now = nowMs()) {
  const addr = String(address || '').trim();
  if (!ADDR_RE.test(addr)) return { ok: false, error: 'Enter a valid 0x… address (40 hex chars).' };
  if (!FAUCET_ADDR || !FAUCET_PASSWORD) return { ok: false, error: 'Faucet is not configured yet.' };
  const key = addr.toLowerCase();
  const last = _seen.get(key);
  const cooldownMs = RATE_HOURS * 3600 * 1000;
  if (last && now - last < cooldownMs) {
    return { ok: false, error: `Already funded recently. Try again later.`, retryInHours: Math.ceil((cooldownMs - (now - last)) / 3600000) };
  }
  const resp = await rpc('personal_sendTransaction', [
    { from: FAUCET_ADDR, to: key, value: toWeiHex(DRIP_PRANA), gas: '0x5208' }, FAUCET_PASSWORD,
  ]);
  if (resp.error || !resp.result) return { ok: false, error: typeof resp.error === 'object' ? (resp.error.message || 'send failed') : (resp.error || 'send failed') };
  _seen.set(key, now);
  return { ok: true, txHash: resp.result, amount: DRIP_PRANA };
}

// wrapped so tests can hold time deterministic without Date.now in the module top-level
function nowMs() { try { return Date.now(); } catch { return 0; } }

const PAGE = () => `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>PRANA Faucet · Alpha</title>
<style>body{background:#0b0e14;color:#e8e6e3;font:15px/1.5 system-ui,sans-serif;max-width:560px;margin:0 auto;padding:1.2rem}
h1{font-size:1.3rem;display:flex;gap:.4rem;align-items:baseline}.a{font-size:.55rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#62d0ff;border:1px solid rgba(98,208,255,.5);border-radius:5px;padding:.05rem .3rem;vertical-align:super}
.card{background:#131826;border:1px solid #222a3a;border-radius:13px;padding:1rem;margin:.8rem 0}
input{width:100%;font:inherit;padding:.6rem;border-radius:9px;border:1px solid #222a3a;background:#0b0e14;color:#e8e6e3}
button{font:inherit;font-weight:700;margin-top:.6rem;padding:.6rem 1rem;border-radius:9px;border:0;background:#62d0ff;color:#06121a;cursor:pointer}
.dim{color:#9aa4b2;font-size:.9rem}a{color:#62d0ff}#out{margin-top:.6rem;word-break:break-all}</style>
<h1>PRANA Faucet <span class=a>Alpha</span></h1>
<p class=dim>Test-PRANA for gas, so you can deploy and use contracts on PRANA (chain 108369). ${esc(String(DRIP_PRANA))} PRANA per address, every ${esc(String(RATE_HOURS))}h.</p>
<div class=card>
  <label class=dim for=a>Your PRANA / EVM address</label>
  <input id=a placeholder="0x…40 hex" spellcheck=false autocomplete=off>
  <button id=b>Get test PRANA</button>
  <div id=out></div>
</div>
<p class=dim>Add PRANA to MetaMask: RPC <code>https://rpc.prana.alpha.melek.salon</code> · chainId 108369 · symbol PRANA. Explore on <a href="https://pranascan.alpha.soapbox.community">PRANAScan</a>.</p>
<h1 style="margin-top:1.4rem">MELEK Faucet <span class=a>Alpha</span></h1>
<p class=dim>MELEK (the social chain) has <b>no gas</b> — actions are paid by Resource Credits (RC), not a fee. So the MELEK faucet gives you an <b>account</b>: create one free, and Hathor automatically grants you starter <b>TESTS</b> + delegated <b>POWER</b> (RC) so you can post, vote, and transfer right away.</p>
<div class=card>
  <p>Create a MELEK testnet account (keys generated in your browser, never sent to us):</p>
  <p><a href="https://wallet.melek.salon/signup">Create a MELEK account →</a></p>
  <p class=dim>Already have one? Hathor's welcomer tops up new accounts with TESTS + RC POWER on the Welcome post within minutes.</p>
</div>
<script>
const b=document.getElementById('b'),a=document.getElementById('a'),out=document.getElementById('out');
b.onclick=async()=>{out.textContent='Sending…';b.disabled=true;
try{const r=await fetch('/api/drip',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address:a.value.trim()})});
const d=await r.json();
out.textContent='';
if(d.ok && /^0x[0-9a-fA-F]{64}$/.test(d.txHash||'')){out.append('✅ Sent '+Number(d.amount)+' PRANA. Tx: ');
const link=document.createElement('a');link.href='https://pranascan.alpha.soapbox.community/tx/'+d.txHash;link.textContent=d.txHash.slice(0,18)+'…';out.append(link);}
else{out.textContent='⚠ '+(d.error||'failed');}}catch(e){out.textContent='⚠ error';}b.disabled=false;};
</script>`;

export async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' }); return res.end(); }
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGE());
    }
    if (req.method === 'POST' && url.pathname === '/api/drip') {
      let raw = ''; for await (const c of req) { raw += c; if (raw.length > 4096) break; }
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
      const out = await dripPrana(body.address);
      return json(res, out.ok ? 200 : 400, out);
    }
    return json(res, 404, { ok: false, error: 'not found' });
  } catch {
    return json(res, 200, { ok: false, error: 'faucet error' });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const http = await import('node:http');
  http.createServer(handler).listen(PORT, '127.0.0.1', () => process.stdout.write(`prana faucet on 127.0.0.1:${PORT} (drip ${DRIP_PRANA} PRANA)\n`));
}
