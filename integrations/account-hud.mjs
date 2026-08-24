// account-hud.mjs — the MELEK account-stats HUD (our SteemWorld / SteemAuto analog).
//
// A THIRD account surface, distinct from the profile page and the wallet: for ANY account it shows
// the "energy" readings the Steem-family blogs made famous (the little avatar-power-drain meter) —
// voting mana %, downvote mana %, and Resource-Credit % — plus effective MELEK Power, reputation,
// delegations IN/OUT, and witness/proxy votes. This is the data layer the trade-watch bots consume
// (see memory economy-hud-and-managed-account-health-bot): keep it READ-ONLY and legible where
// Steem's own page is notoriously confusing. MELEK is a Blurt clone but — unlike Blurt, which
// dropped the mana model for paid posts — we KEEP the energy meter.
//
// ───────────────────────────────────────────────────────────────────────────────────────────────
//  READ-ONLY · NO KEYS · SOFT-FAIL.  Standard condenser_api / rc_api reads only. Never broadcasts,
//  never holds a WIF. Every section soft-fails independently: rc_api missing (some forks lack the
//  plugin) or one RPC down does NOT take the board down — that field is just null and marked ok:false.
// ───────────────────────────────────────────────────────────────────────────────────────────────
//
//   import { accountBoard, headline, renderBoard, handler } from './integrations/account-hud.mjs';
//   const board = await accountBoard({ account: 'hathor' });
//   console.log(headline(board));     // "hathor — 87.4% energy · 45,120 MP · rep 62 · 3 delegations out"
//   res.end(renderBoard(board));      // escaped HTML HUD
//
// Tests inject the chain via __setFetch(fn) (canned JSON-RPC), so the whole board assembles OFFLINE.
//
//   node integrations/account-hud.mjs hathor      # print the HUD summary (live; soft-fails to nulls)

import { vestsToPower, esc } from '../src/chain/vests-converter.mjs';
import { manaRegen } from './rc-cost.mjs';

// Steem/Blurt-family mana regenerates fully over 5 days. MELEK inherits this (memory
// melek-curation-vote-constants: "5-day mana"). Voting, downvote, and RC pools all use this window.
const MANA_REGEN_SECONDS = 432000; // 5 days
const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

// ── injectable fetch (offline tests) ────────────────────────────────────────────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

export function rpcUrl() { return process.env.MELEK_RPC_URL || ''; }
export function configured() { return !!rpcUrl(); }
export function network() {
  return String(process.env.MELEK_NETWORK || 'testnet').toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet';
}
export function networkLabel() { return network() === 'mainnet' ? '[MELEK]' : '[TestNet not MELEK]'; }

// ── numeric helpers ─────────────────────────────────────────────────────────────────────────────
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const round = (n, p = 2) => +num(n).toFixed(p);
// Parse the leading number out of a Graphene asset string ("1234.567 VESTS") or a plain number.
function assetNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') { const m = v.trim().match(/^[-+]?\d*\.?\d+/); return m ? num(m[0]) : 0; }
  return 0;
}
// Head-block ISO time (or now) as unix seconds, for deterministic mana regen from last_update_time.
function nowSeconds(headTimeIso) {
  if (headTimeIso) { const t = Date.parse(String(headTimeIso).endsWith('Z') ? headTimeIso : headTimeIso + 'Z'); if (Number.isFinite(t)) return Math.floor(t / 1000); }
  return Math.floor(Date.now() / 1000);
}

// ── one JSON-RPC call (params may be array or object; rc_api uses object) ─────────────────────────
async function rpc(method, params = [], timeout = 12000) {
  const url = rpcUrl();
  if (!url) return null;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await _fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || d.error) return null;
    return d.result;
  } catch { return null; } finally { clearTimeout(t); }
}

// Regenerated mana % of a Graphene manabar {current_mana, last_update_time} against a max pool.
// current_mana is the value AS OF last_update_time; it regenerates linearly to maxMana over 5 days.
function manabarPct(bar, maxMana, nowSec) {
  const max = num(maxMana);
  if (max <= 0 || !bar) return 0;
  const current = num(bar.current_mana);
  const last = num(bar.last_update_time);
  const elapsed = Math.max(0, nowSec - last);
  const { regenerated } = manaRegen({ maxMana: max, regenSeconds: MANA_REGEN_SECONDS, elapsedSeconds: elapsed });
  const manaNow = Math.min(max, current + regenerated);
  return Math.max(0, Math.min(100, (manaNow / max) * 100));
}

// ── the reader: normalize an account's raw chain facts (soft-fails to null) ───────────────────────

/**
 * Pull the raw stats for one account: the account object, global props (for the vests→power ratio
 * and head time), outgoing delegations, and RC (rc_api — soft-fails to null if the plugin is absent).
 * @returns {Promise<object|null>} { account, props, delegationsOut, rc, headTime } or null when the
 *   account can't be read at all.
 */
export async function accountStats(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  const [accs, props] = await Promise.all([
    rpc('condenser_api.get_accounts', [[n]]),
    rpc('condenser_api.get_dynamic_global_properties', []),
  ]);
  const a = Array.isArray(accs) ? accs[0] : null;
  if (!a || !a.name) return null;
  // Outgoing delegations + RC are best-effort — either can be missing on a given node.
  const [delOut, rcRes] = await Promise.all([
    rpc('condenser_api.get_vesting_delegations', [n, '', 100]),
    rpc('rc_api.find_rc_accounts', { accounts: [n] }),
  ]);
  const rc = rcRes && Array.isArray(rcRes.rc_accounts) ? rcRes.rc_accounts[0] : null;
  return {
    account: a,
    props: props || null,
    delegationsOut: Array.isArray(delOut) ? delOut : [],
    rc: rc || null,
    headTime: props && props.time ? props.time : null,
  };
}

// ── the board: derived, plain-English-ready stats built from the raw reader ───────────────────────

/**
 * Assemble the account HUD. Every derived section soft-fails independently.
 * @param {object} [opts]
 * @param {string} [opts.account]  account to read (default 'hathor')
 * @param {object} [opts.stats]    injected raw stats (tests); when absent, reads the chain
 * @returns {Promise<object>} the board (fields below); `sections.{name}.ok` reports data availability.
 */
export async function accountBoard({ account = 'hathor', stats = null } = {}) {
  const asOf = new Date().toISOString();
  const name = String(account || 'hathor').trim().toLowerCase();
  const raw = stats || (await accountStats(name));

  if (!raw || !raw.account) {
    return { asOf, account: name, network: network(), label: networkLabel(), found: false,
      energy: null, power: null, reputation: null, delegations: null, votes: null,
      sections: { energy: { ok: false }, power: { ok: false }, reputation: { ok: false }, delegations: { ok: false }, votes: { ok: false } } };
  }

  const a = raw.account;
  const props = raw.props || {};
  const nowSec = nowSeconds(raw.headTime);
  const ratioProps = { totalVestingFund: props.total_vesting_fund_balance, totalVestingShares: props.total_vesting_shares };

  // Effective stake (VESTS): own + received − delegated-out. Drives both max voting mana and MP.
  const ownVests = assetNum(a.vesting_shares);
  const recvVests = assetNum(a.received_vesting_shares);
  const delegVests = assetNum(a.delegated_vesting_shares);
  const effectiveVests = Math.max(0, ownVests + recvVests - delegVests);

  // 1) energy — the meter: voting mana %, downvote mana %, RC %. Manabar integers are micro-VESTS
  //    (asset value × 1e6), so the max pool for voting/downvote is effectiveVests × 1e6.
  const energy = (() => {
    const maxVoteMana = effectiveVests * 1e6;
    const voting = a.voting_manabar ? round(manabarPct(a.voting_manabar, maxVoteMana, nowSec), 1) : null;
    const downvote = a.downvote_manabar ? round(manabarPct(a.downvote_manabar, maxVoteMana / 4, nowSec), 1) : null; // downvote pool ≈ 1/4 (Steem-family)
    let rc = null;
    if (raw.rc && raw.rc.rc_manabar && raw.rc.max_rc != null) {
      rc = round(manabarPct(raw.rc.rc_manabar, num(raw.rc.max_rc), nowSec), 1);
    }
    if (voting == null && downvote == null && rc == null) return null;
    return { votingPct: voting, downvotePct: downvote, rcPct: rc, maxRc: raw.rc ? num(raw.rc.max_rc) : null };
  })();

  // 2) power — effective MELEK Power (vests→power via the shared converter) + the vests breakdown.
  const power = (() => {
    if (!props.total_vesting_shares) return null;
    return {
      effectiveMp: round(vestsToPower(effectiveVests, ratioProps), 3),
      ownMp: round(vestsToPower(ownVests, ratioProps), 3),
      receivedMp: round(vestsToPower(recvVests, ratioProps), 3),
      delegatedMp: round(vestsToPower(delegVests, ratioProps), 3),
      balances: { liquid: a.balance || null, stable: a.sbd_balance || null, savings: a.savings_balance || null },
    };
  })();

  // 3) reputation — the standard Steem reputation transform (raw int → ~25–75 display score).
  const reputation = (() => {
    if (a.reputation == null) return null;
    const raw0 = num(a.reputation);
    if (raw0 === 0) return { score: 25, raw: 0 };
    const neg = raw0 < 0;
    let score = Math.log10(Math.abs(raw0));
    score = Math.max(score - 9, 0);
    score = (neg ? -1 : 1) * score * 9 + 25;
    return { score: round(score, 1), raw: raw0 };
  })();

  // 4) delegations — OUT list (from get_vesting_delegations) + IN/OUT totals (from the account object).
  const delegations = (() => {
    const out = (raw.delegationsOut || []).map((d) => ({
      to: d.delegatee, vests: assetNum(d.vesting_shares),
      mp: round(vestsToPower(assetNum(d.vesting_shares), ratioProps), 3),
      since: d.min_delegation_time || null,
    })).sort((x, y) => y.vests - x.vests);
    return {
      out, outCount: out.length,
      outTotalMp: round(vestsToPower(delegVests, ratioProps), 3),
      inTotalMp: round(vestsToPower(recvVests, ratioProps), 3),
    };
  })();

  // 5) votes — witness votes / proxy (public governance facts).
  const votes = (() => {
    const wv = Array.isArray(a.witness_votes) ? a.witness_votes : [];
    return { witnessVotes: wv, witnessCount: wv.length, proxy: a.proxy || '' };
  })();

  return {
    asOf, account: a.name, network: network(), label: networkLabel(), found: true,
    created: a.created || null, postCount: num(a.post_count),
    energy, power, reputation, delegations, votes,
    sections: {
      energy: { ok: energy != null },
      power: { ok: power != null },
      reputation: { ok: reputation != null },
      delegations: { ok: true },
      votes: { ok: true },
    },
  };
}

// ── headline: one plain-English line ──────────────────────────────────────────────────────────────

/** One-line summary, e.g. "hathor — 87.4% energy · 45,120 MP · rep 62 · 3 delegations out". */
export function headline(board) {
  if (!board) return 'Account HUD unavailable.';
  if (!board.found) return `@${esc(board.account)} not found on ${board.label}.`;
  const parts = [`@${board.account}`];
  if (board.energy && board.energy.votingPct != null) parts.push(`${board.energy.votingPct}% energy`);
  if (board.power && board.power.effectiveMp != null) parts.push(`${board.power.effectiveMp.toLocaleString()} MP`);
  if (board.reputation) parts.push(`rep ${board.reputation.score}`);
  if (board.delegations && board.delegations.outCount) parts.push(`${board.delegations.outCount} delegation${board.delegations.outCount === 1 ? '' : 's'} out`);
  return parts.join(' · ') + ` ${board.label}`;
}

// ── renderBoard: escaped HTML HUD ─────────────────────────────────────────────────────────────────

function bar(label, pct) {
  const p = pct == null ? null : Math.max(0, Math.min(100, num(pct)));
  const width = p == null ? 0 : p;
  const cls = p == null ? 'ah-bar-na' : p < 20 ? 'ah-bar-low' : p < 60 ? 'ah-bar-mid' : 'ah-bar-hi';
  const val = p == null ? 'n/a' : `${round(p, 1)}%`;
  return `<div class="ah-meter"><span class="ah-meter-label">${esc(label)}</span>`
    + `<span class="ah-bar"><span class="ah-bar-fill ${cls}" style="width:${width}%"></span></span>`
    + `<span class="ah-meter-val">${esc(val)}</span></div>`;
}

function card(title, ok, inner) {
  const flag = ok ? '' : ` <span class="ah-down">(no data)</span>`;
  return `<section class="ah-card"><h3>${esc(title)}${flag}</h3>${inner}</section>`;
}

/**
 * Render the HUD as escaped HTML: the energy meters first (the SteemWorld headline reading), then
 * power, delegations, reputation and votes. A visible read-only line. Everything is HTML-escaped.
 */
export function renderBoard(board) {
  if (!board) return `<div class="account-hud"><p>Account HUD unavailable.</p></div>`;
  if (!board.found) return `<div class="account-hud"><h2>Account HUD</h2><p>@${esc(board.account)} not found on ${esc(board.label)}.</p></div>`;

  const head = `<p class="ah-headline">${esc(headline(board))}</p>`;
  const note = `<p class="ah-readonly"><strong>Read-only.</strong> Public chain stats only — this page holds no keys and changes nothing on-chain.</p>`;

  // energy meters
  const e = board.energy;
  const energyHtml = e
    ? bar('Voting energy', e.votingPct) + bar('Downvote energy', e.downvotePct) + bar('Resource Credits', e.rcPct)
    : `<p>No mana data.</p>`;

  // power
  const p = board.power;
  const powerHtml = p
    ? `<p><strong>${esc(p.effectiveMp.toLocaleString())} MP</strong> effective</p>`
      + `<p>own ${esc(p.ownMp.toLocaleString())} · +received ${esc(p.receivedMp.toLocaleString())} · −delegated ${esc(p.delegatedMp.toLocaleString())}</p>`
      + `<p>Balances: ${esc(p.balances.liquid || '—')} · ${esc(p.balances.stable || '—')}</p>`
    : `<p>No power data.</p>`;

  // delegations
  const d = board.delegations;
  let delHtml = `<p>Out: ${esc(round(d.outTotalMp).toLocaleString())} MP · In: ${esc(round(d.inTotalMp).toLocaleString())} MP</p>`;
  if (d.out && d.out.length) {
    delHtml += `<ul class="ah-deleg">${d.out.slice(0, 20).map((x) =>
      `<li>@${esc(x.to)} — ${esc(round(x.mp).toLocaleString())} MP</li>`).join('')}</ul>`;
  } else {
    delHtml += `<p>No outgoing delegations.</p>`;
  }

  // reputation
  const r = board.reputation;
  const repHtml = r ? `<p>Reputation score: <strong>${esc(r.score)}</strong></p>` : `<p>No reputation data.</p>`;

  // votes
  const v = board.votes;
  let voteHtml = v.proxy
    ? `<p>Witness voting proxied to @${esc(v.proxy)}.</p>`
    : `<p>${esc(v.witnessCount)} witness vote${v.witnessCount === 1 ? '' : 's'}.</p>`;
  if (v.witnessVotes && v.witnessVotes.length) {
    voteHtml += `<ul class="ah-votes">${v.witnessVotes.slice(0, 30).map((w) => `<li>@${esc(w)}</li>`).join('')}</ul>`;
  }

  const S = board.sections || {};
  return `<div class="account-hud">`
    + `<h2>Account HUD — @${esc(board.account)} <span class="ah-net">${esc(board.label)}</span></h2>`
    + head + note
    + card('Energy', S.energy?.ok, energyHtml)
    + card('MELEK Power', S.power?.ok, powerHtml)
    + card('Delegations', S.delegations?.ok, delHtml)
    + card('Reputation', S.reputation?.ok, repHtml)
    + card('Witness Votes', S.votes?.ok, voteHtml)
    + `</div>`;
}

// ── handler(req,res): HTTP surface — HTML page or JSON API ─────────────────────────────────────────

const PAGE_CSS = `
.account-hud{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:0 auto;padding:16px;color:#e8e8ea}
.account-hud h2{font-size:1.3rem;margin:0 0 4px}.ah-net{font-size:.7rem;opacity:.6;font-weight:400}
.ah-headline{font-size:1rem;opacity:.9;margin:.2rem 0}.ah-readonly{font-size:.75rem;opacity:.6;margin:.2rem 0 1rem}
.ah-card{background:#17171b;border:1px solid #2a2a30;border-radius:10px;padding:12px 14px;margin:10px 0}
.ah-card h3{font-size:.95rem;margin:0 0 8px;opacity:.85}
.ah-meter{display:flex;align-items:center;gap:8px;margin:6px 0}
.ah-meter-label{flex:0 0 130px;font-size:.8rem;opacity:.8}
.ah-bar{flex:1;height:12px;background:#0d0d10;border-radius:6px;overflow:hidden}
.ah-bar-fill{display:block;height:100%}.ah-bar-hi{background:#3fb950}.ah-bar-mid{background:#d29922}.ah-bar-low{background:#f85149}.ah-bar-na{background:#30363d}
.ah-meter-val{flex:0 0 52px;text-align:right;font-variant-numeric:tabular-nums;font-size:.8rem}
.ah-deleg,.ah-votes{margin:.3rem 0;padding-left:1.1rem;font-size:.85rem;columns:2}
.ah-down{color:#f85149;font-size:.7rem;font-weight:400}
a{color:#58a6ff}`;

function pageHtml(board) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>Account HUD — @${esc(board.account)}</title><style>body{background:#0b0b0d}${PAGE_CSS}</style></head>`
    + `<body>${renderBoard(board)}`
    + `<p style="max-width:760px;margin:14px auto;font-size:.75rem;opacity:.5">MELEK account HUD · read-only · <a href="?account=hathor">hathor</a></p>`
    + `</body></html>`;
}

/**
 * HTTP handler. GET / or /hud?account=NAME → HTML HUD. GET /api?account=NAME (or Accept: json) → JSON.
 * Read-only, no keys. Exported for tests; the CLI/server wraps it.
 */
export async function handler(req, res) {
  try {
    const u = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
    const account = (u.searchParams.get('account') || 'hathor').trim().toLowerCase();
    const wantsJson = u.pathname.endsWith('/api') || String(req.headers?.accept || '').includes('application/json');
    const board = await accountBoard({ account });
    if (wantsJson) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(board));
      return;
    }
    res.writeHead(board.found ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(pageHtml(board));
  } catch {
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<p>Account HUD error.</p>');
  }
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('account-hud.mjs')) {
  const account = (process.argv[2] || 'hathor').toLowerCase();
  const board = await accountBoard({ account });
  console.log('ACCOUNT HUD — read-only, no keys\n' + '─'.repeat(60));
  console.log(headline(board));
  if (board.found) {
    console.log('\nSection status:');
    for (const [name, s] of Object.entries(board.sections)) console.log(`  ${name.padEnd(12)} ${s.ok ? 'ok' : 'no data'}`);
    if (board.energy) console.log(`\nEnergy: voting ${board.energy.votingPct}% · downvote ${board.energy.downvotePct}% · RC ${board.energy.rcPct}%`);
  }
  if (!configured()) console.log('\n(MELEK_RPC_URL unset — live reads soft-fail to "not found".)');
}
