// oversight-directory.mjs — the SoapBox "Who do I call?" / consumer-protection AGENCY DIRECTORY
// (queue tasks #287/#288, v3 doc §6/§6A.1). The foundation layer: a curated, structured directory of
// oversight / ombudsman / Inspector-General / consumer-protection offices — EACH with full contact
// info — plus a "where do I file a complaint" router that points a person at the RIGHT office.
//
// THIS IS A DIRECTORY OF FACTS, NOT A VERDICT ENGINE. Per the spec it is official-sources-only: we
// publish each office's published contact info and link the office's OWN complaint form. We never
// render a verdict, never tell someone they have a case, never give legal advice.
//
// Style matches cfpb.mjs / lawyer-directory.mjs / benefits-navigator.mjs house pattern:
//   • ESM .mjs, keyless by default, injectable fetch via __setFetch (tests pass a fake fetch).
//   • Every live fetcher SOFT-FAILS to [] on any error — the curated directory always works offline.
//   • Every interpolated value is HTML-escaped before it reaches markup.
//   • Secrets (none required) by env NAME only; CLI guarded.
//
// MONETIZATION / COMPLIANCE (load-bearing, per spec & ABA Model Rules 5.4 / 7.2):
//   The directory is public-interest information. Any future legal/lawyer monetization is FLAT-FEE
//   ADVERTISING ONLY — NEVER a percentage of a legal fee (5.4) and NEVER paid rank/recommendation
//   (7.2). We ship a clearly-marked, DISABLED-BY-DEFAULT affiliate slot (AFFILIATE_SLOT) carrying
//   that note; we deliberately do NOT implement fee-splitting here.
//
//   import { agencies, agency, whereToFile, whereToComplain, oigReports, contactBlock } from './oversight-directory.mjs'
//   node integrations/soapbox/oversight-directory.mjs "where do I report a scam"

import { cached, TTL } from './cache.mjs';

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };
let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (s) => String(s == null ? '' : s).trim();

// HTML escape — every interpolated value passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// The standing disclaimer — present on every rendered block, by construction.
export const NOT_ADVICE =
  'Directory of official oversight and consumer-protection offices — facts, not legal advice and not a ' +
  'verdict. Filing a complaint is not proof of wrongdoing. Verify the office and form at the source before acting.';

// Categories the directory is organized by (also the filter vocabulary for agencies({category})).
export const CATEGORIES = {
  oig: 'Inspector General (federal oversight / fraud, waste & abuse)',
  consumer: 'Consumer protection',
  ombudsman: 'Ombudsman (independent problem-solver)',
  'state-ag': 'State Attorney General — consumer protection unit',
  'where-to-file': 'Where to file (general complaint index)',
};

// Clearly-marked, DISABLED-BY-DEFAULT affiliate slot. Per ABA 5.4/7.2 any legal monetization must be
// FLAT-FEE ADVERTISING ONLY — never a fee-split, never paid rank/recommendation. We ship the slot off.
export const AFFILIATE_SLOT = {
  enabled: false,
  model: 'flat-fee-advertising-only',
  note: 'Affiliate/sponsorship is DISABLED for oversight/consumer-protection listings. If ever enabled '
    + 'for the legal vertical it must be FLAT-FEE ADVERTISING ONLY — never a percentage of a legal fee '
    + '(ABA Model Rule 5.4) and never paid rank or recommendation (ABA Model Rule 7.2).',
};

// ──────────────────────────────────────────────────────────────────────────────────────────────────
// THE CURATED DIRECTORY. Each entry's schema:
//   id        — stable slug
//   name      — office name
//   category  — one of CATEGORIES
//   whoFor    — scope/jurisdiction in plain English. When an office has many sub-units, this lists
//               which sub-office handles what.
//   phone     — main / hotline phone (string, '' if none published)
//   email     — public contact email ('' if none published)
//   fax       — fax number ('' if none published)
//   website   — the office's home page
//   filingUrl — the office's OWN complaint / report / hotline form (what "File here" links to)
//   state     — 2-letter state code for per-state offices; null for federal
//   topics    — keywords the where-to-file router matches against
//   source    — the authoritative source URL for this entry's contact facts
// ──────────────────────────────────────────────────────────────────────────────────────────────────

// ── Federal Inspectors General (CIGIE / oversight.gov roster) ───────────────────────────────────────
const OIGS = [
  {
    id: 'hhs-oig', name: 'HHS Office of Inspector General', category: 'oig',
    whoFor: 'Fraud, waste & abuse in HHS programs — Medicare, Medicaid, CDC, FDA, NIH, CMS.',
    phone: '1-800-447-8477', email: 'public.affairs@oig.hhs.gov', fax: '1-800-223-8164',
    website: 'https://oig.hhs.gov/', filingUrl: 'https://oig.hhs.gov/fraud/report-fraud/',
    state: null, topics: ['medicare', 'medicaid', 'health fraud', 'fda', 'cdc', 'nih', 'cms'],
    source: 'https://oig.hhs.gov/fraud/report-fraud/',
  },
  {
    id: 'dod-oig', name: 'Department of Defense Office of Inspector General', category: 'oig',
    whoFor: 'Fraud, waste & abuse in DoD — military, defense contractors, procurement; whistleblower reprisal.',
    phone: '1-800-424-9098', email: 'hotline@dodig.mil', fax: '',
    website: 'https://www.dodig.mil/', filingUrl: 'https://www.dodig.mil/Components/Administrative-Investigations/DoD-Hotline/',
    state: null, topics: ['military', 'defense', 'contractor fraud', 'procurement', 'whistleblower'],
    source: 'https://www.dodig.mil/Components/Administrative-Investigations/DoD-Hotline/',
  },
  {
    id: 'ssa-oig', name: 'Social Security Administration Office of Inspector General', category: 'oig',
    whoFor: 'Social Security fraud — benefit fraud, SSN misuse, and Social Security imposter scam calls.',
    phone: '1-800-269-0271', email: '', fax: '1-410-597-0118',
    website: 'https://oig.ssa.gov/', filingUrl: 'https://oig.ssa.gov/report/',
    state: null, topics: ['social security', 'ssn', 'benefit fraud', 'imposter scam', 'ssi'],
    source: 'https://oig.ssa.gov/report/',
  },
  {
    id: 'usps-oig', name: 'U.S. Postal Service Office of Inspector General', category: 'oig',
    whoFor: 'Postal fraud, theft & misconduct involving USPS employees and operations (not mail crime — that is the Postal Inspection Service).',
    phone: '1-888-877-7644', email: '', fax: '',
    website: 'https://www.uspsoig.gov/', filingUrl: 'https://www.uspsoig.gov/hotline',
    state: null, topics: ['postal', 'usps', 'mail fraud', 'mail theft'],
    source: 'https://www.uspsoig.gov/hotline',
  },
  {
    id: 'treasury-oig', name: 'Department of the Treasury Office of Inspector General', category: 'oig',
    whoFor: 'Fraud, waste & abuse in Treasury programs and bureaus (excluding the IRS, which has its own TIGTA).',
    phone: '1-800-359-3898', email: 'Hotline@oig.treas.gov', fax: '',
    website: 'https://oig.treasury.gov/', filingUrl: 'https://oig.treasury.gov/report-fraud-waste-and-abuse',
    state: null, topics: ['treasury', 'banking oversight', 'grant fraud'],
    source: 'https://oig.treasury.gov/report-fraud-waste-and-abuse',
  },
  {
    id: 'tigta', name: 'Treasury Inspector General for Tax Administration (TIGTA)', category: 'oig',
    whoFor: 'IRS employee misconduct and IRS impersonation scams (the fake-IRS phone call). For an IRS account problem use the Taxpayer Advocate.',
    phone: '1-800-366-4484', email: '', fax: '',
    website: 'https://www.tigta.gov/', filingUrl: 'https://www.tigta.gov/reportcrime-misconduct',
    state: null, topics: ['irs scam', 'irs impersonation', 'tax', 'irs misconduct'],
    source: 'https://www.tigta.gov/reportcrime-misconduct',
  },
  {
    id: 'va-oig', name: 'Department of Veterans Affairs Office of Inspector General', category: 'oig',
    whoFor: 'Fraud, waste & abuse and patient-safety issues in VA — VA health care, benefits, and construction.',
    phone: '1-800-488-8244', email: 'vaoighotline@va.gov', fax: '1-202-495-5861',
    website: 'https://www.va.gov/oig/', filingUrl: 'https://www.va.gov/oig/hotline/',
    state: null, topics: ['veterans', 'va', 'va health', 'va benefits'],
    source: 'https://www.va.gov/oig/hotline/',
  },
  {
    id: 'dol-oig', name: 'Department of Labor Office of Inspector General', category: 'oig',
    whoFor: 'Fraud in DOL programs — unemployment insurance fraud, workforce grants, OSHA/union financial integrity.',
    phone: '1-800-347-3756', email: 'hotline@oig.dol.gov', fax: '1-202-693-7020',
    website: 'https://www.oig.dol.gov/', filingUrl: 'https://www.oig.dol.gov/hotline.htm',
    state: null, topics: ['unemployment fraud', 'labor', 'workforce grant', 'union'],
    source: 'https://www.oig.dol.gov/hotline.htm',
  },
  {
    id: 'ed-oig', name: 'Department of Education Office of Inspector General', category: 'oig',
    whoFor: 'Fraud, waste & abuse in federal education programs — student aid (FAFSA/loans), grants, and schools.',
    phone: '1-800-647-8733', email: 'oig.hotline@ed.gov', fax: '',
    website: 'https://oig.ed.gov/', filingUrl: 'https://oig.ed.gov/hotline',
    state: null, topics: ['student loan fraud', 'fafsa', 'education', 'school fraud', 'financial aid'],
    source: 'https://oig.ed.gov/hotline',
  },
  {
    id: 'gsa-oig', name: 'General Services Administration Office of Inspector General', category: 'oig',
    whoFor: 'Fraud, waste & abuse in GSA — federal real estate, procurement, and government-wide acquisition contracts.',
    phone: '1-800-424-5210', email: '', fax: '',
    website: 'https://www.gsaig.gov/', filingUrl: 'https://www.gsaig.gov/hotline',
    state: null, topics: ['gsa', 'federal contract', 'procurement', 'real estate fraud'],
    source: 'https://www.gsaig.gov/hotline',
  },
  {
    id: 'doj-oig', name: 'Department of Justice Office of Inspector General', category: 'oig',
    whoFor: 'Misconduct in DOJ components — FBI, DEA, ATF, BOP (federal prisons), U.S. Marshals.',
    phone: '1-800-869-4499', email: '', fax: '202-616-9881',
    website: 'https://oig.justice.gov/', filingUrl: 'https://oig.justice.gov/hotline',
    state: null, topics: ['fbi', 'dea', 'atf', 'federal prison', 'doj misconduct', 'marshals'],
    source: 'https://oig.justice.gov/hotline',
  },
  {
    id: 'dhs-oig', name: 'Department of Homeland Security Office of Inspector General', category: 'oig',
    whoFor: 'Misconduct and fraud in DHS — ICE, CBP, TSA, FEMA (including disaster-aid fraud), USCIS.',
    phone: '1-800-323-8603', email: 'dhs-oig.officepublicaffairs@oig.dhs.gov', fax: '202-254-4297',
    website: 'https://www.oig.dhs.gov/', filingUrl: 'https://www.oig.dhs.gov/hotline',
    state: null, topics: ['ice', 'cbp', 'tsa', 'fema', 'disaster fraud', 'immigration', 'uscis'],
    source: 'https://www.oig.dhs.gov/hotline',
  },
];

// ── Consumer protection ─────────────────────────────────────────────────────────────────────────────
const CONSUMER = [
  {
    id: 'cfpb', name: 'Consumer Financial Protection Bureau (CFPB)', category: 'consumer',
    whoFor: 'Money & financial products: banks, credit cards, mortgages, student & auto loans, debt collection, credit reports.',
    phone: '1-855-411-2372', email: '', fax: '1-855-237-2392',
    website: 'https://www.consumerfinance.gov/', filingUrl: 'https://www.consumerfinance.gov/complaint/',
    state: null, topics: ['bank', 'credit card', 'mortgage', 'loan', 'debt collection', 'credit report', 'financial'],
    source: 'https://www.consumerfinance.gov/complaint/',
  },
  {
    id: 'ftc', name: 'Federal Trade Commission (FTC) — ReportFraud', category: 'consumer',
    whoFor: 'Scams, fraud, deceptive business practices, identity theft (IdentityTheft.gov), and bad robocalls.',
    phone: '1-877-382-4357', email: '', fax: '',
    website: 'https://www.ftc.gov/', filingUrl: 'https://reportfraud.ftc.gov/',
    state: null, topics: ['scam', 'fraud', 'identity theft', 'robocall', 'deceptive', 'spam', 'imposter'],
    source: 'https://reportfraud.ftc.gov/',
  },
  {
    id: 'cpsc', name: 'Consumer Product Safety Commission (CPSC) — SaferProducts', category: 'consumer',
    whoFor: 'Unsafe consumer products — defects, injuries, fire/shock hazards (not cars, food, or drugs).',
    phone: '1-800-638-2772', email: 'info@cpsc.gov', fax: '301-504-0124',
    website: 'https://www.cpsc.gov/', filingUrl: 'https://www.saferproducts.gov/',
    state: null, topics: ['product safety', 'defective product', 'recall', 'unsafe', 'injury', 'fire hazard'],
    source: 'https://www.saferproducts.gov/',
  },
  {
    id: 'nhtsa', name: 'NHTSA — Vehicle Safety Complaints', category: 'consumer',
    whoFor: 'Motor-vehicle safety defects, tires, car seats, and recalls.',
    phone: '1-888-327-4236', email: '', fax: '',
    website: 'https://www.nhtsa.gov/', filingUrl: 'https://www.nhtsa.gov/report-a-safety-problem',
    state: null, topics: ['car', 'vehicle', 'auto recall', 'tire', 'car seat', 'automobile'],
    source: 'https://www.nhtsa.gov/report-a-safety-problem',
  },
  {
    id: 'bbb', name: 'Better Business Bureau (BBB)', category: 'consumer',
    whoFor: 'Private (non-government) dispute resolution and business complaints; BBB Scam Tracker. NOT a regulator — a nonprofit.',
    phone: '', email: '', fax: '',
    website: 'https://www.bbb.org/', filingUrl: 'https://www.bbb.org/file-a-complaint',
    state: null, topics: ['business complaint', 'dispute', 'scam tracker', 'company'],
    source: 'https://www.bbb.org/file-a-complaint',
  },
  {
    id: 'usagov-consumer', name: 'USA.gov — Consumer Complaints Hub', category: 'where-to-file',
    whoFor: 'The official "I do not know who to call" starting point — routes you to the right federal/state office by complaint type.',
    phone: '1-844-872-4681', email: '', fax: '',
    website: 'https://www.usa.gov/', filingUrl: 'https://www.usa.gov/complaints',
    state: null, topics: ['where to file', 'complaint', 'who do i call', 'general'],
    source: 'https://www.usa.gov/complaints',
  },
];

// ── Ombudsman & per-program advocates (federal) ─────────────────────────────────────────────────────
const OMBUDSMAN = [
  {
    id: 'irs-taxpayer-advocate', name: 'Taxpayer Advocate Service (IRS Ombudsman)', category: 'ombudsman',
    whoFor: 'Independent IRS ombudsman — when an IRS problem causes financial hardship or normal channels have not worked.',
    phone: '1-877-777-4778', email: '', fax: '',
    website: 'https://www.taxpayeradvocate.irs.gov/', filingUrl: 'https://www.taxpayeradvocate.irs.gov/contact-us/',
    state: null, topics: ['irs', 'tax problem', 'tax refund', 'tax hardship'],
    source: 'https://www.taxpayeradvocate.irs.gov/contact-us/',
  },
  {
    id: 'cfpb-ombudsman', name: 'CFPB Ombudsman', category: 'ombudsman',
    whoFor: 'Independent, neutral resource for process problems with the CFPB itself (not a substitute for filing a CFPB complaint).',
    phone: '1-855-830-7880', email: 'CFPBOmbudsman@cfpb.gov', fax: '1-202-435-7888',
    website: 'https://www.consumerfinance.gov/cfpb-ombudsman/', filingUrl: 'https://www.consumerfinance.gov/cfpb-ombudsman/submit-an-inquiry/',
    state: null, topics: ['cfpb process', 'ombudsman'],
    source: 'https://www.consumerfinance.gov/cfpb-ombudsman/',
  },
  {
    id: 'ltc-ombudsman', name: 'Long-Term Care Ombudsman (find your state program)', category: 'ombudsman',
    whoFor: 'Advocates for residents of nursing homes and assisted-living facilities; investigates care complaints. Find your STATE program at the locator.',
    phone: '', email: '', fax: '',
    website: 'https://theconsumervoice.org/get_help', filingUrl: 'https://theconsumervoice.org/get_help',
    state: null, topics: ['nursing home', 'assisted living', 'elder care', 'long term care', 'resident rights'],
    source: 'https://acl.gov/programs/Protecting-Rights-and-Preventing-Abuse/Long-term-Care-Ombudsman-Program',
  },
  {
    id: 'naic-insurance', name: 'State Insurance Commissioners (NAIC locator)', category: 'ombudsman',
    whoFor: 'Insurance complaints (claims denied, premiums, agents) are handled by YOUR STATE insurance department. The NAIC locator routes you to it.',
    phone: '1-866-470-6242', email: '', fax: '',
    website: 'https://content.naic.org/', filingUrl: 'https://content.naic.org/state-insurance-departments',
    state: null, topics: ['insurance', 'claim denied', 'insurance commissioner', 'premium', 'policy'],
    source: 'https://content.naic.org/state-insurance-departments',
  },
];

// ── State Attorneys General — consumer-protection units (50 states + DC) ─────────────────────────────
// Backbone facts: AG consumer hotline + the office's own consumer-complaint form. whoFor states the
// jurisdiction; the consumer-protection division is the sub-office that handles complaints.
const STATE_AGS = [
  ['AL', 'Alabama', '1-800-392-5658', 'https://www.alabamaag.gov/consumercomplaint/'],
  ['AK', 'Alaska', '907-269-5200', 'https://law.alaska.gov/department/civil/consumer/cp_complaint.html'],
  ['AZ', 'Arizona', '602-542-5763', 'https://www.azag.gov/complaints/consumer'],
  ['AR', 'Arkansas', '1-800-482-8982', 'https://arkansasag.gov/consumer-protection/file-a-consumer-complaint/'],
  ['CA', 'California', '1-800-952-5225', 'https://oag.ca.gov/contact/consumer-complaint-against-business-or-company'],
  ['CO', 'Colorado', '1-800-222-4444', 'https://coag.gov/file-complaint/'],
  ['CT', 'Connecticut', '860-808-5318', 'https://portal.ct.gov/AG/Common/Complaint-Form-Landing-Page'],
  ['DE', 'Delaware', '1-800-220-5424', 'https://attorneygeneral.delaware.gov/fraud/cpu/complaint/'],
  ['DC', 'District of Columbia', '202-442-9828', 'https://oag.dc.gov/consumer-protection/consumer-complaint'],
  ['FL', 'Florida', '1-866-966-7226', 'https://www.myfloridalegal.com/consumer-protection'],
  ['GA', 'Georgia', '1-404-651-8600', 'https://consumer.georgia.gov/consumer-complaints'],
  ['HI', 'Hawaii', '808-587-4272', 'https://cca.hawaii.gov/ocp/consumer_complaint/'],
  ['ID', 'Idaho', '1-800-432-3545', 'https://www.ag.idaho.gov/consumer-protection/filing-a-consumer-complaint/'],
  ['IL', 'Illinois', '1-800-386-5438', 'https://illinoisattorneygeneral.gov/consumer-protection/'],
  ['IN', 'Indiana', '1-800-382-5516', 'https://www.in.gov/attorneygeneral/consumer-protection-division/file-a-complaint/'],
  ['IA', 'Iowa', '1-888-777-4590', 'https://www.iowaattorneygeneral.gov/for-consumers/file-a-consumer-complaint'],
  ['KS', 'Kansas', '1-800-432-2310', 'https://www.ag.ks.gov/complaint-center'],
  ['KY', 'Kentucky', '1-888-432-9257', 'https://www.ag.ky.gov/Hot-Topics/Pages/File-a-Complaint.aspx'],
  ['LA', 'Louisiana', '1-800-351-4889', 'https://www.agjefflandry.com/Page/2243'],
  ['ME', 'Maine', '1-800-436-2131', 'https://www.maine.gov/ag/consumer/complaints/complaint_form.shtml'],
  ['MD', 'Maryland', '1-888-743-0023', 'https://www.marylandattorneygeneral.gov/Pages/CPD/complaint.aspx'],
  ['MA', 'Massachusetts', '617-727-8400', 'https://www.mass.gov/how-to/file-a-consumer-complaint'],
  ['MI', 'Michigan', '1-877-765-8388', 'https://www.michigan.gov/ag/consumer-protection/file-a-consumer-complaint'],
  ['MN', 'Minnesota', '1-800-657-3787', 'https://www.ag.state.mn.us/office/complaint.asp'],
  ['MS', 'Mississippi', '1-800-281-4418', 'https://www.ago.state.ms.us/divisions/consumer-protection/'],
  ['MO', 'Missouri', '1-800-392-8222', 'https://ago.mo.gov/file-a-complaint/consumer-complaint'],
  ['MT', 'Montana', '1-800-481-6896', 'https://dojmt.gov/consumer/consumer-complaints/'],
  ['NE', 'Nebraska', '1-800-727-6432', 'https://protectthegoodlife.nebraska.gov/file-consumer-complaint'],
  ['NV', 'Nevada', '1-888-434-9989', 'https://ag.nv.gov/Complaints/File_Complaint/'],
  ['NH', 'New Hampshire', '603-271-3641', 'https://www.doj.nh.gov/consumer/complaints/index.htm'],
  ['NJ', 'New Jersey', '1-800-242-5846', 'https://www.njconsumeraffairs.gov/Pages/Complaints.aspx'],
  ['NM', 'New Mexico', '1-844-255-9210', 'https://www.nmag.gov/file-a-complaint/'],
  ['NY', 'New York', '1-800-771-7755', 'https://ag.ny.gov/complaint-forms'],
  ['NC', 'North Carolina', '1-877-566-7226', 'https://ncdoj.gov/file-a-complaint/'],
  ['ND', 'North Dakota', '1-800-472-2600', 'https://attorneygeneral.nd.gov/consumer-resources/consumer-complaints/'],
  ['OH', 'Ohio', '1-800-282-0515', 'https://www.ohioattorneygeneral.gov/About-AG/Contact/Submit-a-Consumer-Complaint'],
  ['OK', 'Oklahoma', '405-521-2029', 'https://www.oag.ok.gov/consumer-protection-unit'],
  ['OR', 'Oregon', '1-877-877-9392', 'https://www.doj.state.or.us/consumer-protection/file-complaint/'],
  ['PA', 'Pennsylvania', '1-800-441-2555', 'https://www.attorneygeneral.gov/submit-a-complaint/consumer-complaint/'],
  ['RI', 'Rhode Island', '401-274-4400', 'https://riag.ri.gov/consumer-protection/file-complaint'],
  ['SC', 'South Carolina', '1-800-922-1594', 'https://consumer.sc.gov/consumer-resources/file-complaint'],
  ['SD', 'South Dakota', '1-800-300-1986', 'https://consumer.sd.gov/fileacomplaint.aspx'],
  ['TN', 'Tennessee', '1-800-342-8385', 'https://www.tn.gov/attorneygeneral/working-for-tennessee/consumer/filing-a-complaint.html'],
  ['TX', 'Texas', '1-800-621-0508', 'https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint'],
  ['UT', 'Utah', '1-801-366-0310', 'https://dcp.utah.gov/complaints/'],
  ['VT', 'Vermont', '1-800-649-2424', 'https://ago.vermont.gov/cap'],
  ['VA', 'Virginia', '1-800-552-9963', 'https://www.oag.state.va.us/consumer-protection/index.php/file-a-complaint'],
  ['WA', 'Washington', '1-800-551-4636', 'https://www.atg.wa.gov/file-complaint'],
  ['WV', 'West Virginia', '1-800-368-8808', 'https://ago.wv.gov/consumerprotection/Pages/default.aspx'],
  ['WI', 'Wisconsin', '1-800-422-7128', 'https://datcp.wi.gov/Pages/Programs_Services/FileConsumerComplaint.aspx'],
  ['WY', 'Wyoming', '1-800-438-5799', 'https://ag.wyo.gov/consumer-protection-unit'],
].map(([state, name, phone, filingUrl]) => ({
  id: `ag-${state.toLowerCase()}`,
  name: `${name} Attorney General — Consumer Protection`,
  category: 'state-ag',
  whoFor: `Consumer complaints against businesses in ${name}. Handled by the AG's Consumer Protection division; `
    + 'use this for in-state scams, deceptive practices, and unresolved business disputes.',
  phone, email: '', fax: '',
  website: filingUrl, filingUrl, state,
  topics: ['consumer', 'state ag', 'business complaint', 'scam', 'deceptive practice', name.toLowerCase()],
  source: filingUrl,
}));

// The full directory — everything merged. Exported for callers that want the raw seed.
export const DIRECTORY = [...OIGS, ...CONSUMER, ...OMBUDSMAN, ...STATE_AGS];

// Quick lookup by id.
const BY_ID = new Map(DIRECTORY.map((e) => [e.id, e]));

// The contact fields every entry carries (used by tests + contactBlock).
export const CONTACT_FIELDS = ['phone', 'email', 'fax', 'website', 'filingUrl', 'whoFor'];

// ──────────────────────────────────────────────────────────────────────────────────────────────────
// QUERY FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────────────────────────────

/** matches an entry against a free-text query across name / whoFor / topics. */
function matchesQuery(entry, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (entry.name.toLowerCase().includes(needle)) return true;
  if (str(entry.whoFor).toLowerCase().includes(needle)) return true;
  return (entry.topics || []).some((t) => String(t).toLowerCase().includes(needle));
}

/**
 * agencies({category, state, q}) — filter/search the directory. All filters optional and combine (AND).
 *   category — one of CATEGORIES keys.
 *   state    — 2-letter code; matches per-state offices for that state PLUS all federal offices
 *              (federal offices serve every state). Pass state with category:'state-ag' to get
 *              just that state's AG.
 *   q        — free-text across name / whoFor / topics.
 * Always returns an array (possibly empty); never throws.
 */
export function agencies({ category, state, q } = {}) {
  const cat = str(category).toLowerCase();
  const st = str(state).toUpperCase();
  const query = str(q);
  return DIRECTORY.filter((e) => {
    if (cat && e.category !== cat) return false;
    if (st && e.state && e.state !== st) return false; // a per-state office for a different state is out
    return matchesQuery(e, query);
  });
}

/** agency(id) — full detail for one office (all contact fields). Returns null if unknown. */
export function agency(id) {
  return BY_ID.get(str(id)) || null;
}

/**
 * whereToFile({topic, companyType, state}) — the router. Given what went wrong, return the right
 * office(s) to contact, best-match first. Always returns an array; falls back to the general
 * "where to file" index so a person is never left with nothing.
 */
export function whereToFile({ topic, companyType, state } = {}) {
  const needle = `${str(topic)} ${str(companyType)}`.toLowerCase().trim();
  const st = str(state).toUpperCase();
  const scored = [];
  for (const e of DIRECTORY) {
    // per-state offices only count when they match the requested state (or no state requested)
    if (e.state && st && e.state !== st) continue;
    let score = 0;
    for (const t of (e.topics || [])) {
      const tl = String(t).toLowerCase();
      if (needle && (needle.includes(tl) || tl.includes(needle))) score += 3;
      else if (needle && needle.split(/\s+/).some((w) => w && tl.includes(w))) score += 1;
    }
    if (needle && str(e.whoFor).toLowerCase().includes(needle)) score += 2;
    // when a state is requested, gently prefer that state's own AG
    if (st && e.state === st) score += 1;
    if (score > 0) scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const hits = scored.map((s) => s.e);
  if (hits.length) return hits;
  // nothing matched → the official general index so the user always has a next step
  const fallback = agency('usagov-consumer');
  return fallback ? [fallback] : [];
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────
// COMPANY HOOK — exported for company-profiles.mjs to import later (#288). We do NOT edit
// company-profiles.mjs here. Maps a company's industry/type to the right oversight office(s).
// ──────────────────────────────────────────────────────────────────────────────────────────────────

// industry/type → the topic the where-to-file router understands.
const INDUSTRY_TO_TOPIC = {
  bank: 'bank', banking: 'bank', finance: 'financial', financial: 'financial', lender: 'loan',
  mortgage: 'mortgage', 'credit card': 'credit card', 'debt collection': 'debt collection',
  insurance: 'insurance', insurer: 'insurance',
  auto: 'car', automobile: 'car', vehicle: 'vehicle', car: 'car',
  product: 'product safety', retail: 'product safety', manufacturer: 'product safety',
  health: 'health fraud', healthcare: 'medicare', pharma: 'fda', drug: 'fda',
  'nursing home': 'nursing home', 'assisted living': 'assisted living', 'elder care': 'elder care',
  scam: 'scam', fraud: 'fraud',
};

/**
 * whereToComplain(company) — the hook other surfaces (company profiles) import to get the right
 * oversight office(s) for a company by industry/type. Accepts a company string OR an object
 * ({ name, industry|type|category, state }). Always returns an array; never throws.
 */
export function whereToComplain(company) {
  let industry = '', state = '', name = '';
  if (typeof company === 'string') {
    industry = company;
  } else if (company && typeof company === 'object') {
    name = str(company.name);
    industry = str(company.industry || company.type || company.category || company.sector);
    state = str(company.state);
  }
  const il = industry.toLowerCase();
  // map an industry word to a router topic if we recognize it
  let topic = '';
  for (const [k, v] of Object.entries(INDUSTRY_TO_TOPIC)) {
    if (il.includes(k)) { topic = v; break; }
  }
  // route on the mapped topic, falling back to the raw industry/name text
  return whereToFile({ topic: topic || industry || name, state });
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE ENRICHMENT (soft-fail) — oversight.gov reports API for recent OIG findings.
// Keyless. Soft-fails to [] on any error so the curated directory is never blocked by a dead source.
// ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * oigReports({agency}) — recent oversight findings/reports from oversight.gov's public reports API.
 * `agency` is a free-text agency name (e.g. "HHS"); omit for the latest across all. Soft-fails to [].
 */
export async function oigReports({ agency: agencyName = '', size = 10 } = {}) {
  const name = str(agencyName);
  return cached(`oig:reports:${name.toLowerCase()}|${size}`, TTL.metadata, async () => {
    try {
      const p = new URLSearchParams();
      p.set('per_page', String(size));
      if (name) p.set('search', name);
      const u = `https://www.oversight.gov/api/v1/reports?${p.toString()}`;
      const r = await _fetch(u, { headers: UA });
      if (!r || !r.ok) return [];
      const j = await r.json();
      const rows = j?.data || j?.results || (Array.isArray(j) ? j : []);
      return rows.slice(0, size).map((row) => {
        const a = row.attributes || row;
        return {
          title: str(a.title || a.report_title),
          agency: str(a.agency_name || a.agency || (Array.isArray(a.agencies) ? a.agencies.join(', ') : '')),
          date: str(a.date_issued || a.published_date || a.date),
          url: str(a.report_url || a.url || a.link),
          source: 'oversight.gov',
        };
      }).filter((x) => x.title || x.url);
    } catch { return []; }
  });
}

/**
 * scrapeContact(url) — OPTIONAL keyless contact-gap-filler. Fetches a public agency page and best-effort
 * extracts a public contact email / phone / fax. Used only to FILL GAPS in the curated data; never
 * required, never authoritative. Soft-fails to { email:'', phone:'', fax:'', source:url } on any error.
 */
export async function scrapeContact(url) {
  const u = str(url);
  const empty = { email: '', phone: '', fax: '', source: u };
  if (!u) return empty;
  try {
    const r = await _fetch(u, { headers: UA });
    if (!r || !r.ok) return empty;
    const html = await r.text();
    const text = String(html);
    const email = (text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(?:gov|org|us|mil|com)/) || [''])[0];
    // fax first (it's labeled) so a fax number isn't mistaken for the main phone
    const faxM = text.match(/fax[^0-9]{0,15}(\+?1?[-.\s(]*\d{3}[-.\s)]*\d{3}[-.\s]*\d{4})/i);
    const fax = faxM ? faxM[1].trim() : '';
    const phoneM = text.match(/(\+?1?[-.\s(]*\d{3}[-.\s)]*\d{3}[-.\s]*\d{4})/);
    let phone = phoneM ? phoneM[1].trim() : '';
    if (phone && fax && phone === fax) phone = ''; // don't report the fax as the phone
    return { email: str(email), phone, fax, source: u };
  } catch { return empty; }
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────
// RENDERING — escaped HTML, every contact field surfaced, the not-advice line always present.
// ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * contactBlock(entry) — the reusable contact card: Phone / Email / Fax / Who-it's-for / File-here.
 * All fields escaped; missing fields are rendered as "— not published" rather than dropped, so a
 * reader can see the office simply has no published email (vs. a render bug).
 */
export function contactBlock(entry) {
  const e = entry || {};
  const row = (label, value, isLink) => {
    const v = str(value);
    if (!v) return `    <li class="contact-row contact-${label.toLowerCase()}"><span class="label">${esc(label)}:</span> <span class="missing">— not published</span></li>`;
    const inner = isLink
      ? `<a href="${esc(v)}" rel="nofollow noopener">${esc(v)}</a>`
      : esc(v);
    return `    <li class="contact-row contact-${label.toLowerCase()}"><span class="label">${esc(label)}:</span> ${inner}</li>`;
  };
  const phoneLink = e.phone ? `<a href="tel:${esc(String(e.phone).replace(/[^0-9+]/g, ''))}">${esc(e.phone)}</a>` : '';
  const emailLink = e.email ? `<a href="mailto:${esc(e.email)}">${esc(e.email)}</a>` : '';
  const fileLink = e.filingUrl
    ? `<a class="file-here" href="${esc(e.filingUrl)}" rel="nofollow noopener">File a complaint here</a>`
    : '<span class="missing">— no online form published</span>';
  return `<div class="oversight-contact" data-id="${esc(e.id || '')}">
  <h3 class="office-name">${esc(e.name || 'Office')}</h3>
  <p class="who-for"><strong>Who it's for:</strong> ${esc(e.whoFor || '')}</p>
  <ul class="contact-list">
    <li class="contact-row contact-phone"><span class="label">Phone:</span> ${phoneLink || '<span class="missing">— not published</span>'}</li>
    <li class="contact-row contact-email"><span class="label">Email:</span> ${emailLink || '<span class="missing">— not published</span>'}</li>
${row('Fax', e.fax)}
${row('Website', e.website, true)}
    <li class="contact-row contact-file"><span class="label">File here:</span> ${fileLink}</li>
  </ul>
  ${e.source ? `<p class="source"><a href="${esc(e.source)}" rel="nofollow noopener">[source]</a></p>` : ''}
</div>`;
}

/**
 * renderPage({results, title, intro}) — the directory page in SoapBox house style. Renders a contact
 * card per entry + the affiliate-disabled note + the not-advice line. Escaped throughout.
 */
export function renderPage({ results, title, intro } = {}) {
  const rows = Array.isArray(results) ? results : DIRECTORY;
  const cards = rows.map((e) => contactBlock(e)).join('\n')
    || '  <p class="empty">No offices matched.</p>';
  const h = esc(title || 'Who Do I Call? — Oversight & Consumer-Protection Directory');
  const i = esc(intro || 'Every office below is an official oversight, ombudsman, or consumer-protection '
    + 'body, with its published contact info and its own complaint form. We point you at the right door; '
    + 'we never render a verdict.');
  return `<section class="oversight-directory">
  <h2>${h}</h2>
  <p class="intro">${i}</p>
  <div class="oversight-cards">
${cards}
  </div>
  <p class="affiliate-note" data-affiliate-enabled="false"><em>${esc(AFFILIATE_SLOT.note)}</em></p>
  <p class="not-advice">${esc(NOT_ADVICE)}</p>
</section>`;
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────
// CLI (guarded) — quick lookup; no network needed for the directory itself.
//   node integrations/soapbox/oversight-directory.mjs "report a scam"
// ──────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('oversight-directory.mjs')) {
  const q = process.argv.slice(2).join(' ');
  const hits = q ? whereToFile({ topic: q }) : DIRECTORY;
  console.log(`\n# Oversight directory${q ? `: where to file "${q}"` : ''} (${hits.length})\n`);
  for (const e of hits.slice(0, 12)) {
    console.log(`  - ${e.name}  [${e.category}]`);
    console.log(`      who: ${e.whoFor}`);
    if (e.phone) console.log(`      phone: ${e.phone}`);
    if (e.email) console.log(`      email: ${e.email}`);
    if (e.fax) console.log(`      fax: ${e.fax}`);
    console.log(`      file: ${e.filingUrl}`);
  }
  console.log(`\n${NOT_ADVICE}`);
}
