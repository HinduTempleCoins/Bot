// freakazoid.mjs — a THIN on-chain connector skeleton in the Freakazoid pattern (API doc 11), for
// Hathor as the "smarter Freakazoid". The old Freakazoid was a dumb pipe: a long-running process that
// watched a Hive/Steem stream and reacted to mentions/replies. This is that pipe, made swappable and
// key-safe, for the MELEK chain (`hathor` account).
//
// WHAT THIS IS — a DUMB PIPE, three parts and nothing more:
//   (a) SOURCE   — an injectable async iterator (or poll function) yielding chain events
//                  (mentions/replies). We do NOT hardcode a real RPC; the caller supplies the stream.
//   (b) BRAIN    — a SWAPPABLE function brain(ctx) -> reply text. Default is a simple echo/rules stub.
//                  In production the brain is the NEUROSYMBOLIC ROUTER (rules -> tiny LLM -> cloud LLM);
//                  the connector neither knows nor cares which tier answered.
//   (c) SIGN     — the connector emits a reply *intent*; signing/broadcast is a CAPABILITY the caller
//                  grants. Default sign is a DRY-RUN that returns { simulated: true } and touches
//                  nothing. Read-only by default.
//
// CRITICAL — KEY CUSTODY (CLAUDE.md "Zero WIF" + BRIEF.md §7):
//   This file holds NO private key, ever. It takes a `sign` callback (the grant) supplied by the
//   caller. In production that grant is a POSTING-KEY-ONLY, scoped capability handed in by the
//   vault/runner (e.g. via MELEK-Signer with a scoped bearer token) — never a WIF in this process.
//   The connector NEVER signs value: reply intents are `comment` ops only. A grant that could move
//   funds must not be given to this connector.
//
//   import { createConnector, runOnce, defaultBrain, defaultSign } from './freakazoid.mjs';
//   const conn = createConnector({ source, brain: myBrain, sign: myGrant });
//   const intent = await runOnce(conn, event);   // event -> brain -> reply intent (-> sign)
//   for await (const intent of conn.run()) { ... } // long-running pipe over the source stream
//
//   node integrations/freakazoid.mjs   // dry-run demo over a tiny fixture stream, no network, no key

// ── (b) default BRAIN — a simple echo/rules stub ─────────────────────────────────────────────────
// The real brain is the neurosymbolic router (rules -> tiny -> cloud); this stub stands in for it so
// the pipe is testable offline and never depends on a model. It is intentionally dumb: a couple of
// deterministic rules, then an echo acknowledgement. Swap it out via createConnector({ brain }).
export function defaultBrain(ctx = {}) {
  const body = String(ctx.body || ctx.text || '').trim();
  const author = ctx.author ? `@${ctx.author}` : 'friend';
  if (!body) return `Peace, ${author}. I am here when you have something to say.`;
  const low = body.toLowerCase();
  if (/\b(help|commands|how do i|tutorial)\b/.test(low)) {
    return `Peace, ${author}. Try \`!commands\` for what I can do, or \`!signup\` to begin.`;
  }
  if (/\b(hi|hello|hey|greetings|peace)\b/.test(low)) {
    return `Greetings, ${author}. The Witness is listening.`;
  }
  // echo acknowledgement — the floor behaviour of the dumb pipe
  const echo = body.length > 140 ? `${body.slice(0, 137)}...` : body;
  return `Heard you, ${author}: "${echo}"`;
}

// ── (c) default SIGN — a DRY-RUN grant that signs nothing ────────────────────────────────────────
// Returns a simulated result. Holds no key, performs no network, broadcasts nothing. The real grant
// is a posting-key-only scoped capability injected by the caller (vault/runner).
export async function defaultSign(intent = {}) {
  return { simulated: true, broadcast: false, op: intent.op || 'comment', to: intent.parentAuthor || null };
}

// ── (a) default SOURCE — an empty async iterator ─────────────────────────────────────────────────
// No real RPC here by design. A caller injects an async iterable of chain events, or a poll function.
// The default yields nothing, so a connector with no source is inert (read-only floor).
export async function* defaultSource() {
  // intentionally empty — caller supplies the real stream
}

// Normalize whatever the caller passes as `source` into an async iterable of events.
// Accepts: an async iterable, a sync iterable, or a poll function () -> event|event[]|null.
function asEventStream(source) {
  if (!source) return defaultSource();
  if (typeof source[Symbol.asyncIterator] === 'function') return source;
  if (typeof source[Symbol.iterator] === 'function') return source;
  if (typeof source === 'function') {
    return (async function* () {
      // poll until the poll fn signals exhaustion by returning undefined (null = "nothing now", skip)
      for (;;) {
        const got = await source();
        if (got === undefined) return;
        if (got === null) continue;
        if (Array.isArray(got)) { yield* got; } else { yield got; }
      }
    })();
  }
  return defaultSource();
}

// Turn a raw chain event into the brain context. Tolerant of partial events.
export function toContext(event = {}) {
  return {
    id: event.id ?? event.permlink ?? null,
    type: event.type || 'mention',           // 'mention' | 'reply' | ...
    author: event.author || event.from || null,
    body: event.body ?? event.text ?? event.memo ?? '',
    parentAuthor: event.parentAuthor ?? event.author ?? null,
    parentPermlink: event.parentPermlink ?? event.permlink ?? null,
    raw: event,
  };
}

// Build the reply intent (a `comment` op, never value). This is the only thing the connector emits.
export function toReplyIntent(ctx, replyText) {
  return {
    op: 'comment',
    parentAuthor: ctx.parentAuthor || null,
    parentPermlink: ctx.parentPermlink || null,
    author: 'hathor',
    body: String(replyText ?? ''),
    inReplyTo: ctx.id || null,
  };
}

// ── the connector ────────────────────────────────────────────────────────────────────────────────
export function createConnector({ source, brain, sign } = {}) {
  const _brain = typeof brain === 'function' ? brain : defaultBrain;
  const _sign = typeof sign === 'function' ? sign : defaultSign;
  const _stream = () => asEventStream(source);

  return {
    brain: _brain,
    sign: _sign,
    source,
    // process a single event through the pipe; returns { ctx, reply, intent, signed }
    async handle(event) {
      return runOnce(this, event);
    },
    // long-running pipe: iterate the source stream, yielding a reply intent per event.
    async *run() {
      for await (const event of _stream()) {
        yield await runOnce(this, event);
      }
    },
  };
}

// runOnce — route one event: event -> brain -> reply intent -> (optional) sign grant.
// No network, no key. `sign` is whatever capability the connector was created with (dry-run default).
export async function runOnce(connector, event) {
  const ctx = toContext(event);
  const reply = await connector.brain(ctx);
  const intent = toReplyIntent(ctx, reply);
  const signed = await connector.sign(intent);
  return { ctx, reply, intent, signed };
}

// ── CLI: dry-run demo over a tiny fixture stream (no network, no key) ─────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('freakazoid.mjs')) {
  const fixture = [
    { type: 'mention', author: 'alice', body: 'hey @hathor, how do I signup?', permlink: 'p1' },
    { type: 'reply', author: 'bob', body: 'Greetings, Witness!', parentAuthor: 'hathor', parentPermlink: 'intro' },
    { type: 'mention', author: 'carol', body: 'What is the Convergence?', permlink: 'p2' },
  ];
  const conn = createConnector({ source: fixture }); // default brain + default DRY-RUN sign
  console.log('freakazoid connector — DRY-RUN demo (no network, no key)\n');
  for await (const out of conn.run()) {
    console.log(`event  ← @${out.ctx.author} (${out.ctx.type}): ${out.ctx.body}`);
    console.log(`reply  → ${out.reply}`);
    console.log(`intent : op=${out.intent.op} to=${out.intent.parentAuthor ?? '(new)'} signed=${JSON.stringify(out.signed)}\n`);
  }
}
