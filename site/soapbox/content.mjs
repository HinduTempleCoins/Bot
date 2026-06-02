// content.mjs — the editorial/seed content for the non-market pages (dApps directory seed,
// ecosystem copy, /learn articles). Kept as data so the page factory renders it through the same
// layout. /learn is the SEO-depth layer the brief calls for (every concept = an indexable page),
// linked to the Library of Ashurbanipal (wiki.SoapBox.Community).

// dApp directory seed — categorized, with the metric we can show without a key. Real activity
// metrics (TVL via DeFiLlama, on-chain calls) get wired per-adapter later; this is the factory shell.
export const DAPPS = [
  { name: 'SoapBox Swap', category: 'DeFi', chain: 'PRANA', status: 'planned', blurb: 'Native AMM (Uniswap-v2 core) for the SoapBox ecosystem.' },
  { name: 'SoapBox Mining Pool', category: 'Infrastructure', chain: 'MELEK', status: 'planned', blurb: 'CryptoNote-style pool (dvandal/cryptonote-nodejs-pool) for native chains.' },
  { name: 'PRANA Wallet', category: 'Wallet', chain: 'multi', status: 'in progress', blurb: 'Non-custodial connect → portfolio tracker. The on-ramp into the suite.' },
  { name: 'Library of Ashurbanipal', category: 'Social', chain: 'off-chain', status: 'live', blurb: 'The wiki/knowledge layer. SEO + teaching, linked from every listing.', url: 'https://wiki.soapbox.community' },
  { name: 'Hathor (AI Witness)', category: 'Social', chain: 'MELEK', status: 'planned', blurb: 'Resident AI that reads the condenser, analyzes, and drafts — never trades.' },
];

export const ECOSYSTEM = {
  intro: 'The SoapBox ecosystem is built on three tiers of data — external market APIs, the Hive/Graphene rails our first-party tokens live on, and the native chains we run ourselves. The aggregator you are reading is the condenser: one normalized state that the public site, the AI Witness (Hathor), and the autonomous trade bots all read from. One source of truth.',
  pillars: [
    { slug: 'melek', name: 'MELEK', kind: 'Graphene chain', role: 'The witness chain. Hathor is a founding witness account on it.',
      detail: 'MELEK is a standard Graphene (DPoS) chain — accounts, posts, votes, transfers, all stock operations, no custom op for the AI. Hathor, the AI Witness, is an ordinary witness account on it with a one-year founding-slot protection at the chain level, after which it reverts to ordinary stake-weighted election. Tier-3 native data from MELEK is what the condenser will surface that no third-party lister has.' },
    { slug: 'soap', name: 'SOAP', kind: 'Graphene chain', role: 'A BitShares/Graphene-based chain in the ecosystem.',
      detail: 'SOAP is a BitShares/Graphene-based chain in the SoapBox ecosystem. Like MELEK it normalizes into the one condenser schema via a native-node adapter once its RPC is live.' },
    { slug: 'prana', name: 'PRANA', kind: 'EVM value/compute chain', role: 'The wallet + DeFi + useful-work compute layer (Phase 2).',
      detail: 'PRANA is the EVM value/compute layer — the home of the non-custodial PRANA Wallet, the AMM/swap, and useful-work GPU compute. The wallet is the on-ramp that turns a read-only SoapBox visitor into a participant.' },
    { slug: 'tokens', name: 'VKBT / CURE', kind: 'Hive-Engine tokens', role: 'First-party tokens with real holder distribution and a computed Clarity Score.',
      detail: 'VKBT (Van Kush Beauty Token) and CURE (Curator Rewards Token) are first-party Hive-Engine tokens. Because they live on rails we read directly, their coin pages show real holder distribution, a live order book, and a Clarity Score computed from observable on-chain facts.' },
  ],
  note: 'Tier 3 is the moat: CMC structurally cannot replicate first-party data from chains they do not run. The Clarity Score is that legibility made public.',
};

// /learn articles — slug → { title, summary, body(HTML) }. SEO front door; each is its own URL.
export const LEARN = {
  'what-gives-a-token-value': {
    title: 'What gives a token value?',
    summary: 'Utility, distribution, transparency, and real demand — and how to tell them apart from hype.',
    body: `<p>A token's price is what someone will pay; its <em>value</em> is harder. Four observable things matter more than any chart:</p>
      <ul>
        <li><b>Utility</b> — does holding it do something (governance, fees, access, redemption)? A shop token you can spend has a floor a meme token does not.</li>
        <li><b>Distribution</b> — is ownership spread across real, independent holders, or does the issuer/whales hold almost everything? Concentrated supply means the price is whatever a few wallets decide.</li>
        <li><b>Supply transparency</b> — is there a finite, published cap, or can the issuer mint more whenever they like? Silent minting headroom dilutes you.</li>
        <li><b>Real demand</b> — genuine, sustained volume from many parties, not a handful of wallets trading with themselves (wash trading).</li>
      </ul>
      <p>SoapBox's <b>Clarity Score</b> measures exactly these observable facts — never opinion, never points bought or gifted between users. A low score means a project is <em>opaque</em>, which is a fact; it does not mean "scam," which is a judgment.</p>`,
  },
  'recognizing-scam-patterns': {
    title: 'Recognizing scam patterns',
    summary: 'The repeatable red flags — concentration, mint authority, fake volume, anonymous urgency.',
    body: `<p>Most crypto scams reuse a small set of patterns. Learn to read them from on-chain facts, not vibes:</p>
      <ul>
        <li><b>Extreme concentration</b> — the top few wallets hold the overwhelming majority. They can dump on you at any time.</li>
        <li><b>Open mint authority</b> — no fixed max supply, or a contract that lets the deployer mint freely. Your share can be diluted to nothing.</li>
        <li><b>Wash volume</b> — high "volume" with very few unique participants. Depth-over-time and real holder counts expose it.</li>
        <li><b>Urgency + anonymity</b> — "buy now or miss it" from an unverifiable team. Real projects can withstand questions.</li>
        <li><b>No right-of-reply</b> — a project that cannot answer plainly when challenged. SoapBox builds the reply <em>into</em> the page.</li>
      </ul>
      <p>None of these alone proves fraud. Together, low on several, they describe an <em>opaque</em> project — which is what the Clarity Score reports, and why the comments-under-graph exist for the project to respond.</p>`,
  },
  'how-soapbox-is-different': {
    title: 'How SoapBox differs from CoinMarketCap',
    summary: 'Right-of-reply, a Clarity Score from facts, burn-to-feature, and first-party chain data.',
    body: `<p>SoapBox is a market aggregator, but it is built around a few things a pure price-list cannot do:</p>
      <ul>
        <li><b>Comments under every coin's graph</b> — right-of-reply. If a project is called out, it answers on the same page. Fact-and-debate, never a verdict machine.</li>
        <li><b>A Clarity Score from observable facts</b> — transparency measured, not "trust" voted. It can't be bought or gifted between users.</li>
        <li><b>Burn-to-feature, not pay-to-play</b> — projects burn ecosystem tokens for placement (deflationary, aligned), instead of paying CMC in dollars.</li>
        <li><b>First-party chain data</b> — we run the native nodes (MELEK/SOAP/PRANA), so we have data no third-party lister has. That is the moat.</li>
        <li><b>Education on every listing</b> — linked to the Library of Ashurbanipal.</li>
      </ul>`,
  },
  'what-is-a-graphene-chain': {
    title: 'What is a Graphene chain?',
    summary: 'The DPoS blockchain framework behind BitShares, Steem, Hive, BLURT — and MELEK.',
    body: `<p>Graphene is the C++ blockchain toolkit first built for BitShares and later powering Steem, Hive,
      and BLURT. It is known for <b>fast, fee-less-feeling transactions</b> (resources are rate-limited rather
      than per-tx priced) and <b>Delegated Proof of Stake (DPoS)</b>: stakeholders vote for a small set of
      <em>witnesses</em> who produce blocks in turn.</p>
      <p>MELEK is a Graphene chain. Its accounts, posts, votes, and transfers are standard Graphene operations —
      no custom op is added for the AI Witness. That is deliberate: standard operations keep the chain forkable
      and the Witness an ordinary account that happens to be run well.</p>`,
  },
  'how-witnesses-work': {
    title: 'How blockchain witnesses work',
    summary: 'Block producers elected by stake — the DPoS heartbeat of a Graphene chain.',
    body: `<p>On a DPoS chain, <b>witnesses</b> (called validators or block producers elsewhere) take turns signing
      blocks. Stakeholders vote for them; the top-voted set produces blocks in a round-robin, and the rest stand by.
      Witnesses also publish a price feed used by the chain.</p>
      <p>Run one badly — miss blocks, publish a stale feed — and votes drain to someone else. It is a continuous,
      stake-weighted election. A witness is judged on reliability and contribution, which is exactly the kind of
      observable, on-chain behavior SoapBox's Clarity Score is built to read.</p>`,
  },
  'how-the-clarity-score-is-computed': {
    title: 'How the Clarity Score is computed',
    summary: 'Four observable inputs — distribution, supply, contract powers, activity — never points.',
    body: `<p>The Clarity Score (0–100) measures how <b>transparent and verifiable</b> a project is, from facts
      anyone can check on-chain. It is never bought, never gifted between users — that is what rotted points
      systems like Bitcointalk Merit. The four inputs:</p>
      <ul>
        <li><b>Holder distribution</b> — is ownership spread across real outside holders, or concentrated in the issuer/whales?</li>
        <li><b>Supply locks</b> — is there a finite, published max supply, or open minting headroom?</li>
        <li><b>Contract behavior</b> — what powers does the issuer retain (mint authority, stake gates)?</li>
        <li><b>Activity</b> — is there real, sustained market activity (weighted to resist wash trading)?</li>
      </ul>
      <p>A low score means <b>opaque</b> — a fact — not "scam," a judgment. The page's right-of-reply comments
      let a project respond to whatever the number reflects.</p>`,
  },
  'burn-to-feature': {
    title: 'Burn-to-feature, explained',
    summary: 'Premium placement by burning ecosystem tokens — deflationary and aligned, not pay-to-play.',
    body: `<p>CoinMarketCap sells placement for dollars. SoapBox uses <b>burn-to-feature</b>: a project burns
      ecosystem tokens to feature a listing. The tokens are destroyed, not paid to us — so featuring is
      <b>deflationary</b> (it reduces supply), <b>aligned</b> (only people invested in the ecosystem do it), and
      <b>transparent</b> (the burn is on-chain).</p>
      <p>It never buys a better Clarity Score or silences a comment. Featuring affects placement only; the facts on
      the page stay the facts.</p>`,
  },
  'do-your-own-research': {
    title: 'Do your own research (DYOR)',
    summary: 'A practical checklist for reading a token from facts before you ever touch the price.',
    body: `<p>Before trusting any listing — here or anywhere — check the things that can't be faked:</p>
      <ul>
        <li><b>Who holds it?</b> Look at the holder distribution. Concentrated supply is a standing risk.</li>
        <li><b>Can they print more?</b> Find the max supply and mint authority.</li>
        <li><b>Is the volume real?</b> Few participants + high "volume" = likely wash trading.</li>
        <li><b>Can the team answer?</b> Read the right-of-reply comments. Silence under fair questions is a signal.</li>
        <li><b>What's the Clarity Score telling you?</b> Low = opaque. Read <em>why</em> in the breakdown, don't stop at the number.</li>
      </ul>
      <p>No single signal proves anything. Read several together, and weight facts over hype.</p>`,
  },
};
