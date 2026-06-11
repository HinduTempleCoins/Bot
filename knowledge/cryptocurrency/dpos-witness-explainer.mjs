// knowledge/cryptocurrency/dpos-witness-explainer.mjs
//
// DPoS / witness-system explainer — read-only, sourced knowledge module.
//
// Covers the Graphene Delegated-Proof-of-Stake witness mechanics: the top-21
// active schedule, witness voting, block production, missed-block / disable,
// and price-feed publishing — plus the MELEK-specific note that Hathor's
// first-year slot protection lives in the chain code, not in any custom op.
//
// Pure ESM data + query module. No network, no clock, no disk, no LLM. Soft-fail:
// an unknown term returns null; renderMarkdown is deterministic. Facts sourced
// statically from BRIEF.md / CLAUDE.md (the MELEK founding orientation) and the
// public Graphene/Steem DPoS witness documentation.
//
// House style: ESM .mjs, esc() all HTML interpolation, CLI guarded by
// process.argv[1], soft-fail never throw.

/** HTML-escape any interpolated value. */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Glossary of witness / DPoS terms. Each entry is sourced. `term` is the
// canonical name; `plain` is one-line plain-language; `detail` is the longer
// explanation; `source` is the static provenance.
export const TERMS = Object.freeze([
  Object.freeze({
    term: 'Delegated Proof of Stake (DPoS)',
    plain: 'Stakeholders vote for a small set of block producers instead of everyone mining.',
    detail:
      'In DPoS, coin holders vote with their stake to elect a fixed-size set of block producers (called witnesses on Graphene chains). The elected producers take turns signing blocks. This trades the open competition of Proof-of-Work for fast, low-energy, stake-weighted consensus where accountability is continuous: a producer that misbehaves or goes offline can be voted out at any time.',
    source: 'Public Graphene / Steem DPoS documentation; BRIEF.md §1 (standard Graphene only).',
  }),
  Object.freeze({
    term: 'Witness',
    plain: 'An elected account that produces blocks and runs chain infrastructure.',
    detail:
      'A witness is a Graphene account (such as `hathor` on MELEK) that runs a witness_node, signs blocks in its assigned slot, and publishes a price feed. Witnesses are ordinary accounts holding a registered signing (block) key; the chain does not special-case who or what operates them. Being a witness is a role an account takes on, not a separate kind of object on the chain.',
    source: 'CLAUDE.md (Core framing — the Bot IS the witness account `hathor`); BRIEF.md §1.',
  }),
  Object.freeze({
    term: 'Top-21 schedule',
    plain: 'The 21 most-voted witnesses take turns producing blocks each round.',
    detail:
      'Graphene runs a round of block production over the active schedule: the top witnesses by approval-vote weight fill the elected slots (21 on Steem-family chains — the top 20 by votes plus one rotating timeshare/backup slot), and within a round each produces one block in a shuffled order. Witnesses outside the active set are standby: they are ranked and promoted into the schedule as votes shift, but do not produce until elected.',
    source: 'Public Graphene / Steem DPoS documentation (active vs. standby witnesses).',
  }),
  Object.freeze({
    term: 'Witness votes',
    plain: 'Stakeholders cast approval votes to choose who sits in the active schedule.',
    detail:
      'Each account can approve a number of witnesses; the approval is weighted by the voter\'s vesting stake. Witnesses are ranked by total approval weight, and the schedule is filled from the top of that ranking. Votes are standing approvals — they persist until changed — so the active set continuously reflects current stakeholder preference rather than a one-time election. The standard op is `vote` (witness vote); no custom op is needed.',
    source: 'Public Graphene / Steem DPoS documentation; BRIEF.md §1 (standard ops: comment, vote, transfer, delegate).',
  }),
  Object.freeze({
    term: 'Block production',
    plain: 'Each active witness signs one block in its assigned time slot.',
    detail:
      'Block production rotates through the active schedule on a fixed cadence (3-second slots on Steem-family chains). When a witness\'s slot arrives, its node signs and broadcasts a block with the registered signing key. Producing reliably in-slot is the core duty of a witness; missing slots is visible on-chain and erodes both rewards and votes.',
    source: 'Public Graphene / Steem DPoS documentation; BRIEF.md §10 Phase 1 (block production).',
  }),
  Object.freeze({
    term: 'Missed block',
    plain: 'A witness that fails to sign in its slot records an on-chain miss.',
    detail:
      'If a witness does not produce a block during its assigned slot (node down, key misconfigured, network partition), the slot is skipped and the witness\'s `total_missed` counter increments. Missed blocks are public and cumulative; a rising miss count signals an unreliable operator and is a common reason stakeholders re-cast their witness votes elsewhere.',
    source: 'Public Graphene / Steem DPoS documentation (witness total_missed).',
  }),
  Object.freeze({
    term: 'Witness disable / signing-key reset',
    plain: 'A failing witness can drop itself out of the schedule by clearing its signing key.',
    detail:
      'A witness that cannot produce safely can disable itself by updating its block-signing key to the null public key. With no valid signing key it is skipped by the scheduler and stops accruing missed blocks until the operator restores a real key with a fresh witness_update. This is a normal operational lever — taking a node out of rotation for maintenance — not a punishment imposed by the chain.',
    source: 'Public Graphene / Steem DPoS documentation (witness_update / null signing key).',
  }),
  Object.freeze({
    term: 'Price feed publishing',
    plain: 'Witnesses post a regular price quote the chain uses to value its stablecoin.',
    detail:
      'Witnesses publish a price feed (the exchange rate between the chain token and its stablecoin — MELEK/MBD on mainnet, TESTS/TBD on testnet). The chain takes the median of active witnesses\' feeds to set the conversion rate backing the stablecoin. Publishing an accurate, timely feed is a witness duty alongside block production; a stale or wild feed is, like missed blocks, grounds for losing votes.',
    source: 'BRIEF.md §10 Phase 1 (informational price feed); CLAUDE.md Status (hourly price feed, MELEK/MBD vs TESTS/TBD).',
  }),
  Object.freeze({
    term: "Hathor's slot protection (MELEK-specific)",
    plain: "For its first year Hathor's active slot is protected in the chain code — no custom op.",
    detail:
      'On MELEK, the founding witness `hathor` has its active-witness slot protected at the chain-code / consensus level for the first year, after which it reverts to ordinary stake-weighted DPoS election. Crucially, the protection lives in the chain code, scoped to Hathor alone and time-limited — it is NOT a custom chain operation and NOT implemented in the Bot repo. The Bot treats Hathor as a normal Graphene witness account and does not depend on the protection itself.',
    source: 'CLAUDE.md (Core framing — slot protection in chain code, not the Bot repo); BRIEF.md §1.',
  }),
]);

/** Case-insensitive exact-name lookup. Returns the entry or null. */
export function lookup(term) {
  if (term == null) return null;
  const key = String(term).trim().toLowerCase();
  if (!key) return null;
  return TERMS.find((e) => e.term.toLowerCase() === key) || null;
}

/** All term names, sorted (locale-independent, deterministic). */
export function list() {
  return TERMS.map((e) => e.term).sort();
}

/**
 * Deterministic Markdown glossary. Renders every entry in TERMS array order,
 * with all interpolated text esc()'d. No clock, no randomness.
 */
export function renderMarkdown() {
  const lines = ['# DPoS / Witness System — Explainer', ''];
  for (const e of TERMS) {
    lines.push(`## ${esc(e.term)}`);
    lines.push('');
    lines.push(`**${esc(e.plain)}**`);
    lines.push('');
    lines.push(esc(e.detail));
    lines.push('');
    lines.push(`_Source: ${esc(e.source)}_`);
    lines.push('');
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}

// CLI: `node dpos-witness-explainer.mjs [term]`. With a term, prints that
// entry (or a not-found line); with no arg, prints the full Markdown glossary.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (arg) {
    const hit = lookup(arg);
    if (hit) {
      process.stdout.write(`${hit.term}\n  ${hit.plain}\n\n${hit.detail}\n\nSource: ${hit.source}\n`);
    } else {
      process.stdout.write(`No entry for "${arg}".\nKnown terms:\n  ${list().join('\n  ')}\n`);
    }
  } else {
    process.stdout.write(`${renderMarkdown()}\n`);
  }
}
