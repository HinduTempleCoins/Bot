// categories.mjs — the wiki's category system.
//
// The wiki had a flat A-Z list of 80+ articles and a search box. That is fine for someone who
// already knows the word they want and useless for everyone else — which is most first-time
// readers, and all of the press and lab contacts we point here.
//
// Two mechanisms, in this order:
//   1. EXPLICIT — an article named in a category's `pages` list goes there, full stop.
//   2. INFERRED — anything unclaimed is matched on title keywords, so a NEW article files itself
//      instead of silently vanishing from every category page.
// Anything still unmatched lands in 'Other', which is visible on purpose: an article nobody can
// find by browsing is a bug, and the Other bucket is where that bug shows up.

export const CATEGORIES = [
  {
    id: 'start', name: 'Start here', blurb: 'What this whole thing is, in the order it makes sense to read it.',
    pages: ['Start Here', 'SoapBox', 'MELEK', 'Hathor', 'Hathor (AI Witness)', 'Crypt-ology', 'Crypto Glossary', 'Glossaries', 'Autodidacts and Credentials'],
  },
  {
    id: 'chains', name: 'Chains and how they work', blurb: 'The blockchains we run, and the machinery underneath them.',
    pages: ['MELEK Blockchain', 'PRANA Blockchain', 'PRANA', 'STEEM Blockchain', 'HIVE Blockchain', 'BLURT Blockchain',
            'The Graphene Family', 'Forking', 'Mining', 'SoapBox Mining Pool', 'SoapBox Pool', 'KULA', 'KulaSwap',
            'Akasha Wallet', 'PranaScan', 'Running Tokens on MELEK-Engine', 'Running a Condenser Front-End',
            'Witness School', 'Curation Trails and Auto-Voting', 'Hathor (AI Witness)', 'VKBT and CURE', 'REN',
            'APIS', 'Wrapped Tokens', 'wMELEK', 'Crypt-ology',
            'Steem   Hive Bots   the SteemBots   Steemcenter ecosystem'],
    keywords: [/blockchain/i, /witness/i, /token/i, /mining/i, /wallet/i, /chain/i],
  },
  {
    id: 'entrainment', name: 'Entrainment and neurostimulation', blurb: 'The 40 Hz research line, how it is delivered, and where the delivery goes wrong.',
    pages: ['Gamma Entrainment', 'Display Refresh and Flicker Delivery', 'Auditory Steady State Response',
            'Invisible Spectral Flicker', 'MELEK Sleep and Focus'],
    keywords: [/entrain/i, /flicker/i, /gamma/i, /steady.state/i, /binaural/i, /40 ?hz/i],
  },
  {
    id: 'substances', name: 'Substances and pharmacology', blurb: 'One page per thing in the stacks — established, preclinical and hypothesis kept apart.',
    pages: ['Stack Substances', 'Cannabinoid Oilahuasca', 'MAGL', 'FAAH', 'Anandamide and 2-AG', 'Beta-Caryophyllene',
            '8-Prenylnaringenin', 'L-Methylfolate', 'The Amplification Framework', 'Racetams', 'Choline Donors',
            'Creatine', 'Vitamin K2', 'Chelated Minerals', 'Liposomal Vitamin C', 'Silicon and Collagen', 'B-Vitamins',
            'Galantamine', 'Datura', 'Cannabis', 'Cannabis Harm Reduction', 'PIHKAL and TIHKAL',
            'Psychedelic and Psychopharmacology Glossary', 'Food Pyramid and Supplements',
            'Fast Food and Processed Food Nutrition'],
    keywords: [/vitamin/i, /mineral/i, /cannabis/i, /nootropic/i],
  },
  {
    id: 'plants', name: 'Plants and preparation', blurb: 'The botanical inventory, and the procedures that go with it.',
    pages: ['Imphepho', 'Yin Chen Hao', 'Mucuna Pruriens', 'Kava', 'Black Pepper', 'Maca', 'White Sage',
            'Recipes', 'Punic Wax', 'Kyphi', 'Cloning'],
  },
  {
    id: 'religion', name: 'Religion and practice', blurb: 'Living traditions, their working materials, and their histories.',
    pages: ['Pashupata Shaivism', 'Swami Vivekananda', 'Ukuphahla', 'Egyptian Five Souls', 'Head Cone',
            'Mysticism and Eastern Philosophy in Science', 'Khepri'],
    keywords: [/shaiv/i, /temple/i, /angel/i],
  },
  {
    id: 'people', name: 'People and ideas', blurb: 'Figures whose work this corpus builds on, with the folklore separated out.',
    pages: ['Nikola Tesla', 'Albert Einstein'],
  },
  {
    id: 'tools', name: 'Tools', blurb: 'The apps and utilities anyone can use — free calculators, token prices, data, wallets, explorers.',
    pages: ['SoapBox Tools', 'Soap Calculator', 'Dilution Calculator', 'Percentage Calculator', 'Unit Price Calculator',
            'Token Price Ticker', 'SoapBox Data Hub', 'KulaSwap', 'Akasha Wallet', 'PranaScan',
            'SoapBox Mining Pool', 'SoapBox Pool', 'SoapBox Search'],
    keywords: [/calculator/i],
  },
  {
    id: 'law', name: 'Law and your rights', blurb: 'The public legal record and the plain-English guides to how U.S. law actually works — facts, not verdicts.',
    pages: ['SoapBox Law', 'Privacy Law', 'Rights That Hold Up in Court', 'Foundational Law', 'Treaties',
            'Legal Maxims', 'Congress.ink', 'Benefit Societies', 'Appeals and Writs',
            'Legal Lexicon', 'Sources of Legal Authority', 'World Law', 'The Spirit of the Laws',
            'Free Speech and Sedition'],
    keywords: [/\blaw\b/i, /\brights\b/i, /constitution/i, /treat(y|ies)/i, /maxim/i, /privacy/i,
               /benefit societ/i, /mutual aid/i, /fraternal/i, /\bappeals?\b/i, /\bwrits?\b/i,
               /lexicon/i, /world[ -]?law/i, /spirit of the laws/i, /montesquieu/i,
               /free[ -]?speech/i, /first amendment/i, /sedition/i, /incitement/i, /brandenburg/i],
  },
  {
    id: 'philosophy', name: 'Political philosophy and movements', blurb: 'The history of political ideas and the movements that carried them — described neutrally, each in its own terms and with its criticisms.',
    pages: ['SoapBox Philosophy', 'The Ideological Spectrum', 'Self-Determination', 'The Black Panther Party',
            'Punk and Skinhead Subcultures', 'Political Maxims'],
    keywords: [/ideolog/i, /liberalism/i, /conservatism/i, /socialism/i, /anarchism/i, /libertarian/i, /self.determination/i],
  },
  {
    id: 'verticals', name: 'The SoapBox verticals', blurb: 'The public-interest sites, one per domain.',
    pages: ['SoapBox Law', 'SoapBox Politics', 'SoapBox Oversight', 'SoapBox Hemp', 'SoapBox Data', 'SoapBox Search',
            'SoapBox Grants', 'SoapBox Credentials', 'SoapBox Shopping', 'SoapBox Stocks', 'SoapBox Travel',
            'SoapBox Move', 'SoapBox Stream', 'Congress.ink', 'Portable Identity', 'Pentecaust', 'Library of Ashurbanipal',
            'The Library of Ashurbanipal', 'Melek.salon', 'Spanish Glossary'],
    keywords: [/soapbox/i],
  },
];

const norm = (s) => String(s || '').replace(/_/g, ' ').trim().toLowerCase();

/** Every category an article belongs to. Explicit first; keyword inference only if unclaimed. */
export function categoriesFor(title) {
  const t = norm(title);
  const explicit = CATEGORIES.filter((c) => (c.pages || []).some((p) => norm(p) === t));
  if (explicit.length) return explicit.map((c) => c.id);
  const inferred = CATEGORIES.filter((c) => (c.keywords || []).some((re) => re.test(title)));
  return inferred.length ? inferred.map((c) => c.id) : ['other'];
}

/** Group a list of {title,...} into categories. 'Other' is included deliberately — see header. */
export function groupArticles(articles) {
  const out = new Map(CATEGORIES.map((c) => [c.id, { ...c, items: [] }]));
  out.set('other', { id: 'other', name: 'Other', blurb: 'Not yet filed. If something useful is sitting here, it needs a category.', items: [] });
  for (const a of articles) {
    for (const id of categoriesFor(a.title)) {
      if (!out.has(id)) continue;
      out.get(id).items.push(a);
    }
  }
  for (const g of out.values()) g.items.sort((x, y) => x.title.localeCompare(y.title));
  return [...out.values()].filter((g) => g.items.length);
}

export function categoryById(id) {
  if (id === 'other') return { id: 'other', name: 'Other', blurb: '' };
  return CATEGORIES.find((c) => c.id === id) || null;
}

export default { CATEGORIES, categoriesFor, groupArticles, categoryById };
