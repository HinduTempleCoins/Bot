// bot-surfaces.mjs — the cross-surface bot connector registry (queue #138):
// ONE bot-runner, MANY surfaces. Pure + stubs, no network, no keys.
//
// The chain is settlement/identity: Hathor is a Graphene witness ACCOUNT, and the
// canonical record of who-said-what-and-what-resolved lives on-chain. Every other
// surface (Telegram, Discord, Matrix, Nostr, Farcaster) is just a doorway into the
// same one runner. Each surface adapter holds only a SCOPED grant fetched from the
// vault at runtime (a posting-key delegation for chain, a bot token for the others) —
// never a raw key, and never in this repo. Here we model the routing shape only:
// inbound events normalize to a common shape, outbound replies become DRY-RUN
// send-intents. Nothing is actually sent.
//
//   import { SURFACES, register, dispatch, route } from './bot-surfaces.mjs'
//   node integrations/bot-surfaces.mjs            # print the registry + a demo round-trip

// ---- common shapes ----------------------------------------------------------
//
// inbound (after dispatch/normalize):
//   { surface, user, text, replyTo }
// outbound (after route):  a send-INTENT, never an actual send
//   { surface, kind:'send-intent', dryRun:true, to, text, grant }
//
// An adapter implements the common interface:
//   { name, send(msg, ctx) -> send-intent, normalize(event) -> common-shape }

const str = (v) => (v == null ? '' : String(v));
const trim = (v) => str(v).trim();

// Each adapter declares the vault key (NOT the secret) for its scoped grant.
// `grantKind` documents what kind of scoped credential the runner would fetch —
// never the credential itself. Chain settles via a delegated posting key.
function grantRef(name, grantKind) {
  return { surface: name, grantKind, source: 'vault', ref: `vault://surfaces/${name}`, key: null };
}

// ---- adapters (stubs) -------------------------------------------------------

// MELEK / Graphene native. Inbound events are blockchain `comment` ops; outbound is
// a `comment` reply broadcast via a scoped posting-key grant (settlement/identity).
const melekAdapter = {
  name: 'melek',
  normalize(event = {}) {
    return {
      surface: 'melek',
      user: trim(event.author ?? event.user),
      text: trim(event.body ?? event.text),
      replyTo: event.permlink
        ? { author: trim(event.parent_author ?? event.author), permlink: trim(event.permlink) }
        : null,
    };
  },
  send(msg, ctx = {}) {
    return {
      surface: 'melek',
      kind: 'send-intent',
      dryRun: true,
      op: 'comment',
      to: ctx.replyTo ?? null,
      text: trim(msg),
      grant: grantRef('melek', 'posting-key-delegation'),
    };
  },
};

// Telegram. Inbound: a Bot API update; outbound: sendMessage to a chat_id.
const telegramAdapter = {
  name: 'telegram',
  normalize(event = {}) {
    const m = event.message ?? event;
    return {
      surface: 'telegram',
      user: trim(m.from?.username ?? m.from?.id ?? event.user),
      text: trim(m.text ?? event.text),
      replyTo: { chatId: m.chat?.id ?? event.chatId ?? null },
    };
  },
  send(msg, ctx = {}) {
    return {
      surface: 'telegram',
      kind: 'send-intent',
      dryRun: true,
      method: 'sendMessage',
      to: ctx.replyTo?.chatId ?? ctx.chatId ?? null,
      text: trim(msg),
      grant: grantRef('telegram', 'bot-token'),
    };
  },
};

// Discord. Inbound: a gateway MESSAGE_CREATE; outbound: a channel message.
const discordAdapter = {
  name: 'discord',
  normalize(event = {}) {
    return {
      surface: 'discord',
      user: trim(event.author?.username ?? event.author?.id ?? event.user),
      text: trim(event.content ?? event.text),
      replyTo: { channelId: event.channel_id ?? event.channelId ?? null },
    };
  },
  send(msg, ctx = {}) {
    return {
      surface: 'discord',
      kind: 'send-intent',
      dryRun: true,
      method: 'createMessage',
      to: ctx.replyTo?.channelId ?? ctx.channelId ?? null,
      text: trim(msg),
      grant: grantRef('discord', 'bot-token'),
    };
  },
};

// Matrix. Inbound: a sync timeline event; outbound: a room message.
const matrixAdapter = {
  name: 'matrix',
  normalize(event = {}) {
    return {
      surface: 'matrix',
      user: trim(event.sender ?? event.user),
      text: trim(event.content?.body ?? event.text),
      replyTo: { roomId: event.room_id ?? event.roomId ?? null },
    };
  },
  send(msg, ctx = {}) {
    return {
      surface: 'matrix',
      kind: 'send-intent',
      dryRun: true,
      method: 'sendRoomMessage',
      to: ctx.replyTo?.roomId ?? ctx.roomId ?? null,
      text: trim(msg),
      grant: grantRef('matrix', 'access-token'),
    };
  },
};

// Nostr. Inbound: a signed event (kind 1 note); outbound: a reply event to a pubkey.
const nostrAdapter = {
  name: 'nostr',
  normalize(event = {}) {
    return {
      surface: 'nostr',
      user: trim(event.pubkey ?? event.user),
      text: trim(event.content ?? event.text),
      replyTo: event.id ? { eventId: trim(event.id), pubkey: trim(event.pubkey) } : null,
    };
  },
  send(msg, ctx = {}) {
    return {
      surface: 'nostr',
      kind: 'send-intent',
      dryRun: true,
      method: 'publishEvent',
      to: ctx.replyTo ?? null,
      text: trim(msg),
      grant: grantRef('nostr', 'signer-token'),
    };
  },
};

// Farcaster. Inbound: a cast webhook; outbound: a reply cast in a channel/thread.
const farcasterAdapter = {
  name: 'farcaster',
  normalize(event = {}) {
    const c = event.data ?? event.cast ?? event;
    return {
      surface: 'farcaster',
      user: trim(c.author?.username ?? c.author?.fid ?? event.user),
      text: trim(c.text ?? event.text),
      replyTo: c.hash ? { parentHash: trim(c.hash) } : null,
    };
  },
  send(msg, ctx = {}) {
    return {
      surface: 'farcaster',
      kind: 'send-intent',
      dryRun: true,
      method: 'publishCast',
      to: ctx.replyTo?.parentHash ?? ctx.parentHash ?? null,
      text: trim(msg),
      grant: grantRef('farcaster', 'signer-uuid'),
    };
  },
};

// ---- registry ---------------------------------------------------------------

export const SURFACES = new Map();

export function register(adapter) {
  if (!adapter || typeof adapter.name !== 'string' || !adapter.name) {
    throw new Error('register: adapter needs a non-empty string name');
  }
  if (typeof adapter.normalize !== 'function' || typeof adapter.send !== 'function') {
    throw new Error(`register: adapter "${adapter.name}" must implement normalize() and send()`);
  }
  SURFACES.set(adapter.name, adapter);
  return adapter;
}

// Seed the registry with the built-in adapters.
[
  melekAdapter,
  telegramAdapter,
  discordAdapter,
  matrixAdapter,
  nostrAdapter,
  farcasterAdapter,
].forEach(register);

// ---- dispatch / route -------------------------------------------------------

// Normalize an inbound event from ANY surface into the common shape.
// Unknown surface soft-fails: returns null (the runner skips it), never throws.
export function dispatch(event = {}) {
  const surface = trim(event.surface);
  const adapter = SURFACES.get(surface);
  if (!adapter) return null;
  return adapter.normalize(event);
}

// Pick the adapter for a surface and produce a DRY-RUN send-intent. No real send.
// Unknown surface soft-fails: returns null.
export function route(reply, surface, ctx = {}) {
  const adapter = SURFACES.get(trim(surface));
  if (!adapter) return null;
  return adapter.send(reply, ctx);
}

// ---- CLI --------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('bot-surfaces.mjs')) {
  console.log('registered surfaces:', [...SURFACES.keys()].join(', '));
  const inbound = dispatch({ surface: 'telegram', message: { from: { username: 'ryan' }, chat: { id: 42 }, text: 'gm hathor' } });
  console.log('inbound (normalized):', inbound);
  const intent = route('gm — welcome to MELEK', inbound.surface, { replyTo: inbound.replyTo });
  console.log('outbound (send-intent, DRY-RUN):', intent);
}
