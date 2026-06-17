// soapbox-staking.mjs — SoapBox delegation-staking (NutBox-style): delegate "MELEK Power" (dMP) and
// earn ALTI. This is OUR own staking, modeled on NutBox's open-source delegation-mining mechanic (the
// namesake of "SoapBox") — it runs on the live PRANA DelegationMint contract with our ALTI token; it is
// NOT connected to the NutBox protocol.
//
// THE CONTRACT (PRANA DelegationMint, MasterChef-style): every block a fixed emissionPerBlock of ALTI is
// minted and split pro-rata across all delegated dMP. delegate(amount) / undelegate(amount) / claim().
//   pendingReward(user) = pending + amount × accRewardPerShare/ACC − rewardDebt
//   accRewardPerShare advances by (blocksElapsed × emissionPerBlock × ACC) / totalDelegated each pool touch.
//
// WHAT THIS MODULE IS: the PURE off-chain mirror of that math + UNSIGNED EVM tx descriptors (the wallet —
// Akasha or MetaMask — signs), a live state reader over an injected fetch, and a UI fragment / handler.
// House style: ESM .mjs, BigInt (no float in the reward math), soft-fail-never-throw, injectable fetch
// (__setFetch), esc() all HTML, handler(req,res), CLI-guarded. Offline node:test alongside.

let _fetch = (typeof fetch !== 'undefined') ? fetch : null;
export function __setFetch(fn) { _fetch = fn || ((typeof fetch !== 'undefined') ? fetch : null); }

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// PRANA testnet addresses (overridable via env/host). PUBLIC addresses only.
export const ADDR = Object.freeze({
  delegationMint: '0x1429859428C0aBc9C2C47C8Ee9FBaf82cFA0F20f',
  alti: '0xFD471836031dc5108809D173A067e8486B9047A3',          // reward token
  stakeToken: '0xcbEAF3BDe82155F56486Fb5a1072cb8baAf547cc',    // dMP — Delegated MELEK Power
});

// Function selectors (keccak256(sig)[:4]).
export const SEL = Object.freeze({
  delegate: '0x9fa6dd35',     // delegate(uint256)
  undelegate: '0x6c68c0e1',   // undelegate(uint256)
  claim: '0x4e71d92d',        // claim()
  approve: '0x095ea7b3',      // approve(address,uint256)
  pendingReward: '0xf40f0f52',// pendingReward(address)
  delegatedOf: '0x943bc6ab',  // delegatedOf(address)
  totalDelegated: '0x80d04de8',
  emissionPerBlock: '0xc95986a2',
  balanceOf: '0x70a08231',
  allowance: '0xdd62ed3e',    // allowance(address,address)
});

const ACC = 10n ** 12n; // contract's fixed-point scale (1e12)
const WAD = 10n ** 18n;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(a) { return typeof a === 'string' && ADDR_RE.test(a); }
export function toBig(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? BigInt(v) : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^0x[0-9a-fA-F]+$/.test(s)) { try { return BigInt(s); } catch { return null; } }
  if (/^\d+$/.test(s)) { try { return BigInt(s); } catch { return null; } }
  return null;
}
const pad32 = (b) => b.toString(16).padStart(64, '0');
const padAddr = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

// ── pure reward math (mirror of DelegationMint) ─────────────────────────────────────────────────────────
/** accRewardPerShare advanced to the current block. All BigInt. */
export function accPerShareAt({ accRewardPerShare, blocksElapsed, emissionPerBlock, totalDelegated } = {}) {
  const acc = toBig(accRewardPerShare) ?? 0n;
  const be = toBig(blocksElapsed) ?? 0n;
  const epb = toBig(emissionPerBlock) ?? 0n;
  const td = toBig(totalDelegated) ?? 0n;
  if (td <= 0n || be <= 0n || epb <= 0n) return acc;
  return acc + (be * epb * ACC) / td;
}

/** pendingReward(user) — the claimable ALTI as of `acc`. Returns a wei string. */
export function pendingReward({ amount, accRewardPerShare, rewardDebt, pending } = {}) {
  const amt = toBig(amount) ?? 0n;
  const acc = toBig(accRewardPerShare) ?? 0n;
  const debt = toBig(rewardDebt) ?? 0n;
  const pend = toBig(pending) ?? 0n;
  const gross = pend + (amt * acc) / ACC - debt;
  return (gross > 0n ? gross : 0n).toString();
}

/**
 * aprAnnual — APR of the dMP→ALTI pool, in basis points, assuming 1 ALTI == 1 dMP of value (no oracle yet,
 * "let the market correct it"). APR = annualEmission / totalDelegated. Returns { bps, pct } or null.
 */
export function aprAnnual({ emissionPerBlock, totalDelegated, blocksPerYear = 10512000, altiPerStake = 1 } = {}) {
  const epb = toBig(emissionPerBlock);
  const td = toBig(totalDelegated);
  const bpy = toBig(blocksPerYear) ?? 0n;
  if (epb == null || td == null || td <= 0n || bpy <= 0n) return null;
  const annual = epb * bpy;                          // ALTI minted/year (wei)
  // value-adjust by altiPerStake (integer-ish ratio); keep BigInt by scaling
  const ratioNum = BigInt(Math.round((+altiPerStake || 1) * 1e6));
  const bps = (annual * 10000n * ratioNum) / (td * 1000000n);
  return { bps: Number(bps), pct: Number(bps) / 100 };
}

// ── unsigned EVM tx descriptors (the wallet signs) ──────────────────────────────────────────────────────
function uintArg(v) { const b = toBig(v); return b == null ? null : pad32(b); }

/** approve dMP to the DelegationMint (needed before the first delegate). */
export function buildApproveTx(amount, addr = ADDR) {
  const a = uintArg(amount); if (a == null) return null;
  return { to: addr.stakeToken, data: SEL.approve + padAddr(addr.delegationMint) + a, value: '0x0' };
}
export function buildDelegateTx(amount, addr = ADDR) {
  const a = uintArg(amount); if (a == null) return null;
  return { to: addr.delegationMint, data: SEL.delegate + a, value: '0x0' };
}
export function buildUndelegateTx(amount, addr = ADDR) {
  const a = uintArg(amount); if (a == null) return null;
  return { to: addr.delegationMint, data: SEL.undelegate + a, value: '0x0' };
}
export function buildClaimTx(addr = ADDR) {
  return { to: addr.delegationMint, data: SEL.claim, value: '0x0' };
}

// ── live state reader (eth_call) ────────────────────────────────────────────────────────────────────────
export function loadConfig(env = (typeof process !== 'undefined' ? process.env : {})) {
  return Object.freeze({
    pranaRpc: env.PRANA_RPC_URL || 'https://rpc.prana.alpha.melek.salon',
    addr: Object.freeze({
      delegationMint: env.DELEGATION_MINT_ADDRESS || ADDR.delegationMint,
      alti: env.ALTI_ADDRESS || ADDR.alti,
      stakeToken: env.STAKE_TOKEN_ADDRESS || ADDR.stakeToken,
    }),
  });
}

async function ethCall(rpc, to, data) {
  if (!_fetch) throw new Error('no-fetch');
  const res = await _fetch(rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || 'eth_call-error');
  return j.result;
}

/** Read a user's staking position + pool stats. Soft-fails to { ok:false }. */
export async function fetchState(cfg, user) {
  const { addr } = cfg;
  try {
    const dm = addr.delegationMint;
    const [emis, total] = await Promise.all([
      ethCall(cfg.pranaRpc, dm, SEL.emissionPerBlock),
      ethCall(cfg.pranaRpc, dm, SEL.totalDelegated),
    ]);
    const out = {
      ok: true,
      emissionPerBlock: (toBig(emis) ?? 0n).toString(),
      totalDelegated: (toBig(total) ?? 0n).toString(),
    };
    if (isAddress(user)) {
      const [del, pend] = await Promise.all([
        ethCall(cfg.pranaRpc, dm, SEL.delegatedOf + padAddr(user)),
        ethCall(cfg.pranaRpc, dm, SEL.pendingReward + padAddr(user)),
      ]);
      out.delegated = (toBig(del) ?? 0n).toString();
      out.pending = (toBig(pend) ?? 0n).toString();
    }
    out.apr = aprAnnual({ emissionPerBlock: out.emissionPerBlock, totalDelegated: out.totalDelegated });
    return out;
  } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
}

// ── HTTP surface ────────────────────────────────────────────────────────────────────────────────────────
const fmt = (wei) => { const b = toBig(wei) ?? 0n; const w = b / WAD; const f = (b % WAD).toString().padStart(18, '0').slice(0, 4); return `${w}.${f}`; };

function send(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }

const PAGE = (cfg) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>SoapBox Staking — delegate dMP, earn ALTI</title>
<style>
:root{--bg:#0b0e14;--panel:#131826;--gold:#d4a23c;--fg:#e7e3d8;--mut:#8a8f9c}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,sans-serif}
.wrap{max-width:640px;margin:0 auto;padding:32px 20px}
h1{color:var(--gold);font-size:22px;margin:0 0 4px}
.badge{display:inline-block;font-size:11px;border:1px solid var(--gold);color:var(--gold);border-radius:4px;padding:1px 6px;margin-left:8px;vertical-align:middle}
.card{background:var(--panel);border:1px solid #232a3a;border-radius:10px;padding:18px;margin:16px 0}
code{background:#0a0d15;border:1px solid #232a3a;border-radius:4px;padding:1px 5px;color:#cfd6e4}
.mut{color:var(--mut)} .big{font-size:20px;color:var(--gold)}
</style></head><body><div class="wrap">
<h1>SoapBox Staking <span class="badge">Alpha</span></h1>
<p class="mut">Delegate <b>MELEK Power</b> (dMP), earn <b>ALTI</b>. Our own staking, similar to NutBox.</p>
<div class="card"><div class="mut">Pool APR</div><div class="big" id="apr">…</div>
<div class="mut" id="pool" style="margin-top:8px">…</div></div>
<div class="card mut">
delegate <code>${esc(cfg.addr.delegationMint)}</code><br>
dMP <code>${esc(cfg.addr.stakeToken)}</code> · ALTI <code>${esc(cfg.addr.alti)}</code><br>
Connect a PRANA wallet (Akasha / MetaMask) and sign <code>approve → delegate</code>, then <code>claim</code>.
</div>
<script>
fetch('/api/state').then(r=>r.json()).then(s=>{
  if(!s.ok){document.getElementById('apr').textContent='unavailable';return;}
  var el=document.getElementById('apr');
  var pool='Total delegated: '+s.totalDelegatedHuman+' dMP · Emission: '+s.emissionPerBlockHuman+' ALTI/block';
  if(!s.apr){el.textContent='—';}
  else if(s.apr.pct>100000){el.textContent='very high'; el.title=s.apr.pct.toLocaleString()+'%'; pool+=' — APR is very high while TVL is low; it falls as more dMP is delegated.';}
  else{el.textContent=s.apr.pct.toLocaleString(undefined,{maximumFractionDigits:2})+'%';}
  document.getElementById('pool').textContent=pool;
}).catch(()=>{document.getElementById('apr').textContent='unavailable';});
</script>
</div></body></html>`;

export async function handler(req, res, env) {
  const cfg = loadConfig(env);
  const url = (req.url || '/').split('?')[0];
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE(cfg)); return;
  }
  if (req.method === 'GET' && url === '/api/state') {
    const user = new URL(req.url, 'http://x').searchParams.get('user');
    const s = await fetchState(cfg, user);
    if (s.ok) {
      s.totalDelegatedHuman = fmt(s.totalDelegated);
      s.emissionPerBlockHuman = fmt(s.emissionPerBlock);
      if (s.delegated != null) s.delegatedHuman = fmt(s.delegated);
      if (s.pending != null) s.pendingHuman = fmt(s.pending);
    }
    send(res, s.ok ? 200 : 502, s); return;
  }
  send(res, 404, { ok: false, reason: 'not-found' });
}

if (typeof process !== 'undefined' && process.argv[1]) {
  const { fileURLToPath } = await import('node:url');
  if (fileURLToPath(import.meta.url) === process.argv[1]) {
    const http = await import('node:http');
    const PORT = +(process.env.PORT || 8148);
    http.createServer((req, res) => handler(req, res)).listen(PORT, () => process.stdout.write(`[soapbox-staking] :${PORT}\n`));
  }
}
