// paying-markets.mjs — PUBLICATIONS THAT PAY FOR SUBMISSIONS, matched to what this operator writes.
//
// The point of this file is money, not prestige. Every row is a place that pays a writer for accepted
// work, with the submission route and what it wants.
//
// ⚠️ A CORRECTION THAT CHANGED THIS FILE. A first pass read the 177 "Re:"-prefixed sends in the
// mailbox as cold pitches wearing a fake reply prefix, and called that the reason for the low
// response. The operator corrected it: those are not pitches. They are a ONE-WAY COMMUNICATION
// THREAD to a standing list of named recipients, continuing whether or not anyone answers, because
// the purpose is the RECORD — that a named person was told, in writing, on a date. In that
// instrument the "Re:" is accurate, not a disguise.
//
// So there are two instruments over one corpus (see MODES below), and the real failure in the
// mailbox was DELIVERY, not subject lines: 18 hard bounces from Frontiers, an unmonitored address at
// In These Times, a noreply at The Marshall Project. A bounced notice is not a notice — it proves
// the recipient was never told. See DELIVERY_FAILURES.
//
// ⚠️ RATES ARE MARKED, NOT ASSERTED. `rateVerified: false` means the figure is from working knowledge
// and MUST be checked against the outlet's current guidelines before it is quoted to anyone or used to
// decide where to spend an afternoon. Publication rates move and kill fees vary; a wrong number here
// turns into a wrong expectation and a wasted pitch.
//
// `pitched` records outlets already contacted from pihkalrc@yahoo.com or VanKushFamily@yahoo.com, so a
// re-approach is deliberate rather than an accidental duplicate.
//
// Pure data. No network, no keys.

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** What the operator actually has finished and could submit. */
export const ASSETS = Object.freeze([
  { id: 'derelict', title: 'The Unresponsive State',
    pitch: 'Every remedy in American administrative law is built for a government that decides WRONGLY. None is built for one that does not answer at all. Seven bodies, eleven years, not one decision.',
    beats: ['law', 'accountability', 'longform'] },
  { id: 'dea-gao', title: 'Zero of Twenty-Four',
    pitch: 'GAO-24-106630 found the DEA granted none of 24 religious-exemption petitions in eight years. I am one of the 24, with an eleven-year record and the agency\'s own sworn filings.',
    beats: ['drug policy', 'religion', 'investigative', 'law'] },
  { id: 'benefits', title: 'The Free Thing Nobody Tells You About',
    pitch: 'A 121-programme audit of US assistance classified by MECHANISM — grant, loan, cost-share, tax credit — and the middlemen charging for what is free.',
    beats: ['personal finance', 'service journalism', 'poverty'] },
  { id: 'usda', title: 'USDA Will Pay for Your Greenhouse',
    pitch: 'EQIP practice 325 covers up to 90% for underserved producers and pays up to 100% in advance — and NRCS is required to tell them so. Almost nobody knows.',
    beats: ['agriculture', 'rural', 'service journalism'] },
  { id: 'enzymology', title: 'Oilahuasca and the Enzyme',
    pitch: 'CYP450 inhibition as the mechanism behind traditional potentiation practices — what the ethnobotany got right before the pharmacology explained it.',
    beats: ['science', 'psychedelics', 'pharmacology'] },
  { id: 'spiced-coffee', title: 'Spiced Coffee',
    pitch: 'What common spice additions do to caffeine absorption and tolerance — kitchen practice with a pharmacological explanation.',
    beats: ['food', 'coffee', 'science'] },
{ id: 'ai-witness', title: 'An AI Account in a Live Consensus Set',
    pitch: 'A blockchain witness account operated by an AI, producing blocks in a live schedule, with its character and corpus kept in a public repo so it survives a change of model or operator. Not a chatbot bolted onto a chain — an account that does consensus work.',
    beats: ['blockchain', 'AI', 'governance', 'technical'] },
  { id: 'fiction-marketcap', title: 'We Publish a Market Cap We Think Is Fiction',
    pitch: 'Circulating-supply market cap is the number every exchange, index and news desk quotes, and for most tokens it describes nothing real. We run a market-data aggregator and publish it anyway. Here is what it actually measures, and what we show beside it.',
    beats: ['crypto', 'markets', 'critique'] },
  { id: 'merit-not-stake', title: 'Standing You Cannot Buy',
    pitch: 'Scarce peer-awarded merit as an alternative to stake-weighted governance: you can only pass on merit you were given, a whale buys none, and the property is Sybil-resistant by construction rather than by economics.',
    beats: ['governance', 'blockchain', 'community'] },
]);

const m = (o) => Object.freeze(o);

/**
 * `pay` is per-piece unless noted. `route` is the ACTUAL submission channel — a generic info@ is the
 * lowest-yield address at any outlet and is recorded as such.
 */
export const MARKETS = Object.freeze([
  // ── investigative / law / accountability ───────────────────────────────────────────────────────
  m({ id: 'undark', name: 'Undark', url: 'https://undark.org/submissions/', route: 'pitch form',
    pay: '$0.50–$1.00/word', rateVerified: false, beats: ['science', 'investigative', 'law'],
    wants: 'Science journalism with a justice or policy edge. Long-form and reported essays.',
    fit: ['dea-gao', 'enzymology'], pitched: false,
    note: 'MIT Knight Science Journalism. One of the best fits in this file for the DEA piece.' }),
  m({ id: 'texas-observer', name: 'Texas Observer', url: 'https://www.texasobserver.org/', route: 'editors@texasobserver.org',
    pay: 'varies', rateVerified: false, beats: ['texas', 'accountability', 'investigative'],
    wants: 'Texas accountability journalism.', fit: ['derelict', 'dea-gao'], pitched: true,
    note: 'Already contacted from VanKushFamily. The Collin County and Comptroller material is squarely theirs.' }),
  m({ id: 'marshall', name: 'The Marshall Project', url: 'https://www.themarshallproject.org/', route: 'a NAMED editor',
    pay: 'commissioned', rateVerified: false, beats: ['criminal justice', 'investigative'],
    wants: 'Criminal-justice reporting.', fit: ['dea-gao', 'derelict'], pitched: true,
    note: '⛔ Previously pitched to pitches+noreply@ — a NOREPLY address. Every "reply" received was an autoresponder. Re-pitch a named editor.' }),
  m({ id: 'aba-journal', name: 'ABA Journal', url: 'https://www.abajournal.com/', route: 'editor contact',
    pay: 'varies', rateVerified: false, beats: ['law'], wants: 'Legal profession and courts.',
    fit: ['derelict'], pitched: true }),
  m({ id: 'issues-sci-tech', name: 'Issues in Science and Technology', url: 'https://issues.org/',
    route: 'submissions per guidelines', pay: 'paid', rateVerified: false,
    beats: ['science policy', 'law'], wants: 'Science and technology policy essays.',
    fit: ['dea-gao', 'derelict'], pitched: false,
    note: 'Arizona State + National Academies. Ideal venue for the religious-exemption regulatory argument.' }),

  // ── ideas / longform ───────────────────────────────────────────────────────────────────────────
  m({ id: 'aeon', name: 'Aeon', url: 'https://aeon.co/', route: 'ideas pitch form',
    pay: 'paid', rateVerified: false, beats: ['philosophy', 'ideas', 'religion'],
    wants: 'Essays with an argument.', fit: ['derelict', 'enzymology'], pitched: false }),
  m({ id: 'noema', name: 'Noema', url: 'https://www.noemamag.com/', route: 'editorial contact',
    pay: 'well-paid', rateVerified: false, beats: ['governance', 'technology', 'philosophy'],
    wants: 'Long essays on governance and technology.', fit: ['derelict'], pitched: false }),
  m({ id: 'nautilus', name: 'Nautilus', url: 'https://nautil.us/', route: 'ideas@nautil.us',
    pay: 'paid', rateVerified: false, beats: ['science', 'ideas'],
    wants: 'Science with a narrative.', fit: ['enzymology'], pitched: true }),
  m({ id: 'baffler', name: 'The Baffler', url: 'https://thebaffler.com/', route: 'submissions per guidelines',
    pay: 'paid', rateVerified: false, beats: ['politics', 'essay'], fit: ['derelict'], pitched: false }),
  m({ id: 'longreads', name: 'Longreads', url: 'https://longreads.com/', route: 'pitch form',
    pay: 'paid', rateVerified: false, beats: ['longform'], fit: ['derelict', 'dea-gao'], pitched: false }),

  // ── drug policy / psychedelics ─────────────────────────────────────────────────────────────────
  m({ id: 'doubleblind', name: 'DoubleBlind', url: 'https://doubleblindmag.com/', route: 'pitch per guidelines',
    pay: 'paid', rateVerified: false, beats: ['psychedelics', 'drug policy'],
    wants: 'Psychedelics, policy, culture.', fit: ['dea-gao', 'enzymology'], pitched: true }),
  m({ id: 'lucid-news', name: 'Lucid News', url: 'https://www.lucid.news/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['psychedelics', 'policy'], fit: ['dea-gao'], pitched: false }),
  m({ id: 'filter', name: 'Filter', url: 'https://filtermag.org/', route: 'submissions',
    pay: 'paid', rateVerified: false, beats: ['drug policy', 'harm reduction'],
    wants: 'Drug-policy and harm-reduction journalism, often first-person from affected people.',
    fit: ['dea-gao'], pitched: false,
    note: '⭐ Strong fit — Filter publishes people with direct experience of the systems they write about.' }),

  // ── food / coffee trade ────────────────────────────────────────────────────────────────────────
  m({ id: 'standart', name: 'Standart Magazine', url: 'https://standartmag.com/', route: 'hello@standartmag.com',
    pay: 'paid', rateVerified: false, beats: ['coffee'], fit: ['spiced-coffee'], pitched: true }),
  m({ id: 'barista-mag', name: 'Barista Magazine', url: 'https://www.baristamagazine.com/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['coffee'], fit: ['spiced-coffee'], pitched: true }),
  m({ id: 'fresh-cup', name: 'Fresh Cup', url: 'https://freshcup.com/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['coffee'], fit: ['spiced-coffee'], pitched: true }),
  m({ id: 'vittles', name: 'Vittles', url: 'https://www.vittlesmagazine.com/', route: 'submissions',
    pay: 'paid', rateVerified: false, beats: ['food'], fit: ['spiced-coffee'], pitched: false,
    note: 'Pays contributors and publishes unusual food scholarship.' }),
  m({ id: 'taste', name: 'TASTE', url: 'https://tastecooking.com/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['food'], fit: ['spiced-coffee'], pitched: false }),

  // ── agriculture / rural ────────────────────────────────────────────────────────────────────────
  m({ id: 'modern-farmer', name: 'Modern Farmer', url: 'https://modernfarmer.com/', route: 'pitch per guidelines',
    pay: 'paid', rateVerified: false, beats: ['agriculture'], fit: ['usda'], pitched: false }),
  m({ id: 'ambrook', name: 'Ambrook Research', url: 'https://ambrook.com/research', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['agriculture', 'rural economics'],
    wants: 'Agriculture, money and policy.', fit: ['usda'], pitched: false,
    note: '⭐ Ambrook publishes exactly the "here is the federal money and how it actually works" piece.' }),
  m({ id: 'civil-eats', name: 'Civil Eats', url: 'https://civileats.com/', route: 'pitch per guidelines',
    pay: 'paid', rateVerified: false, beats: ['food systems', 'agriculture'], fit: ['usda'], pitched: false }),

  // ── personal finance / service ─────────────────────────────────────────────────────────────────
  m({ id: 'propublica', name: 'ProPublica', url: 'https://www.propublica.org/', route: 'tips / freelance contact',
    pay: 'commissioned', rateVerified: false, beats: ['investigative', 'poverty'],
    fit: ['benefits', 'derelict'], pitched: false,
    note: 'Also worth sending as a TIP rather than a pitch — the benefits and DEA material is tip-shaped.' }),
// ── ⭐ COMMISSIONERS AND GRANT-MAKERS — these PAY the writer directly ─────────────────────────────
  m({ id: 'ehrp', name: 'Economic Hardship Reporting Project', url: 'https://economichardship.org/', route: 'pitch form',
    pay: 'commissions + co-publishes into major outlets', rateVerified: false,
    beats: ['poverty', 'lived experience', 'service journalism'],
    wants: 'Journalism by people who have LIVED economic hardship, placed into national outlets.',
    fit: ['benefits', 'derelict'], pitched: false,
    note: '⭐⭐ Founded by Barbara Ehrenreich. Commissions writers with direct experience of the systems they cover, then places the piece. The single best structural fit in this file.' }),
  m({ id: 'type-investigations', name: 'Type Investigations', url: 'https://www.typeinvestigations.org/', route: 'pitch form',
    pay: 'funds + pays reporters, co-publishes', rateVerified: false, beats: ['investigative'],
    wants: 'Investigative projects; they fund the reporting and place it.', fit: ['dea-gao', 'derelict'], pitched: false }),
  m({ id: 'fij', name: 'Fund for Investigative Journalism', url: 'https://fij.org/', route: 'grant application',
    pay: 'grants (commonly up to ~$10k)', rateVerified: false, beats: ['investigative'],
    wants: 'Story grants for independent reporters, including expenses.', fit: ['dea-gao', 'derelict'], pitched: false }),
  m({ id: 'pulitzer-center', name: 'Pulitzer Center', url: 'https://pulitzercenter.org/', route: 'grant application',
    pay: 'reporting grants', rateVerified: false, beats: ['investigative', 'global'],
    fit: ['dea-gao'], pitched: false }),
  m({ id: 'solutions-journalism', name: 'Solutions Journalism Network', url: 'https://www.solutionsjournalism.org/', route: 'grant + training',
    pay: 'grants', rateVerified: false, beats: ['solutions'], fit: ['benefits', 'usda'], pitched: false }),

  // ── law and courts ─────────────────────────────────────────────────────────────────────────────
  m({ id: 'balls-strikes', name: 'Balls & Strikes', url: 'https://ballsandstrikes.org/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['courts', 'law'], wants: 'Critical writing on the courts.', fit: ['derelict'], pitched: false }),
  m({ id: 'the-appeal', name: 'The Appeal', url: 'https://theappeal.org/', route: 'pitch per guidelines',
    pay: 'paid', rateVerified: false, beats: ['criminal justice'], fit: ['dea-gao', 'derelict'], pitched: false }),
  m({ id: 'bolts', name: 'Bolts Magazine', url: 'https://boltsmag.org/', route: 'pitch per guidelines',
    pay: 'paid', rateVerified: false, beats: ['local power', 'courts', 'elections'],
    wants: 'How power works at county and state level.', fit: ['derelict'], pitched: false,
    note: '⭐ Bolts covers county-level officials specifically — the Collin County material is their beat.' }),
  m({ id: 'injustice-watch', name: 'Injustice Watch', url: 'https://www.injusticewatch.org/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['courts', 'accountability'], fit: ['derelict'], pitched: false }),
  m({ id: 'jurist', name: 'JURIST', url: 'https://www.jurist.org/', route: 'commentary submission',
    pay: 'often unpaid', rateVerified: false, beats: ['law'], fit: ['derelict'], pitched: false,
    note: '⚠️ Law-school run; frequently unpaid. Useful for the record and citation, not for income.' }),
  m({ id: 'verdict-justia', name: 'Verdict (Justia)', url: 'https://verdict.justia.com/', route: 'editorial contact',
    pay: 'varies', rateVerified: false, beats: ['law'], fit: ['derelict'], pitched: false }),
  m({ id: 'slate-jurisprudence', name: 'Slate — Jurisprudence', url: 'https://slate.com/', route: 'section editor',
    pay: 'paid', rateVerified: false, beats: ['law', 'courts'], fit: ['derelict', 'dea-gao'], pitched: false }),

  // ── drug policy and psychedelics (trade + advocacy) ────────────────────────────────────────────
  m({ id: 'psymposia', name: 'Psymposia', url: 'https://www.psymposia.com/', route: 'editorial contact',
    pay: 'varies', rateVerified: false, beats: ['psychedelics', 'critique'],
    wants: 'Critical writing on psychedelic science, industry and policy.', fit: ['dea-gao', 'enzymology'], pitched: false }),
  m({ id: 'chacruna', name: 'Chacruna Institute', url: 'https://chacruna.net/', route: 'submissions',
    pay: 'varies', rateVerified: false, beats: ['psychedelics', 'religion', 'anthropology'],
    wants: 'Plant medicine, religion and law — including religious-freedom cases.', fit: ['dea-gao', 'enzymology'], pitched: false,
    note: '⭐ Chacruna runs a Religious Freedom initiative specifically. Direct topical overlap with the DEA petition.' }),
  m({ id: 'talkingdrugs', name: 'TalkingDrugs', url: 'https://www.talkingdrugs.org/', route: 'submissions',
    pay: 'varies', rateVerified: false, beats: ['drug policy', 'global'], fit: ['dea-gao'], pitched: false }),
  m({ id: 'microdose', name: 'The Microdose (UC Berkeley)', url: 'https://themicrodose.substack.com/', route: 'editorial contact',
    pay: 'varies', rateVerified: false, beats: ['psychedelics', 'science'], fit: ['enzymology'], pitched: false }),
  m({ id: 'drug-science', name: 'Drug Science', url: 'https://www.drugscience.org.uk/', route: 'editorial contact',
    pay: 'varies', rateVerified: false, beats: ['drug policy', 'science'], fit: ['enzymology', 'dea-gao'], pitched: false }),

  // ── religion and spirituality ──────────────────────────────────────────────────────────────────
  m({ id: 'religion-news', name: 'Religion News Service', url: 'https://religionnews.com/', route: 'commentary desk',
    pay: 'paid', rateVerified: false, beats: ['religion'], wants: 'Religion news and commentary.',
    fit: ['dea-gao', 'derelict'], pitched: false,
    note: '⭐ A religious-liberty story with a federal audit behind it is squarely RNS territory.' }),
  m({ id: 'tricycle', name: 'Tricycle', url: 'https://tricycle.org/', route: 'submissions',
    pay: 'paid', rateVerified: false, beats: ['buddhism', 'contemplative'], fit: ['enzymology'], pitched: true }),
  m({ id: 'lions-roar', name: "Lion's Roar", url: 'https://www.lionsroar.com/', route: 'submissions',
    pay: 'paid', rateVerified: false, beats: ['buddhism'], fit: ['enzymology'], pitched: false }),
  m({ id: 'plough', name: 'Plough Quarterly', url: 'https://www.plough.com/', route: 'submissions',
    pay: 'paid', rateVerified: false, beats: ['faith', 'essay'], fit: ['derelict'], pitched: false }),
  m({ id: 'christian-century', name: 'The Christian Century', url: 'https://www.christiancentury.org/', route: 'submissions',
    pay: 'paid', rateVerified: false, beats: ['religion'], fit: ['dea-gao'], pitched: false }),
  m({ id: 'sojourners', name: 'Sojourners', url: 'https://sojo.net/', route: 'submissions',
    pay: 'paid', rateVerified: false, beats: ['faith', 'justice'], fit: ['derelict', 'dea-gao'], pitched: true }),

  // ── Texas and the South ────────────────────────────────────────────────────────────────────────
  m({ id: 'texas-monthly', name: 'Texas Monthly', url: 'https://www.texasmonthly.com/', route: 'pitch per guidelines',
    pay: 'well-paid', rateVerified: false, beats: ['texas', 'longform'], fit: ['derelict'], pitched: false }),
  m({ id: 'd-magazine', name: 'D Magazine (Dallas)', url: 'https://www.dmagazine.com/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['dallas', 'local'], fit: ['derelict'], pitched: false,
    note: '⭐ Local to the operator. Collin County and Dallas County material is their circulation area.' }),
  m({ id: 'dallas-observer', name: 'Dallas Observer', url: 'https://www.dallasobserver.com/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['dallas', 'alt-weekly'], fit: ['derelict', 'dea-gao'], pitched: false }),
  m({ id: 'scalawag', name: 'Scalawag', url: 'https://scalawagmagazine.org/', route: 'pitch per guidelines',
    pay: 'paid', rateVerified: false, beats: ['south', 'justice'], fit: ['derelict'], pitched: false }),
  m({ id: 'facing-south', name: 'Facing South (Institute for Southern Studies)', url: 'https://www.facingsouth.org/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['south', 'investigative'], fit: ['derelict'], pitched: false }),
  m({ id: 'barn-raiser', name: 'Barn Raiser', url: 'https://barnraisingmedia.com/', route: 'pitch per guidelines',
    pay: 'paid', rateVerified: false, beats: ['rural', 'midwest'], fit: ['usda'], pitched: false }),
  m({ id: 'daily-yonder', name: 'The Daily Yonder', url: 'https://dailyyonder.com/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['rural'], fit: ['usda', 'benefits'], pitched: false }),
  m({ id: 'investigate-midwest', name: 'Investigate Midwest', url: 'https://investigatemidwest.org/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['agriculture', 'investigative'], fit: ['usda'], pitched: false }),

  // ── agriculture trade ──────────────────────────────────────────────────────────────────────────
  m({ id: 'acres-usa', name: 'Acres U.S.A.', url: 'https://www.acresusa.com/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['regenerative agriculture'], fit: ['usda'], pitched: false }),
  m({ id: 'growing-for-market', name: 'Growing for Market', url: 'https://growingformarket.com/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['market farming'], fit: ['usda'], pitched: false,
    note: '⭐ Written for exactly the grower who would use an EQIP high tunnel.' }),
  m({ id: 'successful-farming', name: 'Successful Farming', url: 'https://www.agriculture.com/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['farming'], fit: ['usda'], pitched: false }),
  m({ id: 'lancaster-farming', name: 'Lancaster Farming', url: 'https://www.lancasterfarming.com/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['farming'], fit: ['usda'], pitched: false }),

  // ── coffee and food trade ──────────────────────────────────────────────────────────────────────
  m({ id: 'sprudge', name: 'Sprudge', url: 'https://sprudge.com/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['coffee'], fit: ['spiced-coffee'], pitched: false,
    note: '⭐ The most-read independent coffee publication; more reachable than the glossies.' }),
  m({ id: 'roast', name: 'Roast Magazine', url: 'https://roastmagazine.com/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['coffee trade'], fit: ['spiced-coffee'], pitched: true }),
  m({ id: 'daily-coffee-news', name: 'Daily Coffee News', url: 'https://dailycoffeenews.com/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['coffee trade'], fit: ['spiced-coffee'], pitched: true }),
  m({ id: 'whetstone', name: 'Whetstone Magazine', url: 'https://www.whetstonemagazine.com/', route: 'submissions',
    pay: 'paid', rateVerified: false, beats: ['food origin', 'culture'], fit: ['spiced-coffee'], pitched: false }),
  m({ id: 'gravy', name: 'Gravy (Southern Foodways Alliance)', url: 'https://www.southernfoodways.org/', route: 'submissions',
    pay: 'paid', rateVerified: false, beats: ['southern food'], fit: ['spiced-coffee'], pitched: false }),

  // ── science and ideas ──────────────────────────────────────────────────────────────────────────
  m({ id: 'sapiens', name: 'SAPIENS', url: 'https://www.sapiens.org/', route: 'pitch per guidelines',
    pay: 'paid', rateVerified: false, beats: ['anthropology'], wants: 'Anthropology for a general reader.',
    fit: ['enzymology', 'derelict'], pitched: false,
    note: '⭐ Ethnobotany and ritual practice are core SAPIENS subjects.' }),
  m({ id: 'knowable', name: 'Knowable Magazine', url: 'https://knowablemagazine.org/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['science'], fit: ['enzymology'], pitched: false }),
  m({ id: 'hakai', name: 'Hakai Magazine', url: 'https://hakaimagazine.com/', route: 'pitch per guidelines',
    pay: 'well-paid', rateVerified: false, beats: ['coastal science'], fit: ['enzymology'], pitched: false }),
  m({ id: 'biographic', name: 'bioGraphic', url: 'https://www.biographic.com/', route: 'editorial contact',
    pay: 'well-paid', rateVerified: false, beats: ['nature science'], fit: ['enzymology'], pitched: false }),
  m({ id: 'chemistry-world', name: 'Chemistry World', url: 'https://www.chemistryworld.com/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['chemistry'], fit: ['enzymology'], pitched: false }),
  m({ id: 'massive-science', name: 'Massive Science', url: 'https://massivesci.com/', route: 'submissions',
    pay: 'paid', rateVerified: false, beats: ['science'], fit: ['enzymology'], pitched: false }),

  // ── essay and narrative ────────────────────────────────────────────────────────────────────────
  m({ id: 'guernica', name: 'Guernica', url: 'https://www.guernicamag.com/', route: 'submissions',
    pay: 'paid', rateVerified: false, beats: ['essay', 'politics'], fit: ['derelict'], pitched: false }),
  m({ id: 'narratively', name: 'Narratively', url: 'https://narratively.com/', route: 'pitch form',
    pay: 'paid', rateVerified: false, beats: ['narrative nonfiction'], fit: ['derelict', 'dea-gao'], pitched: false }),
  m({ id: 'atavist', name: 'The Atavist', url: 'https://magazine.atavist.com/', route: 'pitch per guidelines',
    pay: 'well-paid', rateVerified: false, beats: ['longform'], fit: ['dea-gao'], pitched: false }),
  m({ id: 'boston-review', name: 'Boston Review', url: 'https://www.bostonreview.net/', route: 'submissions',
    pay: 'paid', rateVerified: false, beats: ['politics', 'ideas'], fit: ['derelict'], pitched: false }),
  m({ id: 'hazlitt', name: 'Hazlitt', url: 'https://hazlitt.net/', route: 'pitch per guidelines',
    pay: 'paid', rateVerified: false, beats: ['essay'], fit: ['derelict'], pitched: false }),
  m({ id: 'atlas-obscura', name: 'Atlas Obscura', url: 'https://www.atlasobscura.com/', route: 'pitch per guidelines',
    pay: 'paid', rateVerified: false, beats: ['place', 'curiosity'], fit: ['enzymology', 'spiced-coffee'], pitched: false }),

  // ── policy and money desks ─────────────────────────────────────────────────────────────────────
  m({ id: 'the-lever', name: 'The Lever', url: 'https://www.levernews.com/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['accountability', 'money in politics'], fit: ['derelict'], pitched: false }),
  m({ id: 'capital-and-main', name: 'Capital & Main', url: 'https://capitalandmain.com/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['economic justice'], fit: ['benefits', 'derelict'], pitched: false }),
  m({ id: 'prism', name: 'Prism', url: 'https://prismreports.org/', route: 'pitch per guidelines',
    pay: 'paid', rateVerified: false, beats: ['justice', 'lived experience'], fit: ['benefits', 'dea-gao'], pitched: false }),
  m({ id: 'grist', name: 'Grist', url: 'https://grist.org/', route: 'pitch per guidelines',
    pay: 'paid', rateVerified: false, beats: ['environment', 'justice'], fit: ['usda'], pitched: false }),
  m({ id: 'stateline', name: 'Stateline', url: 'https://stateline.org/', route: 'editorial contact',
    pay: 'paid', rateVerified: false, beats: ['state policy'], fit: ['benefits', 'derelict'], pitched: false }),
// ── ⭐ PEER-REVIEWED AND ACADEMIC (no article-processing charge) ──────────────────────────────────
  m({ id: 'ledger-journal', name: 'Ledger (University of Pittsburgh)', url: 'https://ledgerjournal.org/', route: 'journal submission',
    pay: 'unpaid — but PEER-REVIEWED and free to publish', rateVerified: false,
    beats: ['blockchain', 'cryptocurrency', 'academic'],
    wants: 'Peer-reviewed cryptocurrency and blockchain research.', fit: ['ai-witness', 'merit-not-stake'], pitched: false,
    note: '⭐⭐ The legitimate academic venue for this material, and the direct answer to the predatory journals in the mailbox: university-published, peer-reviewed, NO article-processing charge. Confers real standing; pays nothing.' }),
  m({ id: 'frontiers-blockchain', name: 'Frontiers in Blockchain', url: 'https://www.frontiersin.org/journals/blockchain', route: 'journal submission',
    pay: '⚠️ author-pays APC', rateVerified: false, beats: ['blockchain', 'academic'],
    fit: ['ai-witness'], pitched: false,
    note: '⚠️ Open access with an article-processing charge — you PAY. Also note 18 hard bounces to frontiersin.net already in the record; fix the address before assuming silence.' }),
  m({ id: 'ethresearch', name: 'ethresear.ch', url: 'https://ethresear.ch/', route: 'forum post',
    pay: 'unpaid', rateVerified: false, beats: ['consensus', 'technical'],
    wants: 'Serious protocol research, posted openly and argued in public.', fit: ['ai-witness', 'merit-not-stake'], pitched: false,
    note: '⭐ Where protocol people actually read. No gatekeeper, high bar. Citable and it builds the reputation the Witness School pitch needs.' }),

  // ── general tech / science press — these PAY ───────────────────────────────────────────────────
  m({ id: 'ieee-spectrum', name: 'IEEE Spectrum', url: 'https://spectrum.ieee.org/', route: 'pitch per guidelines',
    pay: 'paid', rateVerified: false, beats: ['technology', 'engineering'],
    wants: 'Technology explained by the people building it.', fit: ['ai-witness'], pitched: false,
    note: '⭐ An AI running consensus is a Spectrum story in a way it is not a crypto-press story.' }),
  m({ id: 'mit-tech-review', name: 'MIT Technology Review', url: 'https://www.technologyreview.com/', route: 'a NAMED editor',
    pay: 'paid', rateVerified: false, beats: ['technology', 'AI'], fit: ['ai-witness'], pitched: true,
    note: '⛔ Previously contacted at privacy@technologyreview.com — that is their DATA-PRIVACY inbox, not editorial. No editor ever saw it.' }),
  m({ id: 'the-new-stack', name: 'The New Stack', url: 'https://thenewstack.io/', route: 'contributor guidelines',
    pay: 'paid', rateVerified: false, beats: ['infrastructure', 'developers'], fit: ['ai-witness'], pitched: false }),
  m({ id: 'increment-logic', name: 'Logic(s) Magazine', url: 'https://logicmag.io/', route: 'pitch per guidelines',
    pay: 'paid', rateVerified: false, beats: ['technology', 'politics'], fit: ['merit-not-stake', 'fiction-marketcap'], pitched: false }),
  m({ id: 'real-life', name: 'Real Life', url: 'https://reallifemag.com/', route: 'pitch per guidelines',
    pay: 'paid', rateVerified: false, beats: ['technology', 'culture'], fit: ['merit-not-stake'], pitched: false }),

  // ── crypto trade press ⚠️ mostly unpaid for contributed pieces ────────────────────────────────────
  m({ id: 'coindesk-opinion', name: 'CoinDesk — Opinion', url: 'https://www.coindesk.com/', route: 'opinion editor',
    pay: '⚠️ usually unpaid for contributed op-eds', rateVerified: false, beats: ['crypto'],
    wants: 'Argued op-eds from people in the industry.', fit: ['fiction-marketcap', 'merit-not-stake'], pitched: false,
    note: 'Largest reach in the vertical. Treat as distribution, not income.' }),
  m({ id: 'cointelegraph', name: 'Cointelegraph', url: 'https://cointelegraph.com/', route: 'opinion/experts desk',
    pay: '⚠️ usually unpaid', rateVerified: false, beats: ['crypto'], fit: ['fiction-marketcap'], pitched: false }),
  m({ id: 'decrypt', name: 'Decrypt', url: 'https://decrypt.co/', route: 'editorial contact',
    pay: '⚠️ mostly staff-written', rateVerified: false, beats: ['crypto'], fit: ['ai-witness'], pitched: false }),
  m({ id: 'blockworks', name: 'Blockworks', url: 'https://blockworks.co/', route: 'editorial contact',
    pay: '⚠️ mostly staff-written', rateVerified: false, beats: ['crypto', 'markets'], fit: ['fiction-marketcap'], pitched: false }),
  m({ id: 'the-defiant', name: 'The Defiant', url: 'https://thedefiant.io/', route: 'editorial contact',
    pay: 'varies', rateVerified: false, beats: ['defi'], fit: ['fiction-marketcap'], pitched: false }),
  m({ id: 'protos', name: 'Protos', url: 'https://protos.com/', route: 'tips / editorial',
    pay: 'varies', rateVerified: false, beats: ['crypto', 'sceptical'],
    wants: 'Sceptical crypto reporting — they like a debunk.', fit: ['fiction-marketcap'], pitched: false,
    note: '⭐ A piece arguing a headline metric is fiction is squarely Protos territory.' }),
  m({ id: 'dl-news', name: 'DL News', url: 'https://www.dlnews.com/', route: 'editorial contact',
    pay: 'varies', rateVerified: false, beats: ['crypto', 'regulation'], fit: ['fiction-marketcap'], pitched: false }),
  m({ id: 'bitcoin-magazine', name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/', route: 'submissions',
    pay: 'paid for some features', rateVerified: false, beats: ['bitcoin'], fit: ['merit-not-stake'], pitched: false }),
  m({ id: 'hackernoon', name: 'HackerNoon', url: 'https://hackernoon.com/', route: 'submit via platform',
    pay: '⚠️ generally unpaid', rateVerified: false, beats: ['technology', 'developers'],
    fit: ['ai-witness', 'merit-not-stake'], pitched: false,
    note: 'Easy to publish, indexed well, and worth it only as a backlink and a writing sample.' }),
]);

export const byId = (id) => MARKETS.find((x) => x.id === String(id || '')) || null;
export const asset = (id) => ASSETS.find((x) => x.id === String(id || '')) || null;

/** Markets that fit a given finished asset, unpitched first — that is the order to work in. */
export function marketsFor(assetId) {
  const a = String(assetId || '');
  return MARKETS.filter((mk) => mk.fit.includes(a))
    .sort((x, y) => Number(x.pitched) - Number(y.pitched) || x.name.localeCompare(y.name));
}

/** Everything not yet contacted — the actual work queue. */
export const unpitched = () => MARKETS.filter((mk) => !mk.pitched);

/**
 * TWO INSTRUMENTS, TWO SUBJECT FORMS. Conflating them is what produced the wrong advice once already.
 *
 *   'notice'  — a ONE-WAY COMMUNICATION THREAD to a standing list of named recipients. It continues
 *               whether or not anyone answers, because its purpose is the RECORD: that a named person
 *               was told, on a date, in writing. In the operator's legal work that is the whole point
 *               — DERELICT_1 turns on exactly this, an official who was informed and did not answer.
 *               A "Re:" here is ACCURATE: it is a real thread the sender started and is continuing.
 *               It is not a cold pitch wearing a disguise, and it should not be judged as one.
 *
 *   'pitch'   — a first approach to an editor who has never heard from you, asking them to BUY a
 *               piece. Here a "Re:" on first contact is read as deception and scored by filters, so
 *               the subject must stand on its own.
 *
 * Same corpus, different instrument, different deliverability problem. The mistake is using one
 * form for the other job.
 */
export const MODES = Object.freeze(['pitch', 'notice']);

export function subjectFor(assetId, { kind = 'Pitch', mode = 'pitch', thread = '' } = {}) {
  const a = asset(assetId);
  if (!a) return '';
  if (mode === 'notice') {
    // Continuing an existing thread: the thread's own subject governs, prefixed once.
    const base = String(thread || a.title).replace(/^re:\s*/i, '');
    return `Re: ${base}`;
  }
  return `${kind}: ${a.title}`;
}

/**
 * ⚠️ Deliverability applies to BOTH instruments and is where the record actually broke.
 * 18 sends to Frontiers hard-bounced at postmaster@frontiersin.net — a bounced notice is not a
 * notice, it proves the recipient was never told. In These Times replied that the address was not
 * monitored. A one-way thread only produces a record if it is DELIVERED, so bounce handling matters
 * more here than for a pitch, not less.
 */
export const DELIVERY_FAILURES = Object.freeze([
  { host: 'frontiersin.net', kind: 'hard-bounce', count: 18,
    note: 'Every "Charging framework" and "De Facto Rape Permits" send was undeliverable. Frontiers never received any of it.' },
  { host: 'inthesetimes.com', kind: 'unmonitored',
    note: 'Replied: "this is not the right spot. We do not check this account."' },
  { host: 'themarshallproject.org', kind: 'noreply',
    note: 'pitches+noreply@ — every response received was an autoresponder.' },
  { host: 'hudoig.gov', kind: 'hard-bounce', note: 'postmasteralerts@hudoig.gov returned Undeliverable.' },
]);

/** Rows whose pay figure has NOT been verified — check these before quoting or prioritising. */
export const unverifiedRates = () => MARKETS.filter((mk) => !mk.rateVerified);

export function summary() {
  return {
    markets: MARKETS.length,
    unpitched: unpitched().length,
    alreadyPitched: MARKETS.filter((mk) => mk.pitched).length,
    assets: ASSETS.length,
    ratesUnverified: unverifiedRates().length,
  };
}
