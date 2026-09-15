// credentials-catalog.mjs — the DATA LAYER for the SoapBox Credentialing Aggregator
// (credentials.soapbox.community). A curated, BY-INDUSTRY map of how to actually get credentialed:
// certifications, accreditors, credit-by-exam, and the free / low-cost pathways that lead to them.
//
// Operator's goal (on record in govtech-catalog.mjs): MELEK aims to become an IACET Accredited
// Provider so its training can award nationally-recognized CEUs (1 CEU = 10 contact hours). This
// directory is the public front of that work — we MAP the landscape (what each credential is, who
// accredits it, what it costs, whether it carries college credit) and LINK OUT to the issuer. We do
// not sell credentials; we make the maze legible, free-first.
//
// Like hierophant-catalog: pure data, NO network, NO keys. Soft surface — every field may be absent.
// We never fabricate a credential or a link; an entry we can't verify is omitted, not invented.
//
//   import { INDUSTRIES, CREDENTIALS, byIndustry, getCredential, search, industriesWithCounts }
//     from './credentials-catalog.mjs'
//   node integrations/soapbox/credentials-catalog.mjs            # coverage report
//   node integrations/soapbox/credentials-catalog.mjs teaching-english

// ── the honest-comparison guardrail (shared voice with aggregator-directory) ──────────────────────
export const BRAND_GUARDRAIL =
  'We rank by recognition and value to YOU — never by who pays. Free and credit-bearing paths are '
  + 'listed first, costs are shown plainly, and every credential links out to its official issuer. '
  + 'We do not sell credentials or your data.';

// ── industries (the BY-INDUSTRY spine the operator asked for; ordered for presentation) ───────────
export const INDUSTRIES = [
  { id: 'accreditation',        name: 'Accreditation & recognition (who to trust)', blurb: 'The bodies that vouch for everyone else — CHEA & the U.S. regional accreditors for colleges, ANAB & NCCA for certifications (ISO/IEC 17024), ACE & NCCRS for credit. Check a credential here before you pay for it.' },
  { id: 'college-credit',       name: 'College credit (credit-by-exam & free)', blurb: 'Earn real, transferable college credit cheaply or free — CLEP/DSST by exam, ACE/NCCRS-reviewed courses. Start with ModernStates (free CLEP) and Saylor.' },
  { id: 'continuing-education', name: 'Continuing education & CEUs',            blurb: 'Professional continuing-education units (CEUs) under the ANSI/IACET Standard — the recognized way to keep a license or certification current. (MELEK\'s own IACET path lives here.)' },
  { id: 'teaching-english',     name: 'Teaching English (TEFL/TESOL)',          blurb: 'Certifications to teach English abroad or online — TEFL, TESOL, CELTA, TKT and the advanced DELTA. What counts, what\'s accredited, and what\'s a paper mill.' },
  { id: 'information-technology', name: 'Information technology',               blurb: 'IT support, cloud, and networking — CompTIA, AWS/Azure/Google Cloud, Cisco, and the free Google Career Certificates and freeCodeCamp paths into them.' },
  { id: 'cybersecurity',        name: 'Cybersecurity',                          blurb: 'Security credentials from entry to expert — ISC2 Certified in Cybersecurity (free exam), CompTIA Security+, CEH, CISSP — and the free training that feeds them.' },
  { id: 'data-ai',             name: 'Data & AI',                              blurb: 'Data analytics, data science and machine learning — Google Data Analytics, IBM, DeepLearning.AI, and free university courses with credit-recommended options.' },
  { id: 'business-finance',     name: 'Business, finance & PM',                 blurb: 'Project management (CAPM/PMP, Scrum, Google PM), quality (ASQ Six Sigma), IT service (ITIL), and the finance ladders — CFA, CFP, CPA, FINRA SIE — with the free on-ramps.' },
  { id: 'human-resources',      name: 'Human resources',                        blurb: 'The two recognized HR credential families — SHRM (SHRM-CP/SCP) and HRCI (aPHR/PHR/SPHR) — and the free study paths into them.' },
  { id: 'languages',           name: 'Languages (proficiency)',                blurb: 'Recognized language-proficiency credentials — ACTFL (US), and the national standards: Goethe (German), DELE (Spanish), DELF/DALF (French), JLPT (Japanese), HSK (Chinese).' },
  { id: 'healthcare',          name: 'Healthcare & safety',                    blurb: 'Patient-care and safety credentials — CPR/BLS (AHA, Red Cross), CNA, phlebotomy, Medical Assistant, and ServSafe for food handling.' },
  { id: 'childcare',           name: 'Childcare & early education',             blurb: 'The full path: the CDA credential (and how to get it paid for with T.E.A.C.H.), licensing to RUN a daycare, NAEYC accreditation — and the real state & federal money: CCDF subsidies, Head Start, CACFP food reimbursement, and grants.' },
  { id: 'skilled-trades',      name: 'Skilled trades & compliance',           blurb: 'Trade and workplace-compliance credentials — OSHA 10/30, EPA 608 (HVAC refrigerant), CDL, and apprenticeship on-ramps.' },
  { id: 'education-teaching',   name: 'Teaching & instructional design',        blurb: 'K-12 and adult teaching — Praxis prep, alternative certification, and instructional-design / online-teaching credentials.' },
];
const INDUSTRY_IDS = new Set(INDUSTRIES.map((i) => i.id));

// cost buckets: 'free' (learn/earn at no cost), 'low' (≲ $200), 'paid' (more). type: what kind of thing.
// recognition: a short, honest note on who accepts it. Every url is the official issuer.
function c(id, name, industry, type, cost, provider, recognition, url, what) {
  return { id, name, industry, type, cost, provider, recognition, url, what };
}

export const CREDENTIALS = [
  // ── College credit (credit-by-exam & free) ──────────────────────────────────────────────────────
  c('modernstates', 'Modern States — Freshman Year for Free', 'college-credit', 'credit-by-exam', 'free',
    'Modern States Education Alliance', 'Free CLEP prep + a voucher that covers the CLEP exam & proctor fee; CLEP credit accepted by 2,900+ colleges',
    'https://modernstates.org/',
    'Free online courses that prep you for CLEP exams — and Modern States pays your exam voucher. Pass the CLEP and most U.S. colleges grant credit. The cheapest real route to a year of college.'),
  c('clep', 'CLEP (College-Level Examination Program)', 'college-credit', 'credit-by-exam', 'low',
    'College Board', 'Credit-by-exam accepted at 2,900+ institutions', 'https://clep.collegeboard.org/',
    'Standardized exams that grant college credit for what you already know — ~$95/exam (often free via Modern States). 34 subjects from College Composition to Calculus.'),
  c('saylor', 'Saylor Academy', 'college-credit', 'course-provider', 'free',
    'Saylor Academy (nonprofit)', 'Free; many courses are ACE/NCCRS credit-recommended (Saylor Direct Credit)', 'https://www.saylor.org/',
    'Free, self-paced college-level courses. Pass the final exam and many carry ACE- or NCCRS-recommended college credit you can transfer to partner schools — at no cost.'),
  c('sophia', 'Sophia Learning', 'college-credit', 'course-provider', 'low',
    'Sophia (Strategic Education)', 'ACE-recommended; widely accepted (esp. SNHU, WGU pathways)', 'https://www.sophia.org/',
    'Low-cost ($99/mo, unlimited) self-paced courses with ACE credit recommendations — a fast, cheap way to knock out gen-eds that transfer to many online universities.'),
  c('straighterline', 'StraighterLine', 'college-credit', 'course-provider', 'low',
    'StraighterLine', 'ACE-recommended; partner-college transfer network', 'https://www.straighterline.com/',
    'Subscription college courses ($99/mo + per-course fee) with ACE credit recommendations and a large partner-college network that accepts the credit.'),
  c('dsst', 'DSST Exams', 'college-credit', 'credit-by-exam', 'low',
    'Prometric / ACE', 'ACE-recommended credit-by-exam; free for military', 'https://www.getcollegecredit.com/',
    'Credit-by-exam like CLEP but for a different subject set (and upper-level options). ACE-recommended; free for service members via DANTES.'),
  c('ace-credit', 'ACE Credit Recommendation (ACE Learning Evaluations)', 'college-credit', 'accreditor', 'free',
    'American Council on Education', 'The credit-recommendation service colleges trust', 'https://www.acenet.edu/Programs-Services/Pages/Credit-Transcripts/ACE-Learning-Evaluations.aspx',
    'ACE reviews non-college courses/exams and recommends college credit; its transcript is how Saylor/Sophia/StraighterLine credit gets accepted. The backbone of the alt-credit world.'),

  // ── Continuing education & CEUs ──────────────────────────────────────────────────────────────────
  c('iacet', 'IACET Accredited Provider (ANSI/IACET 1-2018)', 'continuing-education', 'accreditor', 'paid',
    'International Accreditors for Continuing Education & Training', 'The ANSI-recognized standard for awarding CEUs (1 CEU = 10 contact hours)', 'https://www.iacet.org/',
    'Accreditation that lets an organization award nationally-recognized CEUs under the ANSI/IACET Standard. The credential path for making training count toward licenses and professional requirements — MELEK\'s own goal.'),
  c('ceu-general', 'Continuing Education Units (CEUs)', 'continuing-education', 'certificate', 'low',
    'IACET-accredited providers', 'Accepted by many licensing boards & employers', 'https://www.iacet.org/standards/the-iacet-ceu/',
    'The standard unit of professional continuing education: 1 CEU = 10 contact hours of instruction from an accredited provider. How professionals keep licenses and certifications current.'),
  c('linkedin-learning', 'LinkedIn Learning', 'continuing-education', 'course-provider', 'paid',
    'LinkedIn', 'Completion certificates; many are PMI PDU / CPE eligible; often free via libraries', 'https://www.linkedin.com/learning/',
    'Thousands of professional courses with completion certificates — many qualify for PMI PDUs or CPE. Free through many public libraries (with a library card).'),

  // ── Teaching English (TEFL / TESOL) ──────────────────────────────────────────────────────────────
  c('tefl-120', '120-hour TEFL Certificate', 'teaching-english', 'certificate', 'low',
    'Various (look for accreditation)', 'The de-facto minimum to teach English abroad/online; accreditation matters', 'https://www.teflcourse.net/',
    'The standard entry credential to teach English as a foreign language. 120 hours is the widely-required minimum. Choose a provider with recognized accreditation (e.g. Accreditat, DEAC) — many cheap ones are unrecognized.'),
  c('tesol', 'TESOL Certificate', 'teaching-english', 'certificate', 'low',
    'Various / TESOL International Association', 'Recognized for teaching English to speakers of other languages', 'https://www.tesol.org/',
    'Teaching English to Speakers of Other Languages — overlaps heavily with TEFL; TESOL International Association is the professional body. University-affiliated TESOL certificates carry the most weight.'),
  c('celta', 'CELTA (Certificate in Teaching English to Speakers of Other Languages)', 'teaching-english', 'certificate', 'paid',
    'Cambridge English / Cambridge University Press & Assessment', 'The gold-standard initial TEFL/TESOL qualification', 'https://www.cambridgeenglish.org/teaching-english/teaching-qualifications/celta/',
    'The most respected entry-level English-teaching qualification worldwide. In-person or online with assessed teaching practice — pricier (~$1,500–2,500) but opens the best schools.'),
  c('tkt', 'TKT (Teaching Knowledge Test)', 'teaching-english', 'certification', 'low',
    'Cambridge English', 'Modular, recognized knowledge test for teachers', 'https://www.cambridgeenglish.org/teaching-english/teaching-qualifications/tkt/',
    'A flexible, modular test of English-teaching knowledge from Cambridge — cheaper than CELTA and good for current teachers proving their knowledge base.'),
  c('delta', 'DELTA (Diploma in Teaching English to Speakers of Other Languages)', 'teaching-english', 'certificate', 'paid',
    'Cambridge English', 'Advanced qualification for experienced teachers (post-CELTA)', 'https://www.cambridgeenglish.org/teaching-english/teaching-qualifications/delta/',
    'The advanced Cambridge diploma for experienced English teachers — the route to senior, teacher-training, and academic-management roles.'),

  // ── Information technology ────────────────────────────────────────────────────────────────────────
  c('comptia-aplus', 'CompTIA A+', 'information-technology', 'certification', 'paid',
    'CompTIA', 'Industry-standard entry IT-support cert (vendor-neutral)', 'https://www.comptia.org/certifications/a',
    'The baseline credential for IT support / help-desk roles. Vendor-neutral, employer-recognized. Two exams; study free via Professor Messer before paying for the exams.'),
  c('google-it-support', 'Google IT Support Professional Certificate', 'information-technology', 'certificate', 'low',
    'Google (via Coursera)', 'Entry-level, ACE-recommended for college credit; financial aid available', 'https://www.coursera.org/professional-certificates/google-it-support',
    'A beginner-to-job IT-support program from Google. Audit free, certificate ~$49/mo; ACE-recommended for college credit and a known on-ramp to CompTIA A+.'),
  c('aws-cloud-practitioner', 'AWS Certified Cloud Practitioner', 'information-technology', 'certification', 'paid',
    'Amazon Web Services', 'Industry-recognized foundational cloud cert', 'https://aws.amazon.com/certification/certified-cloud-practitioner/',
    'The entry point to AWS cloud certifications. Free training on AWS Skill Builder; the exam is ~$100. Strong signal for cloud-support and DevOps on-ramps.'),
  c('freecodecamp', 'freeCodeCamp Certifications', 'information-technology', 'certificate', 'free',
    'freeCodeCamp (nonprofit)', 'Free portfolio-building certs; respected for self-taught devs', 'https://www.freecodecamp.org/',
    'Completely free, project-based web-development and data certifications. Not accredited, but the projects build a real portfolio that employers respect.'),

  // ── Cybersecurity ────────────────────────────────────────────────────────────────────────────────
  c('isc2-cc', 'ISC2 Certified in Cybersecurity (CC)', 'cybersecurity', 'certification', 'free',
    'ISC2', 'Free training + free exam (ISC2 "One Million Certified" program)', 'https://www.isc2.org/certifications/cc',
    'An entry-level cybersecurity certification with FREE official training and a FREE exam through ISC2\'s One Million Certified in Cybersecurity pledge. The best free foot in the door.'),
  c('comptia-security', 'CompTIA Security+', 'cybersecurity', 'certification', 'paid',
    'CompTIA', 'The baseline security cert for DoD 8570 and most SOC roles', 'https://www.comptia.org/certifications/security',
    'The most-requested entry security certification; meets DoD 8570 baseline. Study free via Professor Messer; the exam is the paid part.'),
  c('tryhackme', 'TryHackMe / Hack The Box (hands-on training)', 'cybersecurity', 'course-provider', 'free',
    'TryHackMe / Hack The Box', 'Free tiers; respected hands-on skill-building (not a formal cert)', 'https://tryhackme.com/',
    'Gamified, hands-on cybersecurity labs with generous free tiers. Not a credential by themselves, but the practical skills that make the certs (and interviews) pass.'),

  // ── Data & AI ────────────────────────────────────────────────────────────────────────────────────
  c('google-data-analytics', 'Google Data Analytics Professional Certificate', 'data-ai', 'certificate', 'low',
    'Google (via Coursera)', 'Entry-level, ACE-recommended for college credit', 'https://www.coursera.org/professional-certificates/google-data-analytics',
    'A beginner-to-job data-analytics program. Audit free, certificate ~$49/mo; ACE-recommended for college credit. Covers spreadsheets, SQL, R and Tableau.'),
  c('deeplearning-ai', 'DeepLearning.AI Specializations', 'data-ai', 'course-provider', 'low',
    'DeepLearning.AI (via Coursera)', 'Respected ML/AI training from Andrew Ng', 'https://www.deeplearning.ai/',
    'The most-recommended applied machine-learning and AI courses. Audit free; certificate via Coursera subscription. Strong signal for ML/AI roles.'),
  c('ibm-data-science', 'IBM Data Science Professional Certificate', 'data-ai', 'certificate', 'low',
    'IBM (via Coursera)', 'Entry-level, employer-recognized', 'https://www.coursera.org/professional-certificates/ibm-data-science',
    'A beginner data-science path from IBM with hands-on Python and a capstone. Audit free; certificate via subscription.'),

  // ── Business, finance & PM ───────────────────────────────────────────────────────────────────────
  c('google-project-management', 'Google Project Management Certificate', 'business-finance', 'certificate', 'low',
    'Google (via Coursera)', 'Entry-level; ACE-recommended; counts toward CAPM eligibility', 'https://www.coursera.org/professional-certificates/google-project-management',
    'A beginner-to-job PM program. Audit free, certificate ~$49/mo; ACE-recommended for college credit and counts toward the education hours for PMI\'s CAPM.'),
  c('capm', 'CAPM (Certified Associate in Project Management)', 'business-finance', 'certification', 'paid',
    'Project Management Institute (PMI)', 'Globally recognized entry PM certification', 'https://www.pmi.org/certifications/capm',
    'PMI\'s entry-level project-management certification — the stepping stone to the PMP. Requires 23 contact hours of PM education (the Google PM cert qualifies).'),
  c('pmp', 'PMP (Project Management Professional)', 'business-finance', 'certification', 'paid',
    'Project Management Institute (PMI)', 'The premier global PM certification', 'https://www.pmi.org/certifications/project-management-pmp',
    'The gold-standard project-management certification. Requires experience + 35 contact hours of education and a rigorous exam. High salary signal.'),
  c('intuit-bookkeeping', 'Intuit Academy Bookkeeping Certificate', 'business-finance', 'certificate', 'low',
    'Intuit (via Coursera)', 'Entry-level bookkeeping; pathway to Intuit work', 'https://www.coursera.org/professional-certificates/intuit-bookkeeping',
    'A beginner bookkeeping credential from Intuit (QuickBooks). Audit free; prepares for the Intuit Certified Bookkeeping Professional exam and entry bookkeeping roles.'),

  // ── Healthcare & safety ──────────────────────────────────────────────────────────────────────────
  c('aha-bls', 'CPR / BLS Certification', 'healthcare', 'certification', 'low',
    'American Heart Association / American Red Cross', 'The standard life-support credential for healthcare & many jobs', 'https://cpr.heart.org/',
    'Basic Life Support / CPR certification required for most clinical and many non-clinical jobs. Blended online + in-person skills check; valid two years.'),
  c('cna', 'Certified Nursing Assistant (CNA)', 'healthcare', 'certification', 'low',
    'State registries (program + state exam)', 'State-licensed entry healthcare credential', 'https://www.redcross.org/take-a-class/cna-training',
    'A state-approved training program plus a competency exam licenses you as a nursing assistant — the most common entry point into clinical healthcare. Some employers pay for it.'),
  c('servsafe', 'ServSafe Food Handler / Manager', 'healthcare', 'certification', 'low',
    'National Restaurant Association', 'The standard U.S. food-safety credential', 'https://www.servsafe.com/',
    'Food-safety certification required by most U.S. jurisdictions for food-service workers and managers. Handler is cheap (~$15); Manager is more rigorous.'),

  // ── Skilled trades & compliance ──────────────────────────────────────────────────────────────────
  c('osha-10-30', 'OSHA 10 / OSHA 30 (Outreach Training)', 'skilled-trades', 'certificate', 'low',
    'OSHA-authorized providers', 'Widely required workplace-safety card (construction/general industry)', 'https://www.osha.gov/training/outreach',
    'Workplace-safety training that many construction and general-industry jobs require. OSHA 10 for workers, OSHA 30 for supervisors. Use an OSHA-authorized provider only.'),
  c('epa-608', 'EPA Section 608 Technician Certification', 'skilled-trades', 'certification', 'low',
    'EPA-approved organizations', 'Legally required to handle refrigerants (HVAC)', 'https://www.epa.gov/section608/section-608-technician-certification-0',
    'Federally required to buy or handle refrigerants — essential for HVAC/R work. Free study materials abound; the exam fee is small.'),
  c('cdl', 'Commercial Driver\'s License (CDL)', 'skilled-trades', 'license-prep', 'low',
    'State DMVs (+ ELDT-registered training)', 'Federal/state license for commercial driving', 'https://www.fmcsa.dot.gov/registration/commercial-drivers-license',
    'The license for driving trucks/buses commercially. Requires federally-mandated Entry-Level Driver Training (ELDT) from a registered provider, then a state exam. Many carriers pay for training.'),

  // ── Teaching & instructional design ──────────────────────────────────────────────────────────────
  c('praxis', 'Praxis Tests (teacher licensure)', 'education-teaching', 'credit-by-exam', 'low',
    'ETS', 'Required for K-12 teacher licensure in most U.S. states', 'https://www.ets.org/praxis.html',
    'The exams most U.S. states require to license K-12 teachers (subject + core skills). Free and low-cost prep is widely available before the paid exam.'),
  c('idol', 'Instructional Design / Online Teaching credentials', 'education-teaching', 'certificate', 'low',
    'Various (ATD, universities, IDOL Academy)', 'Recognized for corporate L&D and online-course design', 'https://www.td.org/',
    'Credentials for designing training and online courses — from ATD\'s instructional-design certificates to university programs. The skill behind building IACET-quality CEU courses.'),

  // ── Accreditation & recognition (the bodies that vouch for everyone else) ────────────────────────
  c('chea', 'CHEA — Council for Higher Education Accreditation', 'accreditation', 'accreditor', 'free',
    'CHEA', 'The national body that recognizes legitimate U.S. accreditors', 'https://www.chea.org/',
    'CHEA recognizes the accreditors that vouch for U.S. colleges and programs. Its database is the quickest way to check whether a school\'s accreditation is real — before you spend a dime or a year.'),
  c('usde-dapip', 'U.S. Dept. of Education — Accreditation Database (DAPIP)', 'accreditation', 'accreditor', 'free',
    'U.S. Department of Education', 'The federal record of recognized accreditors & accredited institutions', 'https://ope.ed.gov/dapip/',
    'The government\'s own searchable database of recognized accrediting agencies and the institutions they accredit. The authoritative "is this college legit" check.'),
  c('regional-accreditors', 'U.S. Institutional Accreditors (HLC, MSCHE, SACSCOC, WSCUC, NECHE, NWCCU)', 'accreditation', 'accreditor', 'free',
    'The former "regional" accreditors', 'The accreditation that makes credits transfer & degrees count', 'https://www.chea.org/regional-accrediting-organizations',
    'The six bodies (Higher Learning Commission, Middle States, Southern/SACSCOC, WASC/WSCUC, New England/NECHE, Northwest/NWCCU) whose accreditation is what employers and other schools actually trust. Verify your school holds one.'),
  c('deac', 'DEAC — Distance Education Accrediting Commission', 'accreditation', 'accreditor', 'free',
    'DEAC', 'CHEA- & USDE-recognized accreditor for distance/online programs', 'https://www.deac.org/',
    'The recognized accreditor specifically for distance and online institutions and programs — including many TEFL and career-training providers. If an online program claims accreditation, check it\'s real here.'),
  c('anab-17024', 'ANAB — Personnel Certification Accreditation (ISO/IEC 17024)', 'accreditation', 'accreditor', 'free',
    'ANSI National Accreditation Board', 'Accredits the certification BODIES under the ISO/IEC 17024 standard', 'https://anab.ansi.org/credentialing/',
    'ANAB accredits the organizations that issue professional certifications, against the global ISO/IEC 17024 standard. An ANAB-accredited certification is the gold standard of "this cert is rigorous and fair."'),
  c('ncca', 'NCCA — National Commission for Certifying Agencies', 'accreditation', 'accreditor', 'free',
    'Institute for Credentialing Excellence (ICE)', 'The other major accreditor of personnel-certification programs', 'https://www.credentialingexcellence.org/p/cm/ld/fid=86',
    'NCCA accredits professional-certification programs (peer to ANAB). NCCA-accredited credentials are widely recognized by employers and licensing boards — look for the seal.'),
  c('nccrs', 'NCCRS — National College Credit Recommendation Service', 'accreditation', 'accreditor', 'free',
    'NCCRS (New York Board of Regents)', 'Recommends college credit for non-college learning (peer to ACE)', 'https://www.nationalccrs.org/',
    'Like ACE, NCCRS reviews courses, exams and training and recommends college credit that partner schools accept. The other backbone (with ACE) of the alt-credit world.'),
  c('credly', 'Credly — Digital Credentials & Badges', 'accreditation', 'certificate', 'free',
    'Credly (Pearson)', 'The issuer-of-record platform for verifiable digital badges', 'https://www.credly.com/',
    'Where CompTIA, IBM, Microsoft, PMI and many others issue verifiable digital badges. Free to hold and share; the standard way to prove a credential online.'),

  // ── More college credit / open providers ────────────────────────────────────────────────────────
  c('edx', 'edX', 'college-credit', 'course-provider', 'free',
    'edX (2U)', 'Audit free; verified certs & some for-credit MicroBachelors/Masters', 'https://www.edx.org/',
    'University courses from MIT, Harvard and others. Audit free; verified certificates and credit-bearing MicroBachelors/MicroMasters for a fee. A serious open-learning catalog.'),
  c('coursera', 'Coursera', 'college-credit', 'course-provider', 'free',
    'Coursera', 'Audit free; ACE-recommended certs & degrees from universities', 'https://www.coursera.org/',
    'The largest catalog of university and industry courses. Audit most for free; many professional certificates are ACE-recommended for college credit and financial aid is available.'),
  c('udacity', 'Udacity Nanodegrees', 'college-credit', 'course-provider', 'paid',
    'Udacity', 'Employer-recognized tech "nanodegrees"', 'https://www.udacity.com/',
    'Project-heavy tech "nanodegrees" (data, AI, cloud, programming) built with industry. Pricier and not for college credit, but respected for the portfolio they build.'),

  // ── Teaching English — accreditation note ─────────────────────────────────────────────────────────
  c('trinity-certtesol', 'Trinity CertTESOL', 'teaching-english', 'certificate', 'paid',
    'Trinity College London', 'The other globally-recognized initial TEFL/TESOL qualification (with CELTA)', 'https://www.trinitycollege.com/qualifications/teaching-english/CertTESOL',
    'Trinity College London\'s entry English-teaching certificate — the peer of Cambridge CELTA, equally accepted by reputable schools worldwide. Assessed teaching practice included.'),

  // ── Languages (proficiency) ───────────────────────────────────────────────────────────────────────
  c('actfl', 'ACTFL Proficiency (OPI / WPT)', 'languages', 'certification', 'low',
    'ACTFL / Language Testing International', 'The U.S. standard for certified language proficiency', 'https://www.actfl.org/assessments',
    'The recognized U.S. way to certify how well you speak/write a language (Oral & Writing Proficiency tests) — used for teaching licensure, government and employment.'),
  c('goethe', 'Goethe-Zentrum / Goethe-Institut (German, A1–C2)', 'languages', 'certification', 'low',
    'Goethe-Institut', 'The official German-proficiency standard (CEFR)', 'https://www.goethe.de/en/spr/kup/prf.html',
    'The internationally-recognized German-language certificate, mapped to the CEFR A1–C2 scale — accepted for university, work and immigration in German-speaking countries.'),
  c('dele', 'DELE (Spanish, Instituto Cervantes)', 'languages', 'certification', 'low',
    'Instituto Cervantes / Spanish Ministry of Education', 'The official Spanish-proficiency diploma (CEFR)', 'https://examenes.cervantes.es/en/dele/what-is',
    'The official Spanish-language diplomas (DELE), recognized worldwide for study, work and Spanish citizenship. CEFR A1–C2.'),
  c('delf-dalf', 'DELF / DALF (French)', 'languages', 'certification', 'low',
    'France Éducation international (French Ministry of Education)', 'The official French-proficiency diplomas (CEFR)', 'https://www.france-education-international.fr/en/diplomes-tests/delf-dalf',
    'The official, lifelong French-language diplomas (DELF A1–B2, DALF C1–C2) issued by the French government — for study, work and naturalization in France.'),
  c('jlpt', 'JLPT (Japanese-Language Proficiency Test)', 'languages', 'certification', 'low',
    'Japan Foundation & JEES', 'The standard Japanese-proficiency certificate (N5–N1)', 'https://www.jlpt.jp/e/',
    'The most widely-recognized Japanese-proficiency test (levels N5–N1), used for university, work and visa points in Japan.'),
  c('hsk', 'HSK (Chinese Proficiency Test)', 'languages', 'certification', 'low',
    'Chinese Ministry of Education (Hanban/CLEC)', 'The official Mandarin-proficiency standard', 'https://www.chinesetest.cn/',
    'The official standardized Mandarin Chinese proficiency test, recognized for study and work in China.'),

  // ── Information technology (the big vendor + neutral certs) ────────────────────────────────────────
  c('comptia-network', 'CompTIA Network+', 'information-technology', 'certification', 'paid',
    'CompTIA', 'Vendor-neutral networking baseline (pairs with A+/Security+)', 'https://www.comptia.org/certifications/network',
    'The vendor-neutral networking certification that sits between A+ and Security+ — core for network/IT-support careers. Free study via Professor Messer; the exam is the paid part.'),
  c('cisco-ccna', 'Cisco CCNA', 'information-technology', 'certification', 'paid',
    'Cisco', 'The industry-standard associate networking cert', 'https://www.cisco.com/site/us/en/learn/training-certifications/certifications/enterprise/ccna/index.html',
    'Cisco\'s associate-level networking certification — the most-recognized networking credential. Free training via Cisco Networking Academy; one paid exam.'),
  c('microsoft-certified', 'Microsoft Certified (Azure / 365 Fundamentals & Associate)', 'information-technology', 'certification', 'paid',
    'Microsoft', 'Industry-recognized cloud & productivity certs', 'https://learn.microsoft.com/credentials/',
    'Microsoft\'s role-based certifications (Azure Fundamentals AZ-900 up to Associate/Expert, plus 365). Free training on Microsoft Learn; exams ~$99–165. Strong for cloud and IT-admin roles.'),
  c('google-cloud', 'Google Cloud Certifications', 'information-technology', 'certification', 'paid',
    'Google Cloud', 'Recognized cloud certs (Cloud Digital Leader → Pro)', 'https://cloud.google.com/learn/certification',
    'Google Cloud\'s role-based certifications, from the entry Cloud Digital Leader to Professional Architect/Engineer. Free training paths; exams are the paid part.'),
  c('redhat-rhcsa', 'Red Hat Certified System Administrator (RHCSA)', 'information-technology', 'certification', 'paid',
    'Red Hat', 'The respected hands-on Linux sysadmin cert', 'https://www.redhat.com/en/services/certification/rhcsa',
    'A performance-based (you actually do the tasks) Linux administration certification — highly respected for ops/DevOps roles. Pricier exam, but a real skill signal.'),
  c('linux-foundation', 'Linux Foundation (LFCS / CKA — Kubernetes)', 'information-technology', 'certification', 'paid',
    'The Linux Foundation', 'Hands-on Linux & Kubernetes certs', 'https://training.linuxfoundation.org/certification/',
    'Performance-based certifications for Linux (LFCS) and Kubernetes (CKA/CKAD) — the standard for cloud-native and container roles. Free intro courses; paid proctored exams.'),

  // ── Cybersecurity (the big bodies) ───────────────────────────────────────────────────────────────
  c('isc2-cissp', 'ISC2 CISSP', 'cybersecurity', 'certification', 'paid',
    'ISC2', 'The flagship senior security certification', 'https://www.isc2.org/certifications/cissp',
    'The most-recognized advanced cybersecurity certification — for experienced security professionals and managers. Requires 5 years\' experience + a demanding exam; high salary signal.'),
  c('isaca', 'ISACA — CISA / CISM / CRISC', 'cybersecurity', 'certification', 'paid',
    'ISACA', 'The standard audit/governance/risk security certs', 'https://www.isaca.org/credentialing',
    'ISACA\'s certifications for security audit (CISA), security management (CISM) and risk (CRISC) — the recognized credentials for GRC and security-leadership roles.'),
  c('ec-council-ceh', 'EC-Council CEH (Certified Ethical Hacker)', 'cybersecurity', 'certification', 'paid',
    'EC-Council', 'Widely-requested offensive-security cert (DoD 8570 listed)', 'https://www.eccouncil.org/train-certify/certified-ethical-hacker-ceh/',
    'The best-known penetration-testing / ethical-hacking certification, frequently required in job postings and listed for DoD 8570. Paid training + exam.'),
  c('giac', 'GIAC Certifications (SANS)', 'cybersecurity', 'certification', 'paid',
    'GIAC / SANS Institute', 'Premium, deeply-respected hands-on security certs', 'https://www.giac.org/',
    'The certifications paired with SANS training — among the most respected (and expensive) in security, covering forensics, incident response, pen-testing and more.'),

  // ── Business, finance & PM (the recognized ladders) ──────────────────────────────────────────────
  c('psm-csm', 'Scrum Master (PSM / CSM)', 'business-finance', 'certification', 'paid',
    'Scrum.org / Scrum Alliance', 'The recognized agile/Scrum credentials', 'https://www.scrum.org/professional-scrum-certifications',
    'The two recognized Scrum Master certifications — Scrum.org\'s PSM (cheaper, no required course) and Scrum Alliance\'s CSM (course required). Core for agile delivery roles.'),
  c('asq-six-sigma', 'ASQ Six Sigma (Green / Black Belt)', 'business-finance', 'certification', 'paid',
    'American Society for Quality (ASQ)', 'The standard quality/process-improvement credential', 'https://asq.org/cert',
    'ASQ\'s Six Sigma and quality certifications (Green Belt, Black Belt, CQA) — the recognized process-improvement credentials in manufacturing, healthcare and operations.'),
  c('itil', 'ITIL 4 (IT Service Management)', 'business-finance', 'certification', 'paid',
    'PeopleCert / Axelos', 'The global standard for IT service management', 'https://www.peoplecert.org/browse-certifications/it-governance-and-service-management/ITIL-1',
    'ITIL 4 Foundation and beyond — the recognized framework/credential for IT service management and operations. Self-study + a paid exam.'),
  c('cfa', 'CFA (Chartered Financial Analyst)', 'business-finance', 'certification', 'paid',
    'CFA Institute', 'The premier investment-management credential', 'https://www.cfainstitute.org/programs/cfa',
    'The gold-standard credential for investment analysis and portfolio management — three rigorous exam levels plus experience. Demanding and globally respected.'),
  c('cfp', 'CFP (Certified Financial Planner)', 'business-finance', 'certification', 'paid',
    'CFP Board', 'The standard for personal financial planning', 'https://www.cfp.net/',
    'The recognized credential for financial planners/advisors — coursework, exam, experience and an ethics requirement. The mark consumers are told to look for.'),
  c('cpa', 'CPA (Certified Public Accountant)', 'business-finance', 'license-prep', 'paid',
    'AICPA / NASBA + state boards', 'The licensed U.S. accounting credential', 'https://www.aicpa-cima.com/resources/landing/cpa-exam',
    'The licensed accounting credential in the U.S. — 150 credit hours, the four-part Uniform CPA Exam, and state licensure. The top accounting qualification.'),
  c('finra-sie', 'FINRA SIE (Securities Industry Essentials)', 'business-finance', 'license-prep', 'low',
    'FINRA', 'The entry exam for a securities career (no sponsor needed)', 'https://www.finra.org/registration-exams-ce/qualification-exams/securities-industry-essentials-exam-sie',
    'The entry-level securities exam you can take WITHOUT an employer sponsor — the first step toward Series 7 and a finance/brokerage career. ~$80; free study materials abound.'),

  // ── Human resources ──────────────────────────────────────────────────────────────────────────────
  c('shrm', 'SHRM-CP / SHRM-SCP', 'human-resources', 'certification', 'paid',
    'Society for Human Resource Management', 'A leading HR professional certification', 'https://www.shrm.org/credentials/certification',
    'SHRM\'s competency-based HR certifications (CP for practitioners, SCP for senior) — one of the two recognized HR credential families employers ask for.'),
  c('hrci', 'HRCI — aPHR / PHR / SPHR', 'human-resources', 'certification', 'paid',
    'HR Certification Institute', 'The original HR certification family (NCCA-accredited)', 'https://www.hrci.org/',
    'HRCI\'s credential ladder — aPHR (no experience needed), PHR, SPHR. NCCA-accredited and long-recognized; the other major HR credential family alongside SHRM.'),

  // ── Healthcare & safety (the big credentialing bodies) ───────────────────────────────────────────
  c('nha', 'NHA — Certified Clinical Medical Assistant / Phlebotomy (CCMA, CPT)', 'healthcare', 'certification', 'low',
    'National Healthcareer Association', 'Widely-accepted allied-health certifications', 'https://www.nhanow.com/',
    'NHA issues some of the most common allied-health certifications — Clinical Medical Assistant (CCMA), Phlebotomy (CPT), EKG, Billing & Coding. Accepted by many employers and schools.'),
  c('aama-cma', 'AAMA — Certified Medical Assistant (CMA)', 'healthcare', 'certification', 'low',
    'American Association of Medical Assistants', 'The NCCA-accredited Medical Assistant credential', 'https://www.aama-ntl.org/cma-aama-exam',
    'The CMA (AAMA) — a highly-regarded, NCCA-accredited Medical Assistant certification (requires graduating an accredited MA program). Often preferred by larger clinics/hospitals.'),
  c('nremt', 'NREMT — EMT / Paramedic Certification', 'healthcare', 'certification', 'low',
    'National Registry of Emergency Medical Technicians', 'The national standard for EMS certification', 'https://www.nremt.org/',
    'The national certification behind state EMS licensure for EMTs and Paramedics — complete an approved course, then the NREMT cognitive + skills exams.'),
  c('arrt', 'ARRT — Radiologic Technologist', 'healthcare', 'certification', 'paid',
    'American Registry of Radiologic Technologists', 'The standard credential for medical imaging', 'https://www.arrt.org/',
    'The recognized certification/registration for radiographers and imaging techs — requires an accredited program plus the ARRT exam; the basis for most state licensure.'),
  c('nclex', 'NCLEX (RN / PN) — Nursing Licensure Exam', 'healthcare', 'license-prep', 'low',
    'NCSBN (state boards of nursing)', 'The exam behind every U.S. nursing license', 'https://www.ncsbn.org/exams/about-the-nclex.page',
    'The licensure exam every U.S. nurse must pass (NCLEX-RN or NCLEX-PN) after an accredited nursing program. The single gateway to nursing practice.'),

  // ── Skilled trades & compliance (the recognized issuers) ─────────────────────────────────────────
  c('nccer', 'NCCER — Construction Craft Credentials', 'skilled-trades', 'certification', 'low',
    'National Center for Construction Education & Research', 'The standardized, portable construction-trades credential', 'https://www.nccer.org/',
    'NCCER\'s curriculum and credentials are the industry standard for construction trades (electrical, plumbing, welding, heavy equipment) — portable across employers and states.'),
  c('ase', 'ASE — Automotive Service Excellence', 'skilled-trades', 'certification', 'low',
    'National Institute for Automotive Service Excellence', 'The standard certification for auto technicians', 'https://www.ase.com/',
    'The recognized credential for automotive technicians — a series of exams by specialty (engines, brakes, electrical…). The mark shops and customers trust.'),
  c('aws-welding', 'AWS Certified Welder', 'skilled-trades', 'certification', 'low',
    'American Welding Society', 'The standard performance-based welding credential', 'https://www.aws.org/certification-and-education/',
    'A performance-based welding certification from the American Welding Society — you weld to a code and it\'s tested. The recognized proof of welding skill.'),
  c('nate', 'NATE — HVAC Technician Certification', 'skilled-trades', 'certification', 'low',
    'North American Technician Excellence', 'The leading HVAC/R technician certification', 'https://natex.org/',
    'The largest non-vendor certification for HVAC/R technicians — recognized across the industry and often paired with EPA 608.'),

  // ── Childcare & early education — the credential path AND the funding path ────────────────────────
  c('cda', 'CDA — Child Development Associate Credential', 'childcare', 'certification', 'low',
    'Council for Professional Recognition', 'THE nationally-recognized entry credential to work in childcare', 'https://www.cdacouncil.org/en/credentials/about-cda/',
    'The Child Development Associate (CDA) is the standard national credential for early-childhood educators — what most states and centers require to teach young children. ~120 training hours + a portfolio + an exam (~$425, and often paid for free by T.E.A.C.H.).'),
  c('teach-scholarship', 'T.E.A.C.H. Early Childhood Scholarships', 'childcare', 'funding', 'free',
    'T.E.A.C.H. Early Childhood National Center', 'Pays for your CDA or early-childhood degree', 'https://teachecnationalcenter.org/',
    'Scholarships that cover most of the cost of earning a CDA or an early-childhood degree — tuition, books, and often a raise/bonus. The way most childcare workers get credentialed for (almost) free. Offered state by state.'),
  c('ccp-nac', 'CCP & National Administrator Credential (NAC)', 'childcare', 'certification', 'low',
    'NECPA Commission / Council for Professional Recognition', 'Director-level childcare credentials (to run a center)', 'https://necpa.net/',
    'Step up from the CDA: the Certified Childcare Professional (CCP) and the National Administrator Credential (NAC) — the credentials for directing and running a childcare center, often required for licensing or higher funding tiers.'),
  c('childcare-license', 'State Child Care License (running a daycare)', 'childcare', 'license-prep', 'low',
    'Your state licensing agency (find it via childcare.gov)', 'The legal requirement to operate a daycare', 'https://childcare.gov/state-resources',
    'To run a daycare (home- or center-based) you need a state license: meet health/safety/ratio rules, background checks, and staff-credential minimums. childcare.gov\'s state lookup links your exact agency and rules — start here.'),
  c('naeyc-accreditation', 'NAEYC Accreditation', 'childcare', 'accreditor', 'paid',
    'National Association for the Education of Young Children', 'The mark of a high-quality program — raises your QRIS rating & funding', 'https://www.naeyc.org/accreditation',
    'The gold-standard accreditation for early-childhood programs. It signals quality to parents AND lifts your state QRIS rating — which raises subsidy reimbursement rates and unlocks more grants.'),
  c('ccdf-subsidy', 'CCDF — Child Care Subsidy (state + federal)', 'childcare', 'funding', 'free',
    'Office of Child Care (HHS/ACF) → your state', 'The largest federal money stream into childcare', 'https://www.acf.hhs.gov/occ',
    'The Child Care & Development Fund: federal money, run by each state, that pays providers to care for kids from lower-income families. Become an approved provider and a large share of your tuition can be government-paid. Apply through your state agency.'),
  c('head-start', 'Head Start / Early Head Start', 'childcare', 'funding', 'free',
    'Office of Head Start (HHS/ACF)', 'Federal grants to deliver free early education', 'https://www.acf.hhs.gov/ohs',
    'Federal grants that fund free early-education and family services for low-income children (birth–5). Run a Head Start program (grantee/partner), or point families to free local slots. Major, stable federal funding.'),
  c('cacfp', 'CACFP — Child & Adult Care Food Program (USDA)', 'childcare', 'funding', 'free',
    'USDA Food & Nutrition Service → your state', 'Reimburses daycares for the meals they serve', 'https://www.fns.usda.gov/cacfp',
    'USDA reimburses licensed daycares and home providers for nutritious meals and snacks served to kids — real monthly money that many providers leave on the table. Enroll through your state CACFP sponsor.'),
  c('childcare-grants', 'Free government money for childcare — the official sources', 'childcare', 'funding', 'free',
    'childcare.gov · grants.gov · benefits.gov', 'The real programs behind the "free-money" pitch — no book required', 'https://childcare.gov/',
    'The honest version of the question-mark-suit "free government money" idea: the actual federal/state programs are public and free to apply for. Start at childcare.gov (subsidies, licensing, provider grants), then grants.gov and benefits.gov. You never need to buy a guide — we map it for free.'),

  // ── FREE PATHWAYS — healthcare, trades, business, data (verified 14 Sept 2026) ────────────────────


  // ══ HEALTHCARE ════════════════════════════════════════════════════════════════════════════════

  { id: 'cna-employer-paid-42cfr', name: 'CNA training a facility may not charge you for (42 CFR 483.152)', industry: 'healthcare', type: 'federal-rule', cost: 'free',
    provider: 'U.S. federal regulation, enforced via CMS / state nurse aide registries',
    recognition: 'Binding on every Medicare/Medicaid-certified nursing facility in the U.S.; the resulting CNA certification is state-issued and portable within that state',
    url: 'https://www.law.cornell.edu/cfr/text/42/483.152',
    what: 'Not a course — a federal rule that makes a course free. Verbatim: "No nurse aide who is employed by, or who has received an offer of employment from, a facility on the date on which the aide begins a nurse aide training and competency evaluation program may be charged for any portion of the program" — tuition, textbooks or materials. And if you pay for training yourself and are then hired as a nurse aide within 12 months, "the State must provide for the reimbursement of costs incurred in completing the program on a pro rata basis during the period in which the individual is employed as a nurse aide." The common misunderstanding: people think free CNA training is a favour a nursing home does for them. It is a legal obligation once they have offered you a job, and the pro-rata reimbursement after the fact is a right most candidates never claim.' },

  { id: 'healthcare-registered-apprenticeship', name: 'Healthcare Registered Apprenticeship', industry: 'healthcare', type: 'apprenticeship', cost: 'free',
    provider: 'U.S. Department of Labor Office of Apprenticeship (employer-sponsored)',
    recognition: 'Completion yields a DOL Certificate of Completion — an industry-recognised, nationally portable credential; the underlying occupational licence/certification is the state one',
    url: 'https://www.apprenticeship.gov/apprenticeship-industries/healthcare',
    what: 'A paid job that trains you into a clinical credential. DOL lists registered apprenticeship occupations including Registered Nurse, Licensed Practical Nurse, Certified Nurse Aide, Medical Assistant, Home Health Aide, EMT/Paramedic, Dental Assistant, Surgical Technologist, Community Health Worker, Direct Support Professional and Certified Registered Central Service Technician, and notes these programs are competency-based rather than time-based. The common misunderstanding: people assume apprenticeship means construction only — nursing and allied-health apprenticeships are real and growing. The catch is that it is an employment contract, not a course you can drop.' },

  { id: 'jobcorps-healthcare', name: 'Job Corps — healthcare training track', industry: 'healthcare', type: 'residential-training-program', cost: 'free',
    provider: 'U.S. Department of Labor',
    recognition: 'Training leads into industry-recognised credentials in 100+ training areas across 10 in-demand industries; DOL-operated and nationally available',
    url: 'https://www.jobcorps.gov/',
    what: 'A federally funded residential programme for low-income people aged 16 through 24 that trains into health care among other fields, stating "All at no cost to you" and training "without any student debt" — plus free housing, meals, basic medical care and a living allowance. The common misunderstanding: it is treated as a last resort for troubled teens. It is a free, room-and-board vocational school with a hard age and income ceiling, which is the real limit — if you are 25, this door is closed.' },

  { id: 'nctsn-psychological-first-aid', name: 'Psychological First Aid (PFA) Online', industry: 'healthcare', type: 'course-with-ce', cost: 'free',
    provider: 'National Child Traumatic Stress Network (SAMHSA-funded; jointly coordinated by UCLA and Duke University)',
    recognition: 'NCTSN Learning Center continuing education; PFA is the model used by disaster-response and school crisis teams, recognised in behavioural-health and emergency-response settings',
    url: 'https://www.nctsn.org/resources/psychological-first-aid-pfa-online',
    what: 'A free 5-hour interactive course in the evidence-informed approach to supporting people immediately after a disaster or critical incident; the NCTSN Learning Center that hosts it states plainly that it offers FREE continuing education credits. The common misunderstanding: PFA is not counselling or therapy and does not license you to treat anyone — it is structured, non-clinical immediate support, which is precisely why it can be taught to volunteers for free.' },

  { id: 'fema-cdp-responder-training', name: 'FEMA Center for Domestic Preparedness training', industry: 'healthcare', type: 'federal-training-program', cost: 'free',
    provider: 'FEMA, U.S. Department of Homeland Security',
    recognition: 'Federal responder training for state, local, tribal and territorial emergency response personnel, including healthcare and EMS disciplines',
    url: 'https://www.fema.gov/emergency-managers/national-preparedness/training',
    what: 'Federal hands-on responder training, including healthcare and hazmat disciplines. FEMA states it directly: "Training provided by the CDP is federally funded at no cost to state, local, tribal and territorial emergency response professionals or their agencies." The common misunderstanding: this is not open to the general public — eligibility runs through your agency or employer, so it is free only if you already hold a response role.' },

  { id: 'mental-health-first-aid', name: 'Mental Health First Aid (MHFA)', industry: 'healthcare', type: 'certification', cost: 'paid',
    provider: 'National Council for Mental Wellbeing',
    recognition: 'Widely used by employers, schools, first responders and faith communities; not a clinical licence',
    url: 'https://mentalhealthfirstaid.org/pricing/',
    what: 'COST: Paid — from $29.95/person for small companies; free ONLY where a state, city or grantmaker subsidises a class. A certification in recognising and responding to a mental-health or substance-use crisis. Listed here because it is constantly described as free and it is not: MHFA states that "Course fees vary" and publishes a from-$29.95 per-person figure, with instructor training at $2,400. What IS true is that "Several organizations, states and cities subsidize the cost" — so the free route is finding a subsidised local class, not the national programme. The common misunderstanding: people think the certification itself is free; the subsidy is local and inconsistent.' },

  // ══ SKILLED TRADES ════════════════════════════════════════════════════════════════════════════

  { id: 'registered-apprenticeship', name: 'Registered Apprenticeship (the DOL system itself)', industry: 'skilled-trades', type: 'apprenticeship', cost: 'free',
    provider: 'U.S. Department of Labor Office of Apprenticeship + registered employer/union sponsors',
    recognition: 'Completion yields a nationally recognised, portable DOL Certificate of Completion; recognised across all 50 states',
    url: 'https://www.apprenticeship.gov/career-seekers',
    what: 'The earn-while-you-learn model: apprentices "earn a competitive wage from day one" with a "guaranteed wage increase as you develop new skills," combining paid employment with classroom instruction, and finish with "an industry-recognized and nationally-portable credential." Registered industries include advanced manufacturing, agriculture, AI, construction, education, energy, financial services, healthcare, hospitality, technology, telecommunications and transportation. The common misunderstanding: that you apply to a programme like a school. You are applying for a JOB with a sponsor, intake windows are narrow, and competition for the union building trades is heavy.' },

  { id: 'ua-apprenticeship', name: 'United Association apprenticeship (plumbing, pipefitting, HVACR, welding)', industry: 'skilled-trades', type: 'union-apprenticeship', cost: 'free',
    provider: 'United Association (UA) local unions and their joint apprenticeship committees',
    recognition: 'Journeyman status plus "industry-recognized credentials"; UA journeyman standing is recognised industry-wide across the mechanical trades',
    url: 'https://ua.org/career-paths/apprentice/',
    what: 'A five-year-shaped paid apprenticeship — 2,000 hours of on-the-job training per year plus 216 hours of classroom instruction per year — across plumbers, pipefitters, sprinkler fitters, HVACR service technicians, welders, pipeliners and steamfitters. The UA states apprentices "earn a competitive wage and benefits while you learn your trade," take regular pay increases with healthcare and retirement "without accumulating student debt," and through college partnerships can finish "as a journeyman and be just a few credits away from a college degree with zero student loan debt." The common misunderstanding: that the classroom half is a night school you pay for. It is part of the package. The real cost is the multi-year commitment and the tools.' },

  { id: 'iuoe-apprenticeship', name: 'IUOE apprenticeship (operating engineers, heavy equipment, stationary engineers)', industry: 'skilled-trades', type: 'union-apprenticeship', cost: 'free',
    provider: 'International Union of Operating Engineers local unions',
    recognition: 'Leads to journey-level status and "industry-recognized credentials"',
    url: 'https://www.iuoe.org/training',
    what: 'COST: Earn-while-you-learn; IUOE does not print a tuition figure — confirm with the local (cost UNVERIFIED at source). Paid apprenticeship into heavy-equipment operation and stationary/building engineering, described by IUOE as "Earn While You Learn apprenticeship programs" leading to journey-level status. Honest note: the national IUOE page does NOT state whether any tuition or fee is charged, and IUOE says "locals are the primary point of contact for training" — so the money question has to be asked at the local hall. The common misunderstanding: that terms are uniform nationally. They are set local by local.' },

  { id: 'ibew-neca-jatc', name: 'IBEW/NECA electrical apprenticeship (local JATC)', industry: 'skilled-trades', type: 'union-apprenticeship', cost: 'free',
    provider: 'electrical training ALLIANCE — a joint effort of the IBEW and NECA; delivered by local Joint Apprenticeship and Training Committees',
    recognition: 'The dominant unionised route to electrical journeyman status in the U.S.; curriculum standard across local JATCs',
    url: 'https://www.electricaltrainingalliance.org/',
    what: 'COST: Earn-while-you-learn; the national site prints no tuition figure — confirm with the local JATC (cost UNVERIFIED at source). The IBEW/NECA joint training body, 70+ years old, that writes the curriculum local JATCs teach; you apply to a local JATC, not to the ALLIANCE. Honest note: the national site describes itself as a training-materials resource and does NOT state apprentice pay or tuition, so this entry is listed as the on-ramp, with the cost question to be settled at the local. The common misunderstanding: that "electrical training ALLIANCE" is itself a school you enrol in.' },

  { id: 'hbi-pact', name: 'HBI PACT (Pre-Apprenticeship Certificate Training)', industry: 'skilled-trades', type: 'pre-apprenticeship-certification', cost: 'free',
    provider: 'Home Builders Institute (national nonprofit), certification issued through NOCTI',
    recognition: 'Based on National Skills Standards and "recognized by 140,000 National Association of Home Builders (NAHB) members"',
    url: 'https://hbi.org/certification/',
    what: 'A NOCTI-issued pre-apprenticeship credential requiring a minimum of 150 hours of instruction, available in Core and Core Green, Carpentry, Electrical, Plumbing, Brick Masonry, Landscaping, Painting & Finishing, Building Construction Technology, Weatherization, HVAC and Residential Construction Principles. HBI states "All programs and trainings are at NO COST to our students," delivered to veterans and transitioning service members, youth via Job Corps and BuildStrong Academies, and justice-involved individuals. The common misunderstanding: PACT is a PRE-apprenticeship — it gets you to the front of the apprenticeship queue, it is not journeyman training and it is not a licence.' },

  { id: 'jobcorps-trades', name: 'Job Corps — construction and skilled-trades tracks', industry: 'skilled-trades', type: 'residential-training-program', cost: 'free',
    provider: 'U.S. Department of Labor',
    recognition: '100+ training areas across 10 in-demand industries including construction and manufacturing; DOL-operated',
    url: 'https://www.jobcorps.gov/',
    what: 'Free residential trade training for low-income 16-to-24-year-olds — "All at no cost to you," with free housing, meals, basic medical care and a living allowance, and explicitly "without any student debt." The common misunderstanding: that it competes with a union apprenticeship. It usually FEEDS one — Job Corps and pre-apprenticeship providers like HBI run together, and the apprenticeship is the next step, not the alternative.' },

  { id: 'youthbuild', name: 'YouthBuild', industry: 'skilled-trades', type: 'pre-apprenticeship-program', cost: 'free',
    provider: 'U.S. Department of Labor, Office of Workforce Investment, Division of Youth Services',
    recognition: 'Produces a high school diploma or equivalency plus vocational certifications, and is an explicit on-ramp to Registered Apprenticeship',
    url: 'https://www.dol.gov/agencies/eta/youth/youthbuild',
    what: 'COST: Free (DOL grant-funded under WIOA §171; no participant fee is charged). A community-based pre-apprenticeship for people aged 16-24 who left school without a diploma, combining construction work on affordable housing with finishing secondary education; participants earn a diploma or equivalency plus vocational certifications in construction and also healthcare, IT and hospitality. The common misunderstanding: that you have to choose between finishing school and learning a trade — the entire design of YouthBuild is that you do both at once.' },

  { id: 'helmets-to-hardhats', name: 'Helmets to Hardhats', industry: 'skilled-trades', type: 'placement-program', cost: 'free',
    provider: 'Helmets to Hardhats (nonprofit, building-trades affiliated)',
    recognition: 'Direct pipeline into registered building-trades apprenticeships — carpenters, electricians, plumbers, ironworkers, operating engineers, laborers, roofers',
    url: 'https://helmetstohardhats.org/',
    what: 'COST: Free (no fee stated; placement into paid apprenticeships). A veterans-to-trades placement service, not a school: it routes military veterans into union apprenticeships described as "Earn While You Learn," with "debt-free education through apprenticeships" and the ability to "Use GI Benefits" on top. The common misunderstanding: that it is a job board. It is a route into the apprenticeship intake process, which still has its own tests and waiting lists.' },

  { id: 'wioa-workforce-funding', name: 'WIOA workforce funding via local Workforce Development Boards', industry: 'skilled-trades', type: 'public-funding', cost: 'free',
    provider: 'U.S. Department of Labor Employment and Training Administration; administered by states and local boards',
    recognition: 'The federal statute under which publicly funded job training is purchased in every state',
    url: 'https://www.dol.gov/agencies/eta/wioa',
    what: 'COST: Free (funds third-party tuition; eligibility-gated). The Workforce Innovation and Opportunity Act (2014) is the law behind the American Job Center system and the money that buys training for job seekers — apprenticeship.gov confirms that "WIOA funding is allotted to states and is administered through local Workforce Development Boards." Honest note: DOL\'s own WIOA page describes access to "employment, education, training, and support services" but does NOT itself spell out the Individual Training Account mechanism, so treat the ITA specifics as UNVERIFIED and ask your local board. The common misunderstanding: people look for a national application form. There is none — the money is local, the eligibility is local, and the list of approved training providers is local.' },

  // ══ BUSINESS & FINANCE ════════════════════════════════════════════════════════════════════════

  { id: 'intuit-academy', name: 'Intuit Academy (tax preparer / bookkeeper)', industry: 'business-finance', type: 'vendor-badge', cost: 'free',
    provider: 'Intuit',
    recognition: 'A vendor badge, not a licence — its real value is that it is Intuit\'s own hiring pipeline for remote tax-prep and bookkeeping roles',
    url: 'https://www.intuit.com/expert-careers/',
    what: 'Free self-paced online courses followed by an exam, after which "you will receive a badge that you can easily display." Intuit positions it as the way to "Start your career as a remote tax preparer or bookkeeper," seasonal or year-round. The common misunderstanding: the badge is not a CPA, an Enrolled Agent credential, or a state licence, and completing it does not guarantee Intuit hires you — its worth outside the Intuit ecosystem is modest.' },

  { id: 'irs-vita-link-learn', name: 'IRS VITA/TCE volunteer certification (Link & Learn Taxes)', industry: 'business-finance', type: 'government-certification', cost: 'free',
    provider: 'Internal Revenue Service',
    recognition: 'IRS-issued volunteer certification; the standard credible entry point for hands-on tax-return experience, and Circular 230 professionals can earn CE through the programme',
    url: 'https://www.irs.gov/individuals/link-learn-taxes',
    what: 'COST: Free to volunteers (no fee published; the cost is a volunteer service commitment). Self-paced IRS e-learning with certification tests at Basic, Advanced, Puerto Rico, Foreign Student and Scholar, Military and International levels (the last two require Advanced first); Circular 230 professionals may instead take the Federal Tax Law Update Test. You certify in order to prepare returns free of charge for low-to-moderate-income and elderly taxpayers at a community site. The common misunderstanding: this is a VOLUNTEER certification with a real service commitment attached — you cannot take it, skip the volunteering, and call yourself an IRS-certified preparer. What it genuinely buys you is documented, supervised return-preparation experience that paid roles ask for.' },

  { id: 'hubspot-academy', name: 'HubSpot Academy certifications', industry: 'business-finance', type: 'vendor-certification', cost: 'free',
    provider: 'HubSpot',
    recognition: 'Widely recognised inside marketing/sales/RevOps hiring as a signal of tool fluency; it is a vendor certification, not an accredited qualification',
    url: 'https://academy.hubspot.com/certification-overview',
    what: 'Genuinely free end to end — HubSpot states "Completely free & online," and the flow is complete all lessons, pass the assessment, earn your certificate. Tracks include Social Media Marketing, Digital Marketing, Content Marketing, Inbound Sales, Sales Hub Software, Digital Advertising and Revenue Operations. The common misunderstanding: treating it as equivalent to an accredited credential. It is not — it is proof you can operate the tooling and speak the vocabulary, which is exactly what entry-level ops and marketing roles screen for.' },

  { id: 'financial-services-apprenticeship', name: 'Financial Services Registered Apprenticeship', industry: 'business-finance', type: 'apprenticeship', cost: 'free',
    provider: 'U.S. Department of Labor Office of Apprenticeship (employer-sponsored)',
    recognition: 'DOL Certificate of Completion, nationally portable; sponsors are banks, insurers and financial firms',
    url: 'https://www.apprenticeship.gov/apprenticeship-industries/financial-services',
    what: 'Paid entry into finance without a degree: DOL lists General Insurance Associate, Bank Teller, Customer Service Representative, Operations Assistant and Risk Consultation as registered occupations, and reports over 6,248 apprentices served in financial services in 2024 — a 359% increase over five years. The common misunderstanding: that finance is closed to anyone without a four-year degree. It is the fastest-growing apprenticeship sector by percentage, and it is still small enough that few applicants know it exists.' },

  // ══ DATA & AI ═════════════════════════════════════════════════════════════════════════════════

  { id: 'ibm-skillsbuild', name: 'IBM SkillsBuild', industry: 'data-ai', type: 'course-provider-with-credentials', cost: 'free',
    provider: 'IBM',
    recognition: 'IBM-issued digital credentials; vendor-backed rather than accredited, but IBM badging is well understood by employers',
    url: 'https://skillsbuild.org/adult-learners',
    what: 'IBM states SkillsBuild is "100% free and online" and awards "industry-recognized credentials" across AI, technology and career skills. The common misunderstanding: people expect it to be a degree-equivalent. It is a badge library — useful as evidence of specific skills and as free structured study, not as a substitute for a qualification. (Specific badge names were not enumerated on the page checked; browse the catalog before citing any one badge.)' },

  { id: 'elements-of-ai', name: 'Elements of AI', industry: 'data-ai', type: 'university-course', cost: 'free',
    provider: 'University of Helsinki and MinnaLearn',
    recognition: 'A university-backed free AI literacy course used internationally, including by public-sector employers, as a baseline AI-literacy credential',
    url: 'https://www.elementsofai.com/',
    what: 'A free online introduction to artificial intelligence built for non-experts by the University of Helsinki — Finland\'s oldest and largest university — with MinnaLearn, issuing a certificate on completion. The common misunderstanding: it teaches you to BUILD AI systems. It does not; it makes you literate about what AI is and is not, which is the thing most job descriptions are actually asking for. (ECTS academic credit is widely reported for this course but was NOT stated on the page checked — treat credit claims as UNVERIFIED.)' },

  { id: 'ai-registered-apprenticeship', name: 'Artificial Intelligence Registered Apprenticeship', industry: 'data-ai', type: 'apprenticeship', cost: 'free',
    provider: 'U.S. Department of Labor Office of Apprenticeship (employer-sponsored)',
    recognition: 'DOL Certificate of Completion, nationally portable; AI is a named DOL apprenticeship industry',
    url: 'https://www.apprenticeship.gov/apprenticeship-industries',
    what: 'Artificial Intelligence is one of the twelve industries DOL lists for Registered Apprenticeship, alongside technology and advanced manufacturing — meaning there are employers being paid attention to by DOL who will hire and train you into AI work on a wage. The common misunderstanding: that AI roles require a graduate degree by definition. Some do; the registered apprenticeship occupations exist precisely because many do not.' },

  { id: 'aws-skill-builder-free', name: 'AWS Skill Builder — free tier', industry: 'data-ai', type: 'vendor-training', cost: 'free',
    provider: 'Amazon Web Services',
    recognition: 'AWS certifications are strongly recognised in cloud and data hiring; the free courses themselves are training, not a credential',
    url: 'https://aws.amazon.com/training/digital/',
    what: 'COST: Free TRAINING only — the AWS certification exam is separate and paid; full Skill Builder is $29/month or $449/year. AWS publishes "1,000+ free learning resources," including over 900 free self-paced digital courses across AWS services at all levels. This is the textbook case of the split the catalog should always name: the LEARNING is free, the CREDENTIAL is not. The common misunderstanding: people complete free AWS courses and believe they are AWS certified. They are not — certification requires a separately purchased proctored exam.' },

  { id: 'microsoft-applied-skills', name: 'Microsoft Applied Skills', industry: 'data-ai', type: 'vendor-credential', cost: 'paid',
    provider: 'Microsoft',
    recognition: 'Microsoft-verified credential, shareable to LinkedIn; narrower than a Microsoft Certification and newer, so employer recognition is still building',
    url: 'https://learn.microsoft.com/en-us/credentials/applied-skills/',
    what: 'COST: No fee is stated on Microsoft\'s Applied Skills pages or FAQ — cost UNVERIFIED; Microsoft role-based CERTIFICATION exams are definitely paid. Scenario-based credentials earned by completing tasks in an interactive, lab-based assessment rather than by sitting a multiple-choice exam, covering AI, cloud, data and now business scenarios; Microsoft says they validate one specific skill set where a Certification validates four to six. Microsoft also confirms certifications "renew...annually at no cost." The common misunderstanding: Applied Skills is not a Microsoft Certification and does not replace one — Microsoft says so explicitly. Listed here with the cost flagged rather than asserted, because Microsoft does not print a price on either the programme page or its FAQ.' },

  // ══ CONTINUING EDUCATION ══════════════════════════════════════════════════════════════════════

  { id: 'fema-independent-study', name: 'FEMA Emergency Management Institute — Independent Study Program', industry: 'continuing-education', type: 'ceu-provider', cost: 'free',
    provider: 'FEMA / National Disaster and Emergency Management University (formerly the Emergency Management Institute)',
    recognition: 'Courses "are evaluated and awarded Continuing Education Units (CEUs) in accordance with the standards established by the International Association of Continuing Education and Training (IACET)"; ICS/NIMS courses are effectively mandatory across U.S. emergency response',
    url: 'https://training.fema.gov/is/',
    what: 'COST: Free (federal programme; FEMA publishes no price on the IS pages — the $0 is unstated at source, VERIFY before printing it). A large self-paced online catalog — for example IS-100.c, Introduction to the Incident Command System, carries 0.2 CEUs — open to "the professional and volunteer emergency management community, and the general public," with downloadable completion certificates. A FEMA Student Identification Number (SID) has been required since 1 April 2015. The common misunderstanding, and FEMA states it outright: transcripts issued by the Independent Study Program "do NOT reflect college credits." These are IACET CEUs, which other bodies may accept toward licence renewal at their discretion — that is not the same thing as college credit.' },

  { id: 'fema-cdp-ce', name: 'FEMA Center for Domestic Preparedness — responder continuing education', industry: 'continuing-education', type: 'federal-training-program', cost: 'free',
    provider: 'FEMA, U.S. Department of Homeland Security',
    recognition: 'Federal responder training recognised across state, local, tribal and territorial emergency response agencies',
    url: 'https://www.fema.gov/emergency-managers/national-preparedness/training',
    what: 'FEMA states that CDP training "is federally funded at no cost to state, local, tribal and territorial emergency response professionals or their agencies." The common misunderstanding: "no cost" here is scoped to responders and their agencies — it is not a public continuing-education catalog you can self-enrol in from outside a response role.' },

  { id: 'nctsn-learning-center-ce', name: 'NCTSN Learning Center — free continuing education', industry: 'continuing-education', type: 'ceu-provider', cost: 'free',
    provider: 'National Child Traumatic Stress Network (SAMHSA-funded; UCLA and Duke University)',
    recognition: 'Continuing education for behavioural-health, child-welfare, education and first-responder professionals working with trauma',
    url: 'https://www.nctsn.org/resources/psychological-first-aid-pfa-online',
    what: 'The NCTSN Learning Center states it "Offers FREE continuing education (CE) credits and e-learning resources" in childhood trauma, of which Psychological First Aid Online is the best-known course. The common misunderstanding: free CE is assumed to be low-grade. This is federally funded, university-coordinated material — the reason it is free is SAMHSA, not quality.' },

  // ══ EDUCATION & TEACHING ══════════════════════════════════════════════════════════════════════

  { id: 'teacher-registered-apprenticeship', name: 'Teacher Registered Apprenticeship', industry: 'education-teaching', type: 'apprenticeship', cost: 'free',
    provider: 'U.S. Department of Labor Office of Apprenticeship, with school districts and educator-preparation partners',
    recognition: 'Education is a named DOL apprenticeship industry; the outcome is state teacher certification plus a DOL Certificate of Completion',
    url: 'https://www.apprenticeship.gov/apprenticeship-industries/education',
    what: 'COST: Free (apprenticeship.gov\'s education page does not itself state salary or tuition terms — confirm with the sponsoring district; cost terms UNVERIFIED at source). DOL describes it as "an industry-driven training model that can provide a critical talent pipeline for the education system by streamlining and combining on-the-job (or in classroom) learning with the related academic instruction," covering K-12 teachers, principals, teacher aides and early childhood educators. The common misunderstanding: people assume the only route into teaching is paying for a degree first and student-teaching unpaid. The apprenticeship route inverts that — you work in the classroom while completing the preparation. Confirm the funding terms with the district, because they vary and the national page does not state them.' },

  { id: 'youthbuild-education', name: 'YouthBuild — high school diploma or equivalency', industry: 'education-teaching', type: 'public-program', cost: 'free',
    provider: 'U.S. Department of Labor, Office of Workforce Investment, Division of Youth Services',
    recognition: 'Awards a high school diploma or equivalency alongside vocational certifications',
    url: 'https://www.dol.gov/agencies/eta/youth/youthbuild',
    what: 'COST: Free (DOL grant-funded under WIOA §171). For 16-to-24-year-olds who left school without a diploma, YouthBuild delivers the secondary credential itself while the participant works on affordable housing construction. The common misunderstanding: that it is a GED prep class with a job attached. The education is the point; the construction work is the delivery mechanism and the pre-apprenticeship on-ramp.' },

  // ══ HUMAN RESOURCES ═══════════════════════════════════════════════════════════════════════════

  { id: 'shrm-foundation-hr-apprenticeship', name: 'SHRM Foundation HR Registered Apprenticeship Program', industry: 'human-resources', type: 'apprenticeship', cost: 'paid',
    provider: 'SHRM Foundation',
    recognition: 'UNVERIFIED',
    url: 'https://www.shrm.org/foundation',
    what: 'UNVERIFIED — DO NOT PUBLISH AS-IS. The SHRM Foundation home page references an "HR Registered Apprenticeship Program" alongside scholarships and grants (the Foundation states it awards over $600,000 in scholarships and grants annually), but its dedicated programme page returned 404 this session and the Foundation home page does not state cost, structure, whether apprentices are paid, or whether a SHRM certification is included. Separately confirmed: human resources is NOT one of the twelve industries apprenticeship.gov lists. This is the only free-HR lead found in the sweep and it needs a human to verify before it goes in the catalog.' },

  // ══ LANGUAGES ═════════════════════════════════════════════════════════════════════════════════

  { id: 'seal-of-biliteracy', name: 'Seal of Biliteracy', industry: 'languages', type: 'state-award', cost: 'free',
    provider: 'State education agencies, districts and schools',
    recognition: 'Described by the programme as "evidence of skills that are attractive to future employers and college admissions offices"; adoption is state-by-state and a state map of approved, under-consideration and not-yet states is maintained',
    url: 'https://sealofbiliteracy.org/',
    what: 'COST: No fee published at source — awarded by schools/districts/states, but the qualifying proficiency test may carry a fee (cost UNVERIFIED). An award "given by a school, district, or state in recognition of students who have studied and attained proficiency in two or more languages by high school graduation." It is the closest thing to a free language credential in the U.S., and the only one in this sweep. Two common misunderstandings: it is available only to students still in high school — adults cannot earn it — and the seal itself is free but the proficiency assessment a district uses to qualify you may not be. For adults, the genuinely free-to-the-candidate language route is a CLEP foreign-language exam with a Modern States voucher, which yields college credit rather than a proficiency rating.' }
];

// ── accessors (pure) ──────────────────────────────────────────────────────────────────────────────
const norm = (s) => String(s || '').toLowerCase().trim();

export function industry(id) { return INDUSTRIES.find((i) => i.id === norm(id)) || null; }
export function getCredential(id) { return CREDENTIALS.find((x) => x.id === norm(id)) || null; }
export function byIndustry(id) {
  const key = norm(id);
  if (!INDUSTRY_IDS.has(key)) return [];
  // free first, then low-cost, then paid; stable within a bucket (catalog order = curation order)
  const rank = { free: 0, low: 1, paid: 2 };
  return CREDENTIALS.filter((x) => x.industry === key)
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (rank[a.x.cost] ?? 3) - (rank[b.x.cost] ?? 3) || a.i - b.i)
    .map(({ x }) => x);
}

/** Keyword search across name / provider / what / industry. Free-first within equal relevance. */
export function search(q, { limit = 12 } = {}) {
  const terms = (norm(q).match(/[a-z0-9][a-z0-9+.-]{1,}/g) || []);
  if (!terms.length) return [];
  const rank = { free: 0, low: 1, paid: 2 };
  return CREDENTIALS.map((x) => {
    const hay = `${x.name} ${x.provider} ${x.recognition} ${x.what} ${x.industry} ${x.type}`.toLowerCase();
    const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
    return { x, score };
  }).filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (rank[a.x.cost] ?? 3) - (rank[b.x.cost] ?? 3))
    .slice(0, limit)
    .map((r) => r.x);
}

/** Industries with their credential counts + how many are free — for the home grid + coverage. */
export function industriesWithCounts() {
  return INDUSTRIES.map((i) => {
    const items = CREDENTIALS.filter((x) => x.industry === i.id);
    return { ...i, total: items.length, free: items.filter((x) => x.cost === 'free').length };
  });
}

/** Self-check (catalog integrity) — used by the site /health route. Pure. */
export function validateCatalog() {
  const errors = [];
  const ids = new Set();
  for (const x of CREDENTIALS) {
    if (!x.id || ids.has(x.id)) errors.push(`bad/dup id: ${x.id}`); else ids.add(x.id);
    if (!INDUSTRY_IDS.has(x.industry)) errors.push(`${x.id}: unknown industry ${x.industry}`);
    if (!/^https:\/\//.test(x.url || '')) errors.push(`${x.id}: non-https url`);
    if (!['free', 'low', 'paid'].includes(x.cost)) errors.push(`${x.id}: bad cost ${x.cost}`);
  }
  return { ok: errors.length === 0, errors, industries: INDUSTRIES.length, credentials: CREDENTIALS.length };
}

// ── CLI (coverage report / one industry) ──────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('credentials-catalog.mjs')) {
  const arg = process.argv[2];
  if (arg && industry(arg)) {
    const i = industry(arg);
    console.log(`${i.name} — ${i.blurb}\n`);
    for (const x of byIndustry(arg)) console.log(`  [${x.cost.toUpperCase().padEnd(4)}] ${x.name}  <${x.url}>`);
  } else {
    const v = validateCatalog();
    console.log(`Credentialing catalog — ${v.credentials} credentials across ${v.industries} industries (valid: ${v.ok})`);
    if (!v.ok) v.errors.forEach((e) => console.log('  ! ' + e));
    console.log('');
    for (const i of industriesWithCounts()) console.log(`  ${i.id.padEnd(22)} ${String(i.total).padStart(2)} (${i.free} free) — ${i.name}`);
    console.log('\nUsage: node integrations/soapbox/credentials-catalog.mjs [<industry-id>]');
  }
}
