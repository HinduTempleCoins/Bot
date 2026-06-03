// comms-matrix.mjs — MELEK Comms over Matrix (queue #196).
//
// ONE primitive, THREE hats. Everything the community does in chat is a Matrix *room* with a scope;
// the three product surfaces are just three configurations of that one primitive:
//
//   • DM         — a 1:1 room (private, two-member, no token gate)          → dm(userA, userB)
//   • CLAN       — a Matrix Space (a room that groups rooms), optionally    → clan(name, {tokenGate})
//                  token-gated so only holders may join
//   • PARTY-VOICE — a voice room hung off a live game session, using the    → partyVoice(sessionId)
//                  Element Call / LiveKit SFU as the voice backend
//
// THE FRAME (why Matrix, not just Discord/Telegram):
//   account    = a SoapBox/MELEK key is the SSO identity — you sign in to comms with your chain key,
//                not a siloed username/password per platform.
//   memo       = the on-chain transfer memo is the command rail — chain-native commands ride the memo
//                field; chat is the conversational rail, the memo is the imperative one.
//   federated  = Matrix federation IS covenant-federalism — each homeserver is a sovereign polity that
//                federates with the others by covenant, not a single corporate tenant.
//   Discord/TG = a FUNNEL (rented, surveilled, good for reach); Matrix = the SOVEREIGN home (self-hosted,
//                key-owned, federated). We meet people on the funnel and bring them home.
//
// This module is PURE room/scope modeling. It never contacts a homeserver. The one action that touches
// the network — sendMessage — takes an INJECTED client and soft-fails, so it is testable offline and
// holds no transport of its own.
//
//   import { dm, clan, partyVoice, sendMessage, tokenGateCheck, HATHOR_BOT } from './comms-matrix.mjs';
//   const room = dm('@alice:melek', '@bob:melek');
//   await sendMessage({ room: room.alias, text: 'hi' }, { client: myMatrixClient });

// ── homeserver / naming constants (no live host; these only shape aliases) ───────────────────────────
export const HOMESERVER = 'melek.community';                 // the sovereign MELEK homeserver domain
export const VOICE_BACKEND = 'element-call';                 // Element Call over a LiveKit SFU
const ROOM_VERSION = '11';                                   // Matrix room version we target

// canonicalize a piece of an alias/id: lowercase, collapse non-alphanumerics to a single dash.
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// a stable, order-independent key for a pair of users (so dm(a,b) === dm(b,a)).
function pairKey(a, b) {
  return [String(a || ''), String(b || '')].sort().map(slug).join('__');
}

// ── the Hathor bot participant descriptor — ALWAYS labeled as an AI ──────────────────────────────────
// Per BRIEF.md: the chain does not special-case Hathor, but in human-facing comms the Witness is
// disclosed as a bot/AI. This descriptor is what gets added to a room's member list for the Witness.
export const HATHOR_BOT = Object.freeze({
  userId: `@hathor:${HOMESERVER}`,
  handle: 'hathor',
  displayName: 'Hathor (AI Witness)',
  kind: 'bot',          // machine-readable role
  isBot: true,          // explicit flag for UI badges
  ai: true,             // labeled AI — never presented as human
  label: 'AI',          // the badge text shown beside the name
  role: 'witness',
});

/** Return the Hathor bot participant descriptor (frozen copy semantics via the constant). */
export function hathorBot() {
  return HATHOR_BOT;
}

// ── DM: a 1:1 room ───────────────────────────────────────────────────────────────────────────────────
/** A direct-message room spec for two users. Private, invite-only, two members, no token gate.
 *  Symmetric: dm(a, b) and dm(b, a) produce the same canonical alias. */
export function dm(userA, userB, { withHathor = false } = {}) {
  if (!userA || !userB) throw new Error('dm requires two user ids');
  const members = [userA, userB];
  if (withHathor) members.push(HATHOR_BOT.userId);
  return {
    hat: 'dm',
    type: 'room',
    scope: 'direct',
    roomVersion: ROOM_VERSION,
    alias: `#dm-${pairKey(userA, userB)}:${HOMESERVER}`,
    isDirect: true,
    preset: 'private_chat',          // Matrix createRoom preset: invite-only, encrypted-capable
    visibility: 'private',
    members,
    participants: members.map((id) => participant(id)),
    tokenGate: null,                 // DMs are never token-gated
  };
}

// ── CLAN: a Matrix Space, optionally token-gated ─────────────────────────────────────────────────────
/** A clan = a Matrix Space (a room of type m.space that groups child rooms). May be token-gated so
 *  only holders of a given token/amount may join. */
export function clan(name, { tokenGate = null, founder = null } = {}) {
  if (!name) throw new Error('clan requires a name');
  const s = slug(name);
  const members = [];
  if (founder) members.push(founder);
  members.push(HATHOR_BOT.userId);   // the Witness is present in every clan, labeled AI
  return {
    hat: 'clan',
    type: 'space',                   // Matrix Space
    roomType: 'm.space',             // creation_content.type
    scope: 'clan',
    roomVersion: ROOM_VERSION,
    name,
    alias: `#clan-${s}:${HOMESERVER}`,
    visibility: tokenGate ? 'private' : 'public',
    preset: tokenGate ? 'private_chat' : 'public_chat',
    joinRule: tokenGate ? 'restricted' : 'public',   // restricted join needs the gate check to pass
    tokenGate: tokenGate
      ? { token: tokenGate.token, minHold: Number(tokenGate.minHold ?? tokenGate.amount ?? 1) }
      : null,
    children: [],                    // child rooms (text channels, the party-voice room, etc.)
    members,
    participants: members.map((id) => participant(id)),
  };
}

// ── PARTY-VOICE: a voice room on a live game session ─────────────────────────────────────────────────
/** A party-voice room hung off a game session id, backed by the Element Call / LiveKit SFU. It is a
 *  normal room carrying an m.call widget; the SFU does the audio, Matrix does the room + membership. */
export function partyVoice(sessionId, { clanAlias = null } = {}) {
  if (!sessionId) throw new Error('partyVoice requires a sessionId');
  const s = slug(sessionId);
  return {
    hat: 'party-voice',
    type: 'room',
    scope: 'voice',
    roomVersion: ROOM_VERSION,
    sessionId: String(sessionId),
    alias: `#party-${s}:${HOMESERVER}`,
    visibility: 'private',
    preset: 'private_chat',
    voice: true,
    voiceBackend: VOICE_BACKEND,                 // element-call
    sfu: 'livekit',                              // the underlying SFU
    callWidget: {
      type: 'm.call',
      url: `https://call.${HOMESERVER}/${s}`,    // Element Call ref for this session
      backend: VOICE_BACKEND,
    },
    parentSpace: clanAlias || null,              // optionally nested under a clan Space
    members: [],
    tokenGate: null,
  };
}

// ── token gate: may this user join this token-gated clan? ────────────────────────────────────────────
/** Gate a clan join by token-holding. `holds` is an injected map { token: amount } for the user (the
 *  caller resolves real holdings on-chain; this stays pure). Ungated clans always allow. */
export function tokenGateCheck(user, clanSpec, { holds = {} } = {}) {
  if (!clanSpec || !clanSpec.tokenGate) return { allowed: true, reason: 'no-gate' };
  const { token, minHold } = clanSpec.tokenGate;
  const have = Number(holds[token] ?? 0);
  if (!user) return { allowed: false, reason: 'no-user', token, minHold, have };
  if (have >= minHold) return { allowed: true, reason: 'holds-enough', token, minHold, have };
  return { allowed: false, reason: 'insufficient-holdings', token, minHold, have };
}

// ── a participant descriptor for an arbitrary member id ──────────────────────────────────────────────
function participant(userId) {
  if (userId === HATHOR_BOT.userId) return HATHOR_BOT;
  return { userId, kind: 'human', isBot: false, ai: false, role: 'member' };
}

// ── sendMessage: the ONE network action, via an INJECTED client, soft-failing ───────────────────────
/** Send a text message to a room using an injected Matrix client. Soft-fails (returns { ok:false })
 *  rather than throwing, so a missing/broken client never crashes a caller. The injected client is
 *  expected to expose sendTextMessage(room, text) or sendMessage(room, text) or send(room, text). */
export async function sendMessage({ room, text } = {}, { client } = {}) {
  if (!room) return { ok: false, error: 'no-room' };
  if (!text || !String(text).trim()) return { ok: false, error: 'empty-text' };
  if (!client) return { ok: false, error: 'no-client' };
  const fn = client.sendTextMessage || client.sendMessage || client.send;
  if (typeof fn !== 'function') return { ok: false, error: 'client-has-no-send' };
  try {
    const res = await fn.call(client, room, String(text));
    return { ok: true, room, eventId: res?.event_id || res?.eventId || res || null };
  } catch (e) {
    return { ok: false, error: e?.message || 'send-failed', room };
  }
}

// ── CLI: demonstrate the three hats (no network) ─────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('comms-matrix.mjs')) {
  const a = '@alice:melek.community';
  const b = '@bob:melek.community';
  console.log('MELEK Comms over Matrix — one primitive, three hats:\n' + '─'.repeat(64));
  console.log('\nDM (1:1 room):');
  console.log(JSON.stringify(dm(a, b), null, 2));
  console.log('\nCLAN (Matrix Space, token-gated):');
  const c = clan('Phoenix Guard', { tokenGate: { token: 'MELEK', minHold: 100 }, founder: a });
  console.log(JSON.stringify(c, null, 2));
  console.log('\n  gate check (alice holds 250 MELEK):', JSON.stringify(tokenGateCheck(a, c, { holds: { MELEK: 250 } })));
  console.log('  gate check (bob holds 10 MELEK):  ', JSON.stringify(tokenGateCheck(b, c, { holds: { MELEK: 10 } })));
  console.log('\nPARTY-VOICE (voice room on a game session):');
  console.log(JSON.stringify(partyVoice('raid-42', { clanAlias: c.alias }), null, 2));
  console.log('\nHathor bot participant (labeled AI):', JSON.stringify(HATHOR_BOT));
}
