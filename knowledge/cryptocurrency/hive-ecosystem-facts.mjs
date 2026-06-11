// knowledge/cryptocurrency/hive-ecosystem-facts.mjs
//
// HIVE ecosystem facts knowledge module — the 2020 fork from Steem, the Justin
// Sun / Tron takeover context, the witness system, and DPoS mechanics.
//
// Pure ESM data + query module. No network, no clock, no disk, no chain calls.
// Soft-fail: unknown id -> null; unmatched tag / term -> []. Facts are static,
// public, historical, and apply directly to the MELEK chain (also a Graphene /
// DPoS-witness fork — same witness + voting mechanics as Steem/Hive).
//
// House style: ESM .mjs, esc() all HTML interpolation, CLI guarded by
// process.argv[1], soft-fail never throw. Pure data — nothing here touches the
// MELEK chain or any key material.

/** HTML-escape any interpolated value. */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Each fact: { id, topic, summary, detail, tags }.
// topic groups facts; tags allow cross-cutting lookup.
export const HIVE_FACTS = Object.freeze([
  {
    id: 'hive-fork-2020',
    topic: 'fork',
    summary: 'Hive forked from the Steem blockchain on 2020-03-20.',
    detail:
      'Hive launched as a community hard fork of Steem on March 20, 2020. It copied the Steem state at the fork block, so existing accounts and balances carried over to the new chain — with the notable exception of accounts associated with the Steemit Inc / Tron stake, which were excluded from the airdrop. Hive kept the same Graphene-based codebase and DPoS witness model.',
    tags: ['hive', 'steem', 'fork', 'history', '2020', 'airdrop'],
  },
  {
    id: 'justin-sun-takeover',
    topic: 'takeover',
    summary: 'Justin Sun / Tron acquired Steemit Inc in early 2020, triggering the fork.',
    detail:
      'In February 2020 Justin Sun, founder of Tron, announced the acquisition of Steemit Inc, the company that held a large pre-mined "ninja-mined" stake on Steem. The community feared this stake would be used to control the chain. Steem witnesses initially soft-forked to freeze the stake; Sun, working with major exchanges (Binance, Huobi, Poloniex) that held user-deposited STEEM, voted in new witnesses to override the soft fork. The community responded by forking away to Hive, leaving the contested stake behind on Steem.',
    tags: ['hive', 'steem', 'tron', 'justin-sun', 'takeover', 'exchanges', 'history', '2020'],
  },
  {
    id: 'ninja-mined-stake',
    topic: 'takeover',
    summary: 'The "ninja-mined" Steemit stake was the asset at the center of the dispute.',
    detail:
      'Steem was launched in 2016 with a stake that Steemit Inc mined quietly in the early days before public awareness — commonly called the "ninja-mined" stake. It represented a large fraction of total supply and influence. When that stake changed hands to Tron/Justin Sun, the concentration of voting power it represented is what made the takeover existential for the community and motivated the Hive fork and the airdrop exclusion.',
    tags: ['steem', 'ninja-mined', 'stake', 'justin-sun', 'takeover', 'history'],
  },
  {
    id: 'witness-system',
    topic: 'witness',
    summary: 'Witnesses are the elected block producers of a Graphene DPoS chain.',
    detail:
      'On Steem/Hive (and the MELEK chain), witnesses are accounts that run a witness_node and produce blocks. Stakeholders vote for witnesses; each account may cast up to 30 witness votes, weighted by the voter\'s vesting stake. The top-voted witnesses form the active set that produces blocks in a round-robin schedule, with a backup/timeshare slot rotating in lower-ranked witnesses. Witnesses also publish a price feed and signal which protocol version (hardfork) they run.',
    tags: ['witness', 'dpos', 'block-production', 'voting', 'graphene', 'governance'],
  },
  {
    id: 'witness-price-feed',
    topic: 'witness',
    summary: 'Witnesses publish a price feed used to value the chain-backed stablecoin.',
    detail:
      'Each witness publishes a price feed (the value of the native token against the backed dollar — SBD on Steem, HBD on Hive, MBD on MELEK). The median of the active witnesses\' feeds is used by the chain to convert and to back the stablecoin. A stale or wrong feed is a sign of a misconfigured or offline witness; publishing a sane feed is part of a witness\'s duty.',
    tags: ['witness', 'price-feed', 'hbd', 'sbd', 'mbd', 'stablecoin', 'graphene'],
  },
  {
    id: 'dpos-mechanics',
    topic: 'dpos',
    summary: 'DPoS = Delegated Proof of Stake: stake-weighted votes elect block producers.',
    detail:
      'Delegated Proof of Stake (DPoS), the consensus used by Graphene chains, has stakeholders vote for a fixed-size set of delegates (witnesses) who take turns producing blocks. Voting power is weighted by vested stake, not by one-account-one-vote. This yields fast (~3s) blocks and high throughput at the cost of a small, accountable producer set. Misbehaving producers can be voted out, making it a reputation-and-stake governance system rather than open mining.',
    tags: ['dpos', 'consensus', 'stake', 'voting', 'block-production', 'graphene'],
  },
  {
    id: 'dpos-vs-pow',
    topic: 'dpos',
    summary: 'DPoS replaces energy-spending mining with stake-weighted election.',
    detail:
      'Unlike Proof of Work (Bitcoin), where block production is won by spending energy/hashrate, DPoS selects a small elected set of producers and rotates them deterministically. There is no mining race and near-zero energy cost per block. Security rests on the assumption that stakeholders will vote out producers who censor or double-sign, and on the social/economic cost to a large stakeholder of attacking a chain it holds.',
    tags: ['dpos', 'pow', 'consensus', 'energy', 'security', 'mining'],
  },
  {
    id: 'vesting-influence',
    topic: 'dpos',
    summary: 'Voting weight comes from vested (powered-up) stake, not liquid balance.',
    detail:
      'On Graphene social chains, influence over both witness elections and content curation comes from vesting shares (Steem Power / Hive Power) — tokens that have been "powered up" and are subject to a slow, multi-week power-down. Liquid tokens carry no voting weight. This ties governance influence to a long-term, illiquid commitment to the chain, which is central to the DPoS security argument.',
    tags: ['vesting', 'stake', 'dpos', 'voting', 'governance', 'power-up'],
  },
  {
    id: 'governance-takeaway',
    topic: 'governance',
    summary: 'The Steem→Hive episode is the canonical case study in DPoS capture and exit.',
    detail:
      'The 2020 events are studied as a live demonstration of both the vulnerability and the resilience of DPoS: a single large stakeholder, aided by exchanges voting custodied user stake, can briefly capture the witness set; but because the chain\'s value lives in its community and an open codebase, the community can fork away and re-airdrop, stranding the captured chain. For MELEK, this is the argument for forkability and for not concentrating the protected witness slot beyond a bounded, time-limited window.',
    tags: ['governance', 'fork', 'capture', 'exit', 'melek', 'forkability', 'history'],
  },
]);

/** Distinct topic names, in first-seen order. */
export function topics() {
  const seen = [];
  for (const f of HIVE_FACTS) {
    if (!seen.includes(f.topic)) seen.push(f.topic);
  }
  return seen;
}

/** Look up one fact by id. Unknown / null / empty -> null (soft-fail). */
export function fact(id) {
  if (id == null) return null;
  const key = String(id).trim();
  if (!key) return null;
  return HIVE_FACTS.find((f) => f.id === key) || null;
}

/** All facts carrying a given tag (case-insensitive). Unknown / null -> []. */
export function byTag(tag) {
  if (tag == null) return [];
  const key = String(tag).trim().toLowerCase();
  if (!key) return [];
  return HIVE_FACTS.filter((f) => f.tags.some((t) => t.toLowerCase() === key));
}

/**
 * Case-insensitive substring match over topic / summary / detail / tags.
 * Empty or null term -> [].
 */
export function search(term) {
  if (term == null) return [];
  const q = String(term).trim().toLowerCase();
  if (!q) return [];
  return HIVE_FACTS.filter((f) => {
    const hay = `${f.id} ${f.topic} ${f.summary} ${f.detail} ${f.tags.join(' ')}`.toLowerCase();
    return hay.includes(q);
  });
}

/** All facts for a given topic (case-insensitive). Unknown / null -> []. */
export function byTopic(name) {
  if (name == null) return [];
  const key = String(name).trim().toLowerCase();
  if (!key) return [];
  return HIVE_FACTS.filter((f) => f.topic.toLowerCase() === key);
}

/**
 * Deterministic render of a list of facts (defaults to all facts).
 * { html:false } (default) -> plain text, one block per fact.
 * { html:true }            -> an esc()'d HTML list.
 */
export function render({ html = false, rows = HIVE_FACTS } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (html) {
    const head = '<ul class="hive-facts">';
    const body = list
      .map(
        (f) =>
          '<li>' +
          `<strong>${esc(f.summary)}</strong>` +
          ` <em>(${esc(f.topic)})</em>` +
          `<p>${esc(f.detail)}</p>` +
          `<small>tags: ${esc((f.tags || []).join(', '))}</small>` +
          '</li>',
      )
      .join('');
    return `${head}${body}</ul>`;
  }
  return list
    .map((f) => {
      const tags = (f.tags || []).join(', ');
      return `[${f.topic}] ${f.id}\n  ${f.summary}\n  ${f.detail}\n  tags: ${tags}`;
    })
    .join('\n\n');
}

// CLI: `node hive-ecosystem-facts.mjs [filter]`. Optional arg filters by topic,
// then by tag, then by search term; with no arg prints all facts.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  let rows = HIVE_FACTS;
  if (arg) {
    const byTo = byTopic(arg);
    const byTa = byTo.length ? byTo : byTag(arg);
    rows = byTa.length ? byTa : search(arg);
  }
  if (!rows.length) {
    process.stdout.write(`No HIVE facts match "${arg}".\n`);
    process.stdout.write(`Known topics: ${topics().join(', ')}\n`);
  } else {
    process.stdout.write(`${render({ rows })}\n`);
  }
}
