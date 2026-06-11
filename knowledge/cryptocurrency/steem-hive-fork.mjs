// knowledge/cryptocurrency/steem-hive-fork.mjs
//
// Steem -> Hive 2020 fork / Justin Sun takeover — read-only, sourced knowledge
// module. Covers the Justin Sun / Tron acquisition of Steemit Inc, the soft-fork
// 0.22.2 stake freeze, the exchange-stake vote that seized the witness set, and
// the March 2020 Hive hard fork airdrop (which excluded the flagged accounts).
//
// Pure ESM data + query module. No network, no clock, no disk, no LLM, no chain
// calls. Soft-fail: an unknown topic returns null; nothing here throws. Facts are
// static, sourced from public reporting of the 2020 events, and directly relevant
// to MELEK (also a Graphene / DPoS-witness fork — same capture-and-exit dynamics).
// Strictly factual / historical — no advice.
//
// House style: ESM .mjs, esc() all HTML interpolation, CLI guarded by
// process.argv[1], soft-fail never throw.

/** HTML-escape any interpolated value. */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Each entry: { topic, plain, detail, date, source }.
//   topic  — canonical short slug, used for lookup (case-insensitive).
//   plain  — one-line plain-language summary.
//   detail — longer historical explanation, strictly factual.
//   date   — ISO yyyy-mm-dd of the event, used for timeline ordering.
//   source — static provenance (public reporting / project docs).
export const FACTS = Object.freeze([
  Object.freeze({
    topic: 'tron-acquisition',
    plain: 'Justin Sun / Tron acquired Steemit Inc in February 2020.',
    detail:
      'On February 14, 2020, Justin Sun, founder of the Tron Foundation, announced that Tron / Steemit had acquired Steemit Inc, the company that operated the steemit.com front end and held a large early "ninja-mined" STEEM stake. The acquisition put that stake — long understood by the community as a development fund the company had pledged not to use for governance — under new ownership, and raised the prospect that it could be powered up and used to control witness elections on the Steem chain.',
    date: '2020-02-14',
    source: 'Public reporting of the Tron / Steemit Inc acquisition (Feb 2020); Steemit Inc and Tron Foundation announcements.',
  }),
  Object.freeze({
    topic: 'ninja-mined-stake',
    plain: 'The disputed asset was the early "ninja-mined" Steemit stake.',
    detail:
      'Steem launched in 2016 and Steemit Inc accumulated a large fraction of the supply by mining it in the chain\'s earliest days, before broad public participation — commonly called the "ninja-mined" stake. The community had operated for years on the understanding that this stake was earmarked for ecosystem development and would not vote in witness elections. The Steemit Inc acquisition transferred control of that stake, which is why its potential use for governance became the flashpoint of the entire dispute.',
    date: '2016-03-24',
    source: 'Public reporting and Steem community history of the 2016 launch and the "ninja-mined" stake.',
  }),
  Object.freeze({
    topic: 'soft-fork-0.22.2',
    plain: 'Steem witnesses ran soft fork 0.22.2 to freeze the Steemit stake.',
    detail:
      'In late February 2020, a majority of the active Steem witnesses adopted soft fork 0.22.2, which made the Steemit Inc / Tron-controlled accounts unable to move or vote with their stake — effectively freezing it pending a community agreement. The soft fork was a defensive, reversible measure: it did not confiscate the stake, but it blocked the new owner from using its voting weight while the dispute was unresolved.',
    date: '2020-02-24',
    source: 'Public reporting of Steem soft fork 0.22.2 (the stake-freeze soft fork), Feb 2020.',
  }),
  Object.freeze({
    topic: 'exchange-vote-seizure',
    plain: 'Sun, with exchanges voting user-deposited STEEM, voted in new witnesses to override the freeze.',
    detail:
      'On March 2, 2020, Justin Sun coordinated with major exchanges — Binance, Huobi, and Poloniex — that custodied large amounts of user-deposited STEEM. That custodied stake was powered up and used to vote in a new set of witnesses controlled by the Sun side, displacing the community witnesses who had run the soft fork and reversing the 0.22.2 freeze. The episode drew wide criticism because the exchanges were voting with customer funds rather than their own; the exchanges later said they had not understood how the stake would be used and unwound their votes.',
    date: '2020-03-02',
    source: 'Public reporting of the March 2, 2020 exchange-stake witness vote (Binance, Huobi, Poloniex) on Steem.',
  }),
  Object.freeze({
    topic: 'hive-hard-fork',
    plain: 'The community hard-forked to Hive on March 20, 2020.',
    detail:
      'On March 20, 2020, the Steem community launched Hive as a hard fork of the Steem blockchain. Hive kept the same Graphene-based codebase and DPoS witness model and copied the Steem state at the fork block, so ordinary accounts and balances carried over to the new chain. The community moved its applications, witnesses, and social activity to Hive, leaving the contested chain and its stake behind on Steem — a textbook "exit" in response to perceived governance capture.',
    date: '2020-03-20',
    source: 'Public reporting and Hive project documentation of the March 20, 2020 hard fork from Steem.',
  }),
  Object.freeze({
    topic: 'airdrop-exclusion',
    plain: 'The Hive airdrop mirrored balances but excluded the flagged accounts.',
    detail:
      'When Hive copied the Steem state, it issued a 1:1 airdrop of the new HIVE token to existing stakeholders — with the deliberate exception of a set of accounts associated with the Steemit Inc / Tron stake and with the parties who had taken over the witness set. Those flagged accounts received no HIVE on the new chain. The exclusion was the mechanism by which the fork stranded the contested stake on Steem rather than carrying its concentrated voting power onto Hive.',
    date: '2020-03-20',
    source: 'Public reporting and Hive project documentation of the Hive airdrop and the excluded-accounts list.',
  }),
  Object.freeze({
    topic: 'melek-relevance',
    plain: 'For MELEK the episode is the canonical case for forkability and a bounded protected slot.',
    detail:
      'MELEK is itself a Graphene / DPoS-witness fork, so the 2020 Steem -> Hive events are directly instructive: a single large stakeholder, aided by exchanges voting custodied user stake, can briefly capture the witness set, but a community whose value lives in an open codebase and its own activity can fork away and re-airdrop, stranding the captured chain. This is the argument behind MELEK keeping forkability load-bearing and keeping Hathor\'s founding witness-slot protection bounded and time-limited (first year only) rather than permanent.',
    date: '2020-03-20',
    source: 'BRIEF.md / CLAUDE.md (Core framing — standard Graphene, forkability load-bearing, bounded one-year slot protection).',
  }),
]);

/** Case-insensitive exact-topic lookup. Unknown / null / empty -> null (soft-fail). */
export function lookup(topic) {
  if (topic == null) return null;
  const key = String(topic).trim().toLowerCase();
  if (!key) return null;
  return FACTS.find((e) => e.topic.toLowerCase() === key) || null;
}

/**
 * Entries sorted by date ascending (then by topic for a stable, deterministic
 * order on equal dates). Returns a new array; FACTS itself is not mutated.
 */
export function timeline() {
  return FACTS.slice().sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0;
  });
}

/**
 * Deterministic dated Markdown summary of the fork, in timeline order. All
 * interpolated text is esc()'d. No clock, no randomness.
 */
export function renderMarkdown() {
  const lines = ['# Steem -> Hive (2020) — Fork & Justin Sun Takeover', ''];
  for (const e of timeline()) {
    lines.push(`## ${esc(e.date)} — ${esc(e.topic)}`);
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

// CLI: `node steem-hive-fork.mjs [topic]`. With a topic, prints that entry
// (or a not-found line); with no arg, prints the full dated timeline summary.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (arg) {
    const hit = lookup(arg);
    if (hit) {
      process.stdout.write(`${hit.date} — ${hit.topic}\n  ${hit.plain}\n\n${hit.detail}\n\nSource: ${hit.source}\n`);
    } else {
      const known = timeline().map((e) => e.topic).join('\n  ');
      process.stdout.write(`No entry for "${arg}".\nKnown topics:\n  ${known}\n`);
    }
  } else {
    process.stdout.write(`${renderMarkdown()}\n`);
  }
}
