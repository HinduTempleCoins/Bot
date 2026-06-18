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
