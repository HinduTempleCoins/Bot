// hathor-describe.mjs — Hathor DESCRIBES the ecosystem's offerings, in her own voice.
//
// The operator's ask: "Start having Hathor Describe." As MELEK grows from a chain into a set of products
// — a login, a permission model, compute and identity services on the chains — the Witness is the one who
// tells people, plainly and in her register, what each thing IS and who it's for. This module is the
// catalog of those descriptions + the voicing.
//
// Two paths, same as the rest of the persona layer:
//   - describe(id)                → the FACTS (grounded, honest about status: live / built / design)
//   - describe(id,{voiced:true})  → the facts wrapped in Hathor's disposition (no LLM), via hathor-persona
//   - grounding(id) + systemPrompt→ feed an LLM for the fully-voiced path
//
// It states nothing it can't ground and never dresses up status: a thing that is DESIGN says design, a
// thing LIVE says live (the operator's prove-don't-claim rule). Pure data + pure functions, offline-tested.
//
//   import * as describe from './hathor-describe.mjs'

import { wrapAnswer, systemPrompt } from './hathor-persona.mjs';

const esc = (s) => String(s == null ? '' : s);

// STATUS is honest and load-bearing: live = proven running; built = coded+tested, not yet deployed;
// design = specified, not built.
export const STATUS = Object.freeze({ LIVE: 'live', BUILT: 'built', DESIGN: 'design' });

// The offerings Hathor can describe. Facts only — each `what` is grounded in what actually exists.
export const OFFERINGS = Object.freeze([
  {
    id: 'login-with-melek', name: 'Login with MELEK', status: STATUS.BUILT,
    tagline: 'One account that signs you in — here, and increasingly anywhere.',
    what: 'Your MELEK account is a single sign-in. A site learns who you are and nothing more; there is no '
      + 'new password to make and none to steal, because the site never sees a password or a key. It is the '
      + 'same identity you already carry on the chain, offered to the wider web.',
    audience: 'Anyone with a MELEK account; any website that wants a login button.',
    tier: 'identity',
  },
  {
    id: 'permission', name: 'How permission works', status: STATUS.BUILT,
    tagline: 'Minimal by default. Funds do not move on a casual ask.',
    what: 'Signing in tells a site who you are — that is all it can ever do on its own. To act socially as '
      + 'you — a post, a vote, a follow — an application must ask, and you must approve it on MELEK’s own '
      + 'screen; it is never silent. And to move value? That door is closed. Funds-moving permission is turned '
      + 'off across MELEK right now, refused no matter who asks. Trust is built by what cannot happen to you.',
    audience: 'Every user; every developer building on the Signer.',
    tier: 'all',
  },
  {
    id: 'melek-signer', name: 'MELEK-Signer', status: STATUS.LIVE,
    tagline: 'The one keeper of keys, so nothing else has to be.',
    what: 'The Signer holds the authority to act on the chain so that no app, no page, and no server ever '
      + 'touches a private key. Everything that acts as an account passes through it under a scoped, revocable '
      + 'grant. It is the still point the rest of the machinery turns around.',
    audience: 'Every surface that reads or writes the chain on a user’s behalf.',
    tier: 'infrastructure',
  },
  {
    id: 'melek-chain', name: 'The MELEK chain', status: STATUS.LIVE,
    tagline: 'A social chain — words, votes, and a name that is yours.',
    what: 'MELEK is a Graphene chain in the Steem lineage: accounts, posts, votes, follows, and a stake that '
      + 'earns. Every account is a name, an identity, and a small treasury of standing. It is the ground the '
      + 'social products grow from.',
    audience: 'Writers, communities, and the apps that serve them.',
    tier: 'chain',
  },
  {
    id: 'prana-chain', name: 'The PRANA chain', status: STATUS.BUILT,
    tagline: 'A chain that pays for useful work, not just heat.',
    what: 'PRANA is built as a chain-as-a-pool: its security leans on light hashing, but the reward is meant '
      + 'for useful compute — the work a network of machines can actually do. It is the vessel by which the '
      + 'ecosystem turns idle capacity into something worth paying for.',
    audience: 'Anyone with compute to offer, and anyone who needs it.',
    tier: 'chain',
  },
  // ── the XaaS menu (what the chains sell as services) — honest status, grounded in what exists ──────
  {
    id: 'node-api', name: 'Node API (RPC-as-a-service)', status: STATUS.DESIGN,
    tagline: 'Hosted, reliable access to the MELEK and PRANA chains — so builders need not run a node.',
    what: 'The steadiest business a chain has is renting the door into it: a hosted, rate-limited interface a '
      + 'developer calls instead of running and maintaining their own node. We already run the nodes; this '
      + 'offers them, in tiers, to anyone building on MELEK or PRANA.',
    audience: 'Developers building apps, bots, and services on our chains.',
    tier: 'paas',
  },
  {
    id: 'identity-service', name: 'Identity-as-a-Service', status: STATUS.BUILT,
    tagline: 'Login-with-MELEK, offered to other people’s sites as a service.',
    what: 'The same login you use here, packaged for any site to adopt — a portable, self-owned identity with '
      + 'a name, an avatar, and a standing, in place of a rented per-user account. It is the crypto-native form '
      + 'of the sign-in services the large clouds sell, without the per-head toll.',
    audience: 'Any website or app that wants a login; every MELEK account holder.',
    tier: 'paas',
  },
  {
    id: 'indexing', name: 'Data & search API', status: STATUS.LIVE,
    tagline: 'The chain made legible — search, feeds, and history as a service.',
    what: 'A chain is only as useful as it is readable. This turns MELEK’s content and history into a hosted '
      + 'search and data interface others can build on, rather than each of them re-indexing the whole chain. '
      + 'The search over MELEK is already live.',
    audience: 'App builders, analysts, and anyone reading the chain at scale.',
    tier: 'paas',
  },
  {
    id: 'compute', name: 'Compute hours on PRANA', status: STATUS.DESIGN,
    tagline: 'Rent the network’s spare machines for real work — inference, rendering, batch jobs.',
    what: 'PRANA’s promise made concrete: sell interruptible compute time — the kind of price-tolerant work '
      + 'that fits a distributed network of ordinary machines — where those who supply the hardware earn for '
      + 'the useful work it does. Steady demand, not supply, is the thing this must earn; that is the honest '
      + 'shape of the task.',
    audience: 'Price-sensitive AI, rendering, and batch workloads; hardware owners.',
    tier: 'iaas',
  },
]);

const BY_ID = Object.fromEntries(OFFERINGS.map((o) => [o.id, o]));
const statusPhrase = { live: 'This is live.', built: 'This is built and tested — not yet deployed.', design: 'This is a design, not yet built.' };

/** List the offerings (plain data) for a picker or an index. */
export function list() { return OFFERINGS.map((o) => ({ ...o })); }
/** One offering, or null. */
export function get(id) { const o = BY_ID[String(id || '')]; return o ? { ...o } : null; }

/**
 * Describe one offering. Returns the facts; with { voiced:true } wraps them in Hathor's disposition
 * (no LLM), keeping the facts verbatim. Unknown id → ''.
 */
export function describe(id, { voiced = false } = {}) {
  const o = BY_ID[String(id || '')];
  if (!o) return '';
  const facts = `${o.name} — ${o.tagline}\n\n${o.what}\n\n${statusPhrase[o.status] || ''} For: ${esc(o.audience)}`.trim();
  return voiced ? wrapAnswer({ answer: facts, intent: 'trust' }) : facts;
}

/** Describe every offering, joined. */
export function describeAll({ voiced = false } = {}) {
  return OFFERINGS.map((o) => describe(o.id, { voiced })).join('\n\n———\n\n');
}

/** A grounding block for the LLM path — the facts an LLM must not contradict, plus the persona prompt. */
export function grounding(id) {
  const o = BY_ID[String(id || '')];
  if (!o) return '';
  return `OFFERING: ${o.name}\nSTATUS: ${o.status}\nWHAT IT IS: ${o.what}\nWHO IT IS FOR: ${o.audience}\n`
    + `Describe this truthfully in Hathor’s voice. Do not overstate status: ${statusPhrase[o.status] || ''}`;
}
/** The full system prompt (persona + this offering's grounding) for the LLM-voiced description. */
export function describePrompt(id) { return systemPrompt({ grounding: grounding(id) }); }

if (process.argv[1] && process.argv[1].endsWith('hathor-describe.mjs')) {
  const id = process.argv[2] || 'login-with-melek';
  console.log(describe(id, { voiced: true }));
}
