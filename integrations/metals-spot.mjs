// metals-spot.mjs — spot price, junk-silver melt value, and sourcing math for .999 silver.
//
// Two jobs, one set of arithmetic.
//
//   1. MELT VALUE. What is a pre-1965 US coin actually worth as metal? Pure arithmetic once you have
//      spot, because the silver weights are fixed by law and have not changed since the coins were struck.
//   2. SOURCING. What is the cheapest way to buy a given number of grams of a given purity? Also pure
//      arithmetic, and it is the same arithmetic — premium over spot per gram of CONTAINED metal.
//
// THE THING THAT MATTERS MOST IN THIS FILE. The cheapest silver per gram is junk silver, and junk silver
// is the WRONG silver for colloidal production. Pre-1965 US coins are 90% silver and 10% COPPER. Sterling
// is 92.5% silver and 7.5% copper. Electrolysis does not respect the alloy: you liberate the copper along
// with the silver, into something a person intends to swallow. So `purityFor()` refuses anything below
// .999 for the colloidal use and says why. Cheapest and correct are different answers here, and the
// library's job is to say so rather than to let the price chart make the decision.
//
// SILVER WEIGHTS. Actual Silver Weight (ASW) in troy ounces. Uncirculated figures are the struck weights;
// circulated figures account for the metal that has literally worn off, which is why a slick Standing
// Liberty quarter is worth marginally less as metal than a fresh one. The standard shorthand for a bag is
// 0.715 troy oz of silver per $1 of face value in circulated 90% coin — that number already has the wear
// baked in, which is why it is lower than 10 × the uncirculated dime.
//
// House style: ESM, injectable fetch, soft-fail-never-throw, offline-testable.
//
//   import { COINS, meltValue, faceToOunces, premiumPerGram, purityFor, spot, __setFetch } from './metals-spot.mjs';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

export const TROY_OZ_GRAMS = 31.1034768;

/** US circulating silver coinage. asw = troy oz of contained silver. */
export const COINS = Object.freeze({
  'dime-90': Object.freeze({
    label: 'Silver dime (Mercury / Roosevelt, 1964 and earlier)', face: 0.10, fineness: 0.900,
    aswUnc: 0.07234, aswCirc: 0.07150, years: '1892–1964',
  }),
  'quarter-90': Object.freeze({
    label: 'Silver quarter (Standing Liberty / Washington, 1964 and earlier)', face: 0.25, fineness: 0.900,
    aswUnc: 0.18084, aswCirc: 0.17875, years: '1892–1964',
  }),
  'half-90': Object.freeze({
    label: 'Silver half dollar (Walking Liberty / Franklin / Kennedy 1964)', face: 0.50, fineness: 0.900,
    aswUnc: 0.36169, aswCirc: 0.35750, years: '1892–1964',
  }),
  'dollar-90': Object.freeze({
    label: 'Silver dollar (Morgan / Peace)', face: 1.00, fineness: 0.900,
    aswUnc: 0.77344, aswCirc: 0.76500, years: '1878–1935',
  }),
  'half-40': Object.freeze({
    label: 'Kennedy half, 40% silver', face: 0.50, fineness: 0.400,
    aswUnc: 0.14790, aswCirc: 0.14600, years: '1965–1970',
  }),
  'nickel-35': Object.freeze({
    label: 'Wartime nickel, 35% silver', face: 0.05, fineness: 0.350,
    aswUnc: 0.05626, aswCirc: 0.05560, years: '1942–1945 (mintmark above dome)',
  }),
});

/** Circulated 90% silver, troy oz of silver per $1 of face value. The bag-trade standard. */
export const OZ_PER_DOLLAR_FACE_90 = 0.715;

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };

/**
 * meltValue(holdings, spotUsdPerOz, opts) — metal value of a pile of coins.
 * holdings: { 'quarter-90': 3, 'dime-90': 10, ... }. Unknown keys are ignored, not guessed at.
 * Returns { totalOz, totalUsd, faceUsd, lines[] }. Never throws.
 */
export function meltValue(holdings, spotUsdPerOz, { condition = 'circulated' } = {}) {
  const h = holdings && typeof holdings === 'object' ? holdings : {};
  const sp = num(spotUsdPerOz);
  const key = condition === 'uncirculated' ? 'aswUnc' : 'aswCirc';
  const lines = [];
  let totalOz = 0; let faceUsd = 0;
  for (const [id, rawQty] of Object.entries(h)) {
    const coin = COINS[id];
    const qty = Math.floor(num(rawQty));
    if (!coin || qty <= 0) continue;
    const oz = coin[key] * qty;
    totalOz += oz;
    faceUsd += coin.face * qty;
    lines.push({ id, label: coin.label, qty, oz: round(oz, 5), usd: round(oz * sp, 2) });
  }
  return {
    condition,
    spotUsdPerOz: sp,
    faceUsd: round(faceUsd, 2),
    totalOz: round(totalOz, 5),
    totalUsd: round(totalOz * sp, 2),
    // How many times face value the metal is worth. The number people actually want.
    timesFace: faceUsd > 0 ? round((totalOz * sp) / faceUsd, 2) : 0,
    lines,
  };
}

/** faceToOunces(faceUsd) — the bag shorthand for circulated 90%. */
export function faceToOunces(faceUsd) {
  return round(num(faceUsd) * OZ_PER_DOLLAR_FACE_90, 4);
}

/**
 * premiumPerGram(offer, spotUsdPerOz) — compare sources on the only basis that matters:
 * dollars per gram of CONTAINED metal, and the premium that represents over spot.
 * offer: { priceUsd, grams, fineness }  — fineness 0..1 (e.g. 0.999).
 * Returns { usdPerGramContained, spotPerGram, premiumPct, containedGrams }. Never throws.
 */
export function premiumPerGram(offer, spotUsdPerOz) {
  const o = offer && typeof offer === 'object' ? offer : {};
  const price = num(o.priceUsd);
  const grams = num(o.grams);
  const fineness = Math.min(1, Math.max(0, num(o.fineness, 0)));
  const sp = num(spotUsdPerOz);
  const contained = grams * fineness;
  const spotPerGram = sp / TROY_OZ_GRAMS;
  if (contained <= 0 || spotPerGram <= 0) {
    return { containedGrams: 0, usdPerGramContained: 0, spotPerGram: round(spotPerGram, 4), premiumPct: 0, usable: false };
  }
  const perGram = price / contained;
  return {
    containedGrams: round(contained, 3),
    usdPerGramContained: round(perGram, 4),
    spotPerGram: round(spotPerGram, 4),
    premiumPct: round(((perGram - spotPerGram) / spotPerGram) * 100, 1),
    usable: true,
  };
}

/** Minimum fineness by intended use. Below the floor is refused, with the reason. */
export const PURITY_FLOOR = Object.freeze({
  colloidal: 0.999,
  electroplating: 0.999,
  bullion: 0.999,
  jewellery: 0.925,
});

/**
 * purityFor(use, fineness) — is this metal fit for this purpose?
 * Returns { ok, floor, why }. The colloidal refusal is the point of the function.
 */
export function purityFor(use, fineness) {
  const u = String(use == null ? '' : use).trim().toLowerCase();
  const f = num(fineness);
  const floor = PURITY_FLOOR[u];
  if (floor == null) return { ok: false, floor: null, why: `unknown use "${u}" — no purity floor defined, so nothing is cleared` };
  if (f >= floor) return { ok: true, floor, why: '' };
  if (u === 'colloidal') {
    return {
      ok: false,
      floor,
      why: `${f} fine is below .999. Coin silver (.900) and sterling (.925) are alloyed with COPPER. `
        + 'Electrolysis liberates the copper along with the silver, into a preparation intended for ingestion. '
        + 'Cheapest per gram and correct for this use are different answers: use .999 or do not proceed.',
    };
  }
  return { ok: false, floor, why: `${f} fine is below the ${floor} floor for ${u}` };
}

/**
 * spot(metal, opts) — current spot in USD per troy ounce. Injectable fetch, soft-fails to null so a
 * page renders a dash rather than a stack trace. NEVER throws, NEVER guesses a price.
 */
export async function spot(metal = 'silver', { url = null, fetchImpl = null } = {}) {
  const m = String(metal || '').toLowerCase();
  const endpoint = url || `https://api.coinbase.com/v2/prices/${m === 'gold' ? 'XAU' : 'XAG'}-USD/spot`;
  const f = fetchImpl || _fetch;
  try {
    const r = await f(endpoint, { headers: { accept: 'application/json' } });
    if (!r || r.ok === false) return { metal: m, usdPerOz: null, at: null, source: endpoint, error: 'bad response' };
    const j = await r.json();
    const amt = Number(j && j.data && j.data.amount);
    if (!Number.isFinite(amt) || amt <= 0) return { metal: m, usdPerOz: null, at: null, source: endpoint, error: 'no price in payload' };
    return { metal: m, usdPerOz: amt, at: new Date().toISOString(), source: endpoint, error: null };
  } catch (e) {
    return { metal: m, usdPerOz: null, at: null, source: endpoint, error: (e && e.message) || 'fetch failed' };
  }
}

function round(n, dp) { const f = 10 ** dp; return Math.round((Number(n) || 0) * f) / f; }

/** handler(req,res) — JSON melt calculation, for a page or a bot command. */
export function handler(req, res, holdings = {}, spotUsdPerOz = 0, opts = {}) {
  const out = meltValue(holdings, spotUsdPerOz, opts);
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out, null, 2));
}

const isMain = process.argv[1] && process.argv[1].endsWith('metals-spot.mjs');
if (isMain) {
  const s = await spot('silver');
  console.log('spot:', s);
  if (s.usdPerOz) {
    console.log(JSON.stringify(meltValue({ 'quarter-90': 2, 'dime-90': 1 }, s.usdPerOz), null, 2));
    console.log('sterling for colloidal ->', purityFor('colloidal', 0.925));
  }
}

export default meltValue;
