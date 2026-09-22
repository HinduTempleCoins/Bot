// merkle.test.mjs — OFFLINE proof of the airdrop tree/claim path. Runs with `node --test`, ZERO deps,
// no network, no chain, no keys. Proves:
//   1. the pure-JS keccak matches known Ethereum vectors (so the whole stack is sound);
//   2. the leaf scheme matches MerkleDistributor.sol's abi.encode + double-hash byte-for-byte;
//   3. every generated proof verifies against the root (the on-chain claim would succeed);
//   4. a tampered proof / wrong amount is rejected (a bad claim would revert);
//   5. the CSV → manifest builder is deterministic and totals correctly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { keccak256Utf8, keccak256Bytes, hexToBytes, bytesToHex } from "../scripts/lib/keccak.mjs";
import { leafHash, buildTree, getProof, verifyProof, buildClaims } from "../scripts/lib/merkle.mjs";
import { parseCsv, buildFromRows, toWei } from "../scripts/build-merkle.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));

test("keccak256 matches known Ethereum vectors", () => {
  assert.equal(keccak256Utf8(""), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(keccak256Utf8("abc"), "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
});

test("leafHash reproduces the on-chain abi.encode + double-hash exactly", () => {
  // Hand-encode abi.encode(uint256 index, address account, uint256 amount) = 3 * 32-byte words,
  // then double-keccak, and assert leafHash() equals it. This IS the contract's leaf formula:
  //   keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))))
  const index = 0n;
  const account = "0x1111111111111111111111111111111111111111";
  const amount = 100n;
  const word = (b) => b.toString(16).padStart(64, "0");
  const addrWord = account.slice(2).toLowerCase().padStart(64, "0");
  const encoded = "0x" + word(index) + addrWord + word(amount);
  const inner = keccak256Bytes(hexToBytes(encoded));
  const expected = bytesToHex(keccak256Bytes(inner));
  assert.equal(bytesToHex(leafHash(Number(index), account, amount)), expected);
});

test("every proof verifies against the root", () => {
  const entries = [
    { index: 0, account: "0x1111111111111111111111111111111111111111", amount: "100" },
    { index: 1, account: "0x2222222222222222222222222222222222222222", amount: "250" },
    { index: 2, account: "0x3333333333333333333333333333333333333333", amount: "650" },
    { index: 3, account: "0x4444444444444444444444444444444444444444", amount: "1000" },
    { index: 4, account: "0x5555555555555555555555555555555555555555", amount: "5" },
  ];
  const tree = buildTree(entries);
  assert.match(tree.root, /^0x[0-9a-f]{64}$/);

  tree.entries.forEach((e, i) => {
    const proof = getProof(tree, i);
    assert.ok(verifyProof(tree.root, proof, e.index, e.account, e.amount), `claim ${e.index} must verify`);
  });
});

test("a single-recipient tree verifies (root == leaf, empty proof)", () => {
  const entries = [{ index: 0, account: "0x9999999999999999999999999999999999999999", amount: "777" }];
  const tree = buildTree(entries);
  const proof = getProof(tree, 0);
  assert.equal(proof.length, 0);
  assert.ok(verifyProof(tree.root, proof, 0, entries[0].account, "777"));
});

test("tampered amount / wrong proof is rejected", () => {
  const entries = [
    { index: 0, account: "0x1111111111111111111111111111111111111111", amount: "100" },
    { index: 1, account: "0x2222222222222222222222222222222222222222", amount: "250" },
    { index: 2, account: "0x3333333333333333333333333333333333333333", amount: "650" },
  ];
  const tree = buildTree(entries);
  const proof = getProof(tree, 0);
  const e0 = tree.entries[0];
  // right proof, wrong amount → reject
  assert.equal(verifyProof(tree.root, proof, e0.index, e0.account, "999999"), false);
  // wrong proof (someone else's) → reject
  const otherProof = getProof(tree, 1);
  assert.equal(verifyProof(tree.root, otherProof, e0.index, e0.account, e0.amount), false);
});

test("buildClaims manifest: root, total, and per-account proofs", () => {
  const entries = [
    { index: 0, account: "0xAAaAAAAAaAAAAaAAAaAaAAaAAaAaAAaAAAaAAAaa", amount: "1" },
    { index: 1, account: "0xBbBbBBBBbBbBBbBBBbbBBbBBBbBBBBBbBbBBBBBB", amount: "2" },
  ];
  const m = buildClaims(entries);
  assert.equal(m.count, 2);
  assert.equal(m.tokenTotal, "3");
  for (const acct of Object.keys(m.claims)) {
    const c = m.claims[acct];
    assert.ok(verifyProof(m.merkleRoot, c.proof, c.index, acct, c.amount));
  }
});

test("toWei scales whole tokens and fractional amounts", () => {
  assert.equal(toWei("100", 18), (100n * 10n ** 18n).toString());
  assert.equal(toWei("42.5", 18), (425n * 10n ** 17n).toString());
  assert.equal(toWei("7", 0), "7"); // already wei
});

test("CSV → manifest is deterministic and matches on-chain-verifiable claims", () => {
  const csv = readFileSync(join(__dir, "sample-recipients.csv"), "utf8");
  const rows = parseCsv(csv);
  assert.equal(rows.length, 5);

  const a = buildFromRows(rows, 18);
  const b = buildFromRows(rows, 18);
  assert.equal(a.merkleRoot, b.merkleRoot, "same input → same root (deterministic)");
  // total = (100+250+650+1000+42.5) * 1e18 = 2042.5e18
  assert.equal(a.tokenTotal, (20425n * 10n ** 17n).toString());

  for (const acct of Object.keys(a.claims)) {
    const c = a.claims[acct];
    assert.ok(verifyProof(a.merkleRoot, c.proof, c.index, acct, c.amount), `${acct} proof verifies`);
  }
});
