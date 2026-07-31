// pentecaust/herald/haro-monitor.mjs — the Herald SOURCE-REQUEST monitor (outreach brief, Component 7):
// catch journalist queries (HARO / Qwoted / Featured) that match the operator's expertise and draft a
// response for each. The operator SENDS manually — this module never sends. It does not call the live Gmail
// API; it takes an array of already-fetched digest items (a reader/forwarder fills that array elsewhere).
//
// Deterministic templates by default (works with NO LLM); an LLM may be injected to tighten the pitch, but
// every matched item still gets a real draft from the template — soft-fail-never-throw, fully offline.
//
//   import { TOPICS, matchQuery, draftResponse, scanDigest, __setLLM } from './haro-monitor.mjs'

export function env(k, d) { const v = process.env[k]; return v == null || v === '' ? d : v; }

let _llm = null;
export function __setLLM(fn) { _llm = typeof fn === 'function' ? fn : null; }
async function ask(p) { if (!_llm) return null; try { const r = await _llm(String(p || '')); return r == null ? null : String(r); } catch { return null; } }

const now = (opts) => (opts && opts.now != null ? opts.now : Date.now());
const clean = (s) => String(s == null ? '' : s).trim();

// ── expertise topics → keyword lists (case-insensitive substring match on subject+body). ────────────────
export const TOPICS = {
  blockchain_crypto:   ['blockchain', 'crypto', 'cryptocurrency', 'bitcoin', 'web3', 'token', 'defi', 'decentralized'],
  religious_liberty_rfra: ['religious liberty', 'religious freedom', 'rfra', 'first amendment', 'free exercise', 'establishment clause'],
  ethnobotany:         ['ethnobotany', 'kava', 'kratom', 'plant genetics', 'entheogen', 'botanical', 'psychoactive plant'],
  foodservice_stadium: ['food service', 'foodservice', 'stadium', 'concession', 'concessions', 'venue operations', 'catering'],
  nonprofit_admin:     ['nonprofit', 'non-profit', '501(c)(3)', '501c3', 'charity administration', 'foundation'],
  pro_se_litigation:   ['pro se', 'self-represented', 'self represented', 'litigation', 'federal lawsuit', 'civil rights suit'],
};

const HAYSTACK = (item) => `${clean(item && item.subject)} ${clean(item && item.body)}`.toLowerCase();

// ── which topics does this query touch? ─────────────────────────────────────────────────────────────────
export function matchQuery(item = {}) {
  const hay = HAYSTACK(item);
  const topics = Object.keys(TOPICS).filter((t) => TOPICS[t].some((kw) => hay.includes(kw)));
  return { matched: topics.length > 0, topics };
}

const TOPIC_LABEL = {
  blockchain_crypto: 'blockchain and cryptocurrency',
  religious_liberty_rfra: 'religious liberty and RFRA',
  ethnobotany: 'ethnobotany, kava, and plant genetics',
  foodservice_stadium: 'food service and stadium operations',
  nonprofit_admin: 'nonprofit administration',
  pro_se_litigation: 'self-represented (pro se) litigation',
};

function templateDraft(item, topics) {
  const name = env('HERALD_EXPERT_NAME', 'Rev. Ryan Van Kush');
  const org = env('HERALD_ORG_NAME', 'Van Kush Family Research Institute');
  const areas = topics.map((t) => TOPIC_LABEL[t] || t).join(', ');
  const subj = clean(item && item.subject) || 'your query';
  return [
    `Re: ${subj}`,
    `I can speak to this on the record. My background is in ${areas}, and I can give you concrete, verifiable detail rather than generalities.`,
    `A few specifics I can offer: firsthand experience, primary sources, and plain-language explanation your readers can follow.`,
    `— ${name}, ${org}`,
  ].join('\n\n');
}

// ── draft a response for one item (matched only). Unmatched → soft-fail { ok:false }. Never throws. ─────
export async function draftResponse(item = {}, opts = {}) {
  const { matched, topics } = matchQuery(item);
  if (!matched) return { ok: false, reason: 'no topic match' };
  let text = null;
  if (_llm) {
    const prompt = `Draft a short, factual, first-person expert response pitch to this journalist query about ${topics.map((t) => TOPIC_LABEL[t] || t).join(', ')}. Be concrete, no hype. QUERY: ${HAYSTACK(item)}`;
    try { text = await ask(prompt); } catch { text = null; }
  }
  const draft = clean(text) || templateDraft(item, topics);
  return { ok: true, topics, deadline: item.deadline ?? null, draft };
}

// deadline may be a ms timestamp or an ISO string; returns ms or null (never throws).
function deadlineMs(d) {
  if (d == null) return null;
  if (typeof d === 'number') return d;
  const t = Date.parse(String(d));
  return Number.isNaN(t) ? null : t;
}

// ── scan a digest: keep matched items, draft each, flag urgent deadlines, sort soonest-first. ───────────
export async function scanDigest(items, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const urgentMs = Number(env('HERALD_HARO_URGENT_HOURS', '24')) * 3600 * 1000;
  const out = [];
  for (const item of list) {
    let d;
    try { d = await draftResponse(item, opts); } catch { d = { ok: false }; }
    if (!d.ok) continue;
    const dl = deadlineMs(item.deadline);
    out.push({
      source: clean(item.source), outlet: clean(item.outlet),
      deadline: item.deadline ?? null, topics: d.topics, draft: d.draft,
      deadlineFlag: dl != null && dl - now(opts) <= urgentMs && dl - now(opts) >= 0,
    });
  }
  // soonest real deadline first; items without a parseable deadline sink to the bottom.
  out.sort((a, b) => {
    const da = deadlineMs(a.deadline); const db = deadlineMs(b.deadline);
    if (da == null && db == null) return 0;
    if (da == null) return 1;
    if (db == null) return -1;
    return da - db;
  });
  return out;
}
