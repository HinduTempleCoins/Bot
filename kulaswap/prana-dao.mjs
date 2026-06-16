// prana-dao.mjs — PRANA as the DAO / GOVERNANCE coin, governed THROUGH Akasha.
//
// PRANA is mined via the pool (block-reward emission). This module is the OFF-CHAIN governance layer
// over that emission + treasury: pure, tested helpers + UNSIGNED tx descriptors against the standard
// OpenZeppelin 5.x governance stack already shipped in the PRANA contracts:
//
//   GovernanceToken (PRANA, ERC20Votes)  — the vote weight; holders must delegate() to activate it.
//   GovernorDAO     (OZ Governor)        — propose / castVote / queue / execute lifecycle.
//   DAOTimelock     (TimelockController) — enforces minDelay between a passed vote and execution;
//                                          it OWNS the governed plumbing (no standing admin).
//   DAOFundEmissionSplit                 — the lever the DAO actually pulls: skims a DAO-bps slice
//                                          of every pool emission inflow to the DAO fund, forwards
//                                          the rest to the main RewardsDistributor (capped 20%).
//   RewardsDistributorMerkleEpoch        — weekly Merkle-epoch payout of the contributor slice.
//
// Akasha is the voting wallet: the user signs propose/vote/queue/execute with their Akasha (ethers /
// EIP-1193) signer. We NEVER sign or broadcast here — we only DESCRIBE the call ({to,data,value,chainId})
// exactly like kula-cdp.mjs, and hand the descriptor to the connected wallet.
//
// House style: pure arithmetic, soft-fail to safe shapes, NEVER throws. No network, no deps. ESM.
// The selectors + ABI encoding are the REAL OZ Governor / target selectors, hand-encoded (no ethers),
// verified against ethers' AbiCoder in the test suite.

const PRANA_CHAIN_ID = 108369; // rpc.prana.melek.salon

const nn = (x) => { const v = +x; return Number.isFinite(v) && v >= 0 ? v : 0; };
const round = (x, d = 8) => { const f = +(+x).toFixed(d); return Number.isFinite(f) ? f : 0; };

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 1. Voting power — gov weight from PRANA held / staked (+ optional veCRV-style lock boost)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// The on-chain vote weight is ERC20Votes.getVotes (the delegated PRANA balance). Off-chain we PREVIEW
// that for the UI and, where the deployment layers VoteEscrow (stake-not-compute), add a lock boost:
//   power = pranaBalance + pranaStaked * (1 + lockBoost)
// lockBoost is a fraction in [0, maxBoost] (e.g. a 4-year max lock → +1.0 = 2x on the staked portion),
// mirroring VoteEscrow.balanceOf decay being highest at a fresh max-duration lock. Plain held PRANA
// gets no boost (it can be moved/sold at any time); only locked/staked PRANA earns the multiplier.
/**
 * @param {object} a
 * @param {number} a.pranaBalance  liquid (delegated) PRANA the voter holds.
 * @param {number} [a.pranaStaked] PRANA locked in VoteEscrow / a staking module.
 * @param {number} [a.lockBoost]   extra multiplier on the STAKED portion, fraction [0..maxBoost].
 * @param {number} [a.maxBoost]    cap on lockBoost (default 1 → up to 2x staked weight).
 * @returns {number} total voting power (soft-fails to 0).
 */
export function votingPower({ pranaBalance = 0, pranaStaked = 0, lockBoost = 0, maxBoost = 1 } = {}) {
  const bal = nn(pranaBalance);
  const staked = nn(pranaStaked);
  const cap = nn(maxBoost);
  const boost = Math.min(cap, nn(lockBoost));
  return round(bal + staked * (1 + boost), 8);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 2. Proposal state — mirror the OZ Governor lifecycle off-chain for the UI
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// OZ ProposalState: Pending → Active → (Defeated | Succeeded) → Queued → Executed (or Canceled/Expired).
// On-chain `state()` is authoritative; this is a faithful preview from the values the UI already has:
//   - before voteStart           → pending
//   - voteStart..voteEnd         → active
//   - after voteEnd: succeeded iff quorum reached AND votesFor > votesAgainst, else defeated
//   - explicit flags (queued/executed/canceled) win once set.
// Quorum is the OZ GovernorVotesQuorumFraction rule: For + Abstain must reach `quorum` (we treat the
// passed `quorum` as that threshold and count For+Abstain toward it, For-only toward the majority).
/**
 * @param {object} proposal { voteStart, voteEnd, queued?, executed?, canceled? } (block numbers or ts).
 * @param {object} ctx { now, quorum, votesFor, votesAgainst, votesAbstain? }
 * @returns {{state:string, quorumReached:boolean, succeeded:boolean}}
 */
export function proposalState(proposal = {}, ctx = {}) {
  const { voteStart = 0, voteEnd = 0, queued = false, executed = false, canceled = false } = proposal || {};
  const now = nn(ctx.now);
  const quorum = nn(ctx.quorum);
  const votesFor = nn(ctx.votesFor);
  const votesAgainst = nn(ctx.votesAgainst);
  const votesAbstain = nn(ctx.votesAbstain);

  // For + Abstain count toward quorum (OZ default GovernorCountingSimple._quorumReached).
  const quorumReached = quorum > 0 ? (votesFor + votesAbstain) >= quorum : (votesFor + votesAbstain) > 0;
  const succeeded = quorumReached && votesFor > votesAgainst;

  let state;
  if (canceled) state = 'canceled';
  else if (executed) state = 'executed';
  else if (queued) state = 'queued';
  else if (now < nn(voteStart)) state = 'pending';
  else if (now <= nn(voteEnd)) state = 'active';
  else state = succeeded ? 'succeeded' : 'defeated';

  return { state, quorumReached, succeeded };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 3. ABI encoding (minimal, offline) — head/tail encoding for the OZ Governor dynamic args
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// The Governor calls take (address[], uint256[], bytes[], string|bytes32). We hand-encode the full
// ABI head/tail layout — no ethers/web3 (tests run offline, no deps). encodeProposeArgs is verified
// byte-for-byte against ethers AbiCoder in prana-dao.test.mjs. amounts are BASE UNITS (wei-scale).

const SELECTORS = Object.freeze({
  // GovernorDAO (OZ Governor)
  propose: '0x7d5e81e2',            // propose(address[],uint256[],bytes[],string)
  castVote: '0x56781388',           // castVote(uint256,uint8)
  castVoteWithReason: '0x7b3c71d3', // castVoteWithReason(uint256,uint8,string)
  queue: '0x160cbed7',              // queue(address[],uint256[],bytes[],bytes32)
  execute: '0x2656227d',            // execute(address[],uint256[],bytes[],bytes32)
  // GovernanceToken (ERC20Votes) — activate voting power
  delegate: '0x5c19a95c',           // delegate(address)
  // DAOFundEmissionSplit — what the DAO actually controls (targets of a proposal)
  setDaoBps: '0xe7739e7d',          // setDaoBps(uint16)
  setDaoFund: '0x2c559d27',         // setDaoFund(address)
  setMainDistributor: '0xd50ce69f', // setMainDistributor(address)
  // RewardsDistributorMerkleEpoch — post the contributor-payout epoch root
  postEpoch: '0x41822f2b',          // postEpoch(uint256,bytes32,uint256)
});

const HEX64 = (v) => v.toString(16).padStart(64, '0');

/** Encode a non-negative integer (decimal string, number, or BigInt) as a 32-byte word. */
function encUint(amount) {
  let v;
  try { v = BigInt(typeof amount === 'number' ? Math.trunc(amount) : (amount ?? 0)); }
  catch { v = 0n; }
  if (v < 0n) v = 0n;
  return HEX64(v);
}

/** Encode a 20-byte address as a 32-byte word (left-padded). Soft-fails to the zero word. */
function encAddress(addr) {
  const s = String(addr || '').toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{40}$/.test(s) ? s.padStart(64, '0') : '0'.repeat(64);
}

/** Normalize a 32-byte hash to 64 hex chars (no 0x). Soft-fails to the zero word. */
function encBytes32(h) {
  const s = String(h || '').toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{1,64}$/.test(s) ? s.padStart(64, '0') : '0'.repeat(64);
}

/** Strip 0x and lowercase a hex blob (calldata). Returns '' on bad input. */
function hexBody(h) {
  const s = String(h || '').toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]*$/.test(s) && s.length % 2 === 0 ? s : '';
}

/** ceil-pad a hex body to a multiple of 64 chars (32-byte words) with trailing zeros. */
function padRight32(hex) {
  const rem = hex.length % 64;
  return rem === 0 ? hex : hex + '0'.repeat(64 - rem);
}

/** Encode a `bytes` value: word(len) + right-padded body. Returns the full encoded chunk. */
function encBytesDynamic(hex) {
  const body = hexBody(hex);
  return HEX64(BigInt(body.length / 2)) + padRight32(body);
}

/** Encode a UTF-8 string as ABI `string`: word(byteLen) + right-padded utf-8 bytes. */
function encStringDynamic(str) {
  const bytes = Buffer.from(String(str ?? ''), 'utf8');
  const body = bytes.toString('hex');
  return HEX64(BigInt(bytes.length)) + padRight32(body);
}

/** Encode a uint256[] inline (for placement in the head/tail layout): word(len) + words. */
function encUintArray(arr) {
  const a = Array.isArray(arr) ? arr : [];
  return HEX64(BigInt(a.length)) + a.map(encUint).join('');
}

/** Encode an address[] inline: word(len) + padded addresses. */
function encAddressArray(arr) {
  const a = Array.isArray(arr) ? arr : [];
  return HEX64(BigInt(a.length)) + a.map(encAddress).join('');
}

/**
 * Encode a bytes[] inline: word(len) + per-element offsets (relative to start of this block, after the
 * length word) + each element's encBytesDynamic chunk. This is the standard dynamic-array-of-dynamic
 * layout the OZ Governor calldatas param uses.
 */
function encBytesArray(arr) {
  const a = (Array.isArray(arr) ? arr : []).map((x) => encBytesDynamic(x));
  const n = a.length;
  // offsets are relative to the first element-offset slot region (= after the length word).
  let cursor = n * 32; // bytes; n offset words precede the element data
  const offsets = a.map((chunk) => { const off = HEX64(BigInt(cursor)); cursor += chunk.length / 2; return off; });
  return HEX64(BigInt(n)) + offsets.join('') + a.join('');
}

/**
 * Encode the (address[], uint256[], bytes[], TAIL) tuple where TAIL is either a `string` (propose) or a
 * `bytes32` (queue/execute). Returns the hex body WITHOUT 0x. The four params: addr[] (dyn), uint[] (dyn),
 * bytes[] (dyn) are placed by offset; the final param is `string` (dyn, placed by offset) or `bytes32`
 * (static, inline at its head slot).
 */
function encodeGovTuple(targets, values, calldatas, tail, tailKind) {
  const headSlots = 4; // four params → four 32-byte head slots
  const aChunk = encAddressArray(targets);
  const vChunk = encUintArray(values);
  const cChunk = encBytesArray(calldatas);

  // Head: offsets for the three dynamic arrays, then either an offset (string) or inline word (bytes32).
  let cursor = headSlots * 32; // bytes, start of tail region
  const aOff = HEX64(BigInt(cursor)); cursor += aChunk.length / 2;
  const vOff = HEX64(BigInt(cursor)); cursor += vChunk.length / 2;
  const cOff = HEX64(BigInt(cursor)); cursor += cChunk.length / 2;

  if (tailKind === 'string') {
    const dOff = HEX64(BigInt(cursor));
    const dChunk = encStringDynamic(tail);
    return aOff + vOff + cOff + dOff + aChunk + vChunk + cChunk + dChunk;
  }
  // bytes32: static, inline in the head slot.
  return aOff + vOff + cOff + encBytes32(tail) + aChunk + vChunk + cChunk;
}

/** Public: encode propose args (verified against ethers in tests). Returns hex body (no 0x). */
export function encodeProposeArgs(targets, values, calldatas, description) {
  return encodeGovTuple(targets, values, calldatas, description, 'string');
}

/** Public: encode queue/execute args (descriptionHash as bytes32). Returns hex body (no 0x). */
export function encodeQueueArgs(targets, values, calldatas, descriptionHash) {
  return encodeGovTuple(targets, values, calldatas, descriptionHash, 'bytes32');
}

/** Assemble a tx descriptor. value defaults to '0x0' — gov ops carry no native PRANA. */
function descriptor(to, selector, body, label) {
  return {
    to: String(to || ''),
    data: selector + body,
    value: '0x0',
    method: label,
    chainId: PRANA_CHAIN_ID,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 4. UNSIGNED tx descriptors — Akasha signs; we only describe
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Build the inner call (a single action a proposal will execute). Returns { target, value, calldata }
 * ready to drop into a proposal's parallel arrays. The calldata is the encoded call ON the target.
 * Helpers below produce the common DAO actions; advanced callers can pass raw calldata.
 */
export function buildEmissionSplitAction({ split, daoBps } = {}) {
  // setDaoBps(uint16) — DAO retunes the pool-emission slice routed to the DAO fund (capped 20% on-chain).
  let bps; try { bps = BigInt(Math.trunc(nn(daoBps))); } catch { bps = 0n; }
  if (bps < 0n) bps = 0n;
  return { target: String(split || ''), value: '0x0', calldata: SELECTORS.setDaoBps + HEX64(bps) };
}

export function buildSetDaoFundAction({ split, daoFund } = {}) {
  return { target: String(split || ''), value: '0x0', calldata: SELECTORS.setDaoFund + encAddress(daoFund) };
}

export function buildSetMainDistributorAction({ split, mainDistributor } = {}) {
  return { target: String(split || ''), value: '0x0', calldata: SELECTORS.setMainDistributor + encAddress(mainDistributor) };
}

export function buildPostEpochAction({ distributor, epoch, root, funded } = {}) {
  const body = encUint(epoch) + encBytes32(root) + encUint(funded);
  return { target: String(distributor || ''), value: '0x0', calldata: SELECTORS.postEpoch + body };
}

/**
 * UNSIGNED tx: submit a governance proposal. `actions` is an array of { target, value, calldata } (use
 * the build*Action helpers above, or raw). `description` is the human proposal text (its keccak hash
 * later identifies the proposal for queue/execute). Governor SIGNS via Akasha.
 */
export function buildProposeTx({ governor, actions = [], description = '' } = {}) {
  const list = Array.isArray(actions) ? actions : [];
  const targets = list.map((a) => a && a.target);
  const values = list.map((a) => (a && a.value && a.value !== '0x0') ? a.value : 0);
  const calldatas = list.map((a) => (a && a.calldata) || '0x');
  const body = encodeProposeArgs(targets, values, calldatas, description);
  return descriptor(governor, SELECTORS.propose, body, 'propose');
}

/**
 * UNSIGNED tx: cast a vote on a proposal. support: 0 = Against, 1 = For, 2 = Abstain
 * (OZ GovernorCountingSimple.VoteType). With `reason`, uses castVoteWithReason.
 */
export function buildVoteTx({ governor, proposalId, support = 1, reason = '' } = {}) {
  const s = Math.max(0, Math.min(2, Math.trunc(nn(support))));
  if (reason) {
    const body = encUint(proposalId) + HEX64(BigInt(s)) +
      HEX64(96n) /* offset to reason string (3 head words * 32) */ + encStringDynamic(reason);
    return descriptor(governor, SELECTORS.castVoteWithReason, body, 'castVoteWithReason');
  }
  const body = encUint(proposalId) + HEX64(BigInt(s));
  return descriptor(governor, SELECTORS.castVote, body, 'castVote');
}

/**
 * UNSIGNED tx: queue a SUCCEEDED proposal into the timelock (starts the minDelay clock). Must pass the
 * SAME actions + descriptionHash the proposal was created with. descriptionHash = keccak256(description)
 * — pass it precomputed (Akasha/ethers computes it; this module stays dep-free).
 */
export function buildQueueTx({ governor, actions = [], descriptionHash } = {}) {
  const list = Array.isArray(actions) ? actions : [];
  const targets = list.map((a) => a && a.target);
  const values = list.map((a) => (a && a.value && a.value !== '0x0') ? a.value : 0);
  const calldatas = list.map((a) => (a && a.calldata) || '0x');
  const body = encodeQueueArgs(targets, values, calldatas, descriptionHash);
  return descriptor(governor, SELECTORS.queue, body, 'queue');
}

/** UNSIGNED tx: execute a QUEUED proposal once the timelock minDelay has elapsed. Same args as queue. */
export function buildExecuteTx({ governor, actions = [], descriptionHash } = {}) {
  const list = Array.isArray(actions) ? actions : [];
  const targets = list.map((a) => a && a.target);
  const values = list.map((a) => (a && a.value && a.value !== '0x0') ? a.value : 0);
  const calldatas = list.map((a) => (a && a.calldata) || '0x');
  const body = encodeQueueArgs(targets, values, calldatas, descriptionHash);
  return descriptor(governor, SELECTORS.execute, body, 'execute');
}

/** UNSIGNED tx: delegate PRANA voting power (to self to activate it, or to a delegate). */
export function buildDelegateTx({ token, delegatee } = {}) {
  return descriptor(token, SELECTORS.delegate, encAddress(delegatee), 'delegate');
}

export const DAO_SELECTORS = SELECTORS;

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 5. Emission-split preview — how DAOFundEmissionSplit divides a pool block-reward inflow
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// The on-chain split today is a single DAO-bps skim (DAO fund vs main distributor). The DAO can model
// a richer multi-way split off-chain (treasury / contributors / burn / ...) — this previews any named
// breakdown that must sum to 100% (10000 bps). It surfaces the per-bucket emission AND the equivalent
// daoBps the DAO would set on-chain (everything NOT going to the main rewards distributor).
/**
 * @param {object} a
 * @param {number} a.totalEmission  the pool block-reward inflow to split (any unit).
 * @param {Array<{name:string,bps:number}>} a.splits  buckets; bps must sum to 10000.
 * @param {string} [a.mainBucket]   the bucket name that maps to the main RewardsDistributor
 *                                  (default 'contributors'); the rest = the on-chain daoBps.
 * @returns {{ok:boolean, error?:string, totalBps:number, daoBps:number, buckets:Array}}
 */
export function emissionSplitPreview({ totalEmission = 0, splits = [], mainBucket = 'contributors' } = {}) {
  const total = nn(totalEmission);
  const list = Array.isArray(splits) ? splits : [];
  if (list.length === 0) return { ok: false, error: 'no splits', totalBps: 0, daoBps: 0, buckets: [] };

  let totalBps = 0;
  for (const s of list) {
    const bps = nn(s && s.bps);
    if (bps !== Math.trunc(bps)) return { ok: false, error: 'fractional bps', totalBps: 0, daoBps: 0, buckets: [] };
    totalBps += bps;
  }
  if (totalBps !== 10000) {
    return { ok: false, error: `bps sum ${totalBps} != 10000`, totalBps, daoBps: 0, buckets: [] };
  }

  const buckets = list.map((s) => {
    const bps = nn(s.bps);
    return { name: String(s.name || ''), bps, amount: round((total * bps) / 10000, 8) };
  });
  // daoBps = everything NOT routed to the main rewards distributor (the on-chain skim).
  const mainBps = buckets.filter((b) => b.name === mainBucket).reduce((acc, b) => acc + b.bps, 0);
  const daoBps = 10000 - mainBps;
  return { ok: true, totalBps, daoBps, buckets };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 6. UI fragment — the Akasha "DAO" tab (esc()'d HTML)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const STATE_CLASS = {
  pending: 'pend', active: 'active', succeeded: 'ok', queued: 'queued',
  executed: 'done', defeated: 'bad', canceled: 'bad',
};

/**
 * Render the DAO governance tab as an HTML string (all interpolation esc()'d). Shows the connected
 * voter's voting power, then a list of proposals each with a state badge, For/Against tallies, a quorum
 * indicator, and Vote/Queue/Execute buttons wired to global JS fns the host defines to hand the matching
 * descriptor to the connected Akasha wallet.
 *
 * @param {object} a
 * @param {object} a.voter { pranaBalance, pranaStaked?, lockBoost? } — for the power readout.
 * @param {Array}  a.proposals  [{ id, title, voteStart, voteEnd, votesFor, votesAgainst, votesAbstain?,
 *                                 quorum, queued?, executed?, canceled? }]
 * @param {number} a.now  current block/timestamp for state evaluation.
 * @param {object} a.handlers { vote, queue, execute } — global fn names (defaults pranaDao*).
 */
export function renderDaoFragment({
  voter = {},
  proposals = [],
  now = 0,
  handlers = {},
} = {}) {
  const power = votingPower(voter || {});
  // No inline JS handlers (would be a JS-attribute XSS sink). The host wires a delegated
  // click listener reading data-dao-id (on the <li>) + data-dao-vote / data-dao-action.
  const list = Array.isArray(proposals) ? proposals : [];

  const rows = list.map((p) => {
    const { state, quorumReached } = proposalState(p || {}, {
      now, quorum: p && p.quorum, votesFor: p && p.votesFor,
      votesAgainst: p && p.votesAgainst, votesAbstain: p && p.votesAbstain,
    });
    const cls = STATE_CLASS[state] || 'pend';
    const id = esc(String(p && p.id != null ? p.id : ''));
    const title = esc((p && p.title) || `Proposal ${id}`);
    const vFor = esc(nn(p && p.votesFor));
    const vAgainst = esc(nn(p && p.votesAgainst));
    const quorumTxt = quorumReached ? 'quorum reached' : 'quorum not met';

    let actions = '';
    if (state === 'active') {
      actions =
        '<button type="button" data-dao-vote="1">Vote For</button>' +
        '<button type="button" data-dao-vote="0">Vote Against</button>' +
        '<button type="button" data-dao-vote="2">Abstain</button>';
    } else if (state === 'succeeded') {
      actions = '<button type="button" data-dao-action="queue">Queue</button>';
    } else if (state === 'queued') {
      actions = '<button type="button" data-dao-action="execute">Execute</button>';
    }

    return [
      '<li class="dao-proposal" data-dao-id="', id, '">',
      '<div class="dao-head"><span class="dao-title">', title, '</span>',
      '<span class="dao-state state-', cls, '">', esc(state), '</span></div>',
      '<dl class="dao-votes"><dt>For</dt><dd data-dao-vfor>', vFor, '</dd>',
      '<dt>Against</dt><dd data-dao-vagainst>', vAgainst, '</dd>',
      '<dt>Quorum</dt><dd class="', quorumReached ? 'ok' : 'warn', '">', esc(quorumTxt), '</dd></dl>',
      '<div class="dao-actions">', actions, '</div>',
      '</li>',
    ].join('');
  }).join('');

  return [
    '<div class="prana-dao" data-prana-dao>',
    '<h3>PRANA DAO</h3>',
    '<p class="dao-sub">PRANA is the governance coin. Mined via the pool, it votes the emission split, ',
    'the treasury, and the contributor payouts. Vote with your Akasha wallet.</p>',
    '<div class="dao-power">Your voting power: <strong data-dao-power>', esc(power), '</strong> PRANA</div>',
    list.length
      ? '<ul class="dao-proposals">' + rows + '</ul>'
      : '<p class="dao-empty">No proposals yet.</p>',
    '</div>',
  ].join('');
}

// CLI demo (guarded) — worked propose → vote → queue → execute against a sample emission-split action.
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('prana-dao.mjs')) {
  const governor = '0x' + '11'.repeat(20);
  const split = '0x' + '22'.repeat(20);
  const action = buildEmissionSplitAction({ split, daoBps: 1500 }); // route 15% of emission to DAO fund
  const description = 'PRANA-DAO #1: raise emission DAO slice to 15%';
  console.log('voting power:', votingPower({ pranaBalance: 1000, pranaStaked: 500, lockBoost: 1 }));
  console.log('propose tx:', buildProposeTx({ governor, actions: [action], description }));
  console.log('vote tx:', buildVoteTx({ governor, proposalId: 42, support: 1 }));
  console.log('emission preview:', emissionSplitPreview({
    totalEmission: 1000,
    splits: [{ name: 'treasury', bps: 1000 }, { name: 'contributors', bps: 8000 }, { name: 'burn', bps: 1000 }],
  }));
}
