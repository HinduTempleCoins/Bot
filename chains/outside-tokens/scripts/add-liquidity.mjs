// add-liquidity.mjs — plan (and, when a signer is wired, execute) the opening NEW/wPRANA liquidity
// seed on a UniV2 DEX. BY DEFAULT IT ONLY PLANS: it prints the exact router.addLiquidity call params
// and the resulting opening price + LP tokens. It NEVER broadcasts unless the operator explicitly
// runs it with a signer AND passes --broadcast (guarded; a no-op stub here so this repo holds no
// key/broadcast path — matches the Bot's key-custody rules).
//
//   node scripts/add-liquidity.mjs --chain base --token <NEW> --quote <wPRANA> \
//        --amount-token 1000000 --amount-quote 5000 [--decimals 18]
//
// The seed ratio DEFINES the opening price (plan Part 3c): price = amountQuote / amountToken.
// PURE planning math (scripts/lib/univ2.mjs); no chain, no network, no keys in this file.

import { addLiquidityPlan } from "./lib/univ2.mjs";
import { ROUTER_ABI } from "./lib/router-abi.mjs";
import { chain, isLive } from "../config/chains.mjs";

const toWei = (amt, dec) => {
  const s = String(amt);
  if (!s.includes(".")) return BigInt(s) * 10n ** BigInt(dec);
  const [i, f = ""] = s.split(".");
  return BigInt(i) * 10n ** BigInt(dec) + BigInt((f + "0".repeat(dec)).slice(0, dec) || "0");
};

/**
 * Build the add-liquidity plan (call params + opening price + LP) without touching a chain.
 * @returns {{ router:string, call:object, plan:object, deadlineHint:string }}
 */
export function planAddLiquidity({ chainKey, tokenAddr, quoteAddr, amountToken, amountQuote, decimals = 18, to = "<treasury>" }) {
  const c = chain(chainKey);
  const at = toWei(amountToken, decimals);
  const aq = toWei(amountQuote, decimals);
  const plan = addLiquidityPlan({ amountToken: at, amountQuote: aq });

  // For a FRESH pair there is no prior ratio, so min == desired is safe (no other LPs to front-run).
  const call = {
    method: "addLiquidity",
    signature: ROUTER_ABI.find((s) => s.startsWith("function addLiquidity")),
    args: {
      tokenA: tokenAddr,
      tokenB: quoteAddr,
      amountADesired: at.toString(),
      amountBDesired: aq.toString(),
      amountAMin: at.toString(),
      amountBMin: aq.toString(),
      to,
      deadline: "<now + 20min at broadcast>",
    },
  };
  return {
    router: c.router,
    routerLive: isLive(c.router),
    call,
    plan: {
      openingPrice_quotePerToken: plan.openingPrice.priceBperA,
      openingPrice_tokenPerQuote: plan.openingPrice.priceAperB,
      lpTokensToSeeder: plan.lpTokens.toString(),
      lpLockedForever: plan.lockedForever.toString(),
    },
    deadlineHint: "set deadline = Math.floor(Date.now()/1000) + 1200 when broadcasting",
  };
}

// ---- CLI (PLAN ONLY) ------------------------------------------------------
function isMain() {
  return typeof process !== "undefined" && process.argv[1] && process.argv[1].endsWith("add-liquidity.mjs");
}

if (isMain()) {
  const a = process.argv.slice(2);
  const get = (k, d) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : d;
  };
  const broadcast = a.includes("--broadcast");
  const res = planAddLiquidity({
    chainKey: get("--chain", "base"),
    tokenAddr: get("--token", "<NEW_TOKEN>"),
    quoteAddr: get("--quote", "<wPRANA>"),
    amountToken: get("--amount-token", "1000000"),
    amountQuote: get("--amount-quote", "5000"),
    decimals: parseInt(get("--decimals", "18"), 10),
    to: get("--to", "<treasury>"),
  });

  console.log("=== add-liquidity PLAN (no broadcast) ===");
  console.log(JSON.stringify(res, null, 2));
  if (broadcast) {
    console.error(
      "\n[STOP] --broadcast is a no-op in this repo by design. Broadcasting requires a signer and a" +
        "\nprivate key, which live in the separate signer repo (never here). Hand these params to the" +
        "\noperator-gated deploy runner to execute. See README 'Operator-gated steps'."
    );
    process.exit(2);
  }
}
