// amygdala.mjs — Hathor's AMYGDALA lobe: salience + valence. What MATTERS, and how much.
//
// The brain architecture (.local/BRAIN_ARCHITECTURE.md) already names the neocortex (Hathor), the
// sensory cortex (Resource Center), Broca/Wernicke (Language Center), the hippocampus (memory), the
// basal ganglia (reflex routing) and the cerebellum (the deterministic readers). The missing piece is
// the limbic one: a region that tags everything streaming through the brain with EMOTIONAL/STRATEGIC
// SALIENCE so the rest can PRIORITIZE — handle the burning thing first, give weight to what's
// important, notice what's new, and flag threat. Cheetah is a specialized threat detector; this is the
// general salience layer that sits over the whole stream (harvested-todos, brief lines, incoming asks,
// annals) and answers "of these N things, which few matter most right now?"
//
// Deterministic + offline by construction (an amygdala is fast and pre-cognitive — it must not depend
// on a rented model). An optional LLM pass can REFINE, but the core score is keyword/heuristic and
// always works. House style: ESM, injectable clock + seen-set, soft-fail, CLI guard, handler(req,res).

// Signal lexicons. Tuned for THIS project's stream (chain/keys/users/trade/brief work).
const URGENT = ['urgent', 'asap', 'now', 'immediately', 'today', 'deadline', 'broken', 'broke', 'crash', 'crashed', 'down', 'failing', 'fails', 'blocked', 'stuck', 'hang', 'stall', 'stalled', 'regression', 'outage', 'expired', 'expiring'];
const IMPORTANT = ['key', 'keys', 'wif', 'vault', 'security', 'secret', 'chain', 'witness', 'hathor', 'live', 'production', 'mainnet', 'money', 'funds', 'treasury', 'user', 'users', 'signup', 'consensus', 'genesis', 'operator', 'decide', 'decision', 'launch'];
const THREAT = ['exploit', 'hack', 'hacked', 'leak', 'leaked', 'breach', 'scam', 'phish', 'malware', 'csam', 'attacker', 'compromise', 'compromised', 'drain', 'drained', 'rug', 'impersonat', 'stolen', 'theft'];
const NEG = ['broken', 'fail', 'crash', 'down', 'error', 'bug', 'lost', 'wrong', 'missing', 'corrupt', 'dropped', 'stale', 'cannot', "can't", 'unable', 'blocked', 'denied', 'regression', 'worse', 'bad'];
const POS = ['done', 'shipped', 'live', 'works', 'working', 'passed', 'green', 'fixed', 'resolved', 'success', 'merged', 'verified', 'proven', 'complete', 'ready', 'confirmed'];

const has = (text, list) => { const t = ` ${String(text).toLowerCase()} `; let n = 0; for (const w of list) if (t.includes(w)) n++; return n; };
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Cheap novelty key: the significant words of an item, sorted — so paraphrases collide.
function noveltyKey(text) {
  return [...new Set(String(text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3))]
    .sort().slice(0, 12).join(' ');
}

/**
 * Score one item's salience.
 * @param {string|{text:string, at?:number|string, source?:string}} item
 * @param {{ now?:number, seen?:Set<string> }} [ctx]
 * @returns {{ text, salience, urgency, importance, threat, valence, novelty, tags, source }}
 */
export function scoreSalience(item, ctx = {}) {
  const text = typeof item === 'string' ? item : (item && item.text) || '';
  const now = ctx.now ?? Date.now();
  const seen = ctx.seen;

  const urgency = clamp01(has(text, URGENT) * 0.34);
  const importance = clamp01(has(text, IMPORTANT) * 0.28);
  const threat = clamp01(has(text, THREAT) * 0.45);
  const neg = has(text, NEG);
  const pos = has(text, POS);
  // valence: -1 (bad) … +1 (good). Negative things are MORE salient (the amygdala leans to threat).
  const valence = clamp01((pos - neg + 3) / 6) * 2 - 1;

  // recency boost if the item carries a timestamp (newer = a touch more salient)
  let recency = 0;
  const at = typeof item === 'object' ? item.at : null;
  if (at) { const ms = typeof at === 'number' ? at : Date.parse(at); if (Number.isFinite(ms)) recency = clamp01(1 - (now - ms) / (48 * 3.6e6)) * 0.15; }

  // novelty: unseen → full; seen → none. Mutates the seen-set if provided (so a stream self-dedupes).
  let novelty = 0.12;
  if (seen) { const k = noveltyKey(text); if (!seen.has(k)) { novelty = 0.2; seen.add(k); } else novelty = 0; }

  // negativity adds salience on its own (bad news matters)
  const negPull = clamp01(neg * 0.12);

  const salience = clamp01(urgency + importance + threat + novelty + recency + negPull);
  const tags = [];
  if (threat > 0) tags.push('threat');
  if (urgency >= 0.34) tags.push('urgent');
  if (importance >= 0.28) tags.push('important');
  if (valence < -0.2) tags.push('negative');
  if (valence > 0.4) tags.push('positive');
  return {
    text,
    salience: round(salience),
    urgency: round(urgency),
    importance: round(importance),
    threat: round(threat),
    valence: round(valence),
    novelty: round(novelty),
    tags,
    source: typeof item === 'object' ? item.source : undefined,
  };
}

// Rank a stream of items by salience (most-salient first). Shares one seen-set so novelty is honest
// across the batch. Stable for ties (preserves input order).
export function rank(items, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const seen = ctx.seen ?? new Set();
  return items
    .map((it, i) => ({ ...scoreSalience(it, { now, seen }), _i: i }))
    .sort((a, b) => b.salience - a.salience || a._i - b._i)
    .map(({ _i, ...r }) => r);
}

// The few that matter most right now (default top 5, or everything above a floor).
export function topSalient(items, { k = 5, floor = 0 } = {}, ctx = {}) {
  return rank(items, ctx).filter((r) => r.salience >= floor).slice(0, k);
}

function round(x) { return Math.round(x * 100) / 100; }

export function handler(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let items = [];
    try { const p = JSON.parse(body || '{}'); items = Array.isArray(p) ? p : (p.items || []); } catch {}
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ranked: rank(items) }, null, 2));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // CLI demo: rank a few sample stream items.
  const sample = [
    'The vault key expired — feed + welcomer down (Missing Posting Authority)',
    'Shipped the exchange join-list; 12 tests green',
    'Possible key leak in a public commit — investigate',
    'Add a tooltip to the tutorial page',
  ];
  for (const r of rank(sample)) console.log(`${r.salience.toFixed(2)}  [${r.tags.join(',') || '-'}]  ${r.text}`);
}
