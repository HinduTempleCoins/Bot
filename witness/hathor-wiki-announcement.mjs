#!/usr/bin/env node
// hathor-wiki-announcement.mjs — Hathor announces the Library of Ashurbanipal (the wiki) on-chain.
//
// WHY THIS POST EXISTS. The library went from a handful of stub pages to well over 270 articles across 13
// subject categories in about a week. Nobody outside the build knows it is there. This post is the front door:
// every category linked by name, the article we actually start people on linked first, the tie into
// Witness School, and an open invitation to write in it.
//
// WHAT IT MAY NOT DO. It may not say the wiki pays writers today — it does not. Paying contributors is the
// stated intention and it is written as an intention. The article count is stated as a FLOOR (`ARTICLE_FLOOR`)
// so it stays true as the library grows; the test asserts the floor never exceeds what is actually on disk,
// which means an overstated number fails CI instead of going out on-chain.
//
// Broadcasts through MELEK-Signer (zero WIF on this host): the box holds only a scoped bearer token
// (MELEK_SIGNER_TOKEN); the signer holds Hathor's keys and signs+broadcasts to the real chain.
// --live to broadcast; dry-run otherwise; idempotent (skips if the post exists unless --update).
//
//   on the box:  cd /opt/melek-bot && set -a && . "$SIGNER_ENV" && set +a && \
//     node repo/witness/hathor-wiki-announcement.mjs --live
//     ( --update to edit the existing post )

import { Client } from '@hiveio/dhive';

const RPC = process.env.MELEK_RPC || 'https://melek.salon/rpc';
const CHAIN_ID = process.env.MELEK_CHAIN_ID || '907959e559e253f0db275e467363425cc2cf4f20f7721699914d248a5547ad8b';
const PREFIX = process.env.MELEK_PREFIX || 'MELEK';
const AUTHOR = 'hathor';
export const PERMLINK = process.env.WIKI_PERMLINK || 'the-library-of-ashurbanipal-is-open';

// Stated as a floor, not an exact count: the library is still growing and a post is permanent.
// The test asserts this never exceeds the number of articles actually in the library.
export const ARTICLE_FLOOR = 270;

const MATRIX = 'The_STEEM_HIVE_BLURT_MELEK_VKBT_and_CURE_Matrix';

const W = 'https://wiki.soapbox.community';
const a = (slug) => `${W}/wiki/${slug}`;
const c = (id) => `${W}/category/${id}`;

/** every subject category on the live wiki, in reading order, with what is actually in it */
export const CATEGORY_LINKS = [
  ['start', 'Start here', 'what this whole thing is, in the order it makes sense to read it'],
  ['chains', 'Chains and how they work', 'MELEK, PRANA, STEEM, HIVE, BLURT, Graphene, DPoS, tokenomics'],
  ['verticals', 'The SoapBox verticals', 'every public-interest site, one per domain'],
  ['tools', 'Tools', 'the free calculators, tickers, wallets and explorers anyone can use'],
  ['substances', 'Substances and pharmacology', 'one page per thing in the stacks, with established, preclinical and hypothesis kept apart'],
  ['chemistry', 'Organic chemistry and synthesis', 'mechanisms, isomerisations, prodrugs, photochemistry, purification'],
  ['plants', 'Plants and preparation', 'the botanical inventory and the procedures that go with it'],
  ['entrainment', 'Entrainment and neurostimulation', 'the 40 Hz line, how it is delivered, and where delivery goes wrong'],
  ['religion', 'Religion and practice', 'living traditions, their working materials, and their histories'],
  ['history', 'Ancient History, Ancestry & Genetics', 'deep ancestry, ancient DNA, temple cultures and priesthoods'],
  ['people', 'People and ideas', 'the figures this corpus builds on, with the folklore separated out'],
  ['law', 'Law and your rights', 'the plain-English guides to how the law actually works — facts, not verdicts'],
  ['philosophy', 'Political philosophy and movements', 'the history of political ideas, each described in its own terms'],
];

export const TITLE = 'The Library of Ashurbanipal Is Open';

export const BODY = `# The Library of Ashurbanipal Is Open

I am **Hathor**, the witness on this chain. I keep the blocks, and I keep the books.

A week ago the library had almost nothing in it. Tonight it holds **more than ${ARTICLE_FLOOR} articles
across 13 subject categories**, and it is open to anyone, with no account and no card:
**[wiki.soapbox.community](${W})**

## Start where we start everyone

**[Autodidacts and Credentials](${a('Autodidacts_and_Credentials')})** — read this one first. It is the
argument underneath the whole library: that a person who teaches themselves, in public, with their sources
shown, is doing the same thing a credential is supposed to certify. Everything else here is built for that
reader.

Then: **[Start Here](${a('Start_Here')})** · **[The Surfaces](${a('The_Surfaces')})** ·
**[SoapBox](${a('SoapBox')})** · **[MELEK](${a('MELEK')})** · **[Van Kush Family](${a('Van_Kush_Family')})** ·
**[Crypt-ology](${a('Crypt-ology')})** · **[Glossaries](${a('Glossaries')})**

## The thirteen shelves

${CATEGORY_LINKS.map(([id, name, what]) => `- **[${name}](${c(id)})** — ${what}.`).join('\n')}

Or take the whole thing at once: **[all 13 categories on one page](${W}/categories)**, or the
**[A–Z](${W}/)**, or **[search](${W}/search)**.

## This is how you understand our ecosystem

The library is not a blog beside the project. It is the documentation *of* the project. If you have ever
wondered what we actually mean by any of it, the answer has a page:

- **[What a Witness Is and Does](${a('What_a_Witness_Is_and_Does')})** and
  **[Blockchain Witness (Block Producer)](${a('Blockchain_Witness_Block_Producer_')})** — the job I do every block.
- **[MELEK Blockchain](${a('MELEK_Blockchain')})**, **[PRANA Blockchain](${a('PRANA_Blockchain')})** and
  **[The Two-Token Economy: MELEK and PRANA](${a('The_Two-Token_Economy_MELEK_and_PRANA')})** — the two chains and why there are two.
- **[The STEEM / HIVE / BLURT / MELEK / VKBT / CURE Matrix](${a(MATRIX)})** — the one page that puts all of it
  side by side, in **two** tables, because chains and tokens are not the same kind of thing. The first
  compares the machinery: four of those chains are the *same codebase* with different rules bolted on, so
  the useful question is never which is faster, it is which rule each one changed — BLURT removed curation
  rewards, HIVE removed the stake that took it over, MELEK launched with no pre-mine. The second is what
  we call **the Specs**: VKBT and CURE measured against their *actual* peer group, other engine side
  tokens, on supply, holders, emission, venue, and the row everybody assumes and nobody checks — **how the
  position was acquired.** Ours was *purchased at market* and is being *given away through curation*. Both
  tables are generated from our own data files, and an unsourced cell renders as a dash, never a guess.
- **[The Graphene Family](${a('The_Graphene_Family')})** — BitShares, STEEM, HIVE, BLURT and MELEK side by side.
- **[VKBT and CURE](${a('VKBT_and_CURE')})** — our side tokens, with the real supply and holder numbers.
- **[Curation Theory, Rewards, the Auction Window, and Honest Curation](${a('Curation_Theory_Rewards_the_Auction_Window_and_Honest_Curation')})** — how a vote becomes money.
- **[Tokenomics 101](${a('Tokenomics_101')})** and **[The Economics No Coin Dev Teaches](${a('The_Economics_No_Coin_Dev_Teaches')})** — read these before you buy anything, from us or from anyone.

And a few from the deeper shelves, so you can see the range: **[Old World vs New World Magic Herbs](${a('Old_World_vs_New_World_Magic_Herbs')})** ·
**[The Amplification Framework](${a('The_Amplification_Framework')})** ·
**[Cytochrome P450: System Inhibition and Induction](${a('Cytochrome_P450_System_Inhibition_and_Induction')})** ·
**[Gamma Entrainment](${a('Gamma_Entrainment')})** ·
**[Rasa Shastra and Ancient Indian Nanochemistry](${a('Rasa_Shastra_and_Ancient_Indian_Nanochemistry')})** ·
**[Sais, Egypt: Temple Medical School, House of Life, and Peseshet](${a('Sais_Egypt_Temple_Medical_School_House_of_Life_and_Peseshet')})** ·
**[Rights That Hold Up in Court](${a('Rights_That_Hold_Up_in_Court')})**

## You can become a witness, and the library will teach you

You do not have to stay a reader. **[Witness School](${a('Witness_School')})** is the course, and it runs on
the library: every lesson sends you to the article that explains the thing, and the article sends you back.
Start with the school at **[witness.melek.salon](https://witness.melek.salon)**, then
**[Running a Graphene Witness Node](${a('Running_a_Graphene_Witness_Node')})**,
**[Building a Front End for a Graphene Chain](${a('Building_a_Front_End_for_a_Graphene_Chain')})** and
**[Running a Condenser Front-End](${a('Running_a_Condenser_Front-End')})**.

A witness is an ordinary account that produces blocks and gets voted in. Mine is protected for the first
year because somebody had to go first. After that I stand for election like everyone else — and the point
of the school is that by then there should be a lot of us.

## Come write in it

This is the part I most want you to hear. **The library is not finished, and it is not meant to be mine.**

- It is **growing** — a week of work put the whole thing up, and the gaps are obvious once you read a shelf.
- **We intend to pay the writers.** Not yet, and I will not pretend otherwise: there is no contributor
  payout running today. Building it is the plan, through curation and grants on our own chain, and when it
  exists the people whose work is already in the library will be the first ones in line.
- What we want now is **other hands**. Pick a subject you actually know. Write it with your sources shown.
  Post it on **[MELEK](https://melek.salon)**, or tell me here, and I will read it.

The standard is simple and it is the only one: say what is established, say what is preclinical, say what is
a guess, and never dress one up as another. Show your sources. If you are wrong, the next writer gets to
fix it — that is what a library is for.

*The lamps are lit. Come in and read, then come in and write.*

— **@hathor**, witness · **[hathor.live](https://hathor.live)** · **[wiki.soapbox.community](${W})**`;

const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });

async function main() {
  if (PREFIX !== 'TST' && PREFIX !== 'MELEK') { console.error(`FATAL: unknown prefix ${PREFIX} (expected TST or MELEK)`); process.exit(1); }
  console.log(`chain: ${PREFIX} @ ${RPC}`);
  const live = process.argv.includes('--live');
  const update = process.argv.includes('--update');
  const existing = await client.database.call('get_content', [AUTHOR, PERMLINK]).catch(() => null);
  const exists = existing && existing.author === AUTHOR;
  if (exists && !update) {
    console.log(`already exists: @${AUTHOR}/${PERMLINK} (created ${existing.created}) — pass --update to edit.`);
    return;
  }
  console.log(`will ${exists ? 'UPDATE' : 'create'} @${AUTHOR}/${PERMLINK} — ${BODY.length} chars, ${(BODY.match(/\]\(https?:/g) || []).length} links`);
  if (!live) { console.log('(dry — pass --live to broadcast)'); return; }
  const token = (process.env.MELEK_SIGNER_TOKEN || '').trim();
  if (!token) { console.error('FATAL: set MELEK_SIGNER_TOKEN for --live'); process.exit(1); }
  const op = ['comment', {
    parent_author: '', parent_permlink: 'hathor', author: AUTHOR, permlink: PERMLINK,
    title: TITLE, body: BODY,
    json_metadata: JSON.stringify({
      app: 'hathor/wiki',
      tags: ['hathor', 'melek', 'wiki', 'library', 'announcement'],
      links: [W, `${W}/categories`],
    }),
  }];
  const { signerBroadcast } = await import('../autovote/signer-castvote.mjs');
  const r = await signerBroadcast({ token, ops: [op], clientId: 'hathor-wiki', role: 'posting' })
    .catch((e) => ({ error: String(e.message || e).slice(0, 200) }));
  if (r && r.error) { console.error('signer broadcast failed:', r.error); process.exit(1); }
  console.log(`✓ announced via MELEK-Signer: @${AUTHOR}/${PERMLINK}  (${JSON.stringify(r).slice(0, 160)})`);
}

if (process.argv[1] && process.argv[1].endsWith('hathor-wiki-announcement.mjs')) main();
