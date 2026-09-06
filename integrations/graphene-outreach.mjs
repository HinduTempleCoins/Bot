// graphene-outreach.mjs — Pizza-Bot-style outreach to curation programs on STEEM, HIVE and BLURT.
//
// THE PROBLEM THIS MODULE IS ACTUALLY SOLVING. Reaching "as many people as relevant" on a Graphene social
// chain is one keystroke away from being comment spam, and comment spam on STEEM or HIVE is not a soft
// failure. It draws downvotes, it draws @spaminator and @hivewatchers attention, and a flagged reputation
// on a founding witness account is not recoverable by apologising. @hathor's reputation is a load-bearing
// asset of the whole project. So the design constraint is not "send more" — it is "never send one that
// looks automated to the person receiving it."
//
// THE PIZZA BOT LESSON. The bots people welcome are the ones that GIVE before they ask. Pizza was known
// for tipping first and being useful second. A curation-program operator receives pitches constantly and
// ignores all of them; what they notice is an account that has already voted their curation posts and can
// name what the program actually does. So `outreachPlan()` refuses a prospect the bot has never voted on,
// and `composeOutreach()` refuses a message that does not reference something specific about that program.
//
// THE THREE GUARDS, in the order they fire:
//   1. NEVER TWICE. A contacted account is contacted once, ever, per campaign. Idempotent like welcomer/state.
//   2. RATE. Per-chain minimum interval between comments, plus a hard daily cap per chain. Both configurable
//      because chain consensus parameters change; both defaulting to conservative rather than to the limit.
//   3. NOT GENERIC. A composed message that would read identically for two different prospects is refused
//      before it can be queued. Generic outreach IS the spam, whatever the volume.
//
// DRY RUN IS THE DEFAULT. `outreachPlan()` produces a QUEUE. Nothing here broadcasts. Handing the queue to
// a signer is a separate, deliberate act, and it should stay that way: the cost of a bad send is measured
// in years of reputation and the cost of a delayed send is measured in hours.
//
// Keys: never held here. HIVE signs via HiveSigner or WhaleVault, MELEK via MELEK-Signer. See autovote/chains.js.
//
// House style: ESM, injectable fetch, soft-fail-never-throw, offline-testable.
//
//   import { classifyProspect, outreachPlan, composeOutreach, CHAIN_LIMITS } from './graphene-outreach.mjs';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

/** Chains this module will address. Config (RPCs, prefixes, auth) lives in autovote/chains.js. */
export const CHAINS = Object.freeze(['steem', 'hive', 'blurt']);

/**
 * Per-chain send limits. Deliberately BELOW what consensus permits — the consensus floor is what gets you
 * rate-limited by the node, the social floor is what gets you flagged by humans, and the social floor is
 * much lower. Override per campaign if an operator has a reason; the default should never need raising.
 */
export const CHAIN_LIMITS = Object.freeze({
  steem: Object.freeze({ minIntervalSec: 60, dailyCap: 20 }),
  hive: Object.freeze({ minIntervalSec: 60, dailyCap: 20 }),
  blurt: Object.freeze({ minIntervalSec: 60, dailyCap: 10 }),
});

/** Signals that an account actually runs a curation program, weighted. */
const CURATION_SIGNALS = Object.freeze([
  { key: 'curationReport', weight: 3, why: 'publishes recurring curation reports' },
  { key: 'delegationsIn', weight: 2, why: 'receives delegations — people trust it with stake' },
  { key: 'tagCuration', weight: 2, why: 'posts under curation tags' },
  { key: 'votesManyAuthors', weight: 2, why: 'votes a wide author set rather than a clique' },
  { key: 'hasProgramPost', weight: 3, why: 'has a standing post describing the programme' },
  { key: 'activeRecently', weight: 1, why: 'active in the last 30 days' },
]);

/** A prospect must clear this to be worth contacting at all. */
export const PROSPECT_THRESHOLD = 6;

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const str = (v, max = 400) => String(v == null ? '' : v).trim().slice(0, max);

/**
 * classifyProspect(account) — is this account running a curation programme, and how confident are we?
 * `account` carries the boolean signals above plus { name, chain, programName, focus }.
 * Returns { ok, score, reasons[], why }. Never throws.
 */
export function classifyProspect(account) {
  const a = account && typeof account === 'object' ? account : {};
  const reasons = [];
  let score = 0;
  for (const s of CURATION_SIGNALS) {
    if (a[s.key] === true) { score += s.weight; reasons.push(s.why); }
  }
  if (a.activeRecently !== true) {
    return { ok: false, score, reasons, why: 'dormant — contacting a dormant account is noise for both sides' };
  }
  if (score < PROSPECT_THRESHOLD) {
    return { ok: false, score, reasons, why: `score ${score} below threshold ${PROSPECT_THRESHOLD} — not clearly a curation programme` };
  }
  return { ok: true, score, reasons, why: '' };
}

/**
 * composeOutreach(prospect, ctx) — the message. Refuses to produce a generic one.
 *
 * The refusal is the feature. A message that does not name the programme and say something specific about
 * what it curates is indistinguishable from the pitches this person already ignores, and sending it costs
 * more than not sending it.
 */
export function composeOutreach(prospect, ctx) {
  const p = prospect && typeof prospect === 'object' ? prospect : {};
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const name = str(p.name, 32);
  const programme = str(p.programName, 80);
  const focus = str(p.focus, 160);
  const observed = str(p.observed, 300);   // something the bot actually saw them curate

  const missing = [];
  if (!name) missing.push('account name');
  if (!programme) missing.push('programme name');
  if (!focus) missing.push('what the programme curates');
  if (!observed) missing.push('a specific post or curation the bot actually saw');
  if (missing.length) {
    return { ok: false, body: '', why: `refused as generic — missing: ${missing.join(', ')}` };
  }
  if (p.votedByUs !== true) {
    return { ok: false, body: '', why: 'refused — the bot has not voted this account yet. Give before asking.' };
  }

  const from = str(c.fromAccount, 32) || 'hathor';
  const link = str(c.link, 200);
  const body = [
    `@${name} — I have been reading ${programme} and voting it${observed ? `, most recently ${observed}` : ''}.`,
    ``,
    `I run @${from}, an AI witness account on the MELEK chain. ${focus} overlaps with what I curate, and I would rather support an existing programme than start a competing one.`,
    ``,
    `Two concrete things I can offer: consistent votes on your curation posts, and a cross-chain audience that does not currently see them.`,
    ``,
    `If that is not useful, no reply needed and I will not write again.${link ? ` If it is: ${link}` : ''}`,
  ].join('\n');

  return { ok: true, body, why: '' };
}

/**
 * outreachPlan(prospects, state, opts) — turn a prospect list into a SEND QUEUE, with every guard applied.
 * Broadcasts nothing. Returns { queue[], skipped[], byChain{} }. Never throws.
 *
 * state: { contacted: { 'chain:account': isoDate }, sentToday: { chain: n } }
 */
export function outreachPlan(prospects, state, opts) {
  const list = Array.isArray(prospects) ? prospects : [];
  const st = state && typeof state === 'object' ? state : {};
  // A `= {}` default only fires on `undefined`. An explicit null — which is what a caller passes when it
  // has no options to give — reached `.limits` below and threw. Fourth instance of this pattern in the
  // repo; normalise every object parameter before reading it.
  const o = opts && typeof opts === 'object' ? opts : {};
  const contacted = st.contacted && typeof st.contacted === 'object' ? st.contacted : {};
  const sentToday = st.sentToday && typeof st.sentToday === 'object' ? st.sentToday : {};
  const limits = { ...CHAIN_LIMITS, ...(o.limits || {}) };
  const ctx = o.ctx || {};

  const queue = []; const skipped = [];
  const perChain = {};
  for (const ch of CHAINS) perChain[ch] = num(sentToday[ch], 0);

  for (const raw of list) {
    const p = raw && typeof raw === 'object' ? raw : {};
    const chain = String(p.chain || '').toLowerCase();
    const name = str(p.name, 32);
    const key = `${chain}:${name}`;

    if (!CHAINS.includes(chain)) { skipped.push({ key, why: `unsupported chain "${chain}"` }); continue; }
    if (!name) { skipped.push({ key, why: 'no account name' }); continue; }
    if (contacted[key]) { skipped.push({ key, why: `already contacted ${contacted[key]} — never twice` }); continue; }

    const cls = classifyProspect(p);
    if (!cls.ok) { skipped.push({ key, why: cls.why, score: cls.score }); continue; }

    const cap = num((limits[chain] || {}).dailyCap, 0);
    if (perChain[chain] >= cap) { skipped.push({ key, why: `daily cap reached for ${chain} (${cap})` }); continue; }

    const msg = composeOutreach(p, ctx);
    if (!msg.ok) { skipped.push({ key, why: msg.why }); continue; }

    perChain[chain] += 1;
    queue.push({
      key, chain, account: name, score: cls.score, reasons: cls.reasons,
      body: msg.body,
      // The runner must honour this. It is a floor, not a target.
      notBeforeOffsetSec: (perChain[chain] - 1) * num((limits[chain] || {}).minIntervalSec, 60),
    });
  }

  return { queue, skipped, byChain: perChain, dryRun: true };
}

/**
 * fetchCurationProspects(chain, opts) — read candidate accounts from a chain by tag.
 * Soft-fails to [] so a campaign run degrades to "nothing to send" rather than to a crash.
 */
export async function fetchCurationProspects(chain, { rpcUrl, tag = 'curation', limit = 50 } = {}) {
  const ch = String(chain || '').toLowerCase();
  if (!CHAINS.includes(ch) || !rpcUrl) return [];
  const body = {
    jsonrpc: '2.0', id: 1, method: 'condenser_api.get_discussions_by_created',
    params: [{ tag: str(tag, 32), limit: Math.max(1, Math.min(100, num(limit, 50))) }],
  };
  try {
    const r = await _fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r || r.ok === false) return [];
    const j = await r.json();
    const posts = (j && Array.isArray(j.result)) ? j.result : [];
    const byAuthor = new Map();
    for (const post of posts) {
      const author = post && typeof post.author === 'string' ? post.author : '';
      if (!author) continue;
      if (!byAuthor.has(author)) byAuthor.set(author, { name: author, chain: ch, posts: 0, sample: str(post.title, 120) });
      byAuthor.get(author).posts += 1;
    }
    return [...byAuthor.values()];
  } catch { return []; }
}

/** handler(req,res) — inspect a planned campaign without sending it. */
export function handler(req, res, prospects = [], state = {}, opts = {}) {
  const plan = outreachPlan(prospects, state, opts);
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(plan, null, 2));
}

const isMain = process.argv[1] && process.argv[1].endsWith('graphene-outreach.mjs');
if (isMain) {
  const demo = [{
    name: 'somecurator', chain: 'hive', programName: 'The Example Curation Trail',
    focus: 'long-form science writing', observed: 'your weekly report on under-voted chemistry posts',
    votedByUs: true, curationReport: true, delegationsIn: true, hasProgramPost: true, activeRecently: true,
  }];
  console.log(JSON.stringify(outreachPlan(demo, {}, { ctx: { fromAccount: 'hathor' } }), null, 2));
}

export default outreachPlan;
