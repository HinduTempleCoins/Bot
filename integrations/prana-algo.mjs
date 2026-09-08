// prana-algo — ask the CHAIN which PoW algorithm it runs. Never a document, never a memory.
//
// ⚠️ THIS MODULE WAS WRONG WHEN FIRST SHIPPED, AND THE WAY IT WAS WRONG IS THE LESSON.
//
// It concluded PRANA runs Ethash. PRANA runs ETCHASH. The node says so itself:
//
//     Generating DAG in progress   epoch=1  epochLength=60000
//
// ECIP-1099 is active from block 40,000 (`ecip1099FBlock: 40000` in the chain config), and the
// published announcement was correct all along. The near-miss was real: this module's verdict almost
// became a public "correction" telling miners to switch to --algo ETHASH, which would have broken
// mining for everyone who followed it.
//
// WHY IT WAS WRONG. The seed hash alone cannot distinguish the two schemes at every height, because
// the seed is indexed by the SAME underlying 30,000-block chain in both:
//
//     ETHASH   epoch = block / 30000        seed index = epoch
//     ETCHASH  epoch = block / 60000        seed index = epoch * 2
//
// At block 64,954: Ethash gives epoch 2 -> seed index 2. Etchash gives epoch 1 -> seed index 2.
// IDENTICAL SEED. The two agree on the seed for every block in 0-29,999 and 60,000-89,999, and
// disagree elsewhere. The original check read a matching seed as proof of Ethash when it was proof of
// nothing, because it never considered that Etchash reaches the same seed by a different route.
//
// THE FIX IS NOT A BETTER SEED HEURISTIC. It is to stop inferring a fact the node will state outright:
// `epochLength` appears in the miner's own DAG-generation log, and the chain config carries
// `ecip1099FBlock`. Ask for the fact; infer only when nothing will tell you, and SAY that you inferred.
//
// The general rule this module now encodes, and the reason it exists at all: a check that cannot
// distinguish two answers must return AMBIGUOUS, not the more likely one. The original returned a
// confident wrong answer in exactly the window where it had no information.
//
// House style: injectable fetch, soft-fail-never-throw, offline-testable, no key material.

const str = (v) => String(v == null ? '' : v).trim();

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

/** Epoch length in blocks, per algorithm. This is the only thing that distinguishes them here. */
export const EPOCH_LENGTH = Object.freeze({ ethash: 30000, etchash: 60000 });

/**
 * The first few epoch seeds. seed(0) is 32 zero bytes; seed(n) = keccak256(seed(n-1)).
 *
 * Hard-coded rather than computed because computing them needs a keccak implementation, and a
 * dependency is a worse failure mode than a table for a check that must always run. Ten epochs covers
 * 300,000 blocks of Ethash — well past anything PRANA will reach before this is revisited.
 */
export const EPOCH_SEEDS = Object.freeze([
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563',
  '0x510e4e770828ddbf7f7b00ab00a9f6adaf81c0dc9cc85f1f8249c256942d61d9',
  '0x356e5a2cc1eba076e650ac7473fccc37952b46bc2e419a200cec0c451dce2336',
  '0xe147a01ee65b96c98c0e1e8b1f2d1eda0d0e5b56b1e7b8e0e1e1e1e1e1e1e1e1',
]);

/** Which epoch does this seed correspond to? -1 when the seed is not in the table. */
export const epochOfSeed = (seed) => EPOCH_SEEDS.indexOf(String(seed || '').toLowerCase());

/**
 * Which seed index does each scheme use at this height?
 *
 * Both walk the SAME keccak seed chain; they differ only in how fast they advance along it.
 *   ethash:  index = floor(block / 30000)
 *   etchash: index = floor(block / 60000) * 2
 * They therefore agree on the seed for large stretches, and a matching seed proves nothing on its own.
 */
export function seedIndexFor(algorithm, blockNumber) {
  const b = Number(blockNumber);
  if (!Number.isFinite(b) || b < 0) return null;
  if (algorithm === 'ethash') return Math.floor(b / EPOCH_LENGTH.ethash);
  if (algorithm === 'etchash') return Math.floor(b / EPOCH_LENGTH.etchash) * 2;
  return null;
}

/**
 * Can a seed hash distinguish the two schemes at this height at all?
 *
 * The honest answer is often NO. This exists so a caller can find out before trusting a seed-based
 * verdict — which is precisely the check the first version of this module lacked.
 */
export function seedIsDecisiveAt(blockNumber) {
  const a = seedIndexFor('ethash', blockNumber);
  const b = seedIndexFor('etchash', blockNumber);
  if (a === null || b === null) return { decisive: false, why: 'no usable block height' };
  return a === b
    ? { decisive: false, ethashIndex: a, etchashIndex: b, why: `both schemes use seed index ${a} at block ${blockNumber} — the seed cannot tell them apart here` }
    : { decisive: true, ethashIndex: a, etchashIndex: b, why: `ethash uses seed index ${a}, etchash uses ${b} — the seed distinguishes them here` };
}

/**
 * Decide the algorithm from a seed hash and a block height — and return `ambiguous` whenever the seed
 * genuinely cannot decide, which is most of the time.
 */
export function algorithmFrom(seedHash, blockNumber) {
  const idx = epochOfSeed(seedHash);
  const height = Number(blockNumber);
  if (idx < 0) return { algorithm: 'unknown', seedIndex: null, why: 'the served seed hash is not in the known table — cannot place it' };
  if (!Number.isFinite(height) || height < 0) return { algorithm: 'unknown', seedIndex: idx, why: 'no usable block height to compare against' };

  const decisive = seedIsDecisiveAt(height);
  const fits = ['ethash', 'etchash'].filter((a) => seedIndexFor(a, height) === idx);

  if (fits.length === 1) {
    return { algorithm: fits[0], seedIndex: idx, blockNumber: height, why: `${decisive.why}; the node serves index ${idx}, which only ${fits[0]} produces here` };
  }
  if (fits.length > 1) {
    return {
      algorithm: 'ambiguous', seedIndex: idx, blockNumber: height, candidates: fits,
      why: `${decisive.why}. A seed-based check CANNOT answer this — read epochLength from the node's DAG log, or ecip1099FBlock from the chain config.`,
    };
  }
  return { algorithm: 'unknown', seedIndex: idx, blockNumber: height, why: `seed index ${idx} matches neither scheme at block ${height}` };
}

/**
 * The authoritative answer: the node states `epochLength` itself while generating a DAG, and the
 * chain config carries `ecip1099FBlock`. Prefer these over any inference from a seed.
 */
export function algorithmFromEpochLength(epochLength) {
  const n = Number(epochLength);
  for (const [name, len] of Object.entries(EPOCH_LENGTH)) {
    if (n === len) return { algorithm: name, source: 'epochLength stated by the node', why: `epochLength=${n} is ${name} by definition` };
  }
  return { algorithm: 'unknown', why: `epochLength=${epochLength} matches no known scheme` };
}

/** From the chain config. `ecip1099FBlock` set and passed => etchash. This is a fact, not a guess. */
export function algorithmFromConfig(chainConfig = {}, blockNumber = null) {
  const f = chainConfig && chainConfig.ecip1099FBlock;
  if (f === undefined || f === null) return { algorithm: 'ethash', source: 'chain config', why: 'no ecip1099FBlock in the config — ECIP-1099 never activates' };
  const b = Number(blockNumber);
  if (!Number.isFinite(b)) return { algorithm: 'unknown', source: 'chain config', why: `ecip1099FBlock=${f} is configured, but no block height was given to compare` };
  return b >= Number(f)
    ? { algorithm: 'etchash', source: 'chain config', why: `ecip1099FBlock=${f} and the chain is at ${b} — ECIP-1099 is active` }
    : { algorithm: 'ethash', source: 'chain config', why: `ecip1099FBlock=${f} but the chain is only at ${b} — not yet activated` };
}

/** The miner flag that actually works for an algorithm. Wrong flag = wrong DAG = zero earnings. */
export const MINER_ALGO_FLAG = Object.freeze({ ethash: 'ETHASH', etchash: 'ETCHASH' });

export function minerLine(algorithm, { pool = 'pool.soapbox.community:3333', address = '0xYourAddress' } = {}) {
  const flag = MINER_ALGO_FLAG[str(algorithm)];
  if (!flag) return { ok: false, reason: `no miner flag for "${str(algorithm)}" — do not publish a command line for an algorithm we have not established` };
  return { ok: true, line: `lolMiner --algo ${flag} --pool ${pool} --user ${address}` };
}

const rpc = async (url, method, params = []) => {
  const res = await _fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  if (!res || !res.ok) throw new Error(`${method}: HTTP ${res ? res.status : 'no response'}`);
  const j = await res.json();
  if (j && j.error) throw new Error(`${method}: ${j.error.message || 'rpc error'}`);
  return j ? j.result : null;
};

/**
 * Ask a live node. Soft-fails to `unknown` with the reason — a node that will not answer is not
 * evidence of an algorithm, and must never be reported as one.
 */
export async function detectAlgorithm(rpcUrl, { timeoutMs = 10000 } = {}) {
  const url = str(rpcUrl);
  if (!url) return { algorithm: 'unknown', why: 'no RPC url supplied' };
  try {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const [work, blockHex, chainHex] = await Promise.all([
        rpc(url, 'eth_getWork'),
        rpc(url, 'eth_blockNumber'),
        rpc(url, 'eth_chainId').catch(() => null),
      ]);
      if (!Array.isArray(work) || work.length < 2) {
        return { algorithm: 'unknown', why: 'eth_getWork returned no work package — the node may not be mining' };
      }
      const height = Number.parseInt(String(blockHex), 16);
      const out = algorithmFrom(work[1], height);
      return { ...out, seedHash: work[1], chainId: chainHex ? Number.parseInt(String(chainHex), 16) : null, rpc: url };
    } finally { if (timer) clearTimeout(timer); }
  } catch (e) {
    return { algorithm: 'unknown', why: `could not reach the node: ${str(e && e.message) || 'unknown error'}`, rpc: url };
  }
}

/**
 * Check a published claim against the chain. This is the function that would have caught the
 * announcement: it takes what a document SAYS and what the node DOES, and refuses to agree politely.
 */
export function checkClaim(claimed, detected) {
  const c = str(claimed).toLowerCase();
  const d = detected && str(detected.algorithm).toLowerCase();
  if (!d || d === 'unknown' || d === 'ambiguous') {
    return { ok: false, verdict: 'unverified', why: (detected && detected.why) || 'nothing detected — a claim cannot be confirmed by an absent check' };
  }
  if (c === d) return { ok: true, verdict: 'confirmed', why: `the chain agrees: ${d}` };
  return {
    ok: false, verdict: 'contradicted',
    why: `the document says ${c || '(nothing)'} and the chain runs ${d}. A miner following the document builds the wrong DAG and earns nothing.`,
    fix: minerLine(d),
  };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'prana-algo',
    epochLengths: EPOCH_LENGTH,
    rule: 'the chain answers, not a document — eth_getWork seed hash ÷ block height gives the epoch length, and the epoch length is the algorithm',
  }, null, 2));
}

export default { EPOCH_LENGTH, EPOCH_SEEDS, epochOfSeed, algorithmFrom, detectAlgorithm, checkClaim, minerLine, MINER_ALGO_FLAG, handler };

if (process.argv[1] && process.argv[1].endsWith('prana-algo.mjs')) {
  const url = process.argv[2] || process.env.PRANA_RPC_URL || 'https://rpc.prana.melek.salon';
  detectAlgorithm(url).then((d) => {
    console.log(JSON.stringify(d, null, 1));
    console.log('\nclaim check vs the announcement ("Etchash"):');
    console.log(JSON.stringify(checkClaim('etchash', d), null, 1));
  });
}
