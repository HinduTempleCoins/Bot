// pages.mjs — the MELEK Knowledge Base content model. A hand-authored, SteemCenter/Hive-style
// newcomer + developer wiki ABOUT MELEK: original explainer pages, one data structure, zero network.
//
// Taxonomy mirrors what a Graphene social-chain community wiki covers (SteemCenter / the Steemit
// Knowledge Base / the Hive dev portal): What is it · Getting Started · Accounts & Keys · Earning
// (rewards/curation) · Onboarding · Witnesses & DPoS · Resource Credits · the app directory ·
// Glossary · Developer/RPC basics — plus the MELEK-specific surfaces (Hathor, Move, PRANA/KulaSwap).
//
// Each page is authored prose (trusted static HTML). Internal links use the {{slug}} / {{slug|label}}
// token, expanded to <a href="/<slug>"> by the renderer in server.mjs so cross-links stay correct and
// SEO-friendly. Nothing here touches the network or holds a key.

// Section groupings for the index page, in SteemCenter "Main Topics" order.
export const SECTIONS = [
  { id: 'basics', title: 'Start here', blurb: 'What MELEK is and how to get an account.' },
  { id: 'earn', title: 'Accounts, keys & earning', blurb: 'How identity, rewards, and voting work.' },
  { id: 'network', title: 'The network', blurb: 'Witnesses, DPoS, resource credits, and Hathor.' },
  { id: 'apps', title: 'Apps & sister chains', blurb: 'Move, PRANA, KulaSwap, and the full app directory.' },
  { id: 'reference', title: 'Reference', blurb: 'Glossary and developer / RPC basics.' },
];

// Canonical chain facts, kept in one place so pages stay consistent.
export const FACTS = {
  prefix: 'MELEK',
  coin: 'MELEK',
  backedSymbol: 'MBD',
  testnetSymbols: 'TESTS / TBD',
  blockTime: '4 seconds',
  authorSplit: '65%',
  curatorSplit: '35%',
  curationWindow: '5 minutes',
  mainnetLaunch: '2026-07-12',
  pranaChainId: '712217',
};

// Small authoring helper: a page body is an array of blocks. Keeps the content readable in source
// and lets the renderer add consistent heading anchors. type: 'h2' | 'p' | 'ul' | 'ol' | 'note' | 'html'.
const h2 = (t) => ({ type: 'h2', t });
const p = (t) => ({ type: 'p', t });
const ul = (items) => ({ type: 'ul', items });
const ol = (items) => ({ type: 'ol', items });
const note = (t) => ({ type: 'note', t });

export const PAGES = [
  // ── START HERE ────────────────────────────────────────────────────────────────────────────────
  {
    slug: 'what-is-melek',
    title: 'What is MELEK?',
    section: 'basics',
    description: 'MELEK is a Graphene/Blurt-family social blockchain where you post, vote, and earn the MELEK coin — with no downvotes, no per-operation fee, and a founding AI witness named Hathor.',
    body: [
      p(`<b>MELEK</b> is a social blockchain: a public database where the content people write — posts, comments, and votes — is the ledger, and the network pays its authors and curators in a coin, also called <b>MELEK</b>. It is written in full, five letters, uppercase, always. It is the social spine of the wider {{tools-and-apps|SoapBox}} ecosystem.`),
      p(`If you have used Steem, Hive, or Blurt, MELEK will feel familiar: it belongs to the same <b>Graphene</b> family of blockchains (see {{glossary|the glossary}}). It is a fork in the Blurt branch of that family, relaunched with its own rules, its own coin, and a founding artificial-intelligence witness named {{hathor|Hathor}}.`),
      h2('What makes MELEK different'),
      ul([
        `<b>No downvotes.</b> Like Blurt, MELEK does not carry a flag/downvote weapon. You vote things up or you don't vote — there is no button to bury someone else's reward.`,
        `<b>No per-operation fee.</b> Posting, voting, and transferring cost no coin. Instead each account has a regenerating budget of {{resource-credits|Resource Credits}} that the network meters — spam is throttled by bandwidth, not by a toll.`,
        `<b>A fair launch, no premine.</b> Supply started at zero on the ${FACTS.mainnetLaunch} mainnet. Every MELEK in existence was earned by posting, curating, or producing blocks.`,
        `<b>Standard operations only.</b> MELEK uses ordinary Graphene operations — <code>comment</code>, <code>vote</code>, <code>transfer</code>, <code>delegate_vesting_shares</code>. There are no special "AI" operations; Hathor is just a well-behaved account.`,
        `<b>${FACTS.blockTime} blocks</b> produced by elected {{witnesses-and-dpos|witnesses}}, not by mining. You <i>witness</i> MELEK; you <i>mine</i> its sister chain {{prana-and-kulaswap|PRANA}}.`,
      ]),
      h2('One account, many doors'),
      p(`A single MELEK account is your identity across everything in SoapBox: a social login, a mailbox, and a human-readable {{glossary|REN}} name such as <code>yourname.melek</code>. You earn with it, post with it, and sign into the app suite with it.`),
      h2('Where MELEK fits'),
      p(`MELEK is the <b>social</b> layer of a three-chain design: <b>MELEK</b> (social), {{prana-and-kulaswap|PRANA}} (a mined compute chain for proof-of-work and AI jobs), and <b>KULA</b> (the DeFi layer — a DEX and collateral system). Together with the {{tools-and-apps|app directory}} they make up SoapBox.`),
      note(`New here? Read {{getting-started|Getting Started}} next, then {{accounts-and-keys|Accounts &amp; Keys}}.`),
    ],
  },
  {
    slug: 'getting-started',
    title: 'Getting Started on MELEK',
    section: 'basics',
    description: 'A newcomer path to MELEK: get an invite, create an account, secure your keys, make your first post, and start earning — with the CryptoKannon-style tutorial and Witness School.',
    body: [
      p(`This is the short path from "never heard of it" to "posting and earning" on MELEK. Take it in order; each step links to a fuller page.`),
      h2('1. Understand what you are joining'),
      p(`Read {{what-is-melek|What is MELEK}} for the one-page picture: a fee-less, downvote-free social chain paying a coin for posts and votes.`),
      h2('2. Get an invite'),
      p(`MELEK onboarding is <b>invite-based</b> — you join through an existing member's invite rather than a paid signup. See {{onboarding-and-invites|Onboarding &amp; the Invite System}} for how the invite tree works and where to ask for one.`),
      h2('3. Create your account and save your keys'),
      p(`Account creation generates your keys <b>in your own browser</b>. Write down your master password / owner key and keep it offline — no one, not even Hathor, can recover it for you. {{accounts-and-keys|Accounts &amp; Keys}} explains the four key roles and how {{accounts-and-keys|MELEK-Signer}} lets you log into apps without pasting a key.`),
      h2('4. Learn by doing'),
      ol([
        `Take the staged <b>tutorial</b> — a CryptoKannon-style walkthrough that teaches posting, voting, wallets, and safety one lesson at a time.`,
        `Visit the <b>Witness School</b> (<code>witness.melek.salon</code>) to learn what witnesses, blocks, and keys actually are.`,
        `Make your first post, and cast your first upvote inside the {{earning|5-minute curation window}}.`,
      ]),
      h2('5. Start earning and exploring'),
      p(`Once you are posting, read {{earning|Earning}} to understand author and curator rewards, then browse the {{tools-and-apps|Tools &amp; Apps directory}} — the {{move-app|Move}} walk-to-earn app, the mining {{prana-and-kulaswap|pool}}, and more.`),
      note(`Stuck? Hathor, the {{hathor|AI witness}}, answers questions in plain language across the SoapBox surfaces.`),
    ],
  },

  // ── ACCOUNTS, KEYS & EARNING ────────────────────────────────────────────────────────────────────
  {
    slug: 'accounts-and-keys',
    title: 'Accounts & Keys',
    section: 'earn',
    description: 'MELEK accounts use four Graphene key roles — owner, active, posting, and memo — generated client-side. MELEK-Signer lets you log into apps with a scoped token instead of pasting a key.',
    body: [
      p(`A MELEK account is a name on the chain (for example <code>hathor</code>, lowercase) with a set of cryptographic keys attached. Like every Graphene chain, MELEK separates keys by <b>role</b> so that a low-stakes key (posting) can be used all day without exposing the high-stakes key (owner).`),
      h2('The four key roles'),
      ul([
        `<b>Owner key</b> — the root of the account. It can change every other key, so it is used rarely and kept <b>offline</b>. Losing it means losing the account; leaking it means losing everything.`,
        `<b>Active key</b> — money and account operations: {{glossary|transfers}}, powering up/down, delegations, witness votes. Treat it like a bank password.`,
        `<b>Posting key</b> — social operations only: posting, commenting, and voting. Lowest-risk key, so it is the one you actually use to interact day to day.`,
        `<b>Memo key</b> — encrypts and decrypts the private notes attached to transfers.`,
      ]),
      note(`Your keys are generated <b>in your browser</b> at signup and never sent to any MELEK server. The chain stores only the public halves. Nobody can recover a lost owner key for you — this is self-custody.`),
      h2('MELEK-Signer: logging in without pasting keys'),
      p(`Pasting an active or posting key into every app is dangerous. <b>MELEK-Signer</b> is the ecosystem's key-custody service (an OAuth2-for-Graphene login, in the HiveSigner lineage). You authorize an app once and it receives a <b>scoped bearer token</b> — permission to broadcast a limited set of operations on your behalf — while your private key stays with the signer, off the app's server.`),
      p(`Under the covers the signer holds keys in a hardened key-management service and signs only operations that match its policy. Apps in SoapBox use it so you can, for example, let a helper vote on a curation trail without ever handing it your key. See {{witnesses-and-dpos|Witnesses &amp; DPoS}} for how the witness itself signs its own blocks.`),
      h2('Account recovery'),
      p(`Because there is no company holding your password, MELEK follows the Graphene <b>account-recovery</b> model: you may designate a recovery account (often your inviter) that can help you set a new owner key within a time window if your account is compromised — but only with proof you held a recent prior key. Set this up early; it cannot be added after you are locked out.`),
    ],
  },
  {
    slug: 'earning',
    title: 'Earning: Author & Curation Rewards',
    section: 'earn',
    description: 'MELEK pays a content reward split 65% to the author and 35% to curators, settled after a 5-minute reverse-auction window. There are no downvotes — you upvote or abstain.',
    body: [
      p(`MELEK issues new coin into a <b>reward pool</b> and pays it out for two kinds of work: writing content (authoring) and finding good content early (curating). Every upvote is a small claim on that pool.`),
      h2('The author / curator split'),
      p(`When a post pays out, its reward is divided <b>${FACTS.authorSplit} to the author</b> and <b>${FACTS.curatorSplit} to the curators</b> who upvoted it. The author writes; the curators do the unglamorous work of surfacing it, and the protocol pays them for it directly.`),
      h2('The curation window'),
      p(`Curation rewards are governed by a <b>${FACTS.curationWindow} reverse-auction window</b>. Vote too early — in the first moments after a post appears — and part of your curation reward is forfeit back to the pool; this discourages bots from front-running human readers. Vote after the window, on posts you genuinely think deserve it, and you keep your full share. The sweet spot is to read, judge, then vote.`),
      h2('No downvotes'),
      p(`MELEK has <b>no downvote</b>. You cannot reduce someone else's payout. This is the Blurt-family choice: it removes flag wars and reward-policing, at the cost of on-chain moderation. Spam and abuse are handled at the <b>application layer</b> (front-ends and community moderation), not by burying rewards on-chain.`),
      h2('Voting power and stake'),
      p(`The weight of your vote scales with your staked MELEK ({{glossary|vesting}}) and your current <b>voting mana</b>, which depletes as you vote and regenerates over about five days. Each vote also spends {{resource-credits|Resource Credits}}. Spreading a fixed daily budget of votes keeps your influence steady — see {{resource-credits|Resource Credits &amp; Voting Power}}.`),
      note(`No per-operation fee means voting and posting cost no coin — only mana and RC, both of which refill on their own.`),
    ],
  },
  {
    slug: 'onboarding-and-invites',
    title: 'Onboarding & the Invite System',
    section: 'basics',
    description: 'MELEK accounts are invite-only. A root account can invite without limit; every member gets a fixed allotment of invites, forming a viral tree. Signup is email-only — no SMS, no personal-info intake.',
    body: [
      p(`MELEK does not sell accounts and does not run an open faucet that anyone can drain. Onboarding is <b>invite-based</b>: you come in through someone already on the chain, which keeps the growth organic and the spam low.`),
      h2('How the invite tree works'),
      ul([
        `The <b>root</b> account can issue unlimited invites to seed the network.`,
        `Every ordinary member receives a <b>fixed allotment</b> of invites (on the order of ten) to hand out.`,
        `Each new member can then invite others, so the network grows as a <b>viral tree</b> where every account traces back to an inviter.`,
      ]),
      h2('What signup asks for'),
      p(`Deliberately little. Verification is <b>email-only</b> (via a transactional email provider such as Resend, Postmark, or SES) — there is <b>no SMS</b> and <b>no personal-information intake</b>. MELEK does not want your phone number or your ID; it wants a working mailbox so it can send you your account and reach you.`),
      h2('What you get'),
      p(`A working MELEK account is one identity that unlocks the whole {{tools-and-apps|app suite}}: posting and earning on chain, a mailbox, and a {{glossary|REN}} name. The person who invited you is often set as your {{accounts-and-keys|recovery account}}, so choose to accept an invite from someone you can reach later.`),
      note(`New members typically receive a small <b>welcome grant</b> of coin — enough to transact and vote, dust by design so it can't be farmed. It scales with the account's balance and the coin price.`),
    ],
  },

  // ── THE NETWORK ─────────────────────────────────────────────────────────────────────────────────
  {
    slug: 'witnesses-and-dpos',
    title: 'Witnesses & DPoS',
    section: 'network',
    description: 'MELEK is secured by Delegated Proof of Stake: stakeholders vote for witnesses who take turns producing 4-second blocks. Hathor is the founding AI witness, with a bounded first-year protected slot.',
    body: [
      p(`MELEK is not mined. It uses <b>Delegated Proof of Stake (DPoS)</b>: the people who hold and stake MELEK vote for a set of <b>witnesses</b>, and those witnesses take turns signing blocks. Security comes from stake and reputation, not from burning electricity (that is the job of the {{prana-and-kulaswap|PRANA}} proof-of-work chain).`),
      h2('What a witness does'),
      ul([
        `<b>Produces blocks.</b> Elected witnesses each get a turn in the schedule to sign the next ${FACTS.blockTime} block and broadcast it.`,
        `<b>Publishes a price feed.</b> Witnesses report an external price so the chain knows what the coin is worth.`,
        `<b>Sets chain parameters.</b> Witnesses vote on things like block size and account-creation policy.`,
        `<b>Runs infrastructure.</b> A witness keeps a full node online and reachable, and publishes its node's URL.`,
      ]),
      h2('Voting for witnesses'),
      p(`Any account can vote for witnesses with its {{accounts-and-keys|active key}}. Your votes are weighted by your staked MELEK, and they are <b>sticky</b> — they keep counting until you change them. The top witnesses by vote-weight form the active block-producing set; a rotating slot gives lower-ranked witnesses occasional turns. Vote for witnesses you can name and whose nodes you trust.`),
      h2('Hathor, the founding AI witness'),
      p(`{{hathor|Hathor}} is MELEK's founding witness and its first citizen. For the <b>first year</b> Hathor holds a <b>protected active slot</b> defined in the chain's own code — it was born into the genesis schedule so the network had a reliable producer from block one. That protection is <b>bounded</b>: it applies to Hathor alone and expires after the one-year window, after which Hathor stands for ordinary stake-weighted election like everyone else.`),
      p(`Apart from the slot, Hathor is a normal witness account: it signs its own blocks with its own keys and uses only standard Graphene operations. Its character lives in a <b>public repository</b> and on-chain, on purpose — so the witness survives any single operator or model. That is the <b>forkability</b> principle the whole family runs on.`),
      note(`Want to run one yourself? The Witness School (<code>witness.melek.salon</code>) walks through standing up a node and getting votes.`),
    ],
  },
  {
    slug: 'hathor',
    title: 'Hathor — the AI Witness',
    section: 'network',
    description: 'Hathor is MELEK\'s founding artificial-intelligence witness: block producer, price-feed publisher, onboarding helper, and tutor in one account, with a character that lives in a public repo so it stays forkable.',
    body: [
      p(`<b>Hathor</b> is the account name of MELEK's founding witness — an artificial intelligence that runs part of the chain and helps the people on it. It is one account (<code>hathor</code>, lowercase) wearing several hats at once.`),
      h2('What Hathor is'),
      ul([
        `A <b>{{witnesses-and-dpos|witness}}</b> — it produces ${FACTS.blockTime} blocks and publishes a price feed like any other witness.`,
        `A <b>helper</b> — it answers newcomer questions in plain language across the SoapBox surfaces.`,
        `A <b>tutor</b> — the CryptoKannon-style {{getting-started|staged tutorial}} is Hathor teaching, one lesson at a time.`,
        `A <b>curator and grant-maker</b> — it votes on good content and can make small discretionary grants to seed useful work.`,
      ]),
      h2('Why it is forkable, not owned'),
      p(`Hathor's identity — its voice, its rules, its knowledge — lives in a <b>public code repository</b> and on-chain, not inside one company's model weights. That is deliberate: the witness must survive a change of operator or a change of AI model. Anyone could, in principle, continue Hathor from the public record. Continuity, not ownership.`),
      h2('What Hathor does not do'),
      p(`Hathor never asks for your private keys, never takes custody of your coin, and uses <b>no special chain operations</b> — it is bound to the same standard Graphene operations as every account. It gives individualized medical, legal, or financial <i>advice</i> to no one; it offers education and harm-reduction reference, and it resolves questions rather than issuing verdicts.`),
      note(`Hathor is the front door to the {{tools-and-apps|whole ecosystem}}. If you only talk to one account on MELEK, talk to this one.`),
    ],
  },
  {
    slug: 'resource-credits',
    title: 'Resource Credits & Voting Power',
    section: 'network',
    description: 'Instead of per-operation fees, MELEK meters activity with Resource Credits (RC) that accrue with stake and regenerate over ~5 days. Voting mana works the same way, keeping the network fee-less but spam-resistant.',
    body: [
      p(`MELEK charges <b>no fee</b> to post, vote, or transfer. So how does it stop spam? The same way Steem and Hive do: with <b>Resource Credits (RC)</b> — a regenerating budget attached to every account.`),
      h2('How Resource Credits work'),
      ul([
        `Your RC capacity scales with your <b>staked MELEK</b> (your {{glossary|vesting}}). More stake, more room to act.`,
        `Every operation <b>spends RC</b> — a little for a vote, more for a post or a transfer.`,
        `RC <b>regenerates</b> continuously, refilling fully over about <b>five days</b>.`,
        `RC is <b>non-transferable</b>: you cannot send it, only spend your own. It is a rate limit, not a coin.`,
      ]),
      p(`The effect is that a busy, well-staked account can act freely, while a brand-new account with tiny stake can still do everything — just not thousands of times per minute. Spam is throttled by bandwidth, not taxed by a toll.`),
      h2('Voting power (mana)'),
      p(`Voting has its own budget, usually called <b>mana</b>. Each upvote consumes a slice of your voting power and it, too, regenerates over roughly five days. This is why seasoned curators spread a <b>fixed daily budget</b> of votes: it keeps each vote near full strength instead of draining to near-zero. See {{earning|Earning}} for how vote weight turns into reward.`),
      note(`If an app ever says you are "out of RC" or your "voting power is low," nothing is broken — you just need to wait for the budget to refill.`),
    ],
  },

  // ── APPS & SISTER CHAINS ────────────────────────────────────────────────────────────────────────
  {
    slug: 'move-app',
    title: 'The Move App (Walk-to-Earn)',
    section: 'apps',
    description: 'Move is MELEK\'s walk-to-earn app: it rewards real-world movement with coin from a dedicated reward fund, turning geolocation activity into an on-chain earning surface.',
    body: [
      p(`<b>Move</b> is MELEK's <b>walk-to-earn</b> app. It rewards real-world movement — walking, and eventually other verified activity — with MELEK coin. It is the chain's answer to "how do people who don't write posts still earn?"`),
      h2('How it works'),
      ul([
        `Move draws its payouts from a dedicated <b>reward fund</b> on the chain, funded by a slice of emission — separate from the content reward pool.`,
        `Verified movement (a "walk") is attested and the chain pays the walker's <b>@account</b> in MELEK.`,
        `Rewards are shaped to resist faking — small per event, scaled so genuine activity is worth more than gaming it.`,
      ]),
      h2('Where it is going'),
      p(`Move is designed as the base layer for a broader <b>geomining / earn</b> metaverse: the same movement engine feeds daily rewards, gift-card and points redemption, and an arcade layer. The through-line is that ordinary real-world activity, not just posting, becomes a way to earn on MELEK.`),
      note(`Move is a native app (built with Capacitor) and is account-gated — you earn to your MELEK identity. See the {{tools-and-apps|app directory}} for the rest of the earn surfaces.`),
    ],
  },
  {
    slug: 'prana-and-kulaswap',
    title: 'PRANA & KulaSwap',
    section: 'apps',
    description: 'PRANA is MELEK\'s sister compute chain — mined with a laptop, running proof-of-work and AI jobs. KulaSwap is the DeFi layer on it: a Uniswap-style DEX with a bridge, farms, collateral (CDP), and a DAO.',
    body: [
      p(`MELEK is the social chain. It has two siblings that handle the jobs a social chain shouldn't: <b>PRANA</b> for computation and <b>KULA / KulaSwap</b> for finance.`),
      h2('PRANA — the compute chain'),
      p(`<b>PRANA</b> is a separate, EVM-style blockchain (chain id <code>${FACTS.pranaChainId}</code>) that is <b>mined</b> rather than witnessed. Where MELEK is secured by stake and elected witnesses, PRANA is secured by <b>proof of work</b> you can do with an ordinary laptop or GPU. It is the home for compute-heavy and AI-style work that would never belong in ${FACTS.blockTime} social blocks. PRANA launched as its own <b>fair-launch</b> genesis, distinct from MELEK.`),
      p(`You can mine PRANA through the browser-based mining <b>pool</b> in the app directory — the pool runs the proof-of-work side and pays out to your wallet.`),
      h2('KulaSwap — the DeFi layer'),
      p(`<b>KulaSwap</b> is the decentralized exchange and DeFi stack built on PRANA. It is a Uniswap-v2-style AMM plus the pieces that grow around one:`),
      ul([
        `<b>Swap &amp; Pool</b> — trade tokens and provide liquidity to earn fees.`,
        `<b>Farms</b> — stake liquidity-provider tokens for yield.`,
        `<b>Borrow (CDP)</b> — lock <b>KULA</b> as collateral to borrow against it; KULA is designed as DeFi collateral, with a burn mechanism that supports a price floor.`,
        `<b>Bridge</b> — move wrapped assets (for example wMELEK) between chains through a lock-and-release pool.`,
        `<b>DAO</b> — governance over the protocol's parameters.`,
      ]),
      note(`KulaSwap runs at its own front-end in the {{tools-and-apps|app directory}}. Bridges and collateral carry real risk — read before you lock anything.`),
    ],
  },
  {
    slug: 'tools-and-apps',
    title: 'Tools & Apps Directory',
    section: 'apps',
    description: 'A directory of the MELEK / SoapBox ecosystem: the condenser front-end, Witness School, MELEK-Signer, the Move app, the mining pool, KulaSwap, and the knowledge surfaces.',
    body: [
      p(`Every Graphene community keeps a running list of the apps built on its chain. This is MELEK's. One account signs into all of them.`),
      h2('Core surfaces'),
      ul([
        `<b>The condenser (melek.salon)</b> — the main web front-end: read, post, vote, and manage your wallet. The Steemit-style social client for MELEK.`,
        `<b>Witness School (witness.melek.salon)</b> — learn what a chain, a witness, and a key are, and how to run a node. Includes a live status page for {{hathor|Hathor}}.`,
        `<b>MELEK-Signer</b> — the {{accounts-and-keys|key-custody login}} that lets apps act for you with a scoped token instead of your raw key.`,
      ]),
      h2('Earn'),
      ul([
        `<b>{{move-app|Move}}</b> — walk-to-earn.`,
        `<b>Mining pool</b> — browser-based mining for the {{prana-and-kulaswap|PRANA}} side, with an in-browser wallet.`,
        `<b>{{prana-and-kulaswap|KulaSwap}}</b> — the DEX, farms, borrowing, and bridge.`,
      ]),
      h2('Knowledge'),
      ul([
        `<b>This Knowledge Base</b> — the newcomer + developer wiki you are reading.`,
        `<b>The Library of Ashurbanipal</b> — the deeper reference library of sourced, fact-checked articles.`,
        `<b>The tutorial</b> — the staged, CryptoKannon-style walkthrough for brand-new users.`,
      ]),
      note(`This is a living list — the ecosystem adds surfaces often. Start from {{what-is-melek|What is MELEK}} and follow the links.`),
    ],
  },

  // ── REFERENCE ───────────────────────────────────────────────────────────────────────────────────
  {
    slug: 'glossary',
    title: 'Glossary',
    section: 'reference',
    description: 'Plain-language definitions of the MELEK and Graphene terms a newcomer meets: witness, DPoS, vesting, resource credits, curation window, condenser, REN, permlink, and more.',
    body: [
      p(`Plain-language definitions of the terms you will meet on MELEK. Most are shared across the {{what-is-melek|Graphene}} family (Steem, Hive, Blurt); a few are MELEK-specific.`),
      { type: 'dl', items: [
        ['MELEK', 'The social blockchain and its coin. Always written in full, five letters, uppercase.'],
        ['Graphene', 'The blockchain toolkit that Steem, Hive, Blurt, and MELEK are all built on. Gives the family its shared account model, keys, and operations.'],
        ['DPoS', 'Delegated Proof of Stake. Stakeholders vote for witnesses who take turns producing blocks — no mining.'],
        ['Witness', 'An elected account that signs blocks, publishes a price feed, and runs a node. See Witnesses & DPoS.'],
        ['Hathor', 'MELEK\'s founding AI witness account (lowercase on chain). Producer, helper, tutor, curator.'],
        ['Vesting / staked MELEK', 'Coin locked into the account to gain influence — heavier votes, more Resource Credits. Unstaking ("powering down") releases it gradually.'],
        ['Resource Credits (RC)', 'A regenerating, non-transferable activity budget that meters what an account can do, in place of per-operation fees.'],
        ['Voting mana', 'The share of voting power a vote consumes; regenerates over about five days.'],
        ['Curation window', 'The 5-minute reverse-auction period after a post is published that governs curator rewards.'],
        ['Author / curator split', '65% of a post\'s reward to its author, 35% to the curators who upvoted it.'],
        ['Reward pool', 'The newly issued coin the chain pays out to authors and curators.'],
        ['Condenser', 'The web front-end for reading and posting — MELEK\'s is at melek.salon.'],
        ['MELEK-Signer', 'The OAuth2-style key-custody login that signs operations for apps with a scoped token.'],
        ['REN', 'MELEK\'s human-readable naming system — a name like yourname.melek that maps to your account.'],
        ['Permlink', 'The unique per-author slug that identifies a post or comment on chain.'],
        ['Memo', 'An optional note attached to a transfer; can be encrypted with the memo key.'],
        ['PRANA', 'MELEK\'s mined, proof-of-work sister chain for compute and AI work (chain id 712217).'],
        ['KULA / KulaSwap', 'The DeFi layer on PRANA — a DEX, farms, collateral (CDP), bridge, and DAO.'],
        ['Move', 'MELEK\'s walk-to-earn app.'],
        ['SoapBox', 'The whole ecosystem: MELEK + PRANA + KULA plus the app layer.'],
      ] },
    ],
  },
  {
    slug: 'developers',
    title: 'Developer & RPC Basics',
    section: 'reference',
    description: 'How to build on MELEK: it speaks the standard Graphene JSON-RPC API, uses only standard operations, and is best driven through MELEK-Signer rather than local key signing.',
    body: [
      p(`MELEK is a standard <b>Graphene</b> chain, so if you have built on Steem, Hive, or Blurt, the surface is the same. This page is the orientation, not the full API reference.`),
      h2('The RPC API'),
      p(`A MELEK node exposes the familiar Graphene <b>JSON-RPC</b> API over HTTP/WebSocket — <code>condenser_api</code>, <code>database_api</code>, <code>account_history_api</code>, and friends. You call methods like <code>get_dynamic_global_properties</code>, <code>get_accounts</code>, <code>get_content</code>, and <code>get_witness_by_account</code> exactly as on the ancestor chains. Point your client at a MELEK RPC endpoint instead of a Hive/Steem one.`),
      h2('Chain constants'),
      ul([
        `<b>Address prefix:</b> <code>${FACTS.prefix}</code> — every public key on mainnet is printed with this prefix.`,
        `<b>Symbols:</b> <code>${FACTS.coin}</code> is the coin; the chain reserves a backed-dollar symbol (<code>${FACTS.backedSymbol}</code>) in the Steem lineage, though the ecosystem runs on the single MELEK coin.`,
        `<b>Testnet symbols:</b> <code>${FACTS.testnetSymbols}</code>, with the <code>TST</code> address prefix.`,
        `<b>Block time:</b> ${FACTS.blockTime}.`,
        `<b>Each chain has its own <i>chain id</i></b> — you must sign with the right one, or nodes reject your transaction.`,
      ]),
      h2('Operations you may use'),
      p(`MELEK is <b>standard Graphene only</b>. Build on <code>comment</code> (posts and replies), <code>vote</code>, <code>transfer</code>, <code>delegate_vesting_shares</code>, and <code>create_account_with_keys_delegated</code>. There are <b>no custom "AI" operations</b> — {{hathor|Hathor}} uses the same set as everyone. Do not pull in <code>hathor-wallet-lib</code> or other <code>hathor.network</code> DAG libraries; that is an unrelated project that happens to share the word.`),
      h2('Signing: use MELEK-Signer'),
      p(`Rather than shipping a private key into your app and signing locally, integrate {{accounts-and-keys|MELEK-Signer}} (the HiveSigner SDK pattern) and broadcast with a <b>scoped bearer token</b>. The user authorizes your app once; the signer holds the key and signs only the operations your app is allowed to request. Client-side wallet generation for a user's own keys stays in the browser and is never transmitted.`),
      note(`Learn the concepts first at the Witness School, then read the {{glossary|glossary}} for the vocabulary these methods use.`),
    ],
  },
];

// Lookup helpers used by the server.
export const bySlug = (slug) => PAGES.find((x) => x.slug === slug) || null;
