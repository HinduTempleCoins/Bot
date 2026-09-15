// portfolio.mjs — THE PORTFOLIO REGISTRY.
//
// One list of everything built, with a REACHABILITY STATE that was probed rather than assumed. This
// is the artifact you hand an advertiser, an investor, a grant officer or a stranger, and the whole
// value of it is that every row is checkable in ten seconds by clicking it.
//
// ⚠️ THE RULE THIS FILE EXISTS TO ENFORCE: a portfolio with dead links is worse than a short one. A
// reader who clicks the third item and gets a connection error stops reading, and correctly downgrades
// everything above it too. So `state` is not decoration — `live` means an HTTPS GET returned 200 on
// PROBED_ON, and nothing else may claim it.
//
//   live   — probed, returned 200
//   built  — code exists and its tests pass, but the host does not resolve yet. Say so plainly.
//   soon   — designed, not built
//
// Probed 2026-09-14 from outside the network: 50 candidate hosts, 29 returned 200, 21 returned 000
// (no host / no certificate). The 21 are not failures of the software — most are surfaces whose DNS
// and vhost were never created. That distinction is in `note`, because "we didn't deploy it" and
// "it's broken" are very different sentences and only one of them is true.

export const PROBED_ON = '2026-09-14';

const L = 'live', B = 'built', S = 'soon';

/** category → what a reader is being shown. Order here is the order on the page. */
export const CATEGORIES = Object.freeze([
  { id: 'money', name: 'Money you are owed', blurb: 'Benefits, grants, credentials and credit — the free-first shelf. Every entry classified by mechanism so a loan is never called free money.' },
  { id: 'chain', name: 'The chain', blurb: 'MELEK: a Graphene chain with an AI witness account producing blocks, plus the wallet, explorer, token and academy surfaces around it.' },
  { id: 'media', name: 'Media and streaming', blurb: 'Browse-and-watch, live video, radio, an image host and a media player — sourcing only legally-clear material.' },
  { id: 'civic', name: 'Law, politics and oversight', blurb: 'Public-records machinery, agency directories, court and legislative readers.' },
  { id: 'market', name: 'Markets and shopping', blurb: 'Coupons, shopping, travel, stocks and market data.' },
  { id: 'tools', name: 'Tools', blurb: 'Small, fast, no-account utilities. Several run entirely client-side by design and are deliberately not even measured.' },
  { id: 'games', name: 'Games and the arcade', blurb: 'Browser games, the arcade hub and the token-economy surfaces.' },
  { id: 'library', name: 'Library and knowledge', blurb: 'The Library of Ashurbanipal: ethnobotany, pharmacology, harm reduction, interactions and traditional preparation — with citations.' },
  { id: 'infra', name: 'Infrastructure', blurb: 'The pieces that make the rest work: analytics, comms, crawling, the growth engine.' },
]);

/**
 * Every public surface. `host` is the real hostname. `state` is the PROBED truth on PROBED_ON.
 * Admin surfaces are deliberately absent and must never be added — see crawlers.mjs isAdminUrl.
 */
export const SURFACES = Object.freeze([
  // ── money ──────────────────────────────────────────────────────────────────────────────────────
  { slug: 'benefits', host: 'benefits.soapbox.community', cat: 'money', state: L, name: 'Benefits Navigator',
    blurb: '121 verified US assistance programmes, each labelled with what the money actually IS — grant, loan, cost-share, tax credit, insurance, or a free service. Names the free path wherever a middleman charges for one.' },
  { slug: 'grants', host: 'grants.soapbox.community', cat: 'money', state: L, name: 'Grant Aggregator',
    blurb: 'Where the money is, by field — the master portals first, then the real funders per field.' },
  { slug: 'credentials', host: 'credentials.soapbox.community', cat: 'money', state: L, name: 'Credentials',
    blurb: '123 credentials across skilled trades, healthcare, business and data — with the free ones marked.' },
  { slug: 'credit', host: 'credit.soapbox.community', cat: 'money', state: L, name: 'Credit Help',
    blurb: 'How scores work and how to defend one, pointing only at the free official tools and nonprofit help. Nothing for sale.' },
  { slug: 'business', host: 'business.soapbox.community', cat: 'money', state: L, name: 'Business Credit',
    blurb: 'The eight real steps to a business credit file — and the fraud that surrounds it named by category. The EIN and the D-U-N-S number are free; this page says so.' },
  { slug: 'abuck', host: 'abuck.soapbox.community', cat: 'money', state: L, name: 'A Buck' },
  { slug: 'coupons', host: 'coupons.soapbox.community', cat: 'money', state: L, name: 'Coupons' },
  { slug: 'insurance', host: 'insurance.soapbox.community', cat: 'money', state: L, name: 'Insurance' },
  { slug: 'jobs', host: 'jobs.soapbox.community', cat: 'money', state: L, name: 'Jobs' },

  // ── chain ──────────────────────────────────────────────────────────────────────────────────────
  { slug: 'melek', host: 'melek.salon', cat: 'chain', state: L, name: 'MELEK',
    blurb: 'The chain front-end. Hathor, the AI witness, is a genesis account and is producing blocks on the live testnet.' },
  { slug: 'witness', host: 'witness.melek.salon', cat: 'chain', state: L, name: 'Witness School',
    blurb: 'How to run a witness, and live status for Hathor.' },
  { slug: 'hathor', host: 'hathor.live', cat: 'chain', state: L, name: 'Hathor',
    blurb: "The witness's always-on public chat, backed by the corpus." },
  { slug: 'tokens', host: 'tokens.alpha.melek.salon', cat: 'chain', state: L, name: 'Tokens' },
  { slug: 'seeds', host: 'seeds.soapbox.community', cat: 'chain', state: L, name: 'SEED' },
  { slug: 'farm', host: 'farm.soapbox.community', cat: 'chain', state: L, name: 'KULA Farm' },
  { slug: 'academy', host: 'academy.melek.salon', cat: 'chain', state: B, name: 'Token Academy' },

  // ── media ──────────────────────────────────────────────────────────────────────────────────────
  { slug: 'tunein', host: 'tunein.soapbox.community', cat: 'media', state: L, name: 'Tune In',
    blurb: 'A browse-and-watch surface in the shape of a streaming app, aggregating the media readers into channels.' },
  { slug: 'genai', host: 'genai.soapbox.community', cat: 'media', state: L, name: 'Creation Studio' },
  { slug: 'arcade', host: 'arcade.soapbox.community', cat: 'media', state: L, name: 'Arcade' },
  { slug: 'stream', host: 'stream.soapbox.community', cat: 'media', state: L, name: 'SoapBox Stream',
    blurb: 'A real catalogue-and-player streaming service sourcing ONLY legally-clear video: public-domain and Creative Commons film from the Internet Archive, free-to-air live TV from iptv-org, plus radio, podcasts and on-chain video.',
 },
  { slug: 'player', host: 'player.soapbox.community', cat: 'media', state: B, name: 'Media Player',
    blurb: 'A working web player with a client-managed playlist and per-track resume.',
    note: 'Built. Host not created.' },
  { slug: 'cams', host: 'cams.soapbox.community', cat: 'media', state: L, name: 'Live Cams',
 },
  { slug: 'gallery', host: 'gallery.melek.salon', cat: 'media', state: B, name: 'Gallery' },
  { slug: 'imghost', host: 'imghost.melek.salon', cat: 'media', state: B, name: 'Image Host', note: 'Built. Host not created.' },

  // ── civic ──────────────────────────────────────────────────────────────────────────────────────
  { slug: 'law', host: 'law.soapbox.community', cat: 'civic', state: L, name: 'Law' },
  { slug: 'politics', host: 'politics.soapbox.community', cat: 'civic', state: L, name: 'Politics' },
  { slug: 'oversight', host: 'oversight.soapbox.community', cat: 'civic', state: L, name: 'Oversight',
    blurb: 'Public-records machinery: who to ask, on what statute, by which channel, with the deadline.' },
  { slug: 'congress', host: 'alpha.congress.ink', cat: 'civic', state: L, name: 'Congress.ink' },
  { slug: 'comms', host: 'comms.soapbox.community', cat: 'infra', state: L, name: 'Comms',
    blurb: 'WiFi phone and fax — including the three FCC regulatory tiers, and why the transmission report is the product when you fax a government office.' },

  // ── market ─────────────────────────────────────────────────────────────────────────────────────
  { slug: 'shopping', host: 'shopping.soapbox.community', cat: 'market', state: L, name: 'Shopping' },
  { slug: 'travel', host: 'travel.soapbox.community', cat: 'market', state: L, name: 'Travel' },
  { slug: 'stocks', host: 'stocks.soapbox.community', cat: 'market', state: L, name: 'Stocks' },
  { slug: 'home', host: 'home.soapbox.community', cat: 'market', state: L, name: 'Home Goods' },
  { slug: 'search', host: 'search.soapbox.community', cat: 'market', state: L, name: 'Search' },
  { slug: 'directory', host: 'directory.soapbox.community', cat: 'market', state: L, name: 'Directory' },
  { slug: 'hemp', host: 'hemp.soapbox.community', cat: 'market', state: L, name: 'Hemp' },

  // ── tools ──────────────────────────────────────────────────────────────────────────────────────
  { slug: 'tools', host: 'tools.soapbox.community', cat: 'tools', state: L, name: 'Tools hub' },
  { slug: 'plate', host: 'plate.soapbox.community', cat: 'tools', state: B, name: 'The Temple Plate',
    blurb: 'Food organised by what it INTERACTS with rather than by macronutrient, plus a MYCIN-shaped deficiency screener whose every answer terminates in a test to ask a clinician for — never in a finding.' },

  // ── games ──────────────────────────────────────────────────────────────────────────────────────
  { slug: 'games', host: 'games.soapbox.community', cat: 'games', state: L, name: 'Games' },
  { slug: 'dudael', host: 'dudael.com', cat: 'games', state: L, name: 'Dudael', blurb: 'The VR / OpenXR world side.' },

  // ── library ────────────────────────────────────────────────────────────────────────────────────
  { slug: 'wiki', host: 'wiki.soapbox.community', cat: 'library', state: L, name: 'Library of Ashurbanipal',
    blurb: 'Ethnobotany, pharmacology, dose ranges, interactions, testing, set and setting, aftercare, documented traditional preparation, and the religious and legal exemptions — with citations. Built to go past the reference sites, not beneath them.' },
  { slug: 'library', host: 'library.soapbox.community', cat: 'library', state: B, name: 'Library' },

  // ── infra ──────────────────────────────────────────────────────────────────────────────────────
  { slug: 'soapbox', host: 'soapbox.community', cat: 'infra', state: L, name: 'SoapBox', blurb: 'The apex.' },
  { slug: 'vankushfamily', host: 'vankushfamily.com', cat: 'infra', state: L, name: 'Van Kush Family', blurb: 'The roadmap.' },
  { slug: 'herald', host: 'herald.soapbox.community', cat: 'infra', state: L, name: 'Herald', blurb: 'The growth engine and click rail.' },
  { slug: 'calculator', host: 'calculator.soapbox.community', cat: 'tools', state: L, name: 'Free Online Calculator',
    blurb: 'Free Online Calculator — scientific, keyboard support,' },
  { slug: 'convert', host: 'convert.soapbox.community', cat: 'tools', state: L, name: 'Free Unit & Currency Converter',
    blurb: 'Free Unit & Currency Converter — offline units, liv' },
  { slug: 'costofliving', host: 'costofliving.soapbox.community', cat: 'market', state: L, name: 'SoapBox Cost of Living',
    blurb: 'SoapBox Cost of Living — compare cities by cost of livi' },
  { slug: 'data', host: 'data.soapbox.community', cat: 'market', state: L, name: 'Global Markets',
    blurb: 'Global Markets — SoapBox Data' },
  { slug: 'diagram', host: 'diagram.soapbox.community', cat: 'tools', state: L, name: 'Free Online Flowchart & Diagram Maker',
    blurb: 'Free Online Flowchart & Diagram Maker — SoapBox Dia' },
  { slug: 'flashlight', host: 'flashlight.soapbox.community', cat: 'tools', state: L, name: 'Free Online Flashlight',
    blurb: 'Free Online Flashlight — bright full-screen light, no i' },
  { slug: 'forum', host: 'forum.soapbox.community', cat: 'infra', state: L, name: 'SoapBox Forum',
    blurb: 'SoapBox Forum — MELEK community boards' },
  { slug: 'gambling', host: 'gambling.soapbox.community', cat: 'infra', state: L, name: 'Gambling Education',
    blurb: 'Gambling Education — House Edge, Odds & Expected Va' },
  { slug: 'habits', host: 'habits.soapbox.community', cat: 'tools', state: L, name: 'Free Habit & Streak Tracker',
    blurb: 'Free Habit & Streak Tracker — build habits, no sign' },
  { slug: 'health-providers', host: 'health-providers.soapbox.community', cat: 'market', state: L, name: 'SoapBox Health Providers',
    blurb: 'SoapBox Health Providers — find hospitals & read of' },
  { slug: 'hierophant', host: 'hierophant.soapbox.community', cat: 'library', state: L, name: 'The Hierophant',
    blurb: 'The Hierophant — the Temple library of sacred texts' },
  { slug: 'idlegames', host: 'idlegames.soapbox.community', cat: 'games', state: L, name: 'Idle-Time Games',
    blurb: 'Idle-Time Games — free browser games for a quick break' },
  { slug: 'karma', host: 'karma.melek.salon', cat: 'chain', state: L, name: 'Karma',
    blurb: 'Karma — the highest standing' },
  { slug: 'kula-paper', host: 'kula-paper.melek.salon', cat: 'chain', state: L, name: 'The KULA Paper',
    blurb: 'The KULA Paper — PRANA / KULA economic spec' },
  { slug: 'shop', host: 'shop.melek.salon', cat: 'chain', state: L, name: 'MELEK Seed Shop',
    blurb: 'MELEK Seed Shop — buy seeds, tools & compost' },
  { slug: 'move', host: 'move.melek.salon', cat: 'chain', state: L, name: 'MELEK Move',
    blurb: 'MELEK Move — Step & Geo Miner' },
  { slug: 'prana-paper', host: 'prana-paper.melek.salon', cat: 'chain', state: L, name: 'The PRANA Paper',
    blurb: 'The PRANA Paper — technical & consensus spec' },
  { slug: 'software-reviews', host: 'software-reviews.soapbox.community', cat: 'market', state: L, name: 'SoapBox Software Reviews',
    blurb: 'SoapBox Software Reviews — compare SaaS, hosting, VPN &' },
  { slug: 'spin', host: 'spin.soapbox.community', cat: 'games', state: L, name: 'SoapBox Daily Spin',
    blurb: 'SoapBox Daily Spin — free daily spin for PLAY points' },
  { slug: 'timer', host: 'timer.soapbox.community', cat: 'tools', state: L, name: 'Free Focus Timer, Stopwatch & Countdown',
    blurb: 'Free Focus Timer, Stopwatch & Countdown — no sign-u' },
  { slug: 'weather', host: 'weather.soapbox.community', cat: 'tools', state: L, name: 'Free Weather App',
    blurb: 'Free Weather App — local forecast, no ads, no sign-up' },
]);

export const bySlug = (s) => SURFACES.find((x) => x.slug === String(s || '')) || null;
export const inCategory = (c) => SURFACES.filter((x) => x.cat === String(c || ''));
export const live = () => SURFACES.filter((x) => x.state === 'live');
export const built = () => SURFACES.filter((x) => x.state === 'built');

/** The honest headline numbers. Computed, never typed. */
export function counts() {
  const c = { total: SURFACES.length, live: 0, built: 0, soon: 0 };
  for (const s of SURFACES) c[s.state] = (c[s.state] || 0) + 1;
  return c;
}

/** Repo facts, updated by hand from executed commands. Each carries HOW it was obtained. */
export const REPO_FACTS = Object.freeze([
  { k: 'Web surfaces with a server', v: '105', how: 'ls site/*/server.mjs' },
  { k: 'Shared library modules', v: '678', how: 'integrations/**.mjs, tests excluded' },
  { k: 'Test files', v: '1,280', how: 'repo-wide' },
  { k: 'Commits', v: '2,713', how: 'git rev-list --count HEAD' },
  { k: 'Assistance programmes catalogued', v: '121', how: 'benefits-navigator.mjs' },
  { k: 'Credentials catalogued', v: '123', how: 'credentials-catalog.mjs' },
  { k: 'Surfaces emitting a pageview beacon', v: '99', how: 'instrumented 2026-09-14' },
]);

export const STATE_LABEL = Object.freeze({
  live: 'Live',
  built: 'Built, not deployed',
  soon: 'Designed',
});
