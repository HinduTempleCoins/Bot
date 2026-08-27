// live.mjs — the KULA Arcade LIVE on-chain reader. Reads the deployed PLAY-token arcade contracts
// (KulaLotto + BinaryEventMarket) straight off a PRANA JSON-RPC endpoint via eth_call and renders the
// current testnet state (latest lotto round + open markets). Dependency-free: it hand-encodes the four
// selectors and hand-decodes the fixed-width return tuples, so the Bot repo stays lib-free and the tests
// run fully offline with an injected fetch. Soft-fail: every read degrades to a "chain unavailable" card
// rather than throwing, so the page always renders.
//
// Compliance unchanged: PLAY is non-cashable, testnet only, entertainment-not-gambling (see shared.mjs).
//
//   ARCADE_RPC_URL=https://rpc.prana.alpha.melek.salon ARCADE_CHAIN_ID=108369 \
//   ARCADE_LOTTO_ADDR=0x… ARCADE_MARKET_ADDR=0x… node site/arcade/live.mjs   # serves :8163

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { esc, shell, commonRoutes, sendHtml, sendJson, DISCLAIMER } from './shared.mjs';

const PORT = +(process.env.PORT || 8163);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');

const RPC = process.env.ARCADE_RPC_URL || '';
const CHAIN_ID = +(process.env.ARCADE_CHAIN_ID || 108369);
const LOTTO_ADDR = process.env.ARCADE_LOTTO_ADDR || '';
const MARKET_ADDR = process.env.ARCADE_MARKET_ADDR || '';

// Function selectors (keccak256(sig)[0:4]).
const SEL = { roundCount: '0x127f0b3f', rounds: '0x8c65c81f', marketCount: '0xec979082', getMarket: '0xeb44fdd3' };
const PHASES = ['Open', 'Closed', 'Proposed', 'Disputed', 'Resolved'];
const OUTCOMES = ['Unset', 'Yes', 'No', 'Invalid'];

// Injectable fetch (offline tests set this; never touches the network otherwise).
let _fetch = (typeof fetch === 'function') ? fetch : null;
export function __setFetch(fn) { _fetch = fn; }

// ---- tiny ABI codec (fixed-width words only; no dynamic types in these calls) ------------------------- //
const pad = (n) => BigInt(n).toString(16).padStart(64, '0');
const words = (hex) => { const h = String(hex || '').replace(/^0x/, ''); const o = []; for (let i = 0; i < h.length; i += 64) o.push(h.slice(i, i + 64)); return o; };
const asBig = (w) => (w ? BigInt('0x' + w) : 0n);
const asNum = (w) => Number(asBig(w));
const asBool = (w) => asBig(w) !== 0n;
const asAddr = (w) => (w ? '0x' + w.slice(24) : '0x' + '0'.repeat(40));

async function ethCall(to, data) {
  if (!_fetch || !RPC || !to) return null;
  try {
    const res = await _fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    });
    if (!res || !res.ok) return null;
    const j = await res.json();
    return (j && j.result) ? j.result : null;
  } catch { return null; }
}

// ---- reads (soft-fail to null / empty) --------------------------------------------------------------- //
export async function readLotto() {
  const cnt = await ethCall(LOTTO_ADDR, SEL.roundCount);
  if (cnt == null) return { ok: false, count: 0, latest: null };
  const count = asNum(words(cnt)[0]);
  let latest = null;
  if (count > 0) {
    const id = count - 1;
    const r = await ethCall(LOTTO_ADDR, SEL.rounds + pad(id));
    const w = words(r);
    if (w.length >= 11) {
      latest = {
        roundId: id, ticketPrice: asNum(w[0]), prizeBps: asNum(w[1]), treasuryBps: asNum(w[2]),
        burnBps: asNum(w[3]), ticketCount: asNum(w[4]), prizePool: asNum(w[5]), closed: asBool(w[6]),
        drawn: asBool(w[7]), commitBlock: asNum(w[8]), saltHash: '0x' + w[9], winner: asAddr(w[10]),
      };
    }
  }
  return { ok: true, count, latest };
}

export async function readMarkets() {
  const cnt = await ethCall(MARKET_ADDR, SEL.marketCount);
  if (cnt == null) return { ok: false, count: 0, list: [] };
  const count = asNum(words(cnt)[0]);
  const list = [];
  for (let id = 0; id < count && id < 25; id++) {
    const m = await ethCall(MARKET_ADDR, SEL.getMarket + pad(id));
    // getMarket returns the full Market struct — a DYNAMIC tuple (field 0 is `string question`), so the
    // outer return has a leading offset word (0x20). Skip it; the tuple head follows. Field order:
    // [0]question-offset [1]sourceRef [2]closeTime [3]disputeWindow [4]feeBps [5]disputeBond [6]yesPool
    // [7]noPool [8]phase [9]proposed [10]outcome [11]proposedAt [12]disputer [13]distributable [14]winningPool
    const h = words(m).slice(1);
    if (h.length >= 15) {
      const yes = asBig(h[6]); const no = asBig(h[7]); const tot = yes + no;
      list.push({
        marketId: id, yesPool: yes.toString(), noPool: no.toString(),
        yesPct: tot > 0n ? Number((yes * 10000n) / tot) / 100 : 0,
        closeTime: asNum(h[2]), disputeWindow: asNum(h[3]), feeBps: asNum(h[4]),
        phase: PHASES[asNum(h[8])] || String(asNum(h[8])), outcome: OUTCOMES[asNum(h[10])] || '?',
        proposedAt: asNum(h[11]),
      });
    }
  }
  return { ok: true, count, list };
}

export async function readAll() {
  const [lotto, markets] = await Promise.all([readLotto(), readMarkets()]);
  return { chainId: CHAIN_ID, rpc: RPC, contracts: { lotto: LOTTO_ADDR, market: MARKET_ADDR }, lotto, markets };
}

// ---- render ------------------------------------------------------------------------------------------ //
function lottoCard(l) {
  if (!l || !l.ok) return `<div class="card"><h3>KULA Lotto</h3><p class="muted">Chain read unavailable — RPC unreachable.</p></div>`;
  if (!l.latest) return `<div class="card"><h3>KULA Lotto</h3><p class="muted">No rounds open yet (roundCount ${esc(l.count)}).</p></div>`;
  const r = l.latest;
  const status = r.drawn ? 'Drawn' : (r.closed ? 'Closed — awaiting draw' : 'Open for tickets');
  return `<div class="card"><h3>KULA Lotto — round ${esc(r.roundId)}</h3>
    <p><b>${esc(status)}</b></p>
    <ul class="kv">
      <li>Tickets sold: <b>${esc(r.ticketCount)}</b></li>
      <li>Prize pool: <b>${esc(r.prizePool)}</b> PLAY (base units)</li>
      <li>Split: prize <b>${esc(r.prizeBps / 100)}%</b> · treasury <b>${esc(r.treasuryBps / 100)}%</b> · burn <b>${esc(r.burnBps / 100)}%</b></li>
      ${r.drawn ? `<li>Winner: <code>${esc(r.winner)}</code></li>` : ''}
      ${r.closed ? `<li>Commit block: <b>${esc(r.commitBlock)}</b> · saltHash <code>${esc(r.saltHash.slice(0, 18))}…</code></li>` : ''}
    </ul></div>`;
}
function marketCard(m) {
  return `<div class="card"><h3>Market ${esc(m.marketId)}</h3>
    <p>Phase: <b>${esc(m.phase)}</b>${m.outcome && m.outcome !== 'Unset' ? ` · outcome <b>${esc(m.outcome)}</b>` : ''}</p>
    <ul class="kv">
      <li>Yes pool: <b>${esc(m.yesPool)}</b> · No pool: <b>${esc(m.noPool)}</b></li>
      <li>Market-implied Yes: <b>${esc(m.yesPct)}%</b></li>
      <li>Closes at: <b>${esc(m.closeTime)}</b> (unix) · fee ${esc(m.feeBps / 100)}%</li>
    </ul></div>`;
}
function marketsCard(mk) {
  if (!mk || !mk.ok) return `<div class="card"><h3>Event Markets</h3><p class="muted">Chain read unavailable.</p></div>`;
  if (!mk.count) return `<div class="card"><h3>Event Markets</h3><p class="muted">No markets created yet.</p></div>`;
  return mk.list.map(marketCard).join('');
}

export async function renderPage() {
  const data = await readAll();
  const body = `
    <p class="muted">Live testnet state, read straight from the deployed arcade contracts on PRANA
      (chainId ${esc(data.chainId)}) via <code>eth_call</code>. Nothing here is cached.</p>
    <div class="grid">
      ${lottoCard(data.lotto)}
      ${marketsCard(data.markets)}
    </div>
    <p class="muted" style="font-size:12px">KulaLotto <code>${esc(data.contracts.lotto || '(unset)')}</code> ·
      BinaryEventMarket <code>${esc(data.contracts.market || '(unset)')}</code></p>
    ${DISCLAIMER}`;
  return shell({ title: 'KULA Arcade — live testnet state', body, basePath: BASE_PATH, baseUrl: BASE_URL });
}

export async function handler(req, res) {
  const url = new URL(req.url, BASE_URL);
  let path = url.pathname;
  if (BASE_PATH && path.startsWith(BASE_PATH)) path = path.slice(BASE_PATH.length) || '/';
  const common = commonRoutes(req, res, path, { name: 'arcade-live' });
  if (common) return common;
  try {
    if (path === '/api/live') return sendJson(res, { ok: true, ...(await readAll()) });
    if (path === '/' || path === '') return sendHtml(res, await renderPage());
    return sendJson(res, { ok: false, error: 'not found' }, 404);
  } catch (e) {
    return sendJson(res, { ok: false, error: String(e && e.message || e) }, 500);
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`KULA Arcade LIVE reader on ${BASE_URL} — RPC ${RPC || '(unset)'} chain ${CHAIN_ID}`));
}
