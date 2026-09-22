// build-merkle.mjs — build the airdrop Merkle tree from a recipient CSV, ZERO dependencies.
//
// INPUT  : a CSV with header `address,amount` (amount in whole tokens OR wei — see --decimals).
// OUTPUT : { merkleRoot, tokenTotal, count, claims } JSON — the root goes on-chain in
//          MerkleDistributor's constructor; the claims + CSV get published (IPFS/repo) so the drop is
//          auditable (the plan's "visible/transparent" requirement, Part 3b).
//
// The index for each recipient is its 0-based row order in the (address-sorted) input, so the CSV and
// the manifest are stably reproducible. PURE: no chain, no network, no keys.
//
//   node scripts/build-merkle.mjs recipients.csv > claims.json
//   node scripts/build-merkle.mjs recipients.csv --decimals 18 --out claims.json
//
// Exports parseCsv() and buildFromRows() for the offline tests.

import { readFileSync, writeFileSync } from "node:fs";
import { buildClaims } from "./lib/merkle.mjs";

/** Parse `address,amount` CSV text into rows. Tolerates blank lines, comments (#), and a header. */
export function parseCsv(text) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [addr, amt] = line.split(",").map((s) => (s || "").trim());
    if (!addr || addr.toLowerCase() === "address") continue; // skip header
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error(`bad address in CSV: ${addr}`);
    rows.push({ address: addr, amount: amt });
  }
  if (!rows.length) throw new Error("no recipient rows found");
  return rows;
}

/** Convert a whole-token or wei amount to a wei BigInt string given `decimals`. */
export function toWei(amount, decimals) {
  const s = String(amount).trim();
  if (decimals === 0) return BigInt(s).toString();
  if (!s.includes(".")) return (BigInt(s) * 10n ** BigInt(decimals)).toString();
  const [intPart, fracRaw] = s.split(".");
  const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(frac || "0")).toString();
}

/** Build the claims manifest from parsed rows. `decimals`: 0 = amounts already in wei. */
export function buildFromRows(rows, decimals = 18) {
  // Deterministic index = position after sorting by lowercased address.
  const sorted = [...rows].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const entries = sorted.map((r, i) => ({
    index: i,
    account: r.address,
    amount: toWei(r.amount, decimals),
  }));
  return buildClaims(entries);
}

// ---- CLI ------------------------------------------------------------------
function isMain() {
  return typeof process !== "undefined" && process.argv[1] && process.argv[1].endsWith("build-merkle.mjs");
}

if (isMain()) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const decIdx = args.indexOf("--decimals");
  const decimals = decIdx >= 0 ? parseInt(args[decIdx + 1], 10) : 18;
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : null;

  if (!file) {
    console.error("usage: node scripts/build-merkle.mjs <recipients.csv> [--decimals N] [--out claims.json]");
    process.exit(1);
  }
  const manifest = buildFromRows(parseCsv(readFileSync(file, "utf8")), decimals);
  const json = JSON.stringify(manifest, null, 2);
  if (out) {
    writeFileSync(out, json);
    console.error(`wrote ${out}  root=${manifest.merkleRoot}  recipients=${manifest.count}  total(wei)=${manifest.tokenTotal}`);
  } else {
    console.log(json);
  }
}
