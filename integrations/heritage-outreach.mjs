// heritage-outreach — the diaspora and heritage communities the family research actually opens.
//
// Source: "The Phoenixian Genome — Tracing the Van Kush Genetic Heritage", Van Kush Family Research
// Institute, January 2026 (operator-supplied). It traces five documented lines and their places. Those
// places are real communities with real organizations, and several of them are already the subject of
// work in this repo — MELEK is Phoenician √mlk, and site/wiki/seed-articles/ carries Melqart, Tanit
// and Neith articles written in a scholarly register.
//
// ── THE LINE THIS MODULE HOLDS ────────────────────────────────────────────────────────────────────
//
// A genealogy document is a reason to be INTERESTED in a community. It is not a membership card, and
// heritage organizations can tell the difference instantly. So `verifyClaim()` refuses three things
// outright, and they are the whole point of the module:
//
//   1. IDENTITY-BY-PERCENTAGE. "I'm 25% Irish so I'm one of you" is the single fastest way to be
//      dismissed by an Irish clan society. An admixture percentage describes reference populations
//      alive today; it confers nothing. What is actually sayable is narrower and stronger: a named
//      ancestor, a named place, a documented migration.
//
//   2. CLAIMING AN ANCIENT PEOPLE. We do not get to say the Phoenicians were "ours." Nobody does.
//      What we can say is that we named a blockchain from their root and wrote a library about them,
//      and anybody can check both.
//
//   3. POPULATION-REPLACEMENT AND RACIAL-CLASSIFICATION ARGUMENTS. The source document's section on
//      1910s-40s naturalization cases and who "counts" as descended from an ancient population is
//      contested ground that shades directly into race science, and it has no place in outreach copy
//      whatever its intent. It stays out of every message this module produces. That is a deliberate
//      exclusion, not an oversight — the genealogy is interesting without it.
//
// Nothing here sends. It drafts, and drafts go through the Herald gate like everything else.
import { readFileSync } from 'node:fs';

const str = (v) => String(v == null ? '' : v).trim();
const low = (v) => str(v).toLowerCase();

// ── the frame that comes first ────────────────────────────────────────────────────────────────────
//
// Operator, 2026-09-08: "Our People are all Mixed."
//
// That corrects how this module was first built. It listed five lineages as if they were five
// separate doors — pick the Irish one and go talk to the Irish. But they are not five people. They
// are five strands in the same people, and the source document says so on its own front page: one
// person's results run 66.5% European, 26.5% East Asian and Native American, 3.4% Sub-Saharan
// African. Nobody in this family is a single line, and presenting as one would be a false face
// before we said anything else.
//
// So MIXED IS THE PRIMARY FRAME and the five lines are what it is mixed FROM. Three things follow,
// and they are improvements rather than concessions:
//
//   1. THE HONEST OPENER GETS EASIER. We are not walking into a Donegal association claiming to be
//      Irish. We are people whose family runs through Donegal, Denmark, Iberia, Mexico and East
//      Texas, saying which strand brought us to their door. That is both true and disarming, and it
//      is the opposite of the identity-by-percentage move `verifyClaim()` already refuses.
//
//   2. "MIXED" IS ITS OWN COMMUNITY, not a gap between other ones. Multiracial and mixed-heritage
//      organizations exist, they are underserved, and they are a better fit for us than any single
//      heritage body — because what we actually have in common with them is the condition, not a
//      country.
//
//   3. IT IS THE TRANSLATION ARGUMENT. Mixed families are disproportionately multilingual
//      households, and Pentecaust's headline feature is translation. That is a product fit that a
//      single-heritage framing cannot reach.
export const MIXED = Object.freeze({
  frame: 'Mixed is the fact. The lines below are what it is mixed from, not five alternative identities.',
  documented: 'The source document\'s own headline results span European, East Asian and Native '
            + 'American, and Sub-Saharan African components in one person.',
  openerShape: 'Name the strand that brought us to this particular door, and be plain that it is one '
             + 'strand of several. Never present as a single-heritage claimant.',
  communities: [
    'Multiracial and mixed-heritage organizations (MAVIN-descended groups, campus mixed-student unions)',
    'Mestizo and Afro-Latino cultural organizations',
    'Mixed-heritage genealogy and DNA communities — the people already doing exactly this research',
    'Multilingual-household and heritage-language programs',
    'DFW is one of the most demographically mixed metros in the United States; the local and the '
    + 'mixed framings are the same framing here',
  ],
  productFit: 'Mixed families are disproportionately multilingual households. Pentecaust ships '
            + 'translation. That is the fit a single-heritage framing cannot reach.',
});

// ── the documented lines ──────────────────────────────────────────────────────────────────────────
// Each carries the FACTS from the document that a stranger could verify, and the communities those
// facts actually touch. `claimable` is what may be said; it is deliberately narrow.
export const LINEAGES = Object.freeze([
  {
    id: 'gallagher',
    line: 'Gallagher — Ó Gallchobhair',
    documented: [
      'Irish surname from gall ("foreigner", conventionally Norse) + cobhair ("help") — "descendant of the foreign helper".',
      'County Donegal, barony of Tirhugh, near Ballyshannon. Donegal\'s Irish name, Contae Dhún na nGall, is "fort of the foreigners".',
      'The clan traces to Niall Noígíallach, Niall of the Nine Hostages.',
    ],
    claimable: 'The operator carries the surname. The etymology and the county are matters of record.',
    communities: [
      'Clann Ó Gallchobhair / Gallagher clan associations',
      'Donegal Association (Dublin, and the diaspora chapters)',
      'Irish-American cultural centres — Dallas has one',
      'Ireland Reaching Out (irelandxo.com), a parish-by-parish diaspora project',
      'r/ireland, r/Genealogy, r/IrishHistory — read the self-promo rules first',
    ],
  },
  {
    id: 'christenson',
    line: 'Christenson — Danish',
    documented: [
      'Danish/Norwegian patronymic, "son of Christen"; the sixth most common surname in Denmark.',
      'The -son spelling is the Americanised form immigrants adopted.',
      'The family settled Fox Lake / Antioch, north-eastern Illinois (Lake and McHenry counties).',
    ],
    claimable: 'A named immigrant line and a named place of settlement.',
    communities: [
      'Danish American Heritage Society; Museum of Danish America (Elk Horn, Iowa)',
      'Danish Brotherhood / Danish Sisterhood lodges',
      'Fox Lake / Antioch and McHenry County historical societies — the most concrete of these',
      'Chicago-area Scandinavian cultural organizations',
    ],
    note: 'The document names living relatives and a family business by address. Those are relatives to '
        + 'call, not outreach targets, and they are NOT recorded in the outreach seed file.',
  },
  {
    id: 'lopez',
    line: 'Lopez — Iberian / Mexican',
    documented: [
      'Iberian surname from Latin lupus.',
      'The line enters through Arlington / Grand Prairie, Texas.',
      'Mexican-American mestizo ancestry, itself Iberian and Indigenous Mesoamerican.',
    ],
    claimable: 'A named family line in a named part of the metroplex.',
    communities: [
      'Greater Dallas Hispanic Chamber of Commerce — and we already hold chamber lists',
      'Arlington and Grand Prairie Hispanic business associations',
      'LULAC councils; Mexican American Cultural Center; Latino Center for Leadership Development',
      'Spanish-language DFW media: Al Día (Dallas Morning News), Univision 23, Telemundo 39',
    ],
    productFit: 'This is the strongest practical fit in the whole file: Pentecaust\'s headline feature '
              + 'is TRANSLATION, and DFW has one of the largest Spanish-speaking populations in the '
              + 'United States. A bilingual product in a bilingual metroplex is a real argument.',
  },
  {
    id: 'henry-alexander',
    line: 'Henry / Alexander — Scots-Irish, Tennessee to East Texas',
    documented: [
      'Scroggins, Hopkins County, Texas; the line traces back to Tennessee.',
      'Part of the Scots-Irish migration through Appalachia to the frontier.',
      'Ona Mae Alexander Henry (1921-2017) built and repaired B-24 Liberator bombers, 1941-1944 — a '
      + 'Rosie the Riveter, documented in the Tyler newspaper and Hideaway Magazine.',
    ],
    claimable: 'A named great-grandmother, a named county, and published contemporaneous coverage.',
    communities: [
      'Hopkins County Genealogical Society; East Texas historical societies',
      'Rosie the Riveter organizations: American Rosie the Riveter Association; Rosie the Riveter Trust',
      'Commemorative Air Force (Dallas Wing); B-24 and WWII aviation preservation groups',
      'Texas State Historical Association; Portal to Texas History',
    ],
    pressAngle: 'The best local-press hook we have. A Rosie the Riveter who built B-24s in East Texas, '
              + 'and her great-grandson builds blockchains in Dallas. It is true, it is checkable, and '
              + 'it is the kind of story a Collin County or East Texas newsroom actually runs.',
  },
  {
    id: 'phoenician',
    line: 'Phoenician / Punic — the thread the document is named for',
    documented: [
      'Phoenician tin trade with the Cassiterides; Strabo records Gades (Cádiz) as the port.',
      '2022 isotopic analysis of tin ingots from Hishuley Carmel, Israel (13th-12th c. BCE) sourced '
      + 'them to Cornwall and Devon — direct evidence of Britain-to-Levant Bronze Age trade.',
      'Gades founded c. 1100 BCE; Carthage held much of the Iberian coast until 146 BCE.',
    ],
    claimable: 'NOT ancestry. What is ours here is the NAMING and the LIBRARY: MELEK is Phoenician '
             + '√mlk, and site/wiki/seed-articles/ carries Melqart, Tanit and Neith. Anyone can read them.',
    communities: [
      'Lebanese diaspora and heritage organizations (Tyre, Sidon, Byblos)',
      'Tunisian and Carthage heritage groups; Maltese and Sardinian cultural societies',
      'Cornish heritage bodies — the tin trade is their story too',
      'Academic: Phoenician/Punic studies lists, ASOR, Society of Biblical Literature',
      'Museums with Phoenician collections — a citation from us is worth something to them',
    ],
    caution: 'Phoenician descent is a live and touchy question in Lebanon and the Maghreb, with real '
           + 'political weight. We approach as people who named things after Melqart and wrote about '
           + 'him carefully, never as claimants.',
  },
]);

/** The things about the PROJECT that are checkable — the honest basis for every heritage approach. */
export const PROJECT_TIES = Object.freeze({
  melek_root: 'MELEK is Phoenician √mlk, "king". Melqart is MLK+QRT, "king of the city".',
  wiki: 'site/wiki/seed-articles/ carries Melqart, Tanit and Neith, written with the contested points '
      + 'flagged (Mosca on the bōshet vocalisation; Eissfeldt on mlk as a rite rather than a deity).',
  chain: 'The MELEK chain is live and public. Every block is checkable.',
  translation: 'Pentecaust ships translation — the reason a heritage community is a real audience and '
             + 'not a themed one.',
  local: 'Built in Dallas-Fort Worth.',
});

// ── refusals ──────────────────────────────────────────────────────────────────────────────────────
const REFUSALS = Object.freeze({
  identity_by_percentage: 'An admixture percentage is not a membership card. It describes people alive '
    + 'today whose DNA resembles yours — it says nothing about belonging, and a heritage society will '
    + 'read it as exactly the presumption it is. Name an ancestor and a place instead.',
  claiming_an_ancient_people: 'Nobody gets to claim the Phoenicians. We named a chain from their root '
    + 'and wrote a library about them; that is checkable and it is enough.',
  population_replacement: 'Population-replacement and racial-classification arguments — including the '
    + 'source document\'s naturalization-case section — stay out of outreach entirely. Contested ground '
    + 'that shades into race science, and the genealogy is interesting without it.',
  endorsement: 'No heritage organization has endorsed us. Sharing an ancestor is not a partnership.',
});

export function verifyClaim(text = '') {
  const t = low(text);
  const problems = [];
  if (/\b\d{1,3}\s*(?:%|percent)/.test(t) && /\b(irish|danish|mexican|spanish|phoenician|african|native|european|scandinavian)\b/.test(t)) {
    problems.push({ code: 'identity_by_percentage', why: REFUSALS.identity_by_percentage });
  }
  if (/\b(my|our|we are|i am)\b[^.]{0,40}\b(phoenician|carthaginian|punic)\b/.test(t)
      || /\b(phoenician|punic|carthaginian)\s+(blood|descent|heritage|ancestry)\b/.test(t)) {
    problems.push({ code: 'claiming_an_ancient_people', why: REFUSALS.claiming_an_ancient_people });
  }
  if (/\b(population replacement|racial classification|not the same population|who built the pyramids|pure ?blood|bloodline)\b/.test(t)) {
    problems.push({ code: 'population_replacement', why: REFUSALS.population_replacement });
  }
  if (/\b(endorsed|partnered|official)\b/.test(t) && /\b(clan|society|association|heritage|diaspora)\b/.test(t)) {
    problems.push({ code: 'endorsement', why: REFUSALS.endorsement });
  }
  return problems.length ? { ok: false, problems, reason: problems.map((p) => p.why).join(' ') } : { ok: true };
}

export function getLineage(id) {
  return LINEAGES.find((l) => l.id === low(id)) || null;
}

/**
 * Draft an approach to one heritage community.
 *
 * The shape is deliberate: lead with what we BUILT, because that is the part that is ours and the
 * part they can check. The family connection is the reason we care, mentioned once, as a reason —
 * never as a credential and never as a claim on them.
 */
export function draft({ lineage, community = '' } = {}) {
  const l = getLineage(lineage);
  if (!l) return { ok: false, code: 'unknown-lineage', reason: `no such lineage "${lineage}"` };

  const body = [
    community ? `To ${community} —` : 'Hello —',
    '',
    'I run a small technology company in Dallas–Fort Worth. We built a public blockchain called MELEK '
    + '— the name is Phoenician √mlk, "king", the root behind Melqart, MLK+QRT, "king of the city" — '
    + 'and a public library that includes articles on Melqart, Tanit and Neith. They are written the '
    + 'way a reference should be: the contested readings are flagged as contested rather than tidied '
    + 'away. You can read all of it before deciding whether I am worth talking to.',
    '',
    `What brought me to your work: ${l.documented[0]} ${l.claimable}`,
    '',
    'I should be straight that this is one strand of several — my family runs through a few '
    + 'different places and I am not going to present as though it runs through only yours.',
    '',
    'I am not writing to claim anything or to ask for an endorsement. I would like to know whether the '
    + 'material is any use to you, and whether anything in it is wrong — corrections from people who '
    + 'know the subject are worth more to us than agreement.',
  ].join('\n');

  const v = verifyClaim(body);
  if (!v.ok) return { ok: false, ...v };
  return {
    ok: true,
    lineage: l.id,
    community: str(community),
    subject: `A Phoenician-named project out of Dallas — and a question for you`,
    body,
    sends: false,
    basis: Object.keys(PROJECT_TIES),
    note: 'draft only — sending runs through the Herald entitlement gate.',
  };
}

/** What this opens, and what is still missing. */
export function plan() {
  const communities = LINEAGES.reduce((n, l) => n + l.communities.length, 0);
  return {
    ok: true,
    lineages: LINEAGES.map((l) => ({ id: l.id, line: l.line, communities: l.communities.length })),
    totalCommunities: communities,
    frame: MIXED.frame,
    strongest: {
      product: 'lopez — translation into a bilingual metroplex is an argument, not a theme',
      press: 'henry-alexander — a Rosie the Riveter who built B-24s, and her great-grandson builds '
           + 'blockchains in Dallas. True, checkable, and the kind of story a local newsroom runs.',
      credible: 'phoenician — because the claim is about what we NAMED and WROTE, not about ancestry.',
    },
    blocked: [
      'No specific organization has been contacted or verified as active. These are categories, not a list.',
      'Every one of them needs its own rules read before anything is posted or sent.',
    ],
  };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'heritage-outreach',
    source: 'The Phoenixian Genome, Van Kush Family Research Institute, January 2026',
    frame: MIXED,
    lineages: LINEAGES.map((l) => ({ id: l.id, line: l.line })),
    projectTies: PROJECT_TIES,
    refuses: REFUSALS,
    ...plan(),
  }, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith('heritage-outreach.mjs')) {
  console.log(JSON.stringify(plan(), null, 1));
  const d = draft({ lineage: 'phoenician', community: 'the Cornish heritage community' });
  console.log(`\n--- sample ---\n\n${d.ok ? d.body : d.reason}`);
  void readFileSync;
}
