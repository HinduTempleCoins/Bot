// src/trollbox/chain-connector.mjs — how the bot CONNECTS to the condenser troll-box (Task #37).
//
// FINDING (recon, 2026-06-04): the MELEK/BLURT condenser ships NO native troll-box — only an
// unused `chatbox.svg` icon. So the troll-box is a feature we ADD, and on a Graphene chain the
// clean, key-custody-safe transport is the chain itself: every chat line is a `custom_json` op
// with a shared id. Condenser and bot both agree on that id; no extra server, no websocket infra.
//
//   transport  : custom_json  { id: 'melek_trollbox', json: { v, user, text, ts } }
//   condenser  : posts a line as the logged-in user (their posting key, in their browser)  AND
//                renders the stream by polling account/op history for that id.  (UI spec below.)
//   bot (here) : READS inbound lines (poll), routes each through handleMessage(), and POSTS its
//                reply as another custom_json line — broadcast via MELEK-Signer (NEVER a local WIF;
//                BRIEF.md §7 / zero-WIF-on-host). Everything is injectable so tests run offline.
//
// This module is the connector only; the deterministic answers live in ./index.mjs (handleMessage).
//
// Exports:
//   CHAT_ID                                  the agreed custom_json id
//   encodeLine({user,text,ts})               -> custom_json `json` payload (validated, capped)
//   decodeOp(op)                             -> { user, text, ts } | null   (parse one custom_json op)
//   pollInbound(client, { since, max })      -> [{ id, user, text, ts }]    (new lines since cursor)
//   replyOp({ user, text })                  -> a custom_json op array ready to broadcast
//   runOnce({ client, broadcaster, since, seen, now }) -> { answered, cursor, seen }
//   __  : pure helpers are exported for tests; no module-level state, no keys.

import { handleMessage, sanitize, redactForLog } from './index.mjs';

export const CHAT_ID = 'melek_trollbox';
export const PROTO_V = 1;
const MAX_TEXT = 500;          // matches index.mjs MAX_LEN
const BOT_TAG = 'hathor';      // the witness account name lines from the bot carry as `user`

// ---- wire format -----------------------------------------------------------

/** Build the custom_json `json` payload for one chat line. Pure; caps + trims text. */
export function encodeLine({ user, text, ts } = {}) {
  return {
    v: PROTO_V,
    user: String(user || 'anon').slice(0, 32),
    text: sanitize(String(text || '')).slice(0, MAX_TEXT),
    ts: Number.isFinite(ts) ? ts : 0,
  };
}

/**
 * Parse one chain op into a chat line, or null if it isn't a well-formed troll-box line.
 * Accepts the Graphene op shapes: ['custom_json', {id, json}] or { op:[...] } history rows,
 * with `json` either a string or already-parsed object. Soft-fail — never throws.
 */
export function decodeOp(op) {
  try {
    const inner = Array.isArray(op?.op) ? op.op : op;            // history row vs raw op
    if (!Array.isArray(inner) || inner[0] !== 'custom_json') return null;
    const body = inner[1] || {};
    if (body.id !== CHAT_ID) return null;
    const j = typeof body.json === 'string' ? JSON.parse(body.json) : body.json;
    if (!j || typeof j !== 'object') return null;
    const text = sanitize(String(j.text || ''));
    if (!text) return null;
    return { user: String(j.user || 'anon').slice(0, 32), text: text.slice(0, MAX_TEXT), ts: Number(j.ts) || 0 };
  } catch { return null; }
}

// ---- read inbound ----------------------------------------------------------

/**
 * Pull recent troll-box lines from the chain. `client` is injectable — anything exposing
 * `customJsonHistory(id, { since, max })` (our GrapheneAdapter / condenser_api wrapper) works.
 * Returns oldest→newest, decoded + filtered, never the bot's own lines. Soft-fail to [].
 * @returns {Promise<Array<{id,user,text,ts}>>}
 */
export async function pollInbound(client, { since = 0, max = 50 } = {}) {
  if (!client || typeof client.customJsonHistory !== 'function') return [];
  let rows = [];
  try { rows = await client.customJsonHistory(CHAT_ID, { since, max }); } catch { return []; }
  const out = [];
  for (const row of rows || []) {
    const seq = row?.seq ?? row?.id ?? row?.[0] ?? null;          // op-history sequence cursor
    const line = decodeOp(row?.op ? row : (row?.value ? { op: ['custom_json', row.value] } : row));
    if (!line) continue;
    if (line.user === BOT_TAG) continue;                          // don't answer ourselves
    out.push({ id: seq, ...line });
  }
  return out;
}

// ---- write reply (via signer, never a local key) ---------------------------

/** Build the custom_json op the bot broadcasts as its reply. The broadcaster (MELEK-Signer) signs. */
export function replyOp({ user, text }) {
  return ['custom_json', {
    required_auths: [],
    required_posting_auths: [BOT_TAG],
    id: CHAT_ID,
    json: JSON.stringify(encodeLine({ user: BOT_TAG, text, ts: 0 })),
  }];
}

/**
 * One poll→route→reply cycle.
 *  - client       : reader (customJsonHistory)
 *  - broadcaster  : async ({ op, redactedLog }) => result  — the MELEK-Signer client. INJECTED.
 *                   The bot holds no key; the signer applies its policy + signs. dry-run when absent.
 *  - since        : op-history cursor to read from
 *  - seen         : Set of already-answered line ids (idempotency across runs)
 * Returns { answered:[{to,reply}], cursor, seen, dryRun }. Soft-fail; never throws.
 */
export async function runOnce({ client, broadcaster, since = 0, seen = new Set(), now = () => 0 } = {}) {
  const lines = await pollInbound(client, { since });
  const answered = [];
  let cursor = since;
  for (const line of lines) {
    if (line.id != null && Number(line.id) > Number(cursor)) cursor = line.id;
    const key = line.id != null ? `id:${line.id}` : `txt:${line.user}:${line.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let res;
    try { res = await handleMessage({ user: line.user, text: line.text }, { now }); }
    catch { continue; }
    if (!res || !res.reply) continue;
    const op = replyOp({ user: line.user, text: res.reply });
    const entry = { to: line.user, reply: res.reply, kind: res.kind, log: redactForLog(line) };
    if (typeof broadcaster === 'function') {
      try { entry.broadcast = await broadcaster({ op, redactedLog: entry.log }); }
      catch (e) { entry.broadcast = { ok: false, error: e?.message || String(e) }; }
    } else {
      entry.broadcast = { ok: true, dryRun: true };               // no signer wired → dry-run
    }
    answered.push(entry);
  }
  return { answered, cursor, seen, dryRun: typeof broadcaster !== 'function' };
}

// ---- CLI (guarded) — offline demo with a fake client -----------------------
if (process.argv[1] && process.argv[1].endsWith('chain-connector.mjs')) {
  (async () => {
    const fakeClient = {
      async customJsonHistory() {
        return [
          { seq: 11, op: ['custom_json', { id: CHAT_ID, json: JSON.stringify({ v: 1, user: 'newbie', text: 'how do i sign up?', ts: 1 }) }] },
          { seq: 12, op: ['custom_json', { id: CHAT_ID, json: JSON.stringify({ v: 1, user: BOT_TAG, text: 'ignored — our own line', ts: 2 }) }] },
        ];
      },
    };
    const r = await runOnce({ client: fakeClient });               // no broadcaster → dry-run
    console.log(JSON.stringify({ transport: CHAT_ID, dryRun: r.dryRun, cursor: r.cursor, answered: r.answered.map((a) => ({ to: a.to, reply: a.reply.slice(0, 60) })) }, null, 2));
  })();
}
