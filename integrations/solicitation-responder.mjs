// solicitation-responder — answer people who ASKED, and nobody else.
//
// The operator's line, 2026-09-08: *"We do want to like Answer People saying like 'Shill me...' and
// 'What is the Next Big Coin?' and give them MELEK and PRANA Answers, but Other than that we don't
// want too much unsolicited stuff, that isn't to Holders."*
//
// That is a real and defensible distinction, and this module exists to enforce it mechanically
// rather than trusting anyone to remember it at 3am. Someone who publicly posts "shill me your bag"
// has invited a reply. Someone posting about their breakfast has not. The whole design is a filter
// that says NO by default.
//
// WHY THE PARANOIA IS EARNED. A previous outreach run from this project posted 20 identical promo
// comments in five hours, including onto large third-party accounts, and the operator's main Hive
// identities have been on the Spaminator blacklist since 2021 as a result. A second run in
// September 2026 repeated one message up to 7 times to a single account. Both times the code had no
// concept of "was I invited." This module is that concept.
//
// FOUR GATES, ALL OF WHICH MUST PASS:
//   1. SOLICITED    the text must actually ask for a recommendation. Merely mentioning crypto is not
//                   an invitation, and `classify()` returns a reason when it declines.
//   2. NOT ALREADY  we never reply twice to the same author, thread, or near-identical text.
//   3. HONEST       the reply must survive `verifyClaims()` -- MELEK is a TESTNET and PRANA is a
//                   small new chain, and a reply that implies otherwise is refused, not softened.
//   4. HUMAN        `draft()` produces a draft. Nothing here posts. Approval is a separate act.
//
// House rules: ESM, no network in the classifier so it is testable offline, soft-fail-never-throw.

const str = (v) => String(v == null ? '' : v);
const norm = (v) => str(v).toLowerCase().replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// 1. IS THIS AN INVITATION?
// ---------------------------------------------------------------------------

// Phrases where somebody is explicitly asking to be told about a coin. These are deliberately
// narrow -- the cost of a false positive here is a spam flag, and we have three of those already.
export const SOLICITATIONS = Object.freeze([
  /\bshill\s+me\b/i,
  /\bshill\s+your\s+(bag|coin|token|project)\b/i,
  /\bshill\s+(me\s+)?(a|your|ur)\s+\w+/i,
  /\bwhat('?s| is)\s+the\s+next\s+(big|100x|1000x)\s+(coin|token|thing|gem)\b/i,
  /\bwhat\s+(coin|token|project)s?\s+(should|would)\s+i\s+(buy|look|check|get)\b/i,
  /\bany\s+(good|new|underrated|hidden)\s+(gems?|coins?|tokens?|projects?)\b/i,
  /\brecommend\s+(me\s+)?(a|some|any)\s+(coin|token|project|chain)\b/i,
  /\bwhat\s+are\s+you\s+(buying|holding|bullish\s+on)\b/i,
  /\bdrop\s+your\s+(bags?|coins?|tokens?|projects?)\b/i,
  /\btell\s+me\s+about\s+your\s+(project|token|chain)\b/i,
  /\bwho('?s| is)\s+building\s+(something|anything)\b/i,
]);

// Even inside a solicitation, these mean walk away.
export const DISQUALIFIERS = Object.freeze([
  { re: /\b(no\s+shill|don'?t\s+shill|stop\s+shilling|no\s+promo|not\s+a\s+shill\s+thread)\b/i,
    why: 'the author explicitly excluded promotion' },
  { re: /\b(scam|rug|rugpull|honeypot|fraud|stolen|hacked)\b/i,
    why: 'the thread is about fraud; arriving with a token reads badly' },
  { re: /\b(giveaway|airdrop\s+farm|follow\s+.{0,12}retweet|tag\s+\d+\s+friends)\b/i,
    why: 'engagement-farming thread, not a real question' },
  { re: /\b(financial\s+advice|not\s+financial|nfa)\b.*\b(please|need|give)\b/i,
    why: 'the author is asking for advice we must not give' },
  { re: /\b(loan|lend|borrow|send\s+me|donate|help\s+me\s+pay)\b/i,
    why: 'a request for money, not for a recommendation' },
]);

/**
 * Decide whether a post invites a reply. Returns { solicited, matched, reason }.
 * The reason is always populated so a declined item can be audited.
 */
export function classify(text) {
  const t = str(text);
  if (!t.trim()) return { solicited: false, matched: null, reason: 'empty text' };
  if (t.length > 4000) return { solicited: false, matched: null, reason: 'suspiciously long; likely an article, not a question' };

  for (const d of DISQUALIFIERS) {
    if (d.re.test(t)) return { solicited: false, matched: null, reason: d.why };
  }
  const hit = SOLICITATIONS.find((re) => re.test(t));
  if (!hit) {
    return { solicited: false, matched: null, reason: 'no explicit request for a recommendation — mentioning crypto is not an invitation' };
  }
  return { solicited: true, matched: String(hit), reason: 'the author asked to be told about a project' };
}

// ---------------------------------------------------------------------------
// 2. HAVE WE ALREADY SPOKEN?
//
// The 2026 flag came from replying repeatedly. Memory is not an optimisation here, it is the
// safety mechanism.
// ---------------------------------------------------------------------------

export function createHistory(initial = []) {
  const rows = Array.isArray(initial) ? initial.filter((r) => r && r.id) : [];
  const authors = new Set(rows.map((r) => norm(r.author)));
  const threads = new Set(rows.map((r) => str(r.thread)));
  const shapes = new Set(rows.map((r) => r.shape).filter(Boolean));

  const api = {
    get size() { return rows.length; },
    all: () => rows.slice(),
    /** A crude but effective near-duplicate key: the reply's first 12 significant words. */
    shapeOf: (body) => norm(body).replace(/[^a-z0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 12).join(' '),
    seenAuthor: (a) => authors.has(norm(a)),
    seenThread: (t) => threads.has(str(t)),
    seenShape: (body) => shapes.has(api.shapeOf(body)),
    record(entry) {
      const row = {
        id: str(entry.id), author: str(entry.author), thread: str(entry.thread),
        venue: str(entry.venue), at: str(entry.at) || new Date().toISOString(),
        shape: api.shapeOf(entry.body),
      };
      rows.push(row);
      authors.add(norm(row.author)); threads.add(row.thread); shapes.add(row.shape);
      return row;
    },
    toJSON: () => rows.slice(),
  };
  return api;
}

// ---------------------------------------------------------------------------
// 3. WHAT WE ARE ALLOWED TO SAY
//
// Every claim carries its own status. A reply that overstates is refused rather than trimmed,
// because the moment this thing oversells is the moment it becomes the problem it replaced.
// ---------------------------------------------------------------------------

export const FACTS = Object.freeze({
  prana: {
    claim: 'PRANA is a live EVM chain — chain id 712217 — with a DEX called KulaSwap on it.',
    status: 'verified', evidence: 'eth_chainId 0xade19; kula.money serves',
  },
  melek: {
    claim: 'MELEK is a Graphene/DPoS chain and it is on TESTNET, not mainnet.',
    status: 'verified', evidence: 'operator brief; testnet chain id 18dcf0…274e',
  },
  early: {
    claim: 'It is early and small — the pools are thin and it is alpha software.',
    status: 'verified', evidence: 'kula.money self-labels Alpha; measured book depth',
  },
});

// Anything matching these must never appear in a generated reply.
export const FORBIDDEN = Object.freeze([
  { re: /\b(guaranteed|risk[- ]free|can'?t\s+lose|sure\s+thing)\b/i, why: 'a guarantee' },
  { re: /\b\d+\s*x\b|\b\d+\s*%\s*(gain|return|apy|profit)/i, why: 'a return figure' },
  { re: /\b(to\s+the\s+moon|moonshot|pump|100x|1000x)\b/i, why: 'price hype' },
  { re: /\b(buy\s+now|get\s+in\s+(early|now)|last\s+chance|don'?t\s+miss)\b/i, why: 'urgency pressure' },
  { re: /\bmainnet\b(?![^.]*\bPRANA\b)/i, why: 'implies MELEK mainnet, which does not exist' },
  { re: /\b(financial\s+advice|you\s+should\s+buy|invest\s+in)\b/i, why: 'investment advice' },
]);

/** Refuse a reply that overstates. Returns { ok, problems }. */
export function verifyClaims(body) {
  const problems = [];
  for (const f of FORBIDDEN) {
    if (f.re.test(str(body))) problems.push(f.why);
  }
  if (/\bMELEK\b/i.test(body) && !/testnet/i.test(body)) {
    problems.push('mentions MELEK without saying it is a testnet');
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// 4. THE DRAFT
// ---------------------------------------------------------------------------

const TEMPLATES = [
  ({ link }) => `Since you asked — I work on PRANA, a small EVM chain (id 712217) with a DEX called `
    + `KulaSwap on it. MELEK is the sister Graphene chain and it is still on testnet. It is early and `
    + `the pools are thin, so I would look before touching anything: ${link}`,
  ({ link }) => `You asked, so: PRANA. It is our own EVM chain, live at id 712217, running an AMM `
    + `called KulaSwap. The related chain, MELEK, is testnet only for now. Genuinely small and `
    + `genuinely alpha — judge it yourself rather than take my word: ${link}`,
  ({ link }) => `Ours is PRANA — an EVM chain we built, chain id 712217, with KulaSwap as the DEX. `
    + `MELEK, the Graphene side, is on testnet. Liquidity is thin and it is alpha software; I would `
    + `rather say that up front than have you find out. ${link}`,
];

/**
 * Build a reply for one solicitation. Returns a draft or a refusal WITH ITS REASON -- the reason
 * matters, because a silent skip teaches nobody anything.
 */
export function draft({ post = {}, history = null, link = 'https://kula.money', variant = 0 } = {}) {
  const c = classify(post.body);
  if (!c.solicited) {
    return { ok: false, action: 'skip', reason: c.reason, post: post.id };
  }
  if (history) {
    if (history.seenAuthor(post.author)) {
      return { ok: false, action: 'skip', reason: `already replied to @${post.author} once — never twice`, post: post.id };
    }
    if (history.seenThread(post.thread || post.id)) {
      return { ok: false, action: 'skip', reason: 'already replied in this thread', post: post.id };
    }
  }
  const body = TEMPLATES[Math.abs(Number(variant) || 0) % TEMPLATES.length]({ link });
  if (history && history.seenShape(body)) {
    return { ok: false, action: 'skip', reason: 'this exact wording has been used before — vary it or stay quiet', post: post.id };
  }
  const v = verifyClaims(body);
  if (!v.ok) {
    return { ok: false, action: 'refuse', reason: `the reply overstates: ${v.problems.join('; ')}`, post: post.id };
  }
  return {
    ok: true, action: 'draft',
    post: post.id, author: post.author, venue: post.venue, thread: post.thread || post.id,
    body,
    matched: c.matched,
    needsApproval: true,
    note: 'DRAFT ONLY. This module never posts. A human approves each one.',
  };
}

/** Process a batch, honouring a hard per-run cap. Volume is what got us flagged. */
export function plan(posts = [], { history = createHistory(), maxPerRun = 3, link, startVariant = 0 } = {}) {
  const drafts = []; const skipped = [];
  let v = Number(startVariant) || 0;
  for (const p of posts) {
    if (drafts.length >= maxPerRun) {
      skipped.push({ post: p.id, reason: `per-run cap of ${maxPerRun} reached — the rest wait` });
      continue;
    }
    const d = draft({ post: p, history, link, variant: v });
    if (d.ok) { drafts.push(d); v += 1; } else skipped.push(d);
  }
  return {
    drafts, skipped,
    considered: posts.length,
    replyRate: posts.length ? drafts.length / posts.length : 0,
    note: 'Nothing is sent. Approve individually, then record each send in the history.',
  };
}

export function handler(req, res) {
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj, null, 2));
  };
  return send(200, {
    ok: true, service: 'solicitation-responder',
    policy: 'Replies ONLY to posts that explicitly ask for a recommendation. Never twice to the '
          + 'same author or thread. Never posts — drafts for human approval.',
    facts: FACTS,
    forbidden: FORBIDDEN.map((f) => f.why),
  });
}
