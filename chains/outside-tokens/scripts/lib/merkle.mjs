// merkle.mjs — off-chain Merkle tree builder for the airdrop, ZERO dependencies.
//
// Produces a root + per-recipient proofs that verify against MerkleDistributor.sol EXACTLY, because
// it reproduces that contract's leaf scheme and OpenZeppelin's MerkleProof.verify pair-hashing:
//
//   leaf   = keccak256( bytes.concat( keccak256( abi.encode(index, account, amount) ) ) )   // double-hash
//   parent = keccak256( sortedPair(left, right) )                                            // commutative
//
// The double-hashed leaf is the OZ StandardMerkleTree convention (guards against second-preimage
// attacks on internal nodes). Sorted-pair hashing is what MerkleProof.verify expects, so a proof
// generated here is accepted on-chain without the tree needing to match OZ's internal node ordering.
//
// PURE: no chain, no network, no keys. Inputs are plain JS values; outputs are hex strings.

import { keccak256Bytes, hexToBytes, bytesToHex } from "./keccak.mjs";

// --- ABI encoding of (uint256 index, address account, uint256 amount) -------
// abi.encode packs each head into a left-padded 32-byte word: uint256 as-is, address in the low 20
// bytes of a 32-byte word. Concatenation of the three words = 96 bytes.
function encodeLeafTuple(index, account, amount) {
  const word = (big) => {
    let h = BigInt(big).toString(16);
    if (h.length > 64) throw new Error("value overflows uint256");
    return h.padStart(64, "0");
  };
  const addr = account.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(addr)) throw new Error(`bad address: ${account}`);
  const addrWord = addr.padStart(64, "0");
  return hexToBytes("0x" + word(index) + addrWord + word(amount));
}

/** The on-chain leaf for a claim: keccak256(bytes.concat(keccak256(abi.encode(index,account,amount)))). */
export function leafHash(index, account, amount) {
  const inner = keccak256Bytes(encodeLeafTuple(index, account, amount));
  return keccak256Bytes(inner); // bytes.concat of a single 32-byte value == that value
}

// --- sorted-pair hashing (matches OZ MerkleProof._hashPair) -----------------
function compareBytes(a, b) {
  for (let i = 0; i < 32; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function hashPair(a, b) {
  const [x, y] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
  const cat = new Uint8Array(64);
  cat.set(x, 0);
  cat.set(y, 32);
  return keccak256Bytes(cat);
}

/**
 * Build a Merkle tree from claim entries.
 * @param {{index:number, account:string, amount:(string|bigint|number)}[]} entries
 * @returns {{ root:string, layers:Uint8Array[][], leaves:Uint8Array[], entries:object[] }}
 */
export function buildTree(entries) {
  if (!entries.length) throw new Error("no entries");
  // Sort by leaf bytes for a deterministic, reproducible tree (OZ does the same).
  const withLeaves = entries.map((e) => ({ ...e, leaf: leafHash(e.index, e.account, e.amount) }));
  withLeaves.sort((a, b) => compareBytes(a.leaf, b.leaf));

  const leaves = withLeaves.map((e) => e.leaf);
  const layers = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const cur = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < cur.length; i += 2) {
      if (i + 1 === cur.length) {
        next.push(cur[i]); // odd node promoted unchanged
      } else {
        next.push(hashPair(cur[i], cur[i + 1]));
      }
    }
    layers.push(next);
  }
  return { root: bytesToHex(layers[layers.length - 1][0]), layers, leaves, entries: withLeaves };
}

/** Merkle proof (array of 0x-hex siblings) for the entry at sorted-leaf position `leafIndex`. */
export function getProof(tree, leafIndex) {
  const proof = [];
  let idx = leafIndex;
  for (let l = 0; l < tree.layers.length - 1; l++) {
    const layer = tree.layers[l];
    const isRight = idx % 2 === 1;
    const pairIdx = isRight ? idx - 1 : idx + 1;
    if (pairIdx < layer.length) proof.push(bytesToHex(layer[pairIdx]));
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/** Local re-implementation of OZ MerkleProof.verify — proves a proof before it ever hits chain. */
export function verifyProof(root, proofHex, index, account, amount) {
  let computed = leafHash(index, account, amount);
  for (const p of proofHex) computed = hashPair(computed, hexToBytes(p));
  return bytesToHex(computed) === root.toLowerCase();
}

/**
 * Build the full claims manifest from entries: root + a claim (amount + proof) per account.
 * This is the JSON a claim dashboard / the operator publishes to IPFS alongside the recipient CSV.
 */
export function buildClaims(entries) {
  const tree = buildTree(entries);
  const claims = {};
  tree.entries.forEach((e, i) => {
    claims[e.account.toLowerCase()] = {
      index: e.index,
      amount: e.amount.toString(),
      proof: getProof(tree, i),
    };
  });
  const total = entries.reduce((s, e) => s + BigInt(e.amount), 0n);
  return { merkleRoot: tree.root, tokenTotal: total.toString(), count: entries.length, claims };
}
