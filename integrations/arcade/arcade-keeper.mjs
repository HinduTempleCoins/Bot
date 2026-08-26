// arcade-keeper.mjs — the PURE planner for the KULA Arcade play-token DeFi keeper (PRANA testnet).
//
// The patch-0004 arcade contracts (contracts/contracts/arcade/) need an off-chain keeper to drive the
// lifecycle steps no player triggers: open/close/draw the KulaLotto rounds (a commit-reveal that must keep a
// salt secret between two txs), and propose/finalize the BinaryEventMarket outcomes after each market closes.
// This module decides WHAT is due and WHY — pure, deterministic, offline-testable. It never signs, never
// touches the chain, never holds a key. The runner (arcade-keeper-run.mjs) supplies the on-chain snapshot +
// an EVM signer adapter + a persistent salt store, executes the plan, and routes anything it can't/shouldn't
// do to a human.
//
// COMPLIANCE LINE (hard, per .local/RESEARCH_PREDICTION_MARKETS_BETTING.md §5/§6 + the
// prana-defi-arcade-compliance-line memory): this keeper operates ONLY the non-cashable PLAY-token arcade on
// testnet. It NEVER moves real money, NEVER auto-adjudicates a DISPUTED market (that is a governance/human
// step — resolveDisputed is out of scope for the keeper), and NEVER proposes a market outcome it isn't
// confident about (an injected resolver returns null → the keeper holds and flags for a human).
//
// Two lifecycles, each a small state machine over on-chain state + keeper-side metadata (open timestamps and
// the secret salt, which the contracts do NOT store):
//
//   KulaLotto round: open ──(entry window elapsed & ticketCount>0)──▶ close(commit saltHash)
//                    close ──(revealBlock mined, within 256-block window)──▶ draw(reveal salt)
//                    close ──(256-block window expired)──▶ reArm(commit fresh saltHash)
//   BinaryEventMarket: Open ──(closeTime passed & resolver confident)──▶ proposeOutcome
//                      Proposed ──(dispute window elapsed, not disputed)──▶ finalize
//                      Disputed ──▶ HUMAN (never auto-resolved)
//
// PURE + soft-fail: planActions(snapshot, cfg, now) -> { actions:[{kind,roundId|marketId,reason,params}],
// notes:[...] }. Bad/partial input yields a note, never a throw.

/** Lotto round on-chain phases we care about (derived from the Round struct's closed/drawn flags). */
export const LOTTO = { OPEN: 'open', CLOSED: 'closed', DRAWN: 'drawn' };

/** BinaryEventMarket.Phase enum order — MUST match the Solidity enum in BinaryEventMarket.sol. */
export const PHASE = ['Open', 'Closed', 'Proposed', 'Disputed', 'Resolved'];

export const DEFAULTS = {
  // KulaLotto cadence (keeper policy — the contract enforces only commit→reveal block spacing).
  entryWindowSec: 3600,        // how long a round takes tickets before the keeper closes it
  roundIntervalSec: 3600,      // min gap between opening one round and opening the next
  emptyGraceSec: 1800,         // extra wait before giving up on a 0-ticket round (contract rejects a 0-ticket close)
  revealLeadBlocks: 1,         // draw is valid only after commitBlock + this many blocks (contract: +1)
  expiryBlocks: 256,           // blockhash window; past this a closed round must be reArmed (contract: 256)
  // Default disclosed pool split for a newly opened round (bps, must sum to 10000).
  openTicketPrice: 100,        // PLAY per ticket
  openPrizeBps: 8000,
  openTreasuryBps: 1000,
  openBurnBps: 1000,
  // BinaryEventMarket.
  disputeGraceSec: 0,          // extra slack after the on-chain dispute window before we finalize
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isObj = (v) => v && typeof v === 'object';

/**
 * Plan the lotto action (if any) for ONE round, given its on-chain state and the keeper's metadata.
 * @param {object} round  on-chain: { roundId, closed, drawn, ticketCount, commitBlock }
 * @param {object} meta   keeper store: { openedAt?:sec, salt?:string, saltHash?:string }
 * @param {number} block  current chain block number
 * @param {object} cfg
 * @param {number} now    unix seconds
 * @returns {object|null} an action, or null if nothing is due for this round
 */
export function planLottoRound(round, meta, block, cfg, now) {
  if (!isObj(round)) return null;
  const c = { ...DEFAULTS, ...(cfg || {}) };
  const id = num(round.roundId);
  const closed = !!round.closed;
  const drawn = !!round.drawn;
  const tickets = num(round.ticketCount);
  const commitBlock = num(round.commitBlock);
  const openedAt = num(meta?.openedAt) || 0;

  if (drawn) return null;                       // finished

  if (!closed) {
    // Entry phase. Close once the window has elapsed AND there is at least one ticket (the contract reverts
    // NoTickets on a 0-ticket close). A round that stays empty past the grace period is left for a human.
    const age = openedAt ? now - openedAt : 0;
    if (tickets > 0 && (!openedAt || age >= c.entryWindowSec)) {
      return { kind: 'lotto.close', roundId: id, reason: `entry window elapsed (${age}s), ${tickets} ticket(s)` };
    }
    if (tickets === 0 && openedAt && age >= c.entryWindowSec + c.emptyGraceSec) {
      return { kind: 'lotto.skip', roundId: id, reason: `round ${id} still empty after ${age}s — cannot close (NoTickets); leave for a human` };
    }
    return null;                                // still taking tickets
  }

  // Closed, not drawn — commit-reveal draw window.
  const revealBlock = commitBlock + c.revealLeadBlocks;
  if (block <= revealBlock) {
    return { kind: 'lotto.wait', roundId: id, reason: `waiting for reveal block ${revealBlock + 1} (at ${block})` };
  }
  if (block > commitBlock + c.expiryBlocks) {
    // blockhash(revealBlock) has left the 256-block window → the salt can no longer be used; re-arm.
    return { kind: 'lotto.rearm', roundId: id, reason: `reveal window expired (block ${block} > ${commitBlock + c.expiryBlocks}); re-arm with a fresh salt` };
  }
  if (!meta?.salt) {
    return { kind: 'lotto.stuck', roundId: id, reason: `round ${id} closed but keeper has no stored salt — cannot reveal; needs a human` };
  }
  return { kind: 'lotto.draw', roundId: id, reason: `reveal block mined (${block}); draw`, params: { salt: meta.salt } };
}

/**
 * Plan across all lotto rounds + decide whether to open a fresh one.
 * @param {object} lotto  { rounds:[...], block:number, meta:{ [roundId]: {openedAt,salt,saltHash} }, lastOpenedAt?:sec }
 */
export function planLotto(lotto, cfg, now) {
  const c = { ...DEFAULTS, ...(cfg || {}) };
  const out = [];
  const rounds = Array.isArray(lotto?.rounds) ? lotto.rounds : [];
  const meta = isObj(lotto?.meta) ? lotto.meta : {};
  const block = num(lotto?.block);

  let anyOpen = false;
  for (const r of rounds) {
    const id = num(r.roundId);
    if (!r.closed && !r.drawn) anyOpen = true;
    const a = planLottoRound(r, meta[id], block, c, now);
    if (a) out.push(a);
  }

  // Open a new round only when nothing is currently taking tickets and the interval has elapsed.
  if (!anyOpen) {
    const last = num(lotto?.lastOpenedAt);
    if (!last || now - last >= c.roundIntervalSec) {
      out.push({
        kind: 'lotto.open',
        reason: last ? `interval elapsed (${now - last}s), no open round` : 'no rounds yet',
        params: { ticketPrice: c.openTicketPrice, prizeBps: c.openPrizeBps, treasuryBps: c.openTreasuryBps, burnBps: c.openBurnBps },
      });
    }
  }
  return out;
}

/**
 * Plan the action (if any) for ONE market.
 * @param {object} m  on-chain: { marketId, phase:number|string, closeTime:sec, proposedAt:sec,
 *                                 disputeWindow:sec, disputer?:address }
 * @param {object} cfg
 * @param {number} now  unix seconds
 * @param {function} [resolve]  (m)=>({outcome:'Yes'|'No'|'Invalid', source, confident:true}) | null
 */
export function planMarket(m, cfg, now, resolve) {
  if (!isObj(m)) return null;
  const c = { ...DEFAULTS, ...(cfg || {}) };
  const id = num(m.marketId);
  const phase = typeof m.phase === 'number' ? PHASE[m.phase] : String(m.phase || '');
  const closeTime = num(m.closeTime);
  const proposedAt = num(m.proposedAt);
  const disputeWindow = num(m.disputeWindow);
  const disputed = m.disputer && String(m.disputer).replace(/^0x/, '').replace(/0/g, '') !== '';

  if (phase === 'Open' || phase === 'Closed') {
    if (now < closeTime) return null;           // still trading
    // Market closed — propose an outcome, but ONLY from a confident named source (Kalshi discipline).
    const r = typeof resolve === 'function' ? safeResolve(resolve, m) : null;
    if (!r || r.confident === false || !r.outcome) {
      return { kind: 'market.hold', marketId: id, reason: `closed at ${closeTime} but no confident resolution — holding for a human/source` };
    }
    if (!['Yes', 'No', 'Invalid'].includes(r.outcome)) {
      return { kind: 'market.hold', marketId: id, reason: `resolver returned bad outcome ${JSON.stringify(r.outcome)} — holding` };
    }
    return { kind: 'market.propose', marketId: id, reason: `resolved ${r.outcome} via ${r.source || 'resolver'}`, params: { outcome: r.outcome, source: r.source || null } };
  }

  if (phase === 'Proposed') {
    if (disputed) return { kind: 'market.human', marketId: id, reason: 'proposal disputed — governance must resolveDisputed (never automated)' };
    const windowEnd = proposedAt + disputeWindow + c.disputeGraceSec;
    if (now <= windowEnd) return { kind: 'market.wait', marketId: id, reason: `dispute window open until ${windowEnd} (now ${now})` };
    return { kind: 'market.finalize', marketId: id, reason: `dispute window elapsed (${now} > ${windowEnd})` };
  }

  if (phase === 'Disputed') {
    return { kind: 'market.human', marketId: id, reason: 'market disputed — needs governance resolveDisputed (keeper never adjudicates)' };
  }

  return null;                                  // Resolved / unknown → nothing to do
}

/** A resolver is caller-supplied and may throw; never let it break the plan. */
function safeResolve(resolve, m) {
  try { return resolve(m) || null; } catch { return null; }
}

export function planMarkets(markets, cfg, now, resolve) {
  const list = Array.isArray(markets) ? markets : (Array.isArray(markets?.list) ? markets.list : []);
  const out = [];
  for (const m of list) { const a = planMarket(m, cfg, now, resolve); if (a) out.push(a); }
  return out;
}

/**
 * Top-level plan. Pure; returns the full action list + human-readable notes. Soft-fails to an empty plan.
 * @param {object} snapshot { lotto:{rounds,block,meta,lastOpenedAt}, markets:{list}|[...] }
 * @param {object} cfg
 * @param {number} now
 * @param {function} [resolve] market outcome resolver (from the watchdog / 17-API named sources)
 */
export function planActions(snapshot, cfg, now = Math.floor(Date.now() / 1000), resolve) {
  const actions = [];
  const notes = [];
  try {
    actions.push(...planLotto(snapshot?.lotto || {}, cfg, now));
  } catch (e) { notes.push(`lotto plan soft-failed: ${e?.message || e}`); }
  try {
    actions.push(...planMarkets(snapshot?.markets ?? [], cfg, now, resolve));
  } catch (e) { notes.push(`market plan soft-failed: ${e?.message || e}`); }

  // Surface the "needs a human" / "can't act" actions as notes too, so a timer log shows them plainly.
  for (const a of actions) {
    if (['lotto.skip', 'lotto.stuck', 'market.human', 'market.hold'].includes(a.kind)) {
      notes.push(`${a.kind}: ${a.reason}`);
    }
  }
  return { actions, notes };
}

/** Actions the runner should actually broadcast (vs. wait/hold/human/skip which are no-ops it just logs). */
export const EXECUTABLE = new Set(['lotto.open', 'lotto.close', 'lotto.draw', 'lotto.rearm', 'market.propose', 'market.finalize']);

export function executable(actions) {
  return (Array.isArray(actions) ? actions : []).filter((a) => EXECUTABLE.has(a?.kind));
}

/**
 * Orchestrate one keeper pass: read → plan → execute, managing the commit-reveal salt lifecycle. Fully
 * dependency-injected so it runs offline in tests (fake adapter/store/rng/hasher). Soft-fails per action —
 * one failed tx leaves that round/market in place for the next pass (idempotent, retry-safe). Never throws.
 *
 * @param {object} deps
 * @param {object} deps.adapter  on-chain seam. Reads: readLotto()->{rounds,block,lastOpenedAt},
 *        readMarkets()->[...]. Writes (return a tx id): openRound(p), closeRound(id,saltHash),
 *        drawRound(id,salt), reArmDraw(id,saltHash), createMarket(p), proposeOutcome(id,outcome),
 *        finalize(id).
 * @param {object} deps.store    salt/metadata persistence: get(key)->obj, set(key,obj), all()->obj.
 * @param {function} deps.rng    ()=>hexSalt (0x + 64 hex). Defaults to crypto-strong in the runner.
 * @param {function} deps.hash   (hexSalt)=>saltHash matching keccak256(abi.encodePacked(salt)).
 * @param {function} [deps.resolve] market outcome resolver.
 * @param {object}  [deps.cfg]
 * @param {number}  [deps.now]
 * @param {boolean} [deps.dry]   plan + log only; do not broadcast.
 */
export async function runKeeper(deps) {
  const { adapter, store, rng, hash, resolve, cfg, dry = false } = deps || {};
  const now = deps?.now ?? Math.floor(Date.now() / 1000);
  const result = { ok: true, planned: 0, executed: [], skipped: [], errors: [], notes: [] };
  if (!adapter) { result.ok = false; result.errors.push('no adapter'); return result; }

  let lotto = { rounds: [], block: 0, meta: {}, lastOpenedAt: 0 };
  let markets = [];
  try { lotto = { ...(await adapter.readLotto()) }; }
  catch (e) { result.notes.push(`readLotto soft-failed: ${e?.message || e}`); }
  try { markets = (await adapter.readMarkets()) || []; }
  catch (e) { result.notes.push(`readMarkets soft-failed: ${e?.message || e}`); }
  // Re-attach keeper metadata (open timestamps + salts) the adapter can't know: the store keys per-round
  // state as `round:N` and the last open time as `_lastOpenedAt` — translate those into what the planner
  // expects (meta keyed by roundId, plus lastOpenedAt).
  lotto.meta = storeMeta(store);
  if (lotto.lastOpenedAt == null) lotto.lastOpenedAt = Number(store?.get?.('_lastOpenedAt')?.at) || 0;

  const { actions, notes } = planActions({ lotto, markets }, cfg, now, resolve);
  result.planned = actions.length;
  result.notes.push(...notes);

  for (const a of actions) {
    if (!EXECUTABLE.has(a.kind)) { result.skipped.push({ kind: a.kind, id: a.roundId ?? a.marketId, reason: a.reason }); continue; }
    if (dry) { result.executed.push({ kind: a.kind, id: a.roundId ?? a.marketId, dry: true, reason: a.reason }); continue; }
    try {
      const tx = await execOne(a, { adapter, store, rng, hash, now });
      result.executed.push({ kind: a.kind, id: a.roundId ?? a.marketId, tx });
    } catch (e) {
      result.ok = false;
      result.errors.push({ kind: a.kind, id: a.roundId ?? a.marketId, error: e?.message || String(e) });
    }
  }
  return result;
}

/** Translate the flat store ({ 'round:0':{...}, _lastOpenedAt:{...} }) into meta keyed by roundId. */
function storeMeta(store) {
  const all = store?.all ? store.all() : {};
  const meta = {};
  for (const [k, v] of Object.entries(all)) {
    const m = /^round:(\d+)$/.exec(k);
    if (m) meta[Number(m[1])] = v;
  }
  return meta;
}

async function execOne(a, { adapter, store, rng, hash, now }) {
  switch (a.kind) {
    case 'lotto.open': {
      const tx = await adapter.openRound(a.params);
      // The chain assigns the id; the runner records openedAt against the newly-created round in a follow-up
      // read. We stamp a provisional "lastOpenedAt" so the next pass doesn't immediately open another.
      if (store?.set) store.set('_lastOpenedAt', { at: now, tx });
      return tx;
    }
    case 'lotto.close': {
      // Generate a fresh secret salt, commit its hash, persist the salt for the reveal in a later pass.
      const salt = rng();
      const saltHash = hash(salt);
      const tx = await adapter.closeRound(a.roundId, saltHash);
      if (store?.set) store.set(`round:${a.roundId}`, { ...(store.get?.(`round:${a.roundId}`) || {}), salt, saltHash, closedTx: tx, closedAt: now });
      return tx;
    }
    case 'lotto.draw': {
      const tx = await adapter.drawRound(a.roundId, a.params.salt);
      if (store?.set) store.set(`round:${a.roundId}`, { ...(store.get?.(`round:${a.roundId}`) || {}), drawnTx: tx, drawnAt: now, salt: undefined });
      return tx;
    }
    case 'lotto.rearm': {
      const salt = rng();
      const saltHash = hash(salt);
      const tx = await adapter.reArmDraw(a.roundId, saltHash);
      if (store?.set) store.set(`round:${a.roundId}`, { ...(store.get?.(`round:${a.roundId}`) || {}), salt, saltHash, reArmTx: tx, reArmAt: now });
      return tx;
    }
    case 'market.propose': return adapter.proposeOutcome(a.marketId, a.params.outcome);
    case 'market.finalize': return adapter.finalize(a.marketId);
    default: throw new Error(`non-executable action reached execOne: ${a.kind}`);
  }
}
