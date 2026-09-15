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
