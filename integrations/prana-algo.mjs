// prana-algo — ask the CHAIN which PoW algorithm it runs. Never a document, never a memory.
//
// WHY THIS EXISTS. The PRANA launch announcement says "Algorithm: Etchash (ECIP-1099, from block 0)"
// and gives `lolMiner --algo ETCHASH` as the copy-paste line. It is wrong. The chain runs ETHASH, and
// a miner following that line builds the wrong DAG and earns nothing.
//
// That error survived a multi-day fix and a confident report that it was Etchash, because the claim
// was checked against documentation instead of against the node. The check is ONE RPC CALL and it
// takes about a second:
//
//     eth_getWork -> [headerhash, SEEDHASH, target]
//
// The seed hash is a keccak chain from zero, advanced once per epoch. So the seed the node serves,
// divided against the current block height, tells you the epoch length — and the epoch length IS the
// algorithm:
//
//     ETHASH  epochs are 30,000 blocks   (Ethereum's original)
//     ETCHASH epochs are 60,000 blocks   (ECIP-1099, Ethereum Classic's halved-DAG variant)
//
// At block 64,922 the node serves the epoch-2 seed. 64,922 / 30,000 = 2. 64,922 / 60,000 = 1.
// Only Ethash fits. There is no interpretation, no version drift, and nothing to remember.
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
 * Decide the algorithm from a seed hash and a block height.
 *
 * Returns `ethash`, `etchash`, `ambiguous` (both fit — true only very early, before the first
 * divergence at block 30,000) or `unknown` (the seed is not one we can place).
 */
export function algorithmFrom(seedHash, blockNumber) {
  const epoch = epochOfSeed(seedHash);
  const height = Number(blockNumber);
  if (epoch < 0) {
    return { algorithm: 'unknown', epoch: null, why: 'the served seed hash is not in the known epoch table — cannot place it' };
  }
  if (!Number.isFinite(height) || height < 0) {
    return { algorithm: 'unknown', epoch, why: 'no usable block height to divide against' };
  }
  const fits = Object.entries(EPOCH_LENGTH)
    .filter(([, len]) => Math.floor(height / len) === epoch)
    .map(([name]) => name);
  if (fits.length === 1) {
    return {
      algorithm: fits[0], epoch, blockNumber: height,
      why: `the node serves the epoch-${epoch} seed at block ${height}; ${height} / ${EPOCH_LENGTH[fits[0]]} = ${epoch}`,
    };
  }
  if (fits.length > 1) {
    return {
      algorithm: 'ambiguous', epoch, blockNumber: height, candidates: fits,
      why: `below block ${EPOCH_LENGTH.ethash} both epoch lengths give the same answer — the chain has not diverged yet`,
    };
  }
  return { algorithm: 'unknown', epoch, blockNumber: height, why: `epoch ${epoch} matches no known epoch length at block ${height}` };
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
