// backlink-targets.mjs — curated catalog of places to LIST / SUBMIT the SoapBox sites for
// legitimate backlinks + organic discovery (task #116).
//
// Context: we run five live subdomains under soapbox.community —
//   data.       → CMC-style crypto market-data aggregator (the flagship)
//   search.     → on-chain / condenser search
//   directory.  → API + resource directory
//   wiki.       → knowledge wiki
//   stocks.     → equities / multi-asset markets
// We want organic traffic and white-hat backlinks. This file is a STRUCTURED INDEX of
// submission targets — NOT an automation that submits anything. Submitting is a human,
// account-bound act (most of these need a real account, a CAPTCHA, or editor review, and
// several have explicit no-marketing-bot rules). The bots use this catalog to PRIORITIZE
// and to remember what each target needs; a person does the actual submission.
//
// Hard rules honored here:
//   • White-hat only. No link farms, no paid-link networks, no PBNs, no comment spam.
//     Forum "targets" below are for ORGANIC, on-topic participation — earn the mention,
//     never drive-by drop a link (every listed forum bans that and it backfires on SEO).
//   • Free-first. `cost` is 'free' unless a paid tier is the only realistic path.
//   • No secrets. No accounts, tokens, or host details in this file.
//
// Each entry:
//   { name, url, type, howToSubmit, cost, value, note }
//     type        : one of TYPES below.
//     howToSubmit : the concrete action a human takes (the form, the PR, the post).
//     cost        : 'free' | 'paid'  ('paid' = a fee is the only/primary path; free entries
//                   may still have an optional paid fast-track — noted in `note`).
//     value       : 'high' | 'medium' | 'low' — discovery + backlink value for OUR kind of
//                   site (a free crypto/markets DATA product, not a token).
//     note        : caveats, eligibility, fast-track pricing, which subdomain it best fits.
//
// URLs are canonical landing/submission pages, verified to resolve mid-2026. Some hosts
// (Zendesk help-desks, Reddit, Product Hunt) bot-block raw curl with 403 but are live in a
// browser — that's expected and fine, since a human submits anyway.

export const TYPES = [
  'crypto-directory', // crypto-native data aggregators / link hubs (best topical fit)
  'dev-data-directory', // product / SaaS / API discovery sites + GitHub awesome lists
  'web-directory', // general human-edited web directories
  'crypto-forum', // crypto communities for ORGANIC, on-topic mentions (not drops)
];

export const SUBMISSION_TARGETS = [
  // ── CRYPTO DIRECTORIES ───────────────────────────────────────────────────────────────────
  {
    name: 'CoinGecko',
    url: 'https://www.coingecko.com/en/request-form',
    type: 'crypto-directory',
    howToSubmit:
      'Use the CoinGecko Request Form. For a data SITE (not a token), pick the partnership / data-source / "other" path and describe data.soapbox.community as a market-data aggregator; the same support portal (support.coingecko.com → Submit a request) handles non-token submissions. Free; editor-reviewed.',
    cost: 'free',
    value: 'high',
    note: 'Highest-authority crypto domain. Token-listing flow is separate and N/A for us — aim at data-partnership / "request a feature/source". Fits data. + stocks. Review ~5 business days.',
  },
  {
    name: 'CoinMarketCap',
    url: 'https://coinmarketcap.com/request/',
    type: 'crypto-directory',
    howToSubmit:
      'coinmarketcap.com/request/ redirects to the CMC support request form (support.coinmarketcap.com/hc/en-us/requests/new). Choose a non-token request type (data/partnership/general) and pitch the aggregator. Free.',
    cost: 'free',
    value: 'high',
    note: 'Co-flagship with CoinGecko. The dropdown is token-centric; use the general/data path. Optional paid fast-track exists for token listings (irrelevant to us). Fits data.',
  },
  {
    name: 'DefiLlama',
    url: 'https://defillama.com/',
    type: 'crypto-directory',
    howToSubmit:
      'DefiLlama is open-source and community-curated via GitHub (github.com/DefiLlama/DefiLlama-Adapters and the defillama-server repos). Add our chain/aggregator by PR per their listing docs, or open an issue. Free.',
    cost: 'free',
    value: 'high',
    note: 'PR-driven, no marketing gatekeeper — the cleanest high-authority backlink if we have an adapter to contribute. Best fit for data. + on-chain MELEK/Hive-Engine metrics.',
  },
  {
    name: 'CryptoLinks',
    url: 'https://cryptolinks.com/',
    type: 'crypto-directory',
    howToSubmit:
      'Human-edited "best crypto sites" hub organized by category. Use their Submit / contact path to suggest data.soapbox.community under the data/tools/research category. Free; editorial review.',
    cost: 'free',
    value: 'medium',
    note: 'Curated, plain-English notes per site — a genuine discovery hub, not a link farm. Good topical relevance. Fits data. + directory.',
  },
  {
    name: 'CryptoCompare',
    url: 'https://www.cryptocompare.com/',
    type: 'crypto-directory',
    howToSubmit:
      'Reach out via their site/data-partner contact to be listed as a data source / partner. No public self-serve directory form — relationship/email based. Free to ask.',
    cost: 'free',
    value: 'medium',
    note: 'Authoritative data brand (now part of CCData). Listing is partnership-style, slower. Fits data.',
  },
  {
    name: 'Alternative.me',
    url: 'https://www.alternative.me/',
    type: 'crypto-directory',
    howToSubmit:
      'Crypto software/site comparison directory (also runs the Fear & Greed index). Submit our site as an alternative in the relevant crypto-data category via their add/submit flow. Free.',
    cost: 'free',
    value: 'medium',
    note: 'Comparison-style listing; pairs well since we already consume their F&G API. Fits data.',
  },
  {
    name: 'CoinDir',
    url: 'https://coindir.com/',
    type: 'crypto-directory',
    howToSubmit:
      'Crypto project/tool directory — submit the site via their add-listing form under tools/data. Free tier; verify whether a featured upgrade is paid.',
    cost: 'free',
    value: 'low',
    note: 'Lower authority; cheap baseline listing. Confirm it is not link-farm-y before submitting (skip if it looks like a paid-link mill).',
  },

  // ── DEV / DATA / PRODUCT DIRECTORIES ───────────────────────────────────────────────────────
  {
    name: 'Product Hunt',
    url: 'https://www.producthunt.com/',
    type: 'dev-data-directory',
    howToSubmit:
      'Create a maker account and "Submit" the product with tagline, gallery, and a link to data.soapbox.community. Best done as a coordinated launch-day post. Free.',
    cost: 'free',
    value: 'high',
    note: 'Big one-day traffic + a durable dofollow-ish profile + downstream pickups. Launch ALL five subdomains as one product ("SoapBox"). Plan the day; engage in comments. Fits the whole suite.',
  },
  {
    name: 'BetaList',
    url: 'https://betalist.com/submit',
    type: 'dev-data-directory',
    howToSubmit:
      'Submit via betalist.com/submit. Free track has a multi-week queue; $129 fast-track jumps it. Best framed as early-stage / beta. Free (paid optional).',
    cost: 'free',
    value: 'medium',
    note: 'Early-adopter audience + backlink. Use the free queue. Fits data. as the headline product.',
  },
  {
    name: 'SaaSHub',
    url: 'https://www.saashub.com/submit',
    type: 'dev-data-directory',
    howToSubmit:
      'Free submit form at saashub.com/submit — add the product, category (crypto/finance/data tools), description, and link. Free.',
    cost: 'free',
    value: 'medium',
    note: 'Software discovery + comparison; clean free listing, decent domain authority. Fits directory. + data.',
  },
  {
    name: 'AlternativeTo',
    url: 'https://alternativeto.net/',
    type: 'dev-data-directory',
    howToSubmit:
      'Add SoapBox as an "alternative to" CoinMarketCap / CoinGecko / TradingView in the relevant category (account required, community-moderated). Free.',
    cost: 'free',
    value: 'high',
    note: 'Large, high-authority comparison platform; positioning as an alternative to CMC/CoinGecko is exactly our pitch. Fits data. + stocks.',
  },
  {
    name: 'public-apis (GitHub)',
    url: 'https://github.com/public-apis/public-apis',
    type: 'dev-data-directory',
    howToSubmit:
      'Fork, add ONE API per PR alphabetically under the right category, ≤100-char description, title "Add SoapBox API", target master; the CI link-checker must pass. Only if directory./data. exposes a genuinely FREE public read API.',
    cost: 'free',
    value: 'high',
    note: 'Massive-star awesome-list = strong backlink + real dev traffic. STRICT rule: no marketing / paid-solution PRs — the API must be genuinely free & public, or it is rejected. Gate this on our read API being live & free.',
  },
  {
    name: 'awesome-* lists (GitHub)',
    url: 'https://github.com/topics/awesome',
    type: 'dev-data-directory',
    howToSubmit:
      'Target topical curated lists (awesome-crypto, awesome-bitcoin, awesome-blockchain, awesome-hive, awesome-cryptocurrency). Open a PR adding our site under the right section per each list\'s CONTRIBUTING rules. Free.',
    cost: 'free',
    value: 'medium',
    note: 'Per-list editorial bar varies; on-topic, non-spam additions are usually accepted. Spread across several lists over time, one PR each.',
  },
  {
    name: 'StackShare',
    url: 'https://stackshare.io/',
    type: 'dev-data-directory',
    howToSubmit:
      'Add SoapBox as a tool/service in the relevant stack categories (data, crypto, APIs). Account required. Free.',
    cost: 'free',
    value: 'low',
    note: 'Dev-tool discovery; modest but legitimate. Fits directory.',
  },
  {
    name: 'Hacker News (Show HN)',
    url: 'https://news.ycombinator.com/showhn.html',
    type: 'dev-data-directory',
    howToSubmit:
      'Post a "Show HN: SoapBox — a CMC-style crypto + markets aggregator" with the link, then engage candidly in comments. Read the Show HN guidelines first. Free.',
    cost: 'free',
    value: 'medium',
    note: 'Not a directory but a high-signal discovery surface; one good Show HN can drive real traffic + secondary backlinks. nofollow link, but the referral + pickup value is real. One shot — make it count.',
  },

  // ── WEB DIRECTORIES ──────────────────────────────────────────────────────────────────────
  {
    name: 'Curlie',
    url: 'https://curlie.org/docs/en/add.html',
    type: 'web-directory',
    howToSubmit:
      'Find the most specific open category (Business/Financial_Services or Computers/Internet), use "Suggest a Site" when the category accepts suggestions, submit URL + a neutral, non-promotional description. Free; volunteer-editor review.',
    cost: 'free',
    value: 'medium',
    note: 'The DMOZ successor — durable, human-edited, still referenced. Highly selective and slow; description must be factual, not salesy. Fits data. (or directory.).',
  },
  {
    name: 'Best of the Web (BOTW)',
    url: 'https://botw.org/',
    type: 'web-directory',
    howToSubmit:
      'Submit the site to the most specific Business/Finance category via their add-a-site flow. One of the oldest paid human-edited directories; a listing is reviewed for quality. Paid.',
    cost: 'paid',
    value: 'medium',
    note: 'Long-established, trusted general directory (good for E-E-A-T signals). Annual/one-time fee. Only worth it once the suite is stable. Fits data. + directory.',
  },
  {
    name: 'Jasmine Directory',
    url: 'https://www.jasminedirectory.com/',
    type: 'web-directory',
    howToSubmit:
      'Add the site under Finance > Cryptocurrency (or Computers > Internet > Web Services) via their submit form; editor-reviewed. Has a free tier with a slow queue and a paid express review.',
    cost: 'free',
    value: 'low',
    note: 'Human-edited general directory; modest authority. Use the free queue; factual description only. Fits directory.',
  },

  // ── ADDITIONAL DEV / PRODUCT + AI-DISCOVERY DIRECTORIES ──────────────────────────────────────
  {
    name: 'There\'s An AI For That',
    url: 'https://theresanaiforthat.com/submit/',
    type: 'dev-data-directory',
    howToSubmit:
      'Submit via their /submit form if/when we surface an AI-facing feature (the Hathor assistant, the translate tool, AI-readable data API). Free tier + paid fast-track. Free.',
    cost: 'free',
    value: 'medium',
    note: 'Large AI-tool discovery hub. Best fit for search. (translate) + any Hathor/AI surface, NOT the raw market data. Only submit a genuinely AI-flavored feature, or it gets rejected.',
  },
  {
    name: 'Indie Hackers',
    url: 'https://www.indiehackers.com/',
    type: 'dev-data-directory',
    howToSubmit:
      'Post a product/build update in the relevant group and link naturally; build a profile for the product. Community-driven, not a form-submit directory. Free.',
    cost: 'free',
    value: 'low',
    note: 'Referral + community discovery, nofollow links. Earn-the-mention rule applies. Fits the whole suite as a "built in public" story.',
  },
  {
    name: 'awesome-hive / Hive ecosystem lists (GitHub)',
    url: 'https://github.com/search?q=awesome+hive+blockchain',
    type: 'dev-data-directory',
    howToSubmit:
      'Open a PR adding the SoapBox sites to curated Hive/Graphene ecosystem lists and the Hive ecosystem pages, since MELEK is a Graphene/Hive-family chain and we index condenser data. Per each list\'s CONTRIBUTING rules. Free.',
    cost: 'free',
    value: 'medium',
    note: 'Topical, home-ecosystem fit — durable backlinks from Hive-adjacent curated lists. Pair with the Hive/PeakD post below. Fits search. + wiki. + data.',
  },

  // ── CRYPTO FORUMS (organic mentions only — NEVER drop-and-run) ─────────────────────────────
  {
    name: 'Bitcointalk',
    url: 'https://bitcointalk.org/index.php?board=159.0',
    type: 'crypto-forum',
    howToSubmit:
      'Build account standing first, then post in the relevant board (Service Announcements / Altcoin Announcements) introducing the tool, and link naturally where it genuinely helps a thread. Earn it; do not spam. Free.',
    cost: 'free',
    value: 'medium',
    note: 'Oldest/largest crypto forum. Signatures + on-topic posts carry weight; low-effort link drops get flagged and hurt us. Long-game.',
  },
  {
    name: 'Altcoinstalks',
    url: 'https://www.altcoinstalks.com/index.php?board=21.0',
    type: 'crypto-forum',
    howToSubmit:
      'Post a project/tool announcement in the [ANN] board and participate genuinely. Account-bound; same earn-the-mention rule. Free.',
    cost: 'free',
    value: 'low',
    note: 'Smaller Bitcointalk-style forum; lower authority but easy on-topic ANN thread for data./directory.',
  },
  {
    name: 'r/CryptoCurrency (Reddit)',
    url: 'https://www.reddit.com/r/CryptoCurrency/',
    type: 'crypto-forum',
    howToSubmit:
      'Participate first; share the tool only where on-topic and where the subreddit\'s self-promotion rules allow (and consider r/CryptoTechnology, r/defi). Links are nofollow but drive real referral traffic + discovery. Free.',
    cost: 'free',
    value: 'medium',
    note: 'Strict self-promo / 9:1 rules — contribute value or get removed. Best as helpful answers, not posts. Referral, not link-juice.',
  },
  {
    name: 'Hive / PeakD',
    url: 'https://peakd.com/',
    type: 'crypto-forum',
    howToSubmit:
      'Publish a post (via PeakD or hive.blog) introducing the SoapBox sites to the Hive community — this is OUR home ecosystem (MELEK is a Graphene/Hive-family chain). On-chain content + outbound links. Free.',
    cost: 'free',
    value: 'high',
    note: 'Home-turf, friendly audience, and the links live on-chain (durable). Natural fit since we already index Hive/condenser data. Use our own handles. Fits all subdomains, especially search. + wiki.',
  },
];

// ── Query helpers ─────────────────────────────────────────────────────────────────────────

/** All targets of a given type (see TYPES). Throws on an unknown type to fail loud. */
export function byType(type) {
  if (!TYPES.includes(type)) {
    throw new Error(`Unknown target type "${type}". Known: ${TYPES.join(', ')}`);
  }
  return SUBMISSION_TARGETS.filter((t) => t.type === type);
}

/** Only the free targets (cost === 'free'). The default working set — start here. */
export function free() {
  return SUBMISSION_TARGETS.filter((t) => t.cost === 'free');
}

/** Convenience: counts by type + cost, for the catalog page / status reporting. */
export function summary() {
  const out = { total: SUBMISSION_TARGETS.length, free: free().length, byType: {} };
  for (const type of TYPES) out.byType[type] = byType(type).length;
  return out;
}

// ── Per-subdomain fit ───────────────────────────────────────────────────────────────────────
// The five live subdomains. A target "fits" a subdomain when its name appears in the entry's `note`
// (the prose already says e.g. "Fits data. + stocks."). This keeps the fit hints in one place (the
// note) instead of duplicating a tags array per entry. `forSubdomain()` reads them out.
export const SUBDOMAINS = ['data', 'search', 'directory', 'wiki', 'stocks'];

/**
 * Targets that best fit a given subdomain, ranked free-first then by value (high→low). Reads the
 * "data." / "search." / etc. mentions in each target's `note`. A few generic targets (Product Hunt,
 * Hacker News, Hive/PeakD) say "the whole suite"/"all subdomains" and fit every subdomain.
 * @param {string} sub - one of SUBDOMAINS.
 */
export function forSubdomain(sub) {
  if (!SUBDOMAINS.includes(sub)) {
    throw new Error(`Unknown subdomain "${sub}". Known: ${SUBDOMAINS.join(', ')}`);
  }
  const rank = { high: 0, medium: 1, low: 2 };
  const wholeSuite = /\b(whole suite|all subdomains|the suite)\b/i;
  return SUBMISSION_TARGETS
    .filter((t) => {
      const note = t.note || '';
      return wholeSuite.test(note) || new RegExp(`\\b${sub}\\.`, 'i').test(note);
    })
    .sort((a, b) => (a.cost === b.cost ? 0 : a.cost === 'free' ? -1 : 1) || (rank[a.value] - rank[b.value]));
}

// ── CLI ── node backlink-targets.mjs [list|free|summary|sub <name>|type <name>]
if (process.argv[1] && process.argv[1].endsWith('backlink-targets.mjs')) {
  const [, , cmd = 'summary', arg] = process.argv;
  const fmt = (t) => `• ${t.name}  [${t.type} · ${t.cost} · ${t.value}]\n  ${t.url}\n  ${t.howToSubmit}`;
  if (cmd === 'summary') {
    console.log(JSON.stringify(summary(), null, 2));
  } else if (cmd === 'list') {
    console.log(SUBMISSION_TARGETS.map(fmt).join('\n\n'));
  } else if (cmd === 'free') {
    console.log(free().map(fmt).join('\n\n'));
  } else if (cmd === 'type') {
    console.log(byType(arg).map(fmt).join('\n\n'));
  } else if (cmd === 'sub') {
    console.log(forSubdomain(arg).map(fmt).join('\n\n'));
  } else {
    console.log(`usage: node backlink-targets.mjs [summary|list|free|type <type>|sub <subdomain>]
  types:      ${TYPES.join(', ')}
  subdomains: ${SUBDOMAINS.join(', ')}
This is a READ-ONLY catalog — it never submits anything (submission is a human, account-bound act).`);
  }
}
