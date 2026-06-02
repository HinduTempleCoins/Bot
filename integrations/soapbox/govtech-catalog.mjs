// govtech-catalog.mjs — the structured index of GOVERNMENT-technology entry points: the open
// gov APIs/SDKs MELEK can integrate, the standards a gov-grade build must conform to, the
// identity rails, the incumbent platforms agencies already run on, and the contracting/credential
// path to actually sell to government. This is the data layer behind task #182 (map the gov-tech
// landscape so MELEK can build gov-grade software, get training/credentials gov-approved, and win
// modernization contracts). Full strategy write-up lives in .local/GOVTECH_LANDSCAPE.md.
//
// Same shape-as-index discipline as api-catalog.mjs: a STRUCTURED INDEX, not live clients. No
// secrets, no live calls at module load. Knowledge as of mid-2026 — access models and key
// requirements change; treat as a starting point and VERIFY before relying on a quota.
//
// Each entry:
//   { name, category, url, kind, keyless?, notes }
//     kind     : 'gov-api'     → a callable government data/service API.
//                'sdk'         → a client library / dev kit / design toolkit to build with.
//                'platform'    → an incumbent system agencies run on (the field to "show up" in).
//                'standard'    → a spec/standard a gov-grade build must conform to (not callable).
//                'identity'    → an identity / single-sign-on / proofing rail.
//                'contracting' → a procurement/authorization/credential gate to sell to gov.
//     keyless  : true  → callable with no signup/key (or a public DEMO_KEY). Omitted/false → a key,
//                registration, FedRAMP boundary, or vendor relationship is required first.
//     category : the functional bucket (Secretary of State, DMV, Public Safety, 311/Civic,
//                Federal Identity & Data, Standards & Design, Gov Platforms, Gov Cloud, Contracting).
//
//   import { GOVTECH, byCategory, byKind, keyless } from './govtech-catalog.mjs'

export const CATEGORIES = [
  'Secretary of State',
  'DMV',
  'Public Safety',
  '311/Civic',
  'Federal Identity & Data',
  'Standards & Design',
  'Gov Platforms',
  'Gov Cloud',
  'Contracting',
];

export const KINDS = ['gov-api', 'sdk', 'platform', 'standard', 'identity', 'contracting'];

export const GOVTECH = [
  // ── SECRETARY OF STATE: elections, business entities, open data ───────────────────────────────
  { name: 'OpenFEC API', category: 'Secretary of State', url: 'https://api.open.fec.gov/developers/', kind: 'gov-api', keyless: true, notes: 'FEC campaign-finance REST API (candidates, committees, filings). Keyless via DEMO_KEY; free api.data.gov key lifts limits. Nightly updates. Federal analogue to state elections/finance data. THIS-WEEK demo candidate.' },
  { name: 'state SoS open-data portals', category: 'Secretary of State', url: 'https://catalog.data.gov/', kind: 'gov-api', keyless: true, notes: 'Most states publish business-entity registries + elections data on Socrata/CKAN portals (e.g. data.ca.gov, data.ny.gov). No single national business-entity API — per-state, mostly keyless Socrata SODA endpoints. Aggregate per state.' },
  { name: 'Socrata Open Data API (SODA)', category: 'Secretary of State', url: 'https://dev.socrata.com/', kind: 'sdk', keyless: true, notes: 'The query layer under thousands of state/city open-data portals (Tyler-owned). SoQL over HTTP, keyless reads (app token raises limits). The de-facto way to read state/SoS/311 open datasets.' },

  // ── DMV / MOTOR VEHICLES: AAMVA networks + modernization incumbents ────────────────────────────
  { name: 'AAMVA DLDV', category: 'DMV', url: 'https://www.aamva.org/technology/systems/verification-systems/dldv', kind: 'gov-api', notes: 'Driver\'s License Data Verification — real-time web-service match of DL/ID fields against the issuing jurisdiction. Vendor/government-only; AAMVA membership + agreement required. Not open.' },
  { name: 'AAMVA S2S', category: 'DMV', url: 'https://www.aamva.org/technology/systems/driver-licensing-systems/state-to-state-verification-service-(s2s)', kind: 'gov-api', notes: 'State-to-State Verification — one-driver-one-record across participating states (now with Driver History Record). DMV-agency-only via AAMVA network. Not public.' },
  { name: 'AAMVA NMVTIS', category: 'DMV', url: 'https://www.aamva.org/technology/systems/vehicle-systems/nmvtis', kind: 'gov-api', notes: 'National Motor Vehicle Title Information System — title/brand/junk-salvage history; all states/insurers/junkyards report by federal law. Access via approved NMVTIS data providers (vendor relationship), not a public key.' },
  { name: 'Tyler / Accela DMV & licensing platforms', category: 'DMV', url: 'https://www.tylertech.com/', kind: 'platform', notes: 'State DMV/credentialing modernization is largely Tyler, Accela, and FAST Enterprises (FAST is the dominant driver-licensing/tax incumbent at state level). The "show up" target for statewide DMV rebuilds — operator\'s ex-Nebulogic DMV-SaaS lineage maps here.' },

  // ── PUBLIC SAFETY: FirstNet, NG911, RapidSOS ──────────────────────────────────────────────────
  { name: 'FirstNet Developer Program', category: 'Public Safety', url: 'https://developer.firstnet.com/firstnet/apis-sdks', kind: 'gov-api', notes: 'AT&T-run public-safety broadband (FirstNet Authority is the federal entity). API/SDK catalog for the nation\'s only public-safety app ecosystem. Developer registration + public-safety vetting; not open-anon.' },
  { name: 'RapidSOS Emergency API', category: 'Public Safety', url: 'https://developer.rapidsos.com/', kind: 'gov-api', notes: 'Connects device/app location + additional data to 911/ECCs. Free to public-safety vendors and ECCs; partner registration required. Now delivers HARMONY AI through AT&T ESInet NG911. Partner-gated.' },
  { name: 'NG911 / ESInet (NENA i3)', category: 'Public Safety', url: 'https://www.nena.org/page/i3_Stage3', kind: 'standard', notes: 'Next-Generation 911 architecture — IP-based emergency call routing per NENA i3. The standard any public-safety integration must speak. Spec, not a callable API.' },

  // ── 311 / CIVIC: Open311 + the platforms behind it ────────────────────────────────────────────
  { name: 'Open311 GeoReport v2', category: '311/Civic', url: 'https://wiki.open311.org/GeoReport_v2/', kind: 'standard', keyless: true, notes: 'Open spec for non-emergency service requests (potholes, graffiti, street cleaning). Services + service_requests resources; jurisdiction_id = city root URL. Read endpoints keyless; POSTing a request often needs an api_key. Implemented by Chicago, SF, DC, Boston, NYC, Toronto. THIS-WEEK demo candidate (read services for a live city).' },
  { name: 'SeeClickFix Open311 endpoints', category: '311/Civic', url: 'https://seeclickfix.com/open311/v2/docs', kind: 'gov-api', keyless: true, notes: 'Reference Open311 server; provides GeoReport v2 endpoints for all its client cities. Easiest live, keyless way to pull real 311 service lists. (SeeClickFix is a CivicPlus product.)' },
  { name: 'Open311 reference implementation', category: '311/Civic', url: 'https://github.com/SeeClickFix/Open311', kind: 'sdk', keyless: true, notes: 'Open-source reference implementation of the Open311 API — basis for standing up our own GeoReport v2 server to out-build a 311 incumbent.' },

  // ── FEDERAL IDENTITY & DATA: the keyless/free-key open APIs MELEK can demo on ──────────────────
  { name: 'SAM.gov Entity Management API', category: 'Federal Identity & Data', url: 'https://open.gsa.gov/api/entity-api/', kind: 'gov-api', notes: 'Authoritative registry of entities doing business with the federal government (keyed to UEI). Public read tier needs a system account + api.data.gov key (public ~10/day, registered ~1,000/day). The contracting-identity source of truth.' },
  { name: 'SAM.gov Get Opportunities (Public) API', category: 'Federal Identity & Data', url: 'https://open.gsa.gov/api/get-opportunities-public-api/', kind: 'gov-api', keyless: true, notes: 'Public federal contract-opportunity (RFP/RFI) feed. Free api.data.gov key. How MELEK programmatically watches for modernization solicitations to bid. THIS-WEEK demo candidate.' },
  { name: 'USAspending API', category: 'Federal Identity & Data', url: 'https://api.usaspending.gov/', kind: 'gov-api', keyless: true, notes: 'All federal award spending — contracts/grants by agency, recipient, geography. Fully keyless REST. Best first demo: show which agencies/vendors win gov-tech dollars. THIS-WEEK demo candidate.' },
  { name: 'Census Data API', category: 'Federal Identity & Data', url: 'https://www.census.gov/data/developers.html', kind: 'gov-api', notes: 'Demographic/economic data (ACS, decennial, business patterns). Free API key required (instant signup). Powers any place-based gov dashboard. THIS-WEEK demo candidate (free key).' },
  { name: 'Regulations.gov API', category: 'Federal Identity & Data', url: 'https://open.gsa.gov/api/regulationsgov/', kind: 'gov-api', notes: 'Search/read federal dockets, documents, and public comments; supports comment submission. Free api.data.gov key. Useful for rulemaking-aware civic tools.' },
  { name: 'api.data.gov', category: 'Federal Identity & Data', url: 'https://api.data.gov/', kind: 'gov-api', keyless: true, notes: 'The shared API gateway/key for most federal APIs (one free DEMO_KEY-or-signup key works across OpenFEC, SAM, Regulations.gov, NREL, FEMA, etc.). The single front door — get one key, reach many agencies.' },
  { name: 'Data.gov catalog', category: 'Federal Identity & Data', url: 'https://catalog.data.gov/', kind: 'gov-api', keyless: true, notes: 'CKAN catalog of 250k+ federal/state/local datasets and their API endpoints. Discovery layer — find the dataset, then hit its (often keyless) API.' },
  { name: 'GSA Open Technology APIs', category: 'Federal Identity & Data', url: 'https://open.gsa.gov/api/', kind: 'gov-api', notes: 'Index of GSA-run APIs (SAM, USAspending, Site Scanning, IT Collect, Assistance Listings, per-diem, etc.). Most via api.data.gov key. The map of what GSA exposes.' },

  // ── IDENTITY RAILS ────────────────────────────────────────────────────────────────────────────
  { name: 'Login.gov', category: 'Federal Identity & Data', url: 'https://developers.login.gov/', kind: 'identity', notes: 'Federal single-sign-on + identity proofing (OIDC/SAML). FedRAMP Moderate; IAL2/NIST 800-63-3 proofing tiers incl. facial match. The government identity rail to integrate so users sign into MELEK gov apps the way they sign into federal services. Registration/partner agreement required.' },
  { name: 'ID.me', category: 'Federal Identity & Data', url: 'https://developers.id.me/', kind: 'identity', notes: 'Private IAL2 identity-proofing IdP used by IRS, VA, and many state agencies (unemployment, DMV). OIDC/SAML. Commercial partner; alternative/complement to Login.gov where states require it.' },

  // ── STANDARDS & DESIGN: conformance for a gov-grade build ─────────────────────────────────────
  { name: 'U.S. Web Design System (USWDS)', category: 'Standards & Design', url: 'https://designsystem.digital.gov/', kind: 'sdk', keyless: true, notes: 'GSA/TTS design system — accessible, mobile-first UI components + tokens. Building MELEK gov front-ends in USWDS makes them look and behave like federal sites. Open-source (github.com/uswds/uswds). Adopt day one.' },
  { name: 'NIEM (National Information Exchange Model)', category: 'Standards & Design', url: 'https://www.niem.gov/', kind: 'standard', notes: 'DOJ/DHS/HHS-backed data-exchange model (justice, public safety, human services, health). NDR conformance; compatible with HL7/FHIR. The standard for cross-agency data exchange — conform to win justice/safety/health integrations.' },
  { name: 'HL7 FHIR', category: 'Standards & Design', url: 'https://www.hl7.org/fhir/', kind: 'standard', keyless: true, notes: 'Health-data interoperability standard — required for Medicaid/CMS and any health-adjacent gov build (CMS Interoperability rule). Open spec + public test servers. Pair with NIEM for human-services exchanges.' },
  { name: 'cloud.gov', category: 'Standards & Design', url: 'https://cloud.gov/', kind: 'platform', notes: 'GSA/TTS FedRAMP-authorized PaaS (Cloud Foundry) for federal teams — a fast, pre-authorized hosting path for gov apps. Reduces the compliance lift of a from-scratch ATO.' },
  { name: '18F / TTS engineering tooling', category: 'Standards & Design', url: 'https://18f.gsa.gov/', kind: 'sdk', keyless: true, notes: 'GSA digital-services org behind USWDS, cloud.gov, and the U.S. Digital Services Playbook. Open patterns/guides for building like the government does — adopt their playbook to pass digital-services reviews.' },
  { name: 'Section 508 / WCAG accessibility', category: 'Standards & Design', url: 'https://www.section508.gov/', kind: 'standard', keyless: true, notes: 'Legally required accessibility conformance (WCAG 2.x) for any software sold to government. Non-conformance disqualifies bids. USWDS gets us most of the way; full 508 testing is mandatory.' },

  // ── GOV PLATFORMS: the incumbents to "show up" against ────────────────────────────────────────
  { name: 'Tyler Technologies', category: 'Gov Platforms', url: 'https://www.tylertech.com/', kind: 'platform', notes: 'The largest US gov-tech vendor. Dominates courts/justice, ERP/financials, property tax, EnerGov permitting/licensing, and (via NIC) gov payments + (via Socrata) open data. The 800-lb incumbent across most state/local back-office.' },
  { name: 'Accela', category: 'Gov Platforms', url: 'https://www.accela.com/', kind: 'platform', notes: 'Civic Platform for permitting, licensing, code enforcement — deep in California, Florida, large counties. Highest per-deal value in permitting. A focused, out-buildable first target (vs. Tyler\'s breadth).' },
  { name: 'Granicus', category: 'Gov Platforms', url: 'https://granicus.com/', kind: 'platform', notes: 'Dominates gov websites, agendas/meetings/legislative management, and citizen comms/notifications (govDelivery). The civic-engagement + transparency layer.' },
  { name: 'OpenGov', category: 'Gov Platforms', url: 'https://opengov.com/', kind: 'platform', notes: 'Fastest-growing modern SaaS challenger — budgeting, permitting, procurement, reporting for mid-size cities. Cloud-native, API-friendly. The model MELEK should emulate (and the gap to exploit at the small-city tier).' },
  { name: 'CivicPlus', category: 'Gov Platforms', url: 'https://www.civicplus.com/', kind: 'platform', notes: 'Largest footprint by count among small/mid municipalities — gov CMS/websites, 311 (SeeClickFix), recreation, agendas. The small-town default; out-building here = breadth of references.' },
  { name: 'Esri ArcGIS', category: 'Gov Platforms', url: 'https://developers.arcgis.com/', kind: 'platform', keyless: true, notes: 'De-facto government GIS standard — mapping, spatial analysis, field apps. ArcGIS REST + open APIs (some keyless). Nearly every gov-tech build integrates ArcGIS; don\'t out-build, integrate.' },
  { name: 'Tyler Data & Insights (Socrata)', category: 'Gov Platforms', url: 'https://www.tylertech.com/products/data-insights', kind: 'platform', keyless: true, notes: 'The dominant open-data portal platform (formerly Socrata, now Tyler). Powers data.gov-style state/city portals; reads are keyless SODA. Where most published gov data already lives.' },

  // ── GOV CLOUD: the authorized hosting boundaries ──────────────────────────────────────────────
  { name: 'AWS GovCloud (US)', category: 'Gov Cloud', url: 'https://aws.amazon.com/govcloud-us/', kind: 'platform', notes: 'Isolated AWS regions for FedRAMP High / DoD / ITAR / CJIS workloads. The default landing zone for a serious federal/state SaaS ATO.' },
  { name: 'Microsoft Azure Government', category: 'Gov Cloud', url: 'https://azure.microsoft.com/en-us/explore/global-infrastructure/government', kind: 'platform', notes: 'Isolated Azure for US government (FedRAMP High, DoD IL5, CJIS). Strong where agencies are Microsoft/M365 shops.' },
  { name: 'Google Distributed Cloud / Google Public Sector', category: 'Gov Cloud', url: 'https://cloud.google.com/public-sector', kind: 'platform', notes: 'Google\'s FedRAMP/IL-authorized + air-gapped (Distributed Cloud) offerings for government, incl. data-sovereign deployments.' },
  { name: 'Salesforce Government Cloud', category: 'Gov Cloud', url: 'https://www.salesforce.com/solutions/industries/government/cloud/', kind: 'platform', notes: 'FedRAMP-authorized Salesforce instance — the CRM/case-management/licensing backbone for many agencies. Build-on or integrate rather than out-build.' },
  { name: 'ServiceNow (Government)', category: 'Gov Cloud', url: 'https://www.servicenow.com/solutions/industry/public-sector.html', kind: 'platform', notes: 'FedRAMP-authorized workflow/ITSM/case-management platform widely used for gov service delivery and modernization.' },
  { name: 'Palantir (Foundry/Gotham)', category: 'Gov Cloud', url: 'https://www.palantir.com/offerings/public-sector/', kind: 'platform', notes: 'Heavy data-integration/analytics incumbent in defense, intelligence, and large health/state programs (FedRAMP High). Adjacent, high-barrier; note as landscape, not a near-term target.' },

  // ── CONTRACTING: the path to actually sell to government ───────────────────────────────────────
  { name: 'SAM.gov registration + UEI', category: 'Contracting', url: 'https://sam.gov/', kind: 'contracting', keyless: true, notes: 'STEP 1, free. Register the entity, get a Unique Entity ID (UEI) — the authoritative identifier to bid/receive federal (and most state) awards. Prerequisite to everything else. RECOMMENDED FIRST MOVE.' },
  { name: 'GSA Multiple Award Schedule (MAS)', category: 'Contracting', url: 'https://www.gsa.gov/buy-through-us/purchasing-programs/multiple-award-schedule', kind: 'contracting', notes: 'The governmentwide catalog federal/state/local buyers purchase from at pre-negotiated terms. Getting on Schedule (IT category) makes MELEK directly buyable. Mid-term goal after a past-performance record exists.' },
  { name: 'FedRAMP', category: 'Contracting', url: 'https://www.fedramp.gov/', kind: 'contracting', notes: 'Federal cloud security authorization (NIST 800-53 baselines; Low/Moderate/High + the new 20x AI-cloud track). Required to sell SaaS to federal agencies. Heavy lift — pursue once a federal deal justifies it; cloud.gov/GovCloud shorten the path.' },
  { name: 'StateRAMP / GovRAMP', category: 'Contracting', url: 'https://stateramp.org/', kind: 'contracting', notes: 'State/local equivalent of FedRAMP (501(c)(6); rebranding to GovRAMP for state/local/tribal/edu). NIST 800-53 baselines adapted for state buyers. THE authorization for statewide/citywide modernization wins — the operator\'s actual target. RECOMMENDED authorization path before FedRAMP.' },
  { name: 'SBA 8(a) / set-aside programs', category: 'Contracting', url: 'https://www.sba.gov/federal-contracting/contracting-assistance-programs/8a-business-development-program', kind: 'contracting', notes: 'Small-business set-asides (8(a), HUBZone, SDVOSB, WOSB) that carve out competition. If MELEK/operator qualifies, a major shortcut into first awards. Check eligibility early.' },
  { name: 'State procurement portals', category: 'Contracting', url: 'https://www.naspo.org/', kind: 'contracting', notes: 'Each state runs its own eProcurement portal + cooperative contracts (NASPO ValuePoint lets one state award ride to others). Register per target state; cooperative vehicles multiply reach from one win.' },
  { name: 'IACET Accredited Provider (ANSI/IACET 1-2018)', category: 'Contracting', url: 'https://www.iacet.org/', kind: 'contracting', notes: 'Accreditation that lets MELEK award nationally-recognized CEUs (1 CEU = 10 contact hours) under the ANSI/IACET Standard. THE credential path for getting MELEK training/certification gov-approved and accepted. Directly serves the operator\'s credentialing goal. Requires building a conformant training program + AP application.' },
];

// All entries in a category.
export function byCategory(category) {
  return GOVTECH.filter((e) => e.category === category);
}

// All entries of a kind.
export function byKind(kind) {
  return GOVTECH.filter((e) => e.kind === kind);
}

// Entries callable/usable with no key, signup, or vendor relationship (safe to demo immediately).
export function keyless() {
  return GOVTECH.filter((e) => e.keyless === true);
}

// Quick counts for the Resource Center header / summary.
export function summary() {
  const cats = Object.fromEntries(CATEGORIES.map((c) => [c, byCategory(c).length]));
  const kinds = Object.fromEntries(KINDS.map((k) => [k, byKind(k).length]));
  return { total: GOVTECH.length, keyless: keyless().length, byCategory: cats, byKind: kinds };
}

// CLI summary:  node integrations/soapbox/govtech-catalog.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = summary();
  console.log('\nMELEK govtech-catalog');
  console.log('─'.repeat(60));
  console.log(`Total entries: ${s.total}   (keyless/demo-ready: ${s.keyless})`);
  console.log('By category:');
  for (const [c, n] of Object.entries(s.byCategory)) console.log(`  ${c.padEnd(26)} ${n}`);
  console.log('By kind:');
  for (const [k, n] of Object.entries(s.byKind)) console.log(`  ${k.padEnd(14)} ${n}`);
  console.log('─'.repeat(60));
}
