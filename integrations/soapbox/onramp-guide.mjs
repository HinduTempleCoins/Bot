// onramp-guide.mjs — "Americans into crypto" on-ramp + free-education guide (task #178).
//
// ─────────────────────────────────────────────────────────────────────────────────────────
//  WE OPERATE FROM THE US.  This guide is US-JURISDICTION-GATED ON PURPOSE.
// ─────────────────────────────────────────────────────────────────────────────────────────
//  Every on-ramp listed here is one a US person can legally use today (cross-checked against
//  markets-catalog `usFriendly('crypto')`, which is the us:'full' | us:'partial' set). Listing
//  only US-usable venues is deliberate, not an oversight: a US-resident reader who follows a
//  link should land somewhere they can actually open an account. Non-US venues live in the
//  catalog for the wider project; they are intentionally absent here.
//
//  This module is CONTENT / EDUCATION — informational only, NOT financial advice. It is a
//  structured, teachable corpus the MELEK AI-bots (a Learn page, or Hathor in conversation)
//  can read out: "here is how an American starts in crypto at low or zero cost." Pure data +
//  helpers; no live calls at module load. Regulatory status and program availability move —
//  treat this as a starting point and re-verify before acting.
//
//  Knowledge snapshot: mid-2026. Notable moving parts already folded in:
//   • Coinbase's original "Learn & Earn" (watch-a-video-earn-a-token) was retired May 2025.
//     The live Coinbase earn-for-learning paths are now Wallet Quests; the watch-and-earn
//     model lives on at CoinMarketCap Earn and Binance (US) Learn & Earn campaigns.

import { usFriendly } from './markets-catalog.mjs';

// ── 1. US_EXCHANGES — US-usable fiat on-ramps ───────────────────────────────────────────────
// The places an American can convert USD → crypto. Grounded against the catalog below (every
// entry here must also be us:'full'|'partial' in markets-catalog) so we never point a US reader
// at a venue that blocks them. `custodial: true` = the exchange holds your keys/coins; you do
// not control the private key until you withdraw to your own wallet.
export const US_EXCHANGES = [
  {
    name: 'Coinbase',
    url: 'https://www.coinbase.com',
    note: 'US-headquartered, Nasdaq-listed; the default beginner on-ramp. Higher fees, easiest UX.',
    custodial: true,
    goodFor: 'first-timers — buy with a card/bank, simplest path from $0 knowledge to owning crypto.',
  },
  {
    name: 'Kraken',
    url: 'https://www.kraken.com',
    note: 'Long-running US exchange; lower fees than Coinbase. Not available in NY or ME; some products state-gated.',
    custodial: true,
    goodFor: 'cost-conscious beginners and intermediate traders who want cheaper fees.',
  },
  {
    name: 'Gemini',
    url: 'https://www.gemini.com',
    note: 'NY-regulated (NYDFS trust); security-first reputation. Carries some asset insurance.',
    custodial: true,
    goodFor: 'users who prioritize regulatory clarity and custody safety.',
  },
  {
    name: 'Crypto.com',
    url: 'https://crypto.com',
    note: 'US app + exchange; competitive fees, broad app features. US product set narrower than global.',
    custodial: true,
    goodFor: 'mobile-first users who want one app for buying, spending (card), and staking.',
  },
  {
    name: 'Binance.US',
    url: 'https://www.binance.us',
    note: 'Separate US entity from global Binance (which BLOCKS US persons). Low fees but blocked in ~12 states; rails have been restricted at times.',
    custodial: true,
    goodFor: 'low-fee trading IF available in your state — check first.',
  },
  {
    name: 'River',
    url: 'https://river.com',
    note: 'US Bitcoin-only brokerage; clean, BTC-focused, recurring-buy friendly.',
    custodial: true,
    goodFor: 'people who only want Bitcoin and value a focused, no-altcoin experience.',
  },
  {
    name: 'Cash App',
    url: 'https://cash.app',
    note: 'Consumer payments app (Block); buy/sell BTC + Lightning withdrawals. Likely already installed.',
    custodial: true,
    goodFor: 'the absolute easiest first BTC purchase — no new account if you already use Cash App.',
  },
  {
    name: 'Bitstamp',
    url: 'https://www.bitstamp.net',
    note: 'One of the oldest exchanges; US-supported (Robinhood-owned).',
    custodial: true,
    goodFor: 'users wanting a long-track-record venue.',
  },
  {
    name: 'Robinhood Crypto',
    url: 'https://robinhood.com/crypto',
    note: 'US broker app; crypto alongside stocks. Withdrawals historically limited; product gating by state.',
    custodial: true,
    goodFor: 'people already using Robinhood for stocks who want crypto in the same app.',
  },
];

// ── 2. FREE_EDUCATION — earn-while-you-learn + free resources ────────────────────────────────
// Where an American learns crypto for $0 (and sometimes gets PAID a few dollars of crypto to do
// it). `whatYouGet` says plainly what the reader walks away with.
export const FREE_EDUCATION = [
  {
    name: 'Coinbase Learn',
    url: 'https://www.coinbase.com/learn',
    whatYouGet: 'Free written guides + tutorials covering wallets, keys, common coins, and safety. No purchase needed.',
  },
  {
    name: 'Coinbase Wallet Quests',
    url: 'https://www.coinbase.com/wallet/quests',
    whatYouGet: 'Earn small crypto/NFT rewards for completing real on-chain tasks (swap, stake, mint) in the self-custody Coinbase Wallet. This replaced the old watch-a-video "Learn & Earn," which Coinbase retired in May 2025.',
  },
  {
    name: 'CoinMarketCap Earn',
    url: 'https://coinmarketcap.com/earn/',
    whatYouGet: 'The classic watch-short-video / pass-a-quiz → earn-a-few-dollars-of-the-token model. Live in 2026; rewards are small and campaign-based.',
  },
  {
    name: 'Binance.US Learn & Earn',
    url: 'https://www.binance.us/blog',
    whatYouGet: 'Limited-time learn-and-earn campaigns (US entity); complete a lesson + quiz, earn a token allocation. Availability varies by state and campaign.',
  },
  {
    name: 'Binance Academy',
    url: 'https://academy.binance.com',
    whatYouGet: 'The deepest free library: 400+ articles, videos, and interactive modules, beginner → advanced. No account or purchase needed (education site, distinct from the exchange).',
  },
  {
    name: 'Kraken Learn',
    url: 'https://www.kraken.com/learn',
    whatYouGet: 'Free, security-focused long-form guides and glossaries; strong on "how not to lose your coins."',
  },
  {
    name: 'freeCodeCamp',
    url: 'https://www.freecodecamp.org/news/tag/blockchain/',
    whatYouGet: 'Free, ad-free developer tutorials on blockchain, Solidity, and Web3 — for readers who want to BUILD, not just buy.',
  },
  {
    name: 'Investopedia — Cryptocurrency',
    url: 'https://www.investopedia.com/cryptocurrency-4427699',
    whatYouGet: 'Neutral, vendor-agnostic explainers of terms and concepts; good for sanity-checking what an exchange tells you.',
  },
  {
    name: 'Airdrops & faucets (CAUTION)',
    url: 'https://academy.binance.com/en/articles/what-is-a-crypto-airdrop',
    whatYouGet: 'Free tokens exist (airdrops, faucets) but this space is THICK with scams. Never connect a wallet holding funds, never pay a fee or share a seed phrase to "claim." Treat any free-token offer as guilty until proven safe.',
  },
];

// ── 3. ZERO_COST_PATHS — the $0 ways to start (no money in) ──────────────────────────────────
// You do NOT need to deposit a dollar to begin. MELEK's own model is first and prominent: on a
// Graphene social chain you earn crypto by CONTRIBUTING (posting, voting, curating), not by
// buying in. That is the genuinely-$0 on-ramp this project owns end to end.
export const ZERO_COST_PATHS = [
  {
    name: 'MELEK — earn by blogging, voting & curating (no money in)',
    url: 'https://soapbox.community',
    note: 'On MELEK you earn crypto by POSTING and VOTING — $0 to start. Write a post, vote on others, curate good content, and the chain rewards you in its native token. No card, no bank deposit, no "buy-in." This is the on-ramp MELEK itself provides, and the one the AI-bots can walk a newcomer through directly.',
    flagship: true,
  },
  {
    name: 'Learn-and-earn rewards',
    url: 'https://coinmarketcap.com/earn/',
    note: 'Get paid small amounts of crypto to learn: CoinMarketCap Earn, Binance.US Learn & Earn campaigns, Coinbase Wallet Quests. Your first crypto can literally come from finishing a lesson.',
  },
  {
    name: 'Testnet faucets (for devs)',
    url: 'https://www.alchemy.com/faucets',
    note: 'Developers get FREE test-network coins (e.g. Sepolia/Holesky ETH) from faucets to build and experiment. Test coins have no real value — they are for learning to send transactions and write contracts at zero risk.',
  },
  {
    name: 'Free education (no purchase)',
    url: 'https://academy.binance.com',
    note: 'Binance Academy, Coinbase Learn, Kraken Learn, freeCodeCamp — understand the whole space before spending a cent.',
  },
];

// ── 4. STEPS — plain-English getting-started sequence ───────────────────────────────────────
// Ordered so the cheapest/lowest-commitment moves come first. A Learn page or Hathor can read
// these out as a numbered walkthrough.
export const STEPS = [
  {
    step: 1,
    title: 'Learn the basics for free first',
    detail: 'Spend an hour on Binance Academy or Coinbase Learn. Understand three words: wallet, private key, seed phrase. Anyone who asks for your seed phrase is stealing from you — full stop.',
  },
  {
    step: 2,
    title: 'Try MELEK\'s earn-by-posting — $0, no deposit',
    detail: 'Before spending any money, earn your first crypto by contributing: write a post and vote on MELEK. This is the no-money-in on-ramp, and the AI-bots can guide you through it step by step.',
  },
  {
    step: 3,
    title: 'Get free crypto by learning',
    detail: 'Use CoinMarketCap Earn or a Coinbase Wallet Quest to pick up a few dollars of crypto for finishing short lessons. (The old Coinbase watch-and-earn was retired in 2025 — these are the live replacements.)',
  },
  {
    step: 4,
    title: 'Pick a US exchange and verify your identity',
    detail: 'Choose a US-legal on-ramp (Coinbase = easiest, Kraken/Crypto.com = cheaper fees, River/Cash App = Bitcoin-only). Sign up and complete KYC (ID verification) — required by US law. Confirm it operates in YOUR state.',
  },
  {
    step: 5,
    title: 'Buy a small amount with money you can afford to lose',
    detail: 'Start tiny. A first $10–$25 buy teaches you the whole flow with negligible risk. Crypto is volatile; never spend rent or emergency savings.',
  },
  {
    step: 6,
    title: 'Learn self-custody (your own wallet)',
    detail: 'An exchange holds your coins (custodial) until you move them. Set up a self-custody wallet, write the seed phrase on paper (never a photo, never the cloud), and practice a small withdrawal. "Not your keys, not your coins."',
  },
  {
    step: 7,
    title: 'Keep contributing on MELEK',
    detail: 'Come back to the chain: post, vote, curate. It is the one place in this guide where you earn by giving rather than buying — and where the MELEK AI-bots can keep teaching you as you go.',
  },
];

// One-paragraph framing the bots can open or close with.
export const STORY =
  'Getting into crypto as an American does not require money up front, only a little learning. ' +
  'Start free: read Binance Academy or Coinbase Learn, then earn your very first crypto by ' +
  'POSTING and VOTING on MELEK — $0 in, you earn by contributing. Pick up a few more dollars ' +
  'through learn-and-earn lessons (CoinMarketCap Earn, Coinbase Wallet Quests). Only then, if you ' +
  'want more, open an account at a US-legal exchange (Coinbase for ease, Kraken or Crypto.com for ' +
  'lower fees, River or Cash App for Bitcoin only), verify your identity, and buy a small amount ' +
  'you can afford to lose. Finally, learn self-custody so you truly own your coins. This is ' +
  'education, not financial advice — the goal is to start safely, cheaply, and informed.';

// ── 5. guide() — the assembled, teachable structure ─────────────────────────────────────────
// Returns everything a Learn page / Hathor needs to teach the on-ramp, plus a cross-check that
// every listed US exchange is genuinely in the catalog's us:'full'|'partial' crypto set.
export function guide() {
  const catalogUsFriendly = new Set(usFriendly('crypto').map((e) => e.name));
  const verifiedUsExchanges = US_EXCHANGES.map((x) => ({
    ...x,
    // true when the catalog independently confirms this venue is US-usable for crypto.
    catalogUsConfirmed: catalogUsFriendly.has(x.name),
  }));
  const unverified = verifiedUsExchanges.filter((x) => !x.catalogUsConfirmed).map((x) => x.name);

  return {
    story: STORY,
    disclaimer: 'Informational / educational only. NOT financial advice. US-jurisdiction-gated by design. Re-verify availability and program status before acting.',
    usExchanges: verifiedUsExchanges,
    freeEducation: FREE_EDUCATION,
    zeroCostPaths: ZERO_COST_PATHS,
    steps: STEPS,
    meta: {
      usExchangeCount: US_EXCHANGES.length,
      catalogUsFriendlyCryptoCount: catalogUsFriendly.size,
      // Names listed here but NOT confirmed US-friendly by the catalog (should be empty).
      unverifiedAgainstCatalog: unverified,
      flagshipZeroCostPath: ZERO_COST_PATHS.find((p) => p.flagship)?.name ?? null,
    },
  };
}

// CLI summary:  node integrations/soapbox/onramp-guide.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const g = guide();
  console.log('\nMELEK — Americans into crypto: on-ramp + free-education guide');
  console.log('─'.repeat(64));
  console.log(g.story);
  console.log('─'.repeat(64));
  console.log(`US exchanges listed: ${g.meta.usExchangeCount}`);
  console.log(`Catalog US-friendly crypto venues: ${g.meta.catalogUsFriendlyCryptoCount}`);
  console.log(`Unverified against catalog: ${g.meta.unverifiedAgainstCatalog.length ? g.meta.unverifiedAgainstCatalog.join(', ') : 'none ✓'}`);
  console.log(`Flagship $0 path: ${g.meta.flagshipZeroCostPath}`);
  console.log('─'.repeat(64));
  for (const x of g.usExchanges) {
    console.log(`  ${x.catalogUsConfirmed ? '✓' : '✗'} ${x.name.padEnd(18)} ${x.goodFor}`);
  }
  console.log('─'.repeat(64));
  console.log(`Free-education sources: ${g.freeEducation.length}`);
  console.log(`Zero-cost paths: ${g.zeroCostPaths.length}  (flagship: MELEK earn-by-posting)`);
  console.log(`Steps: ${g.steps.length}`);
  console.log('\nInformational / educational only — NOT financial advice.\n');
}
