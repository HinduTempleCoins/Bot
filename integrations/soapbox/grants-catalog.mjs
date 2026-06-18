// grants-catalog.mjs — the DATA LAYER for the SoapBox Grant Aggregator (grants.soapbox.community).
// A curated, BY-FIELD map of where the money is: the master search portals first (Grants.gov, SAM.gov,
// Candid), then the big funders by field — research, schools, small business, nonprofits, arts,
// individuals/fellowships — plus a starter RFPs & contracts lane (we aggregate the aggregators).
//
// Like the credentials + hierophant catalogs: pure data, NO network, NO keys, link-out only. We map
// where to apply and who funds what; we never fabricate a program or a link. Honest, free-first —
// the searchable portals (where you actually find thousands of grants) lead each field.
//
//   import { FIELDS, GRANTS, byField, getGrant, search, fieldsWithCounts, validateCatalog }
//     from './grants-catalog.mjs'
//   node integrations/soapbox/grants-catalog.mjs            # coverage report
//   node integrations/soapbox/grants-catalog.mjs research

export const BRAND_GUARDRAIL =
  'We point you to the official application — free. The search portals (where you find thousands of '
  + 'grants and RFPs) lead each field. We never charge for access to public money, never pay-to-rank, '
  + 'and never sell your data.';

// ── fields (the BY-FIELD spine) ───────────────────────────────────────────────────────────────────
export const FIELDS = [
  { id: 'portals',            name: 'Search them all (the master portals)', blurb: 'Start here. The databases that let you search thousands of grants and RFPs at once — Grants.gov for all federal grants, SAM.gov for federal contracts, Candid for foundations.' },
  { id: 'research',           name: 'Research & science',                   blurb: 'Federal science money and research fellowships — NSF, NIH, DOE, NASA, DARPA, USDA, NEH, ARPA-H — plus the discovery tools researchers use.' },
  { id: 'education-schools',  name: 'Schools & education',                  blurb: 'Money for K-12 and districts — Title I, IDEA, 21st Century Learning Centers, charter/magnet, E-Rate broadband, the TEACH Grant for teachers, and classroom funders like DonorsChoose.' },
  { id: 'small-business',     name: 'Small business & startups',            blurb: 'SBIR/STTR (America\'s Seed Fund), SBA programs, USDA Rural, MBDA for minority-owned firms, and the well-known private small-business grants.' },
  { id: 'nonprofit-community', name: 'Nonprofits & community',              blurb: 'HUD community block grants (CDBG) and the major private foundations — Ford, MacArthur, Gates, Knight, Kresge, RWJF — plus how to find your local community foundation.' },
  { id: 'arts-humanities',    name: 'Arts & humanities',                    blurb: 'Project and artist funding — the NEA and NEH, state arts councils, and arts foundations like Mellon and Creative Capital.' },
  { id: 'individuals',        name: 'Individuals & fellowships',            blurb: 'Money that goes to a person, not an org — Guggenheim and MacArthur fellowships, Fulbright, artist grants, and emergency/hardship funds.' },
  { id: 'rfp-procurement',    name: 'RFPs & contracts',                     blurb: 'Where requests-for-proposals live — SAM.gov for federal contracts, state & local procurement, the big bid databases (BidNet, GovWin), and Candid\'s nonprofit RFP bulletin.' },
];
const FIELD_IDS = new Set(FIELDS.map((f) => f.id));

// kind: how to read the entry. 'portal' = a searchable database (these lead each field).
// 'federal' | 'state' | 'foundation' | 'fellowship' | 'rfp'. scope: a short eligibility/who-it's-for note.
function g(id, name, field, kind, funder, scope, url, what) {
  return { id, name, field, kind, funder, scope, url, what };
}

export const GRANTS = [
  // ── Master search portals ────────────────────────────────────────────────────────────────────────
  g('grants-gov', 'Grants.gov', 'portals', 'portal', 'U.S. federal government', 'All ~26 federal grant-making agencies in one search', 'https://www.grants.gov/',
    'The single front door to every federal grant — search by agency, category, and eligibility, then apply. Free. If you want U.S. government grant money, you start here.'),
  g('sam-gov', 'SAM.gov', 'portals', 'portal', 'U.S. federal government', 'Federal contract opportunities + the registration you MUST have to receive federal $', 'https://sam.gov/',
    'Two things in one: the official list of federal contract opportunities (RFPs), and the entity registration (free UEI) every organization must complete before it can receive any federal grant or contract.'),
  g('candid', 'Candid — Foundation Directory', 'portals', 'portal', 'Candid (Foundation Center + GuideStar)', 'The database of U.S. private & community foundations and their grants', 'https://candid.org/',
    'The authoritative database of foundation grants — who funds what, how much, and to whom. The paid Foundation Directory is the deep version; much is free, and many public libraries provide full access.'),
  g('usaspending', 'USAspending.gov', 'portals', 'portal', 'U.S. Treasury', 'See who already got funded (research before you apply)', 'https://www.usaspending.gov/',
    'The record of every federal award. Before applying, look up who won similar grants/contracts and for how much — the best free competitive intelligence there is.'),
  g('instrumentl', 'Instrumentl', 'portals', 'portal', 'Instrumentl (private)', 'Grant discovery + deadline tracking (free trial; paid)', 'https://www.instrumentl.com/',
    'A popular grant-discovery and deadline-tracking tool that matches your org/project to live opportunities (federal + foundation). Paid, with a free trial — useful if you apply often.'),
  g('grantwatch', 'GrantWatch', 'portals', 'portal', 'GrantWatch (private)', 'Broad listings across federal/state/foundation (paid)', 'https://www.grantwatch.com/',
    'A large, frequently-updated listing of grants across sectors and geographies. Subscription-based; handy for a quick scan of what\'s open in your field/state.'),

  // ── Research & science ────────────────────────────────────────────────────────────────────────────
  g('nsf', 'National Science Foundation (NSF)', 'research', 'federal', 'NSF', 'Science, engineering, math, and education research', 'https://www.nsf.gov/funding/',
    'The primary U.S. funder of non-medical basic research across all science and engineering. Thousands of programs; submit via Research.gov / Grants.gov.'),
  g('nih', 'National Institutes of Health (NIH)', 'research', 'federal', 'NIH', 'Biomedical & health research (the world\'s largest)', 'https://grants.nih.gov/',
    'The largest public funder of biomedical research on earth. Find programs in the NIH Guide, see funded work in RePORTER, and apply through Grants.gov / ASSIST.'),
  g('doe-science', 'DOE Office of Science', 'research', 'federal', 'U.S. Department of Energy', 'Physics, energy, computing, climate, materials', 'https://science.osti.gov/grants',
    'Department of Energy research funding — physical sciences, advanced computing, fusion, climate and the national labs. Apply via PAMS / Grants.gov.'),
  g('nasa-nspires', 'NASA Research (NSPIRES)', 'research', 'federal', 'NASA', 'Space, earth science, aeronautics research', 'https://nspires.nasaprs.com/',
    'NASA\'s solicitation and proposal system for space, earth-science and aeronautics research grants and fellowships.'),
  g('darpa', 'DARPA', 'research', 'federal', 'U.S. Department of Defense', 'High-risk, high-reward defense R&D', 'https://www.darpa.mil/work-with-us/opportunities',
    'Defense Advanced Research Projects Agency — funds breakthrough, high-risk research. Opportunities post as BAAs on SAM.gov / DARPA\'s site.'),
  g('usda-nifa', 'USDA NIFA', 'research', 'federal', 'U.S. Department of Agriculture', 'Agriculture, food, rural & land-grant research', 'https://www.nifa.usda.gov/grants',
    'The National Institute of Food and Agriculture funds agricultural, food-system, nutrition and rural research and extension.'),
  g('neh', 'National Endowment for the Humanities (NEH)', 'research', 'federal', 'NEH', 'Humanities research, preservation, public programs', 'https://www.neh.gov/grants',
    'Federal funding for humanities scholarship, archives, digital humanities, museums and public programs.'),
  g('arpa-h', 'ARPA-H', 'research', 'federal', 'U.S. Dept. of Health & Human Services', 'Breakthrough biomedical & health research', 'https://arpa-h.gov/engage-and-transition/funding',
    'The newer health-focused DARPA analogue — high-risk, high-reward biomedical projects.'),
  g('nsf-grfp', 'NSF Graduate Research Fellowship (GRFP)', 'research', 'fellowship', 'NSF', 'For early-stage graduate students in STEM', 'https://www.nsfgrfp.org/',
    'A flagship fellowship paying a stipend + tuition for graduate study in science and engineering. Apply early in (or just before) grad school.'),
  g('fulbright', 'Fulbright Program', 'research', 'fellowship', 'U.S. Department of State', 'Study, research or teach abroad (and to the US)', 'https://us.fulbrightonline.org/',
    'The flagship international exchange fellowship — research, study or teach abroad. Separate programs for students, scholars and teachers.'),

  // ── Schools & education ─────────────────────────────────────────────────────────────────────────
  g('ed-gov', 'U.S. Dept. of Education — Grants', 'education-schools', 'federal', 'U.S. Department of Education', 'The hub for all federal education grants', 'https://www.ed.gov/grants-and-programs',
    'The front door to federal education funding — formula grants that flow to states/districts and discretionary grants you compete for. Branches into the programs below.'),
  g('title-i', 'Title I (Part A)', 'education-schools', 'federal', 'U.S. Department of Education', 'Schools serving low-income students', 'https://www.ed.gov/grants-and-programs/grants-special-populations/economically-disadvantaged-students/title-i-part-a-improving-basic-programs-operated-state-and-local-educational-agencies',
    'The largest federal K-12 program — money for schools with high shares of low-income students. Flows through your state and district (not applied for directly by a school in most cases).'),
  g('idea', 'IDEA — Special Education', 'education-schools', 'federal', 'U.S. Department of Education (OSEP)', 'Services for students with disabilities', 'https://sites.ed.gov/idea/',
    'Funds special-education services under the Individuals with Disabilities Education Act. Formula money to states/districts; also discretionary research/personnel grants.'),
  g('21st-cclc', '21st Century Community Learning Centers', 'education-schools', 'federal', 'U.S. Department of Education', 'After-school & summer programs', 'https://www.ed.gov/grants-and-programs/grants-state-and-local-agencies/improving-student-academic-achievement/21st-century-community-learning-centers',
    'Federal money (via states) for before/after-school and summer learning programs, especially in high-poverty communities. Apply through your state education agency.'),
  g('charter-magnet', 'Charter Schools Program & Magnet Schools Assistance', 'education-schools', 'federal', 'U.S. Department of Education', 'Starting/expanding charters; magnet programs', 'https://www.ed.gov/grants-and-programs/grants-special-populations/charter-schools',
    'Discretionary grants to start or expand charter schools (CSP) and to run magnet programs that promote diversity (MSAP).'),
  g('teach-grant', 'TEACH Grant', 'education-schools', 'federal', 'U.S. Department of Education (FSA)', 'Up to $4,000/yr for future teachers', 'https://studentaid.gov/understand-aid/types/grants/teach',
    'A grant (not a loan) for students who agree to teach a high-need subject in a low-income school for four years — up to $4,000/year. Misses the service terms and it converts to a loan, so read the rules.'),
  g('e-rate', 'E-Rate (Schools & Libraries Program)', 'education-schools', 'federal', 'FCC / USAC', 'Discounted broadband & networking for schools/libraries', 'https://www.usac.org/e-rate/',
    'Deep discounts (20–90%) on internet and internal networking for schools and libraries. Administered by USAC; apply each funding year.'),
  g('donorschoose', 'DonorsChoose', 'education-schools', 'foundation', 'DonorsChoose (nonprofit)', 'For individual public-school teachers', 'https://www.donorschoose.org/',
    'Public-school teachers post classroom project requests; donors fund them. The fastest, easiest "grant" for a teacher who needs supplies or materials now.'),
  g('nea-foundation', 'NEA Foundation Grants', 'education-schools', 'foundation', 'NEA Foundation', 'For public-school educators', 'https://www.neafoundation.org/for-educators/',
    'Grants to public-school educators for professional development and student-learning projects (Learning & Leadership, Student Success grants).'),

  // ── Small business & startups ─────────────────────────────────────────────────────────────────────
  g('sbir-sttr', 'SBIR / STTR — America\'s Seed Fund', 'small-business', 'federal', '11 federal agencies (SBA-coordinated)', 'R&D-stage small businesses (non-dilutive funding)', 'https://www.sbir.gov/',
    'The biggest source of early-stage, non-dilutive R&D money for small businesses — ~$4B/yr across NIH, NSF, DOD, DOE and more. You keep your equity. Start at SBIR.gov.'),
  g('sba', 'U.S. Small Business Administration (SBA)', 'small-business', 'federal', 'SBA', 'Programs, grants & local counseling', 'https://www.sba.gov/funding-programs/grants',
    'The SBA mostly backs loans, but it runs grant programs (e.g. for exporting, research, community lenders) and free counseling via SBDCs/SCORE. The honest first stop for small-biz funding.'),
  g('usda-rural', 'USDA Rural Development', 'small-business', 'federal', 'U.S. Department of Agriculture', 'Businesses & co-ops in rural areas', 'https://www.rd.usda.gov/programs-services/all-programs',
    'Grants and loans for businesses, energy projects and infrastructure in rural communities (e.g. REAP energy grants, Rural Business Development Grants).'),
  g('mbda', 'Minority Business Development Agency (MBDA)', 'small-business', 'federal', 'U.S. Department of Commerce', 'Minority-owned businesses', 'https://www.mbda.gov/',
    'Federal agency dedicated to growing minority-owned firms — grant competitions and a national network of business centers.'),
  g('hello-alice', 'Hello Alice — Small Business Grants', 'small-business', 'foundation', 'Hello Alice (private)', 'Small businesses (frequent themed grants)', 'https://helloalice.com/grants/',
    'A platform that runs frequent small-business grant programs (often $5k–$50k) with corporate sponsors, plus funding discovery. Free to join and apply.'),
  g('amber-grant', 'Amber Grant for Women', 'small-business', 'foundation', 'WomensNet', 'Women-owned businesses', 'https://ambergrantsforwomen.com/',
    'Monthly + annual grants for women entrepreneurs. Small application, low barrier — a well-known starting grant for women-owned businesses.'),

  // ── Nonprofits & community ────────────────────────────────────────────────────────────────────────
  g('cdbg', 'Community Development Block Grant (CDBG)', 'nonprofit-community', 'federal', 'U.S. Dept. of Housing & Urban Development', 'Community & economic development (via cities/states)', 'https://www.hud.gov/program_offices/comm_planning/cdbg',
    'Flexible HUD money for housing, infrastructure and economic development in low/moderate-income communities. Flows through your city or state — apply locally.'),
  g('ford-foundation', 'Ford Foundation', 'nonprofit-community', 'foundation', 'Ford Foundation', 'Social justice & inequality work', 'https://www.fordfoundation.org/work/our-grants/',
    'One of the largest U.S. foundations — funds organizations working on inequality, civic engagement, and justice. Mostly invited/relationship-based; read their areas first.'),
  g('macarthur', 'MacArthur Foundation', 'nonprofit-community', 'foundation', 'John D. & Catherine T. MacArthur Foundation', 'Big-bet social, climate & justice work', 'https://www.macfound.org/grants/',
    'Major foundation funding climate, criminal-justice reform, and "big bets." Largely strategy-led; check open calls and eligible areas.'),
  g('gates-foundation', 'Gates Foundation', 'nonprofit-community', 'foundation', 'Bill & Melinda Gates Foundation', 'Global health, development, US education', 'https://www.gatesfoundation.org/about/how-we-work/grant-opportunities',
    'The world\'s largest private foundation — global health, development, and U.S. education/economic mobility. Mostly invited, with periodic open Grand Challenges.'),
  g('rwjf', 'Robert Wood Johnson Foundation (RWJF)', 'nonprofit-community', 'foundation', 'RWJF', 'Health & health-equity work', 'https://www.rwjf.org/en/grants/funding-opportunities.html',
    'The largest U.S. philanthropy focused on health — funds research and programs advancing health equity. Posts open funding opportunities regularly.'),
  g('knight-foundation', 'Knight Foundation', 'nonprofit-community', 'foundation', 'John S. and James L. Knight Foundation', 'Journalism, arts, and the 26 Knight communities', 'https://knightfoundation.org/grants/',
    'Funds journalism, the arts and civic life — with special focus on 26 specific communities. Open calls plus relationship-based grants.'),
  g('community-foundations', 'Find your local Community Foundation', 'nonprofit-community', 'foundation', 'Council on Foundations / local', 'Local nonprofits & projects (often the easiest "yes")', 'https://www.cof.org/page/community-foundation-locator',
    'Every region has a community foundation that funds local nonprofits and projects — often the most accessible grant money for a small/new org. Use the locator to find yours.'),

  // ── Arts & humanities ─────────────────────────────────────────────────────────────────────────────
  g('nea', 'National Endowment for the Arts (NEA)', 'arts-humanities', 'federal', 'NEA', 'Arts projects (orgs; and via state arts agencies)', 'https://www.arts.gov/grants',
    'Federal arts funding — project grants to organizations, partnerships with state arts agencies, and (rare) fellowships. The cornerstone of U.S. public arts money.'),
  g('state-arts-councils', 'State & Regional Arts Councils', 'arts-humanities', 'state', 'Your state arts agency', 'Individual artists & local arts orgs', 'https://nasaa-arts.org/state-arts-agencies/',
    'Most NEA money re-grants through state arts agencies, which DO fund individual artists and small orgs. Find yours — it\'s often the most reachable arts grant.'),
  g('mellon', 'Mellon Foundation', 'arts-humanities', 'foundation', 'Andrew W. Mellon Foundation', 'Humanities, arts, higher ed, social justice', 'https://www.mellon.org/grants/grant-resources',
    'The largest humanities-and-arts funder in the U.S. — supports higher ed, public knowledge, arts and culture. Mostly invited; review priorities and contact program staff.'),
  g('creative-capital', 'Creative Capital', 'arts-humanities', 'foundation', 'Creative Capital', 'Individual artists (open call)', 'https://creative-capital.org/',
    'Project grants and career support to individual artists across disciplines through a competitive open application — a rare big artist grant you can just apply for.'),

  // ── Individuals & fellowships ─────────────────────────────────────────────────────────────────────
  g('guggenheim', 'Guggenheim Fellowships', 'individuals', 'fellowship', 'John Simon Guggenheim Memorial Foundation', 'Mid-career scholars & artists (open application)', 'https://www.gf.org/',
    'Prestigious fellowships for those who have demonstrated exceptional capacity in scholarship or the arts. Open application (US/Canada).'),
  g('macarthur-fellows', 'MacArthur Fellows ("Genius Grant")', 'individuals', 'fellowship', 'MacArthur Foundation', 'By nomination only — you cannot apply', 'https://www.macfound.org/programs/awards/fellows/',
    'The $800k "genius grant" — awarded by confidential nomination, not application. Listed so you know it exists and how it actually works (you build the body of work; they find you).'),
  g('modest-needs', 'Modest Needs — Emergency Grants', 'individuals', 'foundation', 'Modest Needs (nonprofit)', 'Individuals/families facing a short-term crisis', 'https://www.modestneeds.org/',
    'Small emergency grants to working individuals and families hit by an unexpected expense — a real, applicable hardship fund (not a loan).'),
  g('scholarship-search', 'Scholarship search (Fastweb / Scholarships.com)', 'individuals', 'portal', 'Fastweb / Scholarships.com', 'Students seeking tuition money', 'https://www.fastweb.com/',
    'Free databases to match students to scholarships. Pair with our Credentials portal\'s "free college credit" paths (Modern States, Saylor) to cut cost from both sides.'),

  // ── RFPs & contracts (aggregate the aggregators) ─────────────────────────────────────────────────
  g('sam-contract-opps', 'SAM.gov — Contract Opportunities', 'rfp-procurement', 'rfp', 'U.S. federal government', 'Every federal RFP/solicitation (free)', 'https://sam.gov/content/opportunities',
    'The official, free home of all federal RFPs, RFQs and solicitations. Search by NAICS/keyword, set saved searches, and (after free SAM registration) respond.'),
  g('state-procurement', 'State & Local Procurement Portals', 'rfp-procurement', 'rfp', 'NASPO / your state', 'State & local government RFPs', 'https://www.naspo.org/',
    'Each state (and most big cities) runs its own bid/RFP portal. NASPO links state procurement offices — the entry to state & local contract opportunities.'),
  g('bidnet', 'BidNet / state bid systems', 'rfp-procurement', 'rfp', 'BidNet (private)', 'Aggregated state & local bids', 'https://www.bidnet.com/',
    'A commercial aggregator of state and local government bids/RFPs across regions — paid, but a single feed instead of dozens of portals.'),
  g('govwin', 'GovWin IQ (Deltek)', 'rfp-procurement', 'rfp', 'Deltek (private)', 'Pre-RFP intelligence + opportunities (enterprise)', 'https://iq.govwin.com/',
    'The enterprise tool for tracking government opportunities before and after they post (federal/state/local). Expensive; for serious gov contractors.'),
  g('candid-rfp', 'Candid — Philanthropy News Digest RFPs', 'rfp-procurement', 'rfp', 'Candid', 'Open nonprofit/foundation RFPs (free)', 'https://philanthropynewsdigest.org/rfps',
    'A free, regularly-updated bulletin of open requests-for-proposals from foundations and nonprofits — the grant-world counterpart to SAM.gov\'s contract RFPs.'),
  g('grants-gov-rfp', 'Grants.gov — open opportunities feed', 'rfp-procurement', 'rfp', 'U.S. federal government', 'All open federal grant solicitations (free)', 'https://www.grants.gov/search-grants',
    'Grants.gov\'s search IS the federal "grant RFP" feed — filter to open opportunities by agency, category and eligibility, and subscribe to email alerts.'),
];

// ── accessors ───────────────────────────────────────────────────────────────────────────────────
const norm = (s) => String(s || '').toLowerCase().trim();
const KIND_RANK = { portal: 0, federal: 1, state: 2, foundation: 3, fellowship: 4, rfp: 5 };

export function field(id) { return FIELDS.find((f) => f.id === norm(id)) || null; }
export function getGrant(id) { return GRANTS.find((x) => x.id === norm(id)) || null; }

/** Grants in a field — searchable portals first, then by kind, stable within a bucket. */
export function byField(id) {
  const key = norm(id);
  if (!FIELD_IDS.has(key)) return [];
  return GRANTS.filter((x) => x.field === key)
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (KIND_RANK[a.x.kind] ?? 9) - (KIND_RANK[b.x.kind] ?? 9) || a.i - b.i)
    .map(({ x }) => x);
}

/** Keyword search across name / funder / scope / what / field. Portals first within equal relevance. */
export function search(q, { limit = 12 } = {}) {
  const terms = (norm(q).match(/[a-z0-9][a-z0-9+.-]{1,}/g) || []);
  if (!terms.length) return [];
  return GRANTS.map((x) => {
    const hay = `${x.name} ${x.funder} ${x.scope} ${x.what} ${x.field} ${x.kind}`.toLowerCase();
    const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
    return { x, score };
  }).filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (KIND_RANK[a.x.kind] ?? 9) - (KIND_RANK[b.x.kind] ?? 9))
    .slice(0, limit)
    .map((r) => r.x);
}

export function fieldsWithCounts() {
  return FIELDS.map((f) => {
    const items = GRANTS.filter((x) => x.field === f.id);
    return { ...f, total: items.length, portals: items.filter((x) => x.kind === 'portal').length };
  });
}

export function validateCatalog() {
  const errors = [];
  const ids = new Set();
  const kinds = new Set(Object.keys(KIND_RANK));
  for (const x of GRANTS) {
    if (!x.id || ids.has(x.id)) errors.push(`bad/dup id: ${x.id}`); else ids.add(x.id);
    if (!FIELD_IDS.has(x.field)) errors.push(`${x.id}: unknown field ${x.field}`);
    if (!/^https:\/\//.test(x.url || '')) errors.push(`${x.id}: non-https url`);
    if (!kinds.has(x.kind)) errors.push(`${x.id}: bad kind ${x.kind}`);
  }
  return { ok: errors.length === 0, errors, fields: FIELDS.length, grants: GRANTS.length };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('grants-catalog.mjs')) {
  const arg = process.argv[2];
  if (arg && field(arg)) {
    const f = field(arg);
    console.log(`${f.name} — ${f.blurb}\n`);
    for (const x of byField(arg)) console.log(`  [${x.kind.toUpperCase().padEnd(10)}] ${x.name}  <${x.url}>`);
  } else {
    const v = validateCatalog();
    console.log(`Grant aggregator — ${v.grants} sources across ${v.fields} fields (valid: ${v.ok})`);
    if (!v.ok) v.errors.forEach((e) => console.log('  ! ' + e));
    console.log('');
    for (const f of fieldsWithCounts()) console.log(`  ${f.id.padEnd(20)} ${String(f.total).padStart(2)} (${f.portals} portals) — ${f.name}`);
    console.log('\nUsage: node integrations/soapbox/grants-catalog.mjs [<field-id>]');
  }
}
