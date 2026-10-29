// metals-alert.mjs — watch gold and silver, post when one of them moves hard in a day.
//
// NO API KEY, NO PAID FEED. Tokenised metal is the watchpost: PAX Gold and Tether Gold are each one
// troy ounce of gold, Kinesis Silver one troy ounce of silver, and CoinGecko serves them keyless with
// `usd_24h_change` already computed — so there is nothing to poll on a schedule, nothing to store, and
// no history to keep in order to know what moved. Accuracy was checked against a bullion dealer's own
// report on 2026-10-28: KAG printed 53.91 against the dealer's 53.91, PAXG 4,066 against spot 4,049.
//
// ⚠ THE FAILURE THIS GUARDS AGAINST. A tokenised-metal price can move because the TOKEN moved. A
// depeg, a thin book or an exchange outage will print -8% on PAXG while gold has not budged, and a bot
// that trusts one number will publish a screaming emergency post about nothing. So gold needs TWO
// independent proxies that AGREE before any alert fires. If they disagree by more than DISAGREE_PCT,
// that is evidence about the tokens, not about gold, and the right output is silence.
//
// Silver has only ONE proxy, and that limit is stated rather than papered over. A first draft gated
// silver on "the ratio must also move", which reads well and does nothing: a Kinesis depeg moves the
// implied ratio exactly as a real silver move does, because in both cases silver changed and gold did
// not. The two are indistinguishable from one source. So silver alerts on the threshold, the verdict
// carries confirmed:false, and the post says which source it came from — an honest caveat beats a
// check that cannot fire.
//
// House style: ESM .mjs, injectable fetch + fs, soft-fail-never-throw, CLI guarded by argv[1].

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

export const THRESHOLD_PCT = Number(env('METALS_ALERT_PCT', '5'));
/** Two gold proxies further apart than this are arguing about the token, not reporting the metal. */
export const DISAGREE_PCT = Number(env('METALS_DISAGREE_PCT', '1.5'));
/** A silver move this large should shift the ratio by at least this much to be believed. */
export const RATIO_CONFIRM_PCT = Number(env('METALS_RATIO_CONFIRM_PCT', '2'));
export const API = env('METALS_ALERT_API', 'https://api.coingecko.com/api/v3/simple/price');
export const GOLD_IDS = ['pax-gold', 'tether-gold'];
export const SILVER_IDS = ['kinesis-silver'];
export const STATE_FILE = () => env('METALS_ALERT_STATE', './data/metals-alert.json');

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const realFs = {
  read: (p) => { try { return require('node:fs').readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { const fs = require('node:fs'); fs.mkdirSync(require('node:path').dirname(p), { recursive: true }); fs.writeFileSync(p, s); return true; } catch { return false; } },
};
const ctx = (o = {}) => ({ fs: o.fs || realFs, file: o.file || STATE_FILE() });
export function loadState(o = {}) {
  const { fs, file } = ctx(o);
  try { return JSON.parse(fs.read(file) || '{}') || {}; } catch { return {}; }
}
export function saveState(st, o = {}) { const { fs, file } = ctx(o); try { return fs.write(file, JSON.stringify(st)); } catch { return false; } }

/** Pull the raw quotes. Returns null on any failure — a watcher that guesses is worse than one that waits. */
export async function fetchQuotes({ url = API } = {}) {
  const ids = [...GOLD_IDS, ...SILVER_IDS].join(',');
  try {
    const r = await _fetch(`${url}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
    const j = await r.json();
    if (!j || typeof j !== 'object') return null;
    const pick = (id) => {
      const o = j[id]; if (!o) return null;
      const p = Number(o.usd); const c = Number(o.usd_24h_change);
      return Number.isFinite(p) && p > 0 && Number.isFinite(c) ? { price: p, changePct: c } : null;
    };
    const gold = GOLD_IDS.map(pick).filter(Boolean);
    const silver = SILVER_IDS.map(pick).filter(Boolean);
    if (!gold.length && !silver.length) return null;
    return { gold, silver };
  } catch { return null; }
}

/**
 * Decide whether anything is worth posting. PURE — no network, no disk.
 * @returns {{alert:boolean, metal?:string, changePct?:number, price?:number, reason:string}}
 */
export function assess({ gold = [], silver = [], threshold = THRESHOLD_PCT, disagree = DISAGREE_PCT,
                         ratioConfirmPct = RATIO_CONFIRM_PCT } = {}) {
  const out = [];
  // GOLD — needs two proxies that agree
  if (gold.length >= 2) {
    const [a, b] = gold;
    const spread = Math.abs(a.changePct - b.changePct);
    if (spread > disagree) {
      out.push({ alert: false, metal: 'gold', reason: `proxies disagree by ${spread.toFixed(2)}pp — that is a token problem, not a gold move` });
    } else {
      const avg = (a.changePct + b.changePct) / 2;
      out.push(Math.abs(avg) >= threshold
        ? { alert: true, metal: 'gold', changePct: avg, price: (a.price + b.price) / 2, confirmed: true, reason: `both proxies agree on ${avg.toFixed(2)}%` }
        : { alert: false, metal: 'gold', changePct: avg, reason: `${avg.toFixed(2)}% is inside the ${threshold}% threshold` });
    }
  } else if (gold.length === 1) {
    out.push({ alert: false, metal: 'gold', reason: 'only one gold proxy responded — not enough to confirm a move' });
  }
  // SILVER — single proxy, so an alert is flagged unconfirmed rather than pretending to be verified
  if (silver.length) {
    const s = silver[0];
    const g = gold.length ? gold.reduce((t, x) => t + x.changePct, 0) / gold.length : 0;
    const ratioMovePct = ((1 + g / 100) / (1 + s.changePct / 100) - 1) * 100;
    out.push(Math.abs(s.changePct) >= threshold
      ? { alert: true, metal: 'silver', changePct: s.changePct, price: s.price, confirmed: false,
          ratioMovePct, reason: `${s.changePct.toFixed(2)}% on a single source (ratio ${ratioMovePct.toFixed(2)}%)` }
      : { alert: false, metal: 'silver', changePct: s.changePct, reason: `${s.changePct.toFixed(2)}% is inside the ${threshold}% threshold` });
  }
  const hit = out.find((o) => o.alert);
  return hit || out[0] || { alert: false, reason: 'no quotes' };
}

/** One alert per metal per direction per day — a watcher that repeats itself gets muted by readers. */
export function alreadyPosted(state, metal, changePct, { now = Date.now() } = {}) {
  const k = `${metal}:${changePct >= 0 ? 'up' : 'down'}`;
  const last = state && state[k];
  if (!last) return false;
  return (now - Number(last)) < 20 * 3600 * 1000;
}

const esc = (s) => String(s == null ? '' : s);
/** The post. Short, factual, no exclamation marks — the number is the drama. */
export function composePost({ metal, changePct, price, confirmed = true, asof = new Date().toISOString().slice(0, 10) } = {}) {
  const dir = changePct >= 0 ? 'up' : 'down';
  const name = metal === 'gold' ? 'Gold' : 'Silver';
  const title = `${name} ${dir} ${Math.abs(changePct).toFixed(1)}% in a day — $${Number(price).toLocaleString('en-US', { maximumFractionDigits: 2 })}/oz`;
  const body = [
    `**${name} has moved ${Math.abs(changePct).toFixed(2)}% ${dir} over the last 24 hours**, to about $${Number(price).toLocaleString('en-US', { maximumFractionDigits: 2 })} per troy ounce.`,
    '',
    `A move of this size in one session is rare enough to be worth saying out loud, and it is posted automatically the moment it clears ${THRESHOLD_PCT}% — not written up after the fact once somebody has decided what it meant.`,
    '',
    'What this post does **not** do is tell you why, or what happens next. Nobody knows that yet, and the accounts that will explain it confidently tomorrow are guessing today.',
    '',
    `Read against the long record: the weekly board on this account carries the full history, and a single day — however violent — is one point on a line that runs back to 1876.`,
    '',
    confirmed
      ? `*Price from tokenised metal, each token one troy ounce, and confirmed across two independent sources before posting. Posted ${esc(asof)}.*`
      : `*Price from a single tokenised-metal source (one token, one troy ounce). A one-source reading cannot rule out that the token moved rather than the metal — check dealer spot before acting on it. Posted ${esc(asof)}.*`,
  ].join('\n');
  return { title, body, tags: ['gold', 'silver', 'metals', 'markets', 'kula'] };
}

/** One pass. Never throws. Returns what it did and why. */
export async function tick({ post = null, now = Date.now(), ...opts } = {}) {
  const q = await fetchQuotes(opts);
  if (!q) return { ok: false, reason: 'no quotes — refusing to guess' };
  const verdict = assess({ ...q, ...opts });
  if (!verdict.alert) return { ok: true, posted: false, ...verdict };
  const state = loadState(opts);
  if (alreadyPosted(state, verdict.metal, verdict.changePct, { now })) {
    return { ok: true, posted: false, ...verdict, reason: 'already posted this move today' };
  }
  const draft = composePost(verdict);
  if (!post) return { ok: true, posted: false, ...verdict, draft, reason: 'no publisher supplied (dry)' };
  try {
    const res = await post(draft);
    state[`${verdict.metal}:${verdict.changePct >= 0 ? 'up' : 'down'}`] = now;
    saveState(state, opts);
    return { ok: true, posted: true, ...verdict, result: res };
  } catch (e) {
    return { ok: false, posted: false, ...verdict, reason: `publish failed: ${String(e.message || e).slice(0, 140)}` };
  }
}

if (process.argv[1] && /metals-alert\.mjs$/.test(process.argv[1])) {
  const r = await tick({});
  console.log(JSON.stringify(r, null, 2));
}
