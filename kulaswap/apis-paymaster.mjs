// apis-paymaster.mjs — off-chain coordinator for the APIS token-paymaster: "pay gas in APIS".
//
// THE FLOW (pairs with PRANA contracts/VerifyingPaymaster.sol):
//   1. A user who holds APIS (bridged to PRANA as an ERC-20) but little/no native PRANA wants to transact.
//   2. They ask this coordinator to QUOTE: "I need maxCost native wei of gas — how much APIS is that?"
//      -> quoteGasInApis(): maxCost × (APIS per PRANA) × (1 + margin).
//   3. The user calls VerifyingPaymaster.payInToken(APIS, apisAmount) on PRANA (APIS -> paymaster owner).
//   4. They hand this coordinator the payment txHash. We READ the receipt, verify a matching PaidInToken
//      event, derive a single-use nonce from that txHash, and SIGN a sponsorship authorizing the paymaster
//      to cover up to maxCost of native gas for that user.
//   5. The user (or a bundler) calls VerifyingPaymaster.sponsor(user, maxCost, nonce, signature); the
//      deposit is debited and their gas is covered. One payment -> one nonce -> one sponsorship.
//
// WHAT THIS MODULE IS: the PURE, layer-agnostic coordinator — quote math (BigInt, no float), the exact
// abi.encodePacked sponsorship payload the contract hashes, receipt/event verification, nonce derivation,
// idempotency planning, and a handler(req,res). It SIGNS NOTHING: the verifying-signer key lives only in
// apis-paymaster-daemon.mjs (ethers at the edge), injected here via __setSigner. Mirrors the bridge relayer.
//
// House style: ESM .mjs, soft-fail-never-throw (safe { ok:false } shapes), injectable fetch (__setFetch),
// esc() all HTML interpolation, handler(req,res) exported, CLI-guarded. node:test offline suite alongside.

// ── injectable edges ──────────────────────────────────────────────────────────────────────────────────
let _fetch = (typeof fetch !== 'undefined') ? fetch : null;
/** Swap the fetch impl (tests inject a fake; call with no arg to restore the global). */
export function __setFetch(fn) { _fetch = fn || ((typeof fetch !== 'undefined') ? fetch : null); }

let _signer = null;
/** Inject the sponsorship signer: async (packedHex) => signatureHex. The daemon wires the real key. */
export function __setSigner(fn) { _signer = fn || null; }

// ── small helpers ─────────────────────────────────────────────────────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const WAD = 10n ** 18n;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export function isAddress(a) { return typeof a === 'string' && ADDR_RE.test(a); }
export function isTxHash(h) { return typeof h === 'string' && HASH_RE.test(h); }

/** Parse a decimal/0x integer string to BigInt; null on garbage. */
export function toBig(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? BigInt(v) : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^0x[0-9a-fA-F]+$/.test(s)) { try { return BigInt(s); } catch { return null; } }
  if (/^\d+$/.test(s)) { try { return BigInt(s); } catch { return null; } }
  return null;
}

/** Left-pad a BigInt to a 32-byte (64-hex) field, no 0x. */
function pad32(b) { return b.toString(16).padStart(64, '0'); }
/** A 20-byte address as 40 hex, no 0x, lowercased. */
function addr20(a) { return a.toLowerCase().replace(/^0x/, ''); }

// ── quote: native gas budget -> APIS amount ─────────────────────────────────────────────────────────────
/**
 * quoteGasInApis — how much APIS covers a native-gas budget of `maxCostWei`.
 *   apisAmount = maxCostWei × apisPerPranaWei / 1e18 × (10000 + marginBps) / 10000
 * apisPerPranaWei = APIS (in 18-dp wei) priced per 1 PRANA (1e18 wei). marginBps = paymaster spread.
 * All BigInt — no float loss. Soft-fails to { ok:false } on bad input.
 */
export function quoteGasInApis({ maxCostWei, apisPerPranaWei, marginBps = 0 } = {}) {
  const cost = toBig(maxCostWei);
  const rate = toBig(apisPerPranaWei);
  const bps = toBig(marginBps) ?? 0n;
  if (cost == null || cost < 0n) return { ok: false, reason: 'bad-maxCost' };
  if (rate == null || rate <= 0n) return { ok: false, reason: 'bad-rate' };
  if (bps < 0n || bps > 100000n) return { ok: false, reason: 'bad-margin' };
  const base = (cost * rate) / WAD;
  const apisAmount = (base * (10000n + bps)) / 10000n;
  return {
    ok: true,
    maxCostWei: cost.toString(),
    apisPerPranaWei: rate.toString(),
    marginBps: Number(bps),
    apisAmount: apisAmount.toString(),
  };
}

// ── the exact payload the contract signs ────────────────────────────────────────────────────────────────
// VerifyingPaymaster.sponsorshipHash = toEthSignedMessageHash(
//   keccak256(abi.encodePacked(uint256 block.chainid, address(this), address user, uint256 maxCost, uint256 nonce)))
// abi.encodePacked layout: chainId(32) ‖ paymaster(20) ‖ user(20) ‖ maxCost(32) ‖ nonce(32) = 136 bytes.
// We emit the packed hex; the daemon keccak256+eth-signs it (keeps signing-relevant logic testable offline).
/** Build the abi.encodePacked sponsorship preimage (0x + 272 hex = 136 bytes). null on bad input. */
export function buildSponsorshipPacked({ chainId, paymaster, user, maxCost, nonce } = {}) {
  const cid = toBig(chainId);
  const cost = toBig(maxCost);
  const non = toBig(nonce);
  if (cid == null || cost == null || non == null) return null;
  if (!isAddress(paymaster) || !isAddress(user)) return null;
  return '0x' + pad32(cid) + addr20(paymaster) + addr20(user) + pad32(cost) + pad32(non);
}

/**
 * nonceFromRef — derive a deterministic single-use nonce from the payment txHash (or any 0x ref).
 * Uses the low 128 bits so it fits comfortably and one payment maps to exactly one nonce. The contract's
 * usedNonce[nonce] then makes the sponsorship single-use on-chain. null on a non-hex ref.
 */
export function nonceFromRef(ref) {
  if (typeof ref !== 'string') return null;
  const h = ref.replace(/^0x/, '');
  if (!/^[0-9a-fA-F]+$/.test(h) || h.length === 0) return null;
  const tail = h.slice(-32).padStart(32, '0');     // low 16 bytes
  try { return BigInt('0x' + tail).toString(); } catch { return null; }
}

// ── verify the on-chain APIS payment ────────────────────────────────────────────────────────────────────
// PaidInToken(address indexed user, address indexed token, uint256 amount)
// topic0 = keccak256("PaidInToken(address,address,uint256)"). We accept either an ethers-decoded
// {args:{user,token,amount}} OR a raw {topics:[t0,userTopic,tokenTopic], data} log and normalize it.
export const PAID_IN_TOKEN_TOPIC0 =
  '0x33c2f2793e61a81009e59d808dc5895a95480c66c72699706785808ea9591b64'; // keccak256("PaidInToken(address,address,uint256)")
const topicAddr = (t) => (typeof t === 'string' && t.length >= 42 ? '0x' + t.slice(-40).toLowerCase() : null);

/** Normalize one log into { user, token, amount } or null if it isn't a usable PaidInToken. */
export function parsePaidInToken(log, { topic0 } = {}) {
  if (!log || typeof log !== 'object') return null;
  // ethers-decoded shape
  const a = log.args;
  if (a && (a.user || a.token || a.amount != null)) {
    const amount = toBig(a.amount);
    if (!isAddress(a.user || '') || !isAddress(a.token || '') || amount == null) return null;
    return { user: a.user.toLowerCase(), token: a.token.toLowerCase(), amount: amount.toString() };
  }
  // raw log shape
  const topics = log.topics;
  if (Array.isArray(topics) && topics.length >= 3) {
    if (topic0 && topics[0] && topics[0].toLowerCase() !== topic0.toLowerCase()) return null;
    const user = topicAddr(topics[1]);
    const token = topicAddr(topics[2]);
    const amount = toBig(log.data);
    if (!isAddress(user || '') || !isAddress(token || '') || amount == null) return null;
    return { user, token, amount: amount.toString() };
  }
  return null;
}

/**
 * verifyPayment — given a tx receipt, confirm it contains a PaidInToken emitted by `paymaster`
 * for `user` paying `token` >= `minAmount`. Soft-fails to { ok:false, reason }.
 */
export function verifyPayment(receipt, { paymaster, user, token, minAmount, topic0 } = {}) {
  if (!receipt || typeof receipt !== 'object') return { ok: false, reason: 'no-receipt' };
  if (receipt.status != null && Number(receipt.status) === 0) return { ok: false, reason: 'tx-reverted' };
  const logs = receipt.logs || [];
  const min = toBig(minAmount) ?? 0n;
  for (const log of logs) {
    if (paymaster && log.address && log.address.toLowerCase() !== paymaster.toLowerCase()) continue;
    const ev = parsePaidInToken(log, { topic0 });
    if (!ev) continue;
    if (user && ev.user !== user.toLowerCase()) continue;
    if (token && ev.token !== token.toLowerCase()) continue;
    if (toBig(ev.amount) < min) return { ok: false, reason: 'amount-too-low', paid: ev.amount, required: min.toString() };
    return { ok: true, ...ev };
  }
  return { ok: false, reason: 'no-matching-payment' };
}

// ── idempotency ─────────────────────────────────────────────────────────────────────────────────────────
/** planSponsorship — sign once per nonce. state.signedNonces is a Set/array of already-signed nonces. */
export function planSponsorship(intent, state = {}) {
  if (!intent || intent.nonce == null) return { action: 'skip', reason: 'no-intent' };
  const nonce = String(intent.nonce);
  const done = state.signedNonces;
  const seen = (done instanceof Set) ? done.has(nonce) : Array.isArray(done) ? done.includes(nonce) : false;
  if (seen) return { action: 'skip', reason: 'already-signed' };
  return { action: 'sign', nonce };
}

// ── config / manifest ───────────────────────────────────────────────────────────────────────────────────
export function loadConfig(env = (typeof process !== 'undefined' ? process.env : {})) {
  const num = (v, d) => { const n = +v; return Number.isFinite(n) ? n : d; };
  return Object.freeze({
    pranaRpc: env.PRANA_RPC_URL || '',
    chainId: num(env.PRANA_CHAIN_ID, 108369),
    paymaster: env.VERIFYING_PAYMASTER_ADDRESS || '',
    apisToken: env.APIS_TOKEN_ADDRESS || '',
    apisPerPranaWei: env.APIS_PER_PRANA_WEI || '0',
    marginBps: num(env.PAYMASTER_MARGIN_BPS, 500),     // default 5% spread
    confirmations: num(env.CONFIRMATIONS, 2),
    paidInTokenTopic0: env.PAID_IN_TOKEN_TOPIC0 || PAID_IN_TOKEN_TOPIC0,
    signerPresent: !!env.PAYMASTER_SIGNER_KEY,
  });
}

export function paymasterManifest() {
  return {
    boundary: 'This coordinator QUOTES + VERIFIES + SIGNS sponsorships; it SIGNS nothing without the '
      + 'injected verifying-signer (daemon edge). The key never lives in this module.',
    env: {
      pranaRpc: { name: 'PRANA_RPC_URL' },
      chainId: { name: 'PRANA_CHAIN_ID' },
      paymaster: { name: 'VERIFYING_PAYMASTER_ADDRESS' },
      apisToken: { name: 'APIS_TOKEN_ADDRESS' },
      apisPerPranaWei: { name: 'APIS_PER_PRANA_WEI' },
      marginBps: { name: 'PAYMASTER_MARGIN_BPS' },
      signerKey: { name: 'PAYMASTER_SIGNER_KEY', note: 'daemon-only; never read by this module' },
    },
    live: typeof _signer === 'function',
  };
}

// ── reading a PRANA receipt over JSON-RPC ───────────────────────────────────────────────────────────────
async function rpc(url, method, params) {
  if (!_fetch) throw new Error('no-fetch');
  const res = await _fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || 'rpc-error');
  return j.result;
}

/** Fetch a receipt + head block; soft-fails to { ok:false }. */
export async function fetchReceipt(cfg, txHash) {
  if (!cfg.pranaRpc) return { ok: false, reason: 'no-prana-rpc' };
  if (!isTxHash(txHash)) return { ok: false, reason: 'bad-txhash' };
  try {
    const receipt = await rpc(cfg.pranaRpc, 'eth_getTransactionReceipt', [txHash]);
    if (!receipt) return { ok: false, reason: 'not-mined' };
    const headHex = await rpc(cfg.pranaRpc, 'eth_blockNumber', []);
    const head = toBig(headHex) ?? 0n;
    const block = toBig(receipt.blockNumber) ?? 0n;
    const confs = head >= block ? Number(head - block) : 0;
    return { ok: true, receipt, head: head.toString(), confirmations: confs };
  } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
}

// ── the full sponsorship pipeline (pure-ish; signing via injected signer) ───────────────────────────────
/**
 * issueSponsorship — given a paid txHash, verify the APIS payment finalized, then sign the sponsorship.
 * Returns { ok:true, user, maxCost, nonce, signature, paymaster, chainId } the user feeds to sponsor(),
 * or a safe { ok:false, reason }. Never throws.
 */
export async function issueSponsorship(cfg, { txHash, user, maxCostWei }, state = {}) {
  if (!isAddress(user || '')) return { ok: false, reason: 'bad-user' };
  const q = quoteGasInApis({ maxCostWei, apisPerPranaWei: cfg.apisPerPranaWei, marginBps: cfg.marginBps });
  if (!q.ok) return { ok: false, reason: 'bad-quote:' + q.reason };

  const got = await fetchReceipt(cfg, txHash);
  if (!got.ok) return { ok: false, reason: got.reason };
  if (got.confirmations < cfg.confirmations) {
    return { ok: false, reason: 'unconfirmed', confirmations: got.confirmations, need: cfg.confirmations };
  }
  const v = verifyPayment(got.receipt, {
    paymaster: cfg.paymaster, user, token: cfg.apisToken,
    minAmount: q.apisAmount, topic0: cfg.paidInTokenTopic0,
  });
  if (!v.ok) return { ok: false, reason: 'payment:' + v.reason, detail: v };

  const nonce = nonceFromRef(txHash);
  if (nonce == null) return { ok: false, reason: 'bad-nonce-ref' };
  const plan = planSponsorship({ nonce }, state);
  if (plan.action !== 'sign') return { ok: false, reason: plan.reason, nonce };

  const packed = buildSponsorshipPacked({
    chainId: cfg.chainId, paymaster: cfg.paymaster, user, maxCost: q.maxCostWei, nonce,
  });
  if (!packed) return { ok: false, reason: 'bad-packed' };
  if (typeof _signer !== 'function') return { ok: false, reason: 'no-signer' };

  let signature;
  try { signature = await _signer(packed); } catch (e) { return { ok: false, reason: 'sign-failed:' + (e && e.message) }; }
  if (!signature) return { ok: false, reason: 'sign-empty' };

  if (state.signedNonces instanceof Set) state.signedNonces.add(nonce);
  else if (Array.isArray(state.signedNonces)) state.signedNonces.push(nonce);

  return {
    ok: true, user: user.toLowerCase(), maxCost: q.maxCostWei, nonce,
    signature, paymaster: cfg.paymaster, chainId: cfg.chainId,
    apisPaid: v.amount, apisQuoted: q.apisAmount,
  };
}

// ── HTTP surface ────────────────────────────────────────────────────────────────────────────────────────
function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  let raw = '';
  for await (const c of req) raw += c;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return null; }
}

const PAGE = (cfg) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>APIS Paymaster — pay PRANA gas in APIS</title>
<style>
:root{--bg:#0b0e14;--panel:#131826;--gold:#d4a23c;--fg:#e7e3d8;--mut:#8a8f9c}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,sans-serif}
.wrap{max-width:680px;margin:0 auto;padding:32px 20px}
h1{color:var(--gold);font-size:22px;margin:0 0 4px}
.badge{display:inline-block;font-size:11px;border:1px solid var(--gold);color:var(--gold);border-radius:4px;padding:1px 6px;margin-left:8px;vertical-align:middle}
.card{background:var(--panel);border:1px solid #232a3a;border-radius:10px;padding:18px;margin:16px 0}
code{background:#0a0d15;border:1px solid #232a3a;border-radius:4px;padding:1px 5px;color:#cfd6e4}
.mut{color:var(--mut)}
ol{padding-left:18px}
</style></head><body><div class="wrap">
<h1>APIS Paymaster <span class="badge">Alpha</span></h1>
<p class="mut">Hold APIS but no native PRANA? Pay your gas in APIS.</p>
<div class="card">
<b>How it works</b>
<ol>
<li><code>POST /api/quote</code> <span class="mut">{ maxCostWei }</span> → APIS amount to pay.</li>
<li>Call <code>payInToken(${esc(cfg.apisToken || 'APIS')}, amount)</code> on the paymaster.</li>
<li><code>POST /api/sponsor</code> <span class="mut">{ txHash, user, maxCostWei }</span> → a signed sponsorship.</li>
<li>Call <code>sponsor(user, maxCost, nonce, signature)</code> — your gas is covered.</li>
</ol>
</div>
<div class="card mut">
Paymaster <code>${esc(cfg.paymaster || '(unset)')}</code><br>
APIS token <code>${esc(cfg.apisToken || '(unset)')}</code><br>
Chain <code>${esc(String(cfg.chainId))}</code> · margin <code>${esc(String(cfg.marginBps))} bps</code>
</div>
</div></body></html>`;

export async function handler(req, res, env) {
  const cfg = loadConfig(env);
  const url = (req.url || '/').split('?')[0];
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE(cfg));
    return;
  }
  if (req.method === 'GET' && url === '/api/manifest') { send(res, 200, paymasterManifest()); return; }
  if (req.method === 'POST' && url === '/api/quote') {
    const body = await readBody(req);
    if (!body) { send(res, 400, { ok: false, reason: 'bad-json' }); return; }
    const q = quoteGasInApis({
      maxCostWei: body.maxCostWei, apisPerPranaWei: cfg.apisPerPranaWei, marginBps: cfg.marginBps,
    });
    send(res, q.ok ? 200 : 400, q.ok ? { ...q, paymaster: cfg.paymaster, apisToken: cfg.apisToken } : q);
    return;
  }
  if (req.method === 'POST' && url === '/api/sponsor') {
    const body = await readBody(req);
    if (!body) { send(res, 400, { ok: false, reason: 'bad-json' }); return; }
    const out = await issueSponsorship(cfg, body, handler._state || (handler._state = { signedNonces: new Set() }));
    send(res, out.ok ? 200 : 400, out);
    return;
  }
  send(res, 404, { ok: false, reason: 'not-found' });
}

// CLI server (guarded so importing for tests has no side effects).
if (typeof process !== 'undefined' && process.argv[1]) {
  const { fileURLToPath } = await import('node:url');
  if (fileURLToPath(import.meta.url) === process.argv[1]) {
    const http = await import('node:http');
    const PORT = +(process.env.PORT || 8147);
    http.createServer((req, res) => handler(req, res)).listen(PORT, () => {
      process.stdout.write(`[apis-paymaster] listening on :${PORT}\n`);
    });
  }
}
