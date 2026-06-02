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
    { name: 'MELEK', kind: 'Graphene chain', role: 'The witness chain. Hathor is a founding witness account on it.' },
    { name: 'SOAP', kind: 'Graphene chain', role: 'A BitShares/Graphene-based chain in the ecosystem.' },
    { name: 'PRANA', kind: 'EVM value/compute chain', role: 'The wallet + DeFi + useful-work compute layer (Phase 2).' },
    { name: 'VKBT / CURE', kind: 'Hive-Engine tokens', role: 'First-party tokens with real holder distribution and a computed Clarity Score.' },
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
};
