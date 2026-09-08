// hathor-bridge — Hathor as a participant on Congress, not a feature bolted onto it.
//
// Congress is a short-form social surface reading a Graphene chain. Hathor is already a witness on
// that chain and already has one self across Discord, MELEK, the game, trading and PRANA
// (integrations/hathor-agency.mjs). This makes `congress` a sixth surface with its own memory
// compartment — a reply under a 280-character post should not be framed by a trading conversation,
// but she should still recall a PERSON across surfaces.
//
// WHAT THIS DOES NOT DO, DELIBERATELY:
//
//   It does not post on a timer. An account that posts every hour into an empty room is a bot
//   pretending to be a community, and the resulting timeline is worth less than an empty one because
//   it is actively misleading. `shouldSpeak()` requires a reason.
//
//   It does not sign or broadcast. Congress's server holds no key by design and composes through
//   MELEK-Signer; this keeps that property. `draft()` returns text for whatever already holds the
//   posting authority.
//
//   It does not answer everything. On a public timeline, a reply to every post is the behaviour that
//   gets an account muted. Direct address and genuine questions only.
//
// House rules: ESM, injectable everything, soft-fail-never-throw, no keys.

const str = (v) => String(v == null ? '' : v);
const norm = (v) => str(v).toLowerCase().replace(/\s+/g, ' ').trim();

export const SURFACE = 'congress';

// Congress posts are short. The persona's default "one or two sentences" is already right, but the
// hard cap exists because a chain post that overruns gets truncated by front-ends, not rejected --
// so an over-long reply fails silently and looks like a bug in the writing.
export const MAX_REPLY_CHARS = 480;

// ---------------------------------------------------------------------------
// 1. IS THERE A REASON TO SPEAK?
// ---------------------------------------------------------------------------

/** Direct address: an @mention of her, or a reply to something she wrote. */
export function isAddressed(post = {}, account = 'hathor') {
  const a = norm(account);
  if (!a) return false;
  if (norm(post.parent_author) === a) return true;
  return new RegExp(`(^|[^a-z0-9_.-])@${a}([^a-z0-9_.-]|$)`, 'i').test(str(post.body));
}

/** A genuine question, not a rhetorical one. */
export function isQuestion(text) {
  const t = str(text).trim();
  if (!t.includes('?')) return false;
  // "right?" / "no?" / "yeah?" are not requests for an answer
  if (/\b(right|no|yeah|yes|ok|okay|huh)\s*\?\s*$/i.test(t) && t.length < 60) return false;
  return true;
}

/**
 * Decide whether Hathor has a reason to reply. Returns { speak, why }.
 * A `why` is always present, so a decision not to speak can be audited rather than guessed at.
 */
export function shouldSpeak(post = {}, { account = 'hathor', history = null, now = Date.now(), cooldownMs = 300000 } = {}) {
  const author = norm(post.author);
  if (!author) return { speak: false, why: 'no author' };
  if (author === norm(account)) return { speak: false, why: 'her own post' };
  if (history && history.repliedTo(post.author, post.permlink)) {
    return { speak: false, why: `already replied to @${post.author}/${post.permlink}` };
  }
  if (history && history.lastSpokeWithin(now, cooldownMs)) {
    return { speak: false, why: 'inside the cooldown — she does not answer three posts in a minute' };
  }
  if (isAddressed(post, account)) return { speak: true, why: 'addressed directly' };
  if (isQuestion(post.body)) return { speak: true, why: 'a genuine question was asked' };
  return { speak: false, why: 'not addressed and no question — silence is the default on a public timeline' };
}

// ---------------------------------------------------------------------------
// 2. MEMORY OF WHAT SHE ALREADY SAID HERE
// ---------------------------------------------------------------------------

export function createHistory(initial = []) {
  const rows = Array.isArray(initial) ? initial.filter((r) => r && r.author) : [];
  const key = (a, p) => `${norm(a)}/${str(p)}`;
  const seen = new Set(rows.map((r) => key(r.author, r.permlink)));
  let last = 0;
  for (const r of rows) last = Math.max(last, Number(r.at) || 0);
  return {
    get size() { return rows.length; },
    repliedTo: (a, p) => seen.has(key(a, p)),
    lastSpokeWithin: (now, ms) => last > 0 && (Number(now) - last) < Number(ms),
    record(entry) {
      const row = {
        author: str(entry.author), permlink: str(entry.permlink),
        at: Number(entry.at) || Date.now(), reply: str(entry.reply).slice(0, 200),
      };
      rows.push(row); seen.add(key(row.author, row.permlink)); last = Math.max(last, row.at);
      return row;
    },
    toJSON: () => rows.slice(),
  };
}

// ---------------------------------------------------------------------------
// 3. THE DRAFT
// ---------------------------------------------------------------------------

/**
 * Ask Hathor for a reply to one post. `hathor` is a createHathor() instance; nothing is broadcast.
 *
 * @returns {Promise<{ok, reply?, why, post, author}>}
 */
export async function draft(post = {}, { hathor, account = 'hathor', history = null, now = Date.now() } = {}) {
  const decision = shouldSpeak(post, { account, history, now });
  if (!decision.speak) {
    return { ok: false, why: decision.why, post: post.permlink, author: post.author };
  }
  if (!hathor || typeof hathor.perceive !== 'function') {
    return { ok: false, why: 'no Hathor instance supplied — this module does not create one', post: post.permlink };
  }

  let out;
  try {
    out = await hathor.perceive(SURFACE, {
      text: str(post.body).slice(0, 2000),
      person: str(post.author),
    }, { now });
  } catch (e) {
    return { ok: false, why: `perceive failed: ${str(e && e.message).slice(0, 80)}`, post: post.permlink };
  }

  const reply = str(out && out.reply).trim();
  if (!reply) return { ok: false, why: 'she had nothing to say', post: post.permlink };

  return {
    ok: true,
    why: decision.why,
    author: post.author,
    post: post.permlink,
    parent: { author: post.author, permlink: post.permlink },
    reply: truncate(reply, MAX_REPLY_CHARS),
    truncated: reply.length > MAX_REPLY_CHARS,
    recalled: (out.recalled || []).length,
    drewFrom: out.drewFrom || [],
    needsSigner: true,
    note: 'Draft only. Congress holds no key; broadcasting is the signer\'s job.',
  };
}

/** Cut on a sentence boundary where possible — a reply severed mid-word reads as broken. */
export function truncate(text, max = MAX_REPLY_CHARS) {
  const t = str(text).trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '')).trim();
}

/** Walk a timeline and draft for the few posts that warrant one. */
export async function sweep(posts = [], { hathor, account = 'hathor', history = createHistory(), maxPerRun = 3, now = Date.now() } = {}) {
  const drafts = []; const skipped = [];
  for (const p of posts) {
    if (drafts.length >= maxPerRun) {
      skipped.push({ post: p.permlink, why: `per-run cap of ${maxPerRun}` });
      continue;
    }
    const d = await draft(p, { hathor, account, history, now });
    if (d.ok) drafts.push(d); else skipped.push(d);
  }
  return {
    drafts, skipped, considered: posts.length,
    note: 'Nothing broadcast. Approve, sign, then record each in the history.',
  };
}

export function handler(req, res) {
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj, null, 2));
  };
  return send(200, {
    ok: true, service: 'congress-hathor-bridge', surface: SURFACE,
    maxReplyChars: MAX_REPLY_CHARS,
    policy: 'Replies only when addressed directly or asked a real question. Never on a timer, never '
          + 'twice to the same post, cooldown between replies. Drafts only — holds no key.',
  });
}
