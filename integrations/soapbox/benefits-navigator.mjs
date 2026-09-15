// benefits-navigator.mjs — the HONEST benefits navigator for SoapBox (task #214, v3 doc §3): "Lesko but
// better." It surfaces real official programs (grants, loans, cost-shares, tax credits, services) and
// TELLS THE TRUTH about what each one actually is.
//
// GUARDRAILS (load-bearing — this is the whole point of the module):
//   • REAL PROGRAMS ONLY. Every program is an official US government program with a working source URL.
//     No invented programs, no affiliate funnels, no "secret" lists.
//   • HONEST ELIGIBILITY. Eligibility is stated plainly, including the inconvenient parts (sign-first,
//     pay-first, organizations-not-individuals). We never imply "free money for anyone."
//   • NO PAYWALLED SECRET LISTS. Everything here is public and free to look up at the source; we never
//     gate a program behind a fee or claim to know hidden government money.
//   • NOT FINANCIAL OR LEGAL ADVICE. See NOT_ADVICE — present on every render by construction.
//
// THE CORE INSIGHT, encoded as code: "free money" claims are almost always wrong. Every program carries
// an honest `mechanism` classification — and the navigator NEVER calls a loan "free money":
//   • grant                    — money you do NOT repay (and even then: eligibility-gated, competitive)
//   • loan                     — you REPAY it, with interest (every SBA 7(a)/microloan is a LOAN)
//   • cost-share-reimbursement — you PAY FIRST and get reimbursed AFTER you build + pass inspection
//                                (e.g. USDA NRCS EQIP high tunnel)
//   • tax-credit               — reduces taxes owed; no cash up front
//   • insurance                — risk coverage you pay premiums for
//   • service                  — free expert help, not money (SCORE, SBDC)
//
// DESIGN (matches fed-opportunities.mjs / macro.mjs house style):
//   • ESM .mjs, injectable fetch via __setFetch, defensive dynamic import of the live readers (a break
//     in fed-opportunities.mjs cannot break this module — it soft-fails to the curated seed).
//   • Every list reader soft-fails to [] on any error.
//   • Secrets by env NAME only (delegated entirely to fed-opportunities.mjs — none read here).
//   • Every interpolated value is HTML-escaped before it reaches markup.
//   • Every render carries the not-advice line.
//
//   import { PROGRAMS, classifyMechanism, searchPrograms, truthCheck, renderPage } from './benefits-navigator.mjs'
//   node integrations/soapbox/benefits-navigator.mjs "high tunnel"

const str = (s) => String(s == null ? '' : s).trim();

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// HTML escape — every interpolated value passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// The standing disclaimer — present on every rendered page, by construction.
export const NOT_ADVICE =
  'Not financial or legal advice. Program terms change — verify eligibility, amounts, and deadlines ' +
  'with the administering agency before acting.';

// Human-readable badge for each mechanism. The badge is the truth-telling surface: it states, in plain
// English, what the money actually IS — so a "free money" headline cannot mislead a reader.
export const MECHANISM_BADGE = {
  grant: 'GRANT — money you do not repay (eligibility-gated)',
  loan: 'LOAN — you repay this, with interest',
  'cost-share-reimbursement': 'COST-SHARE — you pay first, reimbursed after inspection',
  'tax-credit': 'TAX CREDIT — reduces taxes owed, no cash up front',
  insurance: 'INSURANCE — risk coverage you pay premiums for',
  service: 'FREE SERVICE — expert help, not money',
  varies: 'VARIES — check the specific program; not necessarily a cash grant',
};
export const MECHANISMS = Object.keys(MECHANISM_BADGE);

// ── PROGRAMS — curated seed of REAL programs with honest classification ───────────────────────────────
// Each row tells the truth in plain English. honest_summary is what the program REALLY is, not how a
// "free government money" book would sell it.
export const PROGRAMS = [
  {
    name: 'Bank On Certified Accounts / FDIC #GetBanked',
    agency: 'Cities for Financial Empowerment Fund (Bank On) and the FDIC',
    mechanism: 'service',
    honest_summary:
      'If you have been shown savings and CD offers in answer to the question "need an account for direct ' +
      'deposit," check what those offers actually require. A certificate of deposit with a $1,000 minimum ' +
      'deposit, or a savings account with a $5,000 minimum balance, is not an answer to needing somewhere ' +
      'for a paycheck to land. BANK ON CERTIFIED accounts are checking accounts that meet a published ' +
      'national standard: no overdraft or non-sufficient-funds fees, a low minimum opening deposit, and ' +
      'free direct deposit, bill pay and debit card. Hundreds of banks and credit unions offer them, ' +
      'including large national ones. The FDIC #GetBanked page lists options and explains what identity ' +
      'documents a bank may and may not require.',
    eligibility_notes:
      'No credit check is required for a Bank On certified account and past overdrafts at another bank do ' +
      'not automatically disqualify you. Banks must accept a range of identity documents; ask specifically ' +
      'which ones, and ask whether the account is Bank On certified rather than merely "free checking."',
    source_url: 'https://joinbankon.org/accounts/',
  },
  // ── FOOD · HEALTH · PRESCRIPTIONS · HOUSING (verified 14 Sept 2026) ──────────────────────────────
// for benefits-navigator.mjs PROGRAMS. Every entry below was verified against its official government or
// nonprofit source on 2026-09-14. No program, number, or URL here is invented; where a figure could not be
// read off an official page this session, the entry says "check the source" instead of guessing.
// NOTE (verified 2026-09-14): USDA's Food and Nutrition Service now answers as the Food and Nutrition
// Administration at fna.usda.gov — the old fns.usda.gov links redirect there. Canonical URLs used below.

  // ── FOOD ──────────────────────────────────────────────────────────────────────────────────────────

  {
    name: 'SNAP (Supplemental Nutrition Assistance Program, formerly food stamps)',
    agency: 'U.S. Department of Agriculture, Food and Nutrition Administration — run by your state agency',
    mechanism: 'grant',
    honest_summary:
      'SNAP is money for groceries loaded onto an EBT card every month. You do not repay it and it is not a ' +
      'loan. It IS an entitlement: if you meet the rules, the state must give it to you — there is no lottery, ' +
      'no waiting list, and no cap on how many people can get it. The most common misunderstanding is that you ' +
      'have to be at zero income. You do not. For Oct 1 2025 through Sep 30 2026 in the 48 states and DC, the ' +
      'gross monthly income limit is 130% of poverty — $1,696 for one person, $2,292 for two, $2,888 for three, ' +
      '$3,483 for four, plus $596 for each extra person — and the net limit (after deductions) is 100% of ' +
      'poverty: $1,305 / $1,763 / $2,221 / $2,680. Most states have adopted broad-based categorical eligibility, ' +
      'which raises those limits further. Second misunderstanding: people wait because they think it takes ' +
      'weeks. If your household has under $100 in cash and under $150 in monthly gross income, or your gross ' +
      'income plus cash is less than your rent and utilities, you can be issued benefits within 7 DAYS. Ask for ' +
      'expedited service by name when you apply. Nobody may charge you to apply for SNAP — you apply free ' +
      'through your own state agency, and any site charging an application fee is not the state.',
    eligibility_notes:
      'Apply in the state where you live. Countable resources: $3,000, or $4,500 if someone in the household is ' +
      '60+ or disabled; resources of SSI and TANF recipients do not count, and most retirement and pension ' +
      'accounts do not count. A licensed vehicle counts only for fair market value above $4,650, and states ' +
      'vary. Deductions that lower your net income and raise your benefit: 20% of earned income, a standard ' +
      'deduction ($209 for households of 1-3), dependent care, child support in some states, a $198.99 homeless ' +
      'shelter deduction, excess shelter costs (capped at $744 unless a member is elderly or disabled — for ' +
      'those households the cap is removed, and medical expenses over $35/month also deduct). What trips people ' +
      'up: able-bodied adults without dependents must work or be in a work program 20 hours a week to get more ' +
      'than 3 months of benefits in 36 months — but children, seniors, veterans, people experiencing ' +
      'homelessness, people who were in foster care at 18 and are now 24 or younger, pregnant women, and people ' +
      'exempt for physical or mental health reasons are not subject to it. Students 18-49 enrolled at least ' +
      'half time are generally ineligible unless they meet a specific exemption. Undocumented immigrants have ' +
      'never been eligible. If you are denied, you have 90 days to request a fair hearing. The One Big Beautiful ' +
      'Bill Act of 2025 changed work requirements and non-citizen eligibility and USDA says it is still ' +
      'updating this page — verify the current rule with your state before assuming you are disqualified.',
    source_url: 'https://www.fna.usda.gov/snap/recipient/eligibility',
  },

  {
    name: 'WIC (Special Supplemental Nutrition Program for Women, Infants, and Children)',
    agency: 'U.S. Department of Agriculture, Food and Nutrition Administration — run by state and Tribal agencies',
    mechanism: 'grant',
    honest_summary:
      'WIC gives you specific healthy foods (or a card to buy them), breastfeeding support, nutrition help, and ' +
      'referrals. It is not repaid and it is not a loan. It is also not the same as SNAP — you can have both. ' +
      'The most common misunderstanding is that WIC is only for unmarried mothers, or only for the very poorest. ' +
      'Neither is true: fathers, foster parents, grandparents and anyone else raising a child under 5 can apply ' +
      'for the children in their care, and the income limit is well above the SNAP line. The second-most common ' +
      'error is people doing the income math when they did not have to: if you or the child already get ' +
      'Medicaid, SNAP, or TANF, you are automatically income-eligible for WIC and can skip the income test ' +
      'entirely. That is called adjunctive eligibility and it is the single most under-used shortcut in the ' +
      'program.',
    eligibility_notes:
      'Categories: women who are pregnant, postpartum (up to 6 months after the end of a pregnancy), or ' +
      'breastfeeding (up to the infant\'s first birthday); infants; and children up to their fifth birthday. ' +
      'Income is counted BEFORE deductions or taxes, across everyone you live with and share income and ' +
      'expenses with — which includes people you are not related to and students away at college. If someone in ' +
      'the household is pregnant, add one to household size for each expected birth. Income from loans and ' +
      'AmeriCorps does not count, and certain military income is excluded. You also have to be found at ' +
      'nutritional risk, which a WIC clinic assesses for free at your appointment — being underweight, anemic, ' +
      'or having a poor diet all count, so do not screen yourself out. Life changes re-open eligibility: if you ' +
      'were turned down before and your income dropped or your household grew, apply again. Apply through your ' +
      'state or Tribal WIC agency at fna.usda.gov/wic/apply.',
    source_url: 'https://www.fna.usda.gov/wic/eligibility',
  },

  {
    name: 'Free and Reduced-Price School Meals (National School Lunch Program and School Breakfast Program)',
    agency: 'U.S. Department of Agriculture, Food and Nutrition Administration — run by your school district',
    mechanism: 'grant',
    honest_summary:
      'Free or low-cost breakfast and lunch at school every school day. Nothing is repaid and the child is not ' +
      'marked out in any way — federal rules require that a child getting a free meal not be identifiable to ' +
      'other students. The two things parents get wrong: first, they do not fill out the household application ' +
      'because they assume they earn too much — the eligibility cut-offs are set every year in USDA\'s Child ' +
      'Nutrition Income Eligibility Guidelines, which run July 1 through June 30 and are higher than most people ' +
      'guess, so fill the form out and let the district do the math. Second, they do not realize they may ' +
      'already be approved: if your household gets SNAP, TANF or FDPIR, children are directly certified for free ' +
      'meals without any application at all. The same income guidelines also govern the School Breakfast ' +
      'Program, the Special Milk Program, CACFP and the summer meals programs, so one determination usually ' +
      'carries across all of them.',
    eligibility_notes:
      'Apply through your child\'s school or district office, free, at any point in the school year — not just ' +
      'in September. Household size and income are what matter. Directly certified children (SNAP/TANF/FDPIR ' +
      'households, and often foster, homeless, migrant and Head Start children) need no application. Some ' +
      'schools and districts operate under the Community Eligibility Provision, which lets a school with a high ' +
      'enough "identified student percentage" serve meals at no charge to EVERY enrolled student with no ' +
      'household application at all — ask the office whether your school is a CEP school before filling out ' +
      'anything. Unpaid meal debt from a prior year does not make a child ineligible now. Look up the current ' +
      'year\'s income figures at the source link rather than trusting a number you read somewhere else.',
    source_url: 'https://www.fna.usda.gov/schoolmeals/income-eligibility-guidelines',
  },

  {
    name: 'SUN Bucks / Summer EBT',
    agency: 'U.S. Department of Agriculture, Food and Nutrition Administration — run by states, Tribes and territories',
    mechanism: 'grant',
    honest_summary:
      'A summer grocery benefit of $120 per eligible school-age child, loaded onto a card to spend at ' +
      'authorized food retailers when school is out. It is not a loan and it does not reduce SNAP, school ' +
      'meals, or anything else. Two traps. First, it is NOT nationwide: states, Tribes and territories choose ' +
      'whether to run it, so you have to check whether yours does. Second, it goes by different names in ' +
      'different places — SUN Bucks in some states, something else in others — so parents search for the wrong ' +
      'words and conclude it does not exist where they live. Many eligible children are enrolled ' +
      'automatically through school meal records and the family simply gets a card in the mail; others have to ' +
      'apply. Check the participating-areas map for your state before assuming either way.',
    eligibility_notes:
      'School-age children in participating states, Tribes and territories. Children already certified for free ' +
      'or reduced-price school meals are generally picked up automatically, which is why getting the school ' +
      'meal application in during the school year matters for summer money too. Where an application is ' +
      'required, it runs through the state agency, not the school. This is a benefit for the child, so it is ' +
      'unaffected by whether the adults in the household qualify for anything. Use the participating-areas map ' +
      'on the source page to find your state\'s name for the program and its application route.',
    source_url: 'https://www.fna.usda.gov/sebt',
  },

  {
    name: 'Summer Food Service Program (SUN Meals — free summer meals for kids)',
    agency: 'U.S. Department of Agriculture, Food and Nutrition Administration — run by state agencies and local sponsors',
    mechanism: 'grant',
    honest_summary:
      'Free meals and snacks over the summer for any kid aged 18 and under, served at schools, parks, ' +
      'libraries, churches and other neighborhood sites in eligible areas. There is no application, no income ' +
      'form, no sign-up and no proof of anything — a child walks up during serving hours and eats. That is the ' +
      'part almost nobody believes: parents skip it because they assume there must be paperwork or a means ' +
      'test at the door. There is not, at an open site. Like Summer EBT it goes by different names locally, so ' +
      'search the official site finder rather than the name you half-remember.',
    eligibility_notes:
      'Kids 18 and under. Sites operate in "eligible areas" — the area qualifies, not the individual child — so ' +
      'whether there is a site near you depends on your neighborhood, not your income. Use the Summer Meals ' +
      'for Kids Site Finder on the source page for locations, hours and contact details; hours are short and ' +
      'often only cover one or two meals a day, so check before walking over. Rural non-congregate options let ' +
      'some rural sites hand out meals to take home instead of requiring the child to eat on site. This is ' +
      'separate from, and stackable with, SUN Bucks / Summer EBT.',
    source_url: 'https://www.fna.usda.gov/sfsp',
  },

  {
    name: 'TEFAP (The Emergency Food Assistance Program) — the food behind your local pantry',
    agency: 'U.S. Department of Agriculture, Food and Nutrition Administration — distributed through state agencies and local food banks',
    mechanism: 'grant',
    honest_summary:
      'TEFAP is the federal program that supplies USDA foods, at no cost, to the food banks and pantries that ' +
      'hand them to you. You will almost never hear the word "TEFAP" at the pantry door — you just receive ' +
      'food. It is not a loan, it costs nothing, and in most places you self-declare that you meet the income ' +
      'guideline rather than proving it with documents. The misunderstanding worth correcting: people think a ' +
      'food pantry is charity that will judge them or that they must be destitute. TEFAP food is a federal ' +
      'entitlement of the state\'s allocation, income guidelines are set by the state and are typically well ' +
      'above the SNAP line, and using a pantry does not affect any other benefit you receive.',
    eligibility_notes:
      'States set the income eligibility standard and the certification process for household distribution, so ' +
      'the exact limit varies by state — many allow simple self-certification at the site. Prepared-meal sites ' +
      '(soup kitchens, shelters) generally have no income test at all. USDA distributes a fixed quantity of ' +
      'food and administrative funds to each state, so this is a funded allocation, not an unlimited ' +
      'entitlement to an individual: supply at a given pantry runs out and distribution days are limited. To ' +
      'find your site, use the Feeding America food bank locator or call the USDA National Hunger Hotline.',
    source_url: 'https://www.fna.usda.gov/tefap',
  },

  {
    name: 'Feeding America food bank locator',
    agency: 'Feeding America (nonprofit network of food banks)',
    mechanism: 'service',
    honest_summary:
      'A free lookup that tells you which food bank serves your ZIP code, and through it which pantries, ' +
      'mobile pantries and drive-thru distributions are near you. It is not money and it is not an ' +
      'application for anything — it is a directory. Use it because searching "food pantry near me" on a ' +
      'general search engine surfaces closed sites and lead-generation pages; the network locator points at ' +
      'the actual member food bank, which knows its own current schedule.',
    eligibility_notes:
      'No eligibility, no income test, no cost to look. Requirements to receive food are set by the individual ' +
      'pantry and are usually minimal — often ZIP code and a self-declaration. Mobile and drive-thru ' +
      'distributions frequently have no paperwork at all. Call the food bank before driving to a pantry: hours ' +
      'and rules change, and the food bank can also tell you about the ones it does not list publicly.',
    source_url: 'https://www.feedingamerica.org/find-your-local-foodbank',
  },

  {
    name: 'CSFP (Commodity Supplemental Food Program) — monthly food box for seniors',
    agency: 'U.S. Department of Agriculture, Food and Nutrition Administration — run by state agencies and Indian Tribal Organizations',
    mechanism: 'grant',
    honest_summary:
      'A monthly box of USDA foods for low-income people aged 60 and over. Free, not repaid, and it does not ' +
      'count against SNAP — you can and should have both. The misunderstanding: seniors assume this is the ' +
      'same thing as a food pantry visit, and skip it because they went to a pantry once. It is a separate, ' +
      'reliable, scheduled monthly package. The real limit is supply, not your worthiness: USDA hands each ' +
      'participating state and Tribal organization a set amount of food and administrative money, so this is ' +
      'NOT an open-ended entitlement and local slots can be full with a waiting list. Get on the list anyway ' +
      '— lists move.',
    eligibility_notes:
      'At least 60 years old, with household income under the CSFP income guideline (published annually by ' +
      'USDA — check the current year\'s figure at the source page, it is higher than the SNAP gross limit). ' +
      'Not every state or Tribal area operates CSFP, and within a participating state not every county has a ' +
      'distribution site. Apply through the local agency that distributes in your area — often the same food ' +
      'bank that runs TEFAP — not through USDA. Because caseload slots are capped, ask to be placed on the ' +
      'waiting list on the day you first call rather than waiting until a slot is free.',
    source_url: 'https://www.fna.usda.gov/csfp',
  },

  {
    name: 'Senior Farmers Market Nutrition Program (SFMNP)',
    agency: 'U.S. Department of Agriculture, Food and Nutrition Administration — run by state Departments of Agriculture or Aging',
    mechanism: 'grant',
    honest_summary:
      'Benefits for low-income seniors to spend on locally grown fruit, vegetables, honey and herbs at farmers ' +
      'markets, roadside stands and CSAs. Free, not repaid, small but real, and it stacks with SNAP and CSFP. ' +
      'The misunderstanding: seniors think the income limit will be the SNAP limit. It is not — SFMNP reaches ' +
      'up to 185% of the federal poverty guidelines, well above the SNAP cut-off, so a lot of people who were ' +
      'denied SNAP still qualify for this. The catch is timing and supply: benefits are issued seasonally in ' +
      'limited quantities and typically run out, so ask your Area Agency on Aging in early spring, not in ' +
      'August.',
    eligibility_notes:
      'Generally 60 or older with household income not more than 185% of the federal poverty income ' +
      'guidelines. The program operates through 57 state, territorial and Tribal agencies — check whether your ' +
      'state runs one at the source page, because not every area does, and the administering agency differs ' +
      '(sometimes Agriculture, sometimes Aging). Federal funding is a Farm Bill grant split 90% food / 10% ' +
      'administration, meaning the number of seniors served is capped by the grant, not by how many qualify. ' +
      'Benefits are usable only at authorized farmers, markets and stands — the list of who accepts them ' +
      'comes with the benefit.',
    source_url: 'https://www.fna.usda.gov/sfmnp',
  },

  {
    name: 'USDA National Hunger Hotline',
    agency: 'U.S. Department of Agriculture (operated by Hunger Free America)',
    mechanism: 'service',
    honest_summary:
      'A free phone line that will find you food today. Call 1-866-3-HUNGRY (1-866-348-6479), Monday through ' +
      'Friday, 8:00 a.m. to 8:00 p.m. Eastern, and a person will look up emergency food providers, meal sites, ' +
      'food banks and benefit programs near where you actually are. You can also text 914-342-7744 with a word ' +
      'like "food" or "SNAP" plus an address or ZIP and get an automated answer back. It is not money, it is ' +
      'not an application, and it costs nothing. Use it when you do not know where to start or when the ' +
      'websites are giving you stale listings — the operator has current local information a search engine ' +
      'does not.',
    eligibility_notes:
      'Nobody is screened. No income question, no documents, no citizenship question to get a referral. The ' +
      'line also routes to social services beyond food. It is staffed weekdays only, so for nights and ' +
      'weekends call 211 instead.',
    source_url: 'https://www.fna.usda.gov/national-hunger-hotline',
  },

  // ── HEALTH COVERAGE ───────────────────────────────────────────────────────────────────────────────

  {
    name: 'Medicaid',
    agency: 'Centers for Medicare & Medicaid Services — run by your state Medicaid agency',
    mechanism: 'insurance',
    honest_summary:
      'Comprehensive health coverage, free or nearly free, for people with low income. It is insurance rather ' +
      'than cash, and it is an entitlement — if you meet your state\'s rules the state must enroll you. Three ' +
      'things people get wrong and it costs them real money. First: there is NO open enrollment period. You ' +
      'can apply for Medicaid any day of the year, and if you qualify, coverage can start immediately. ' +
      'Second: Medicaid can pay medical bills from the LAST THREE MONTHS even though you were not enrolled ' +
      'when you got the care — if you are sitting on a recent hospital or ER bill, say so on the application ' +
      'and ask for retroactive coverage. Third: whether your state expanded Medicaid changes the income ' +
      'threshold a lot, but even in a non-expansion state you should still apply, because pregnancy, ' +
      'children, disability, age and caretaker status each open separate doors. Nobody may charge you to ' +
      'apply. Any site asking for a fee to "get you Medicaid" is not the state agency.',
    eligibility_notes:
      'Eligible income levels, covered services and costs differ from state to state within federal guidelines. ' +
      'Coverage groups include low-income families and children, pregnant women, seniors, and people with ' +
      'disabilities in every state; some states additionally cover all adults below an income level ' +
      '(expansion). Apply through your state Medicaid agency or by filing a Marketplace application at ' +
      'HealthCare.gov, which forwards your information to the state automatically. What trips people up: ' +
      'assuming a past denial still holds (rules and your income change — reapply), missing a renewal notice ' +
      'and losing coverage for paperwork reasons rather than income, and not reporting a pregnancy or a new ' +
      'disability that would qualify them under a different group. If you lose or are denied Medicaid, that ' +
      'triggers a Special Enrollment Period for Marketplace coverage — you are not locked out for the year.',
    source_url: 'https://www.healthcare.gov/medicaid-chip/getting-medicaid-chip/',
  },

  {
    name: "CHIP (Children's Health Insurance Program)",
    agency: 'Centers for Medicare & Medicaid Services — run by your state, alongside Medicaid',
    mechanism: 'insurance',
    honest_summary:
      'Low-cost comprehensive health coverage for children in families that earn too much for Medicaid — and ' +
      'in some states for pregnant women too. Routine well-child doctor and dental visits are free; other ' +
      'services may carry a small copayment. The misunderstanding that costs families the most: they buy a ' +
      'Marketplace plan for the kids. Do not. If your children qualify for CHIP they are NOT eligible for ' +
      'Marketplace savings anyway, and CHIP is almost always cheaper and covers more — including dental and ' +
      'vision, which children\'s Marketplace coverage often does not. Second misunderstanding: families ' +
      'assume a parent has to qualify too. The child can be covered by CHIP while the parents are uninsured ' +
      'or on a Marketplace plan; they are separate determinations.',
    eligibility_notes:
      'Each state sets its own CHIP income rules, and they are meaningfully higher than that state\'s Medicaid ' +
      'limit. You can apply and enroll any time of year — there is no open enrollment window. One application ' +
      'covers both: apply to your state agency for Medicaid and you are automatically screened for CHIP, or ' +
      'file at HealthCare.gov and your information is sent securely to the state. Benefits differ by state but ' +
      'all states provide comprehensive coverage including routine check-ups and dental and vision care; some ' +
      'states add more. Common trip-up: a family whose income rose out of Medicaid assumes the children lost ' +
      'coverage entirely, when the children should have rolled into CHIP — call the state and ask.',
    source_url: 'https://www.healthcare.gov/medicaid-chip/childrens-health-insurance-program/',
  },

  {
    name: 'Medicare Savings Programs (QMB, SLMB, QI, QDWI)',
    agency: 'Centers for Medicare & Medicaid Services — applications run through your state Medicaid agency',
    mechanism: 'grant',
    honest_summary:
      'Your state pays your Medicare premiums, and in the top tier your deductibles, coinsurance and copays ' +
      'too. That is roughly two thousand dollars a year back in your Social Security check, and it is not a ' +
      'loan, not a tax credit, and not repaid. It is the single most under-claimed benefit in Medicare. The ' +
      'big misunderstanding: people see the income limits and disqualify themselves. Do not. Many states do ' +
      'not count certain income or resources at all, and several have dropped the resource test entirely — ' +
      'Medicare\'s own guidance says apply even if you think your income or resources are too high, because ' +
      'your STATE decides, not the federal table. The second thing nobody tells you: if you are approved for ' +
      'QMB, providers are legally forbidden to bill you for Medicare-covered deductibles, coinsurance and ' +
      'copays. If you get such a bill anyway, that is an improper charge, not a debt. And qualifying for any ' +
      'of these automatically gets you Extra Help on drugs as well.',
    eligibility_notes:
      '2026 federal figures, as a floor rather than a ceiling. QMB (pays Part A and B premiums plus ' +
      'deductibles, coinsurance and copays): monthly income up to $1,350 individual / $1,824 married, ' +
      'resources $9,950 / $14,910. SLMB (pays the Part B premium): $1,616 / $2,184, same resource limits. QI ' +
      '(pays the Part B premium): $1,816 / $2,455, same resource limits. QDWI (pays the Part A premium, for ' +
      'people who lost premium-free Part A by returning to work after disability): income $5,405 / $7,299, ' +
      'resources $4,000 / $6,000. Limits are slightly higher in Alaska and Hawaii and rise each year. QI has ' +
      'two catches: you must reapply every year, and states approve first-come first-served with priority to ' +
      'last year\'s recipients — so apply in January, not December. QI is also only for people who do not ' +
      'qualify for other Medicaid. Apply through your state; free one-on-one help is available from your ' +
      'State Health Insurance Assistance Program (SHIP), and you should not pay an insurance agent to do this.',
    source_url: 'https://www.medicare.gov/basics/costs/help/medicare-savings-programs',
  },

  {
    name: 'Medicare Part D Extra Help (Low-Income Subsidy)',
    agency: 'Social Security Administration and Centers for Medicare & Medicaid Services',
    mechanism: 'grant',
    honest_summary:
      'Extra Help wipes out your Part D premium and deductible and caps what you pay at the pharmacy counter. ' +
      'In 2026 that means $0 premium, $0 deductible, no more than $5.10 for a covered generic and $12.65 for a ' +
      'covered brand-name drug — and once your total drug costs reach $2,100 you pay $0 for covered drugs for ' +
      'the rest of the year. If you also have full Medicaid and QMB you pay no more than $4.90 per drug. This ' +
      'is a subsidy, not a loan, and there is nothing to pay back. The misunderstanding that keeps people out: ' +
      'the resource limits sound disqualifying but they are far higher than the Medicare Savings Program ' +
      'limits — $18,090 for an individual, $36,100 for a couple — and the income limits ($23,940 individual, ' +
      '$32,460 married) are annual, not monthly. Second thing worth knowing: applying for Extra Help also ' +
      'starts a Medicare Savings Program application with your state unless you tell Social Security not to, ' +
      'so one form can win you both. And if you have Extra Help or Medicaid you may change drug plans once a ' +
      'month instead of once a year.',
    eligibility_notes:
      'You must have Medicare. Many people get Extra Help automatically — full Medicaid, an MSP, or SSI ' +
      'usually triggers it without an application. Everyone else applies to Social Security; your local SHIP ' +
      'will help you fill it out for free, and no one should charge you. Once approved you keep it through ' +
      'December 31 even if your income rises mid-year, and it renews silently — no notice means you keep it. ' +
      'If you were denied before and your income or resources changed, you can reapply at any time. If you ' +
      'qualify but the pharmacy is charging you full price, call 1-800-MEDICARE (1-800-633-4227) — and if you ' +
      'qualify for Extra Help or Medicaid but are not yet in a drug plan, the LI NET program at ' +
      '1-800-783-1307 gives temporary Part D coverage and can reimburse drugs you already paid for, so keep ' +
      'your receipts.',
    source_url: 'https://www.medicare.gov/basics/costs/help/drug-costs',
  },

  {
    name: 'ACA Marketplace premium tax credit',
    agency: 'Centers for Medicare & Medicaid Services — HealthCare.gov or your state Marketplace',
    mechanism: 'tax-credit',
    honest_summary:
      'A tax credit that lowers what you pay each month for a Marketplace health plan. It is a tax credit, not ' +
      'a grant — which matters, because it is calculated on the income you ESTIMATE for the coverage year and ' +
      'then reconciled against your actual income when you file. If you earn more than you estimated, you pay ' +
      'some of it back at tax time. That is the single most common and most painful surprise in this program, ' +
      'and the fix is free: update your income in your Marketplace account the moment it changes, rather than ' +
      'waiting for the tax return. Note the base it uses — your estimate for the year you want coverage, not ' +
      'last year\'s income — so a recent job loss counts in your favour immediately. Also: the credit can be ' +
      'taken in advance each month against the premium, or all at once on your return; taking it monthly is ' +
      'what makes coverage affordable now.',
    eligibility_notes:
      'Start from your household\'s adjusted gross income (Form 1040, line 11) and adjust it for expected ' +
      'changes; count yourself, your spouse if married, and everyone you will claim as a tax dependent, ' +
      'including those who do not need coverage. Catastrophic plans get no credit at any income. If you ' +
      'qualify for Medicaid or CHIP, you take that instead. If you are offered affordable employer coverage, ' +
      'that generally disqualifies you. Open Enrollment for 2027 coverage begins November 1 — but losing other ' +
      'coverage, moving, marrying, or having a baby opens a Special Enrollment Period outside that window, so ' +
      'do not wait until November if something changed. If you think the eligibility result is wrong, you ' +
      'have the right to appeal the Marketplace decision. Free help: 1-800-318-2596, or an in-person assister ' +
      'via HealthCare.gov Find Local Help — never pay a fee to apply.',
    source_url: 'https://www.healthcare.gov/lower-costs/save-on-monthly-premiums/',
  },

  {
    name: 'ACA cost-sharing reductions (the "extra savings" most people throw away)',
    agency: 'Centers for Medicare & Medicaid Services — HealthCare.gov or your state Marketplace',
    mechanism: 'insurance',
    honest_summary:
      'A second, separate discount on top of the premium tax credit that cuts your deductible, your copays and ' +
      'coinsurance, and your annual out-of-pocket maximum. A plan with a $750 deductible might have a $300 one ' +
      'for you; a $5,000 out-of-pocket maximum might be $3,000. Here is the thing almost nobody is told, and ' +
      'it is the whole reason this entry exists: cost-sharing reductions apply ONLY if you buy a SILVER plan. ' +
      'Every year people who qualify buy the cheaper Bronze plan to save $40 a month, and silently forfeit ' +
      'thousands of dollars of deductible help — a subsidised Silver plan is frequently cheaper in total than ' +
      'the Bronze plan next to it. Check your Eligibility Determination Notice: if it says you can choose a ' +
      'plan with lower copayments, coinsurance and deductibles, followed by (04), (05) or (06), you qualify, ' +
      'and you must pick Silver to get it. The lower your income within the range, the larger the discount.',
    eligibility_notes:
      'You must qualify based on income and enrol in a Silver-category Marketplace plan. Bronze, Gold and ' +
      'Platinum plans get the premium tax credit but not these savings. Catastrophic plans get neither. ' +
      'American Indians and Alaska Natives have special, more generous cost-sharing rules — ask specifically. ' +
      'If you have a Silver plan and your income changes so you lose cost-sharing reductions, that opens a ' +
      'Special Enrollment Period to switch plans. You only learn the exact savings after you apply and shop ' +
      'Silver plans, so apply first and compare second. Free, unbiased help choosing is available from a ' +
      'Marketplace Navigator; a commissioned broker is paid by insurers and is not the same thing.',
    source_url: 'https://www.healthcare.gov/lower-costs/save-on-out-of-pocket-costs/',
  },

  {
    name: 'Marketplace Navigators and assisters (free enrollment help)',
    agency: 'Centers for Medicare & Medicaid Services — HealthCare.gov Find Local Help',
    mechanism: 'service',
    honest_summary:
      'Federally funded people, in your town, who will sit with you and complete your Marketplace, Medicaid or ' +
      'CHIP application for free. Not money — expert help, which for this program is worth more, because the ' +
      'Silver-plan and income-estimate traps above are exactly what they catch. This entry exists because of ' +
      'the middleman problem: search "ACA enrollment help" and you will find lead-generation sites and ' +
      'commissioned agents, and some outfits charge a "processing fee" to file a free federal application. ' +
      'Navigators are legally required to be unbiased and free. Brokers and agents are legitimate but are ' +
      'paid commission by insurers and may not show you every plan. Nobody may charge you to apply for ' +
      'Marketplace coverage, Medicaid, or CHIP.',
    eligibility_notes:
      'Open to anyone, no income test, no cost. Use the Find Local Help tool on HealthCare.gov to get ' +
      'in-person and phone assisters near you, or call the Marketplace directly at 1-800-318-2596, 24 hours a ' +
      'day. The tool distinguishes Navigators/assisters from agents and brokers — read the label. Help is ' +
      'available in many languages. Bring your best estimate of next year\'s household income, your household ' +
      'list, and any offer of employer coverage.',
    source_url: 'https://www.healthcare.gov/find-local-help/',
  },

  {
    name: 'Federally Qualified Health Centers and the sliding fee scale',
    agency: 'Health Resources and Services Administration (HRSA) — community health centers nationwide',
    mechanism: 'service',
    honest_summary:
      'A health center is a real clinic — primary care, often dental, behavioral health and a pharmacy — and ' +
      'federal regulation requires it to see you whether or not you can pay. The rule is not a slogan: 42 CFR ' +
      '51c.303 requires every federally funded health center to have a schedule of discounts based on your ' +
      'ability to pay, giving a FULL discount to individuals and families at or below the federal poverty ' +
      'guidelines (a nominal fee may still be collected), tapering upward, and no discount above TWICE the ' +
      'poverty guidelines — and it requires that no person be denied service because they cannot pay. If ' +
      'someone at the front desk tells you otherwise, that is a front-desk problem, not the law. Two ' +
      'practical points: the sliding scale is not automatic, you must ask for it and complete the income form, ' +
      'and it applies to the uninsured AND to insured patients who cannot cover their share. If you are ' +
      'putting off care because you have no insurance, this is the door.',
    eligibility_notes:
      'No insurance required, no citizenship requirement to be seen, and no residency test beyond the ' +
      'center\'s service area. Bring proof of household income (pay stubs, a benefits letter, or a written ' +
      'statement if you have neither) to be placed on the sliding scale; ask for the "sliding fee discount ' +
      'program" or "SFDS" by name. Above 200% of the poverty guidelines you pay full fee, but that fee is ' +
      'generally far below commercial rates. Health centers are also 340B covered entities, which is why ' +
      'their in-house pharmacies are often the cheapest place to fill a prescription — ask whether they ' +
      'dispense on site or have a contract pharmacy. Find a center at findahealthcenter.hrsa.gov.',
    source_url: 'https://www.ecfr.gov/current/title-42/chapter-I/subchapter-D/part-51c/subpart-C/section-51c.303',
  },

  {
    name: 'Vaccines for Children (VFC)',
    agency: 'Centers for Disease Control and Prevention — through enrolled providers in every state and territory',
    mechanism: 'grant',
    honest_summary:
      'Free vaccines for eligible children aged 18 or younger. CDC describes it as a mandatory entitlement ' +
      'program — a right granted by law — not a charity and not a grant someone can run out of. It covers the ' +
      'vaccines recommended by the Advisory Committee on Immunization Practices, protecting against 18 ' +
      'diseases, and the vaccine itself is supplied to the provider at no charge. The misunderstanding: ' +
      'parents assume "free vaccine" means the whole visit is free. The vaccine is free; a provider may still ' +
      'charge an office visit or a vaccine administration fee. Ask about those fees up front, and ask ' +
      'specifically whether the fee can be waived — and if it cannot, take the child to a health center or ' +
      'public health clinic instead, where the sliding fee scale covers it.',
    eligibility_notes:
      'Children 18 and under who meet VFC eligibility criteria; the categories are published on CDC\'s VFC ' +
      'eligibility pages and generally turn on being Medicaid-eligible, uninsured, American Indian or Alaska ' +
      'Native, or underinsured and seen at a qualifying health center — confirm your child\'s category with ' +
      'the provider or your state immunization program rather than assuming. Vaccines are distributed through ' +
      'providers enrolled in VFC, so the practical step is finding an enrolled provider: your state or local ' +
      'health department maintains that list, or call CDC at 800-232-4636. A child already on Medicaid is ' +
      'covered without a separate application.',
    source_url: 'https://www.cdc.gov/vaccines-for-children/about/index.html',
  },

  {
    name: 'SHIP (State Health Insurance Assistance Program) — free one-on-one Medicare counseling',
    agency: 'Administration for Community Living — state and local SHIP offices',
    mechanism: 'service',
    honest_summary:
      'Free, unbiased, in-depth one-on-one help with anything Medicare: choosing a plan, appealing a denial, ' +
      'and — the part that actually moves money — applying for Extra Help and Medicare Savings Programs. ' +
      'Medicare\'s own guidance points people here for free application help. It is not money and it sells you ' +
      'nothing. This entry is a middleman flag: the Medicare space is saturated with commissioned agents and ' +
      'call centres that look like government services, buy names like "Medicare Benefits Center", and are ' +
      'paid by insurers to move you into a particular plan. SHIP counselors are prohibited from selling ' +
      'insurance. If someone helping you with Medicare stands to be paid by a carrier, they are not a SHIP ' +
      'counselor.',
    eligibility_notes:
      'Anyone with Medicare or approaching Medicare eligibility, plus family members and caregivers acting on ' +
      'their behalf. No income test, no fee, in every state, DC, Guam, Puerto Rico and the Virgin Islands. ' +
      'Find your state\'s SHIP at shiphelp.org, or through 1-800-MEDICARE. Many SHIPs are staffed partly by ' +
      'trained volunteers and appointment waits get long in the autumn Open Enrollment crush — call in ' +
      'summer if your issue can wait, and call immediately if it is an appeal with a deadline.',
    source_url: 'https://www.shiphelp.org/',
  },

  {
    name: 'Hospital financial assistance (charity care) under IRS Section 501(r)',
    agency: 'Internal Revenue Service requirement on every nonprofit 501(c)(3) hospital',
    mechanism: 'grant',
    honest_summary:
      'If you were treated at a nonprofit hospital, federal tax law requires that hospital to have a written ' +
      'Financial Assistance Policy covering all emergency and medically necessary care, and to WIDELY ' +
      'PUBLICIZE it. This is the most valuable and least-known item on this list for anyone holding a hospital ' +
      'bill. What the law requires, specifically: the policy must be posted online where you can read, ' +
      'download and print it without creating an account, providing personal information, or paying anything; ' +
      'a plain-language summary must be offered to patients at intake or discharge; every billing statement ' +
      'must carry a conspicuous notice about financial assistance with a phone number and the web address; ' +
      'and notices must be posted in the emergency room and admissions areas. If you are found eligible, the ' +
      'hospital may not charge you more than "Amounts Generally Billed" — roughly what insurers pay, not the ' +
      'sticker price you were sent. The misunderstanding that costs people the most: they think charity care ' +
      'is only for the uninsured and only before treatment. It is not — insured patients can qualify, and you ' +
      'can apply after the bill arrives and after it has gone to collections. Ask for the "financial ' +
      'assistance policy application", in those words. This is also the field where for-profit "medical bill ' +
      'negotiators" charge a percentage of savings to file a free form the hospital is legally required to ' +
      'give you.',
    eligibility_notes:
      'Each hospital sets its own eligibility criteria, and the law requires the policy to state them, along ' +
      'with whether assistance is free or discounted care and how amounts charged are calculated. So the ' +
      'criteria differ hospital to hospital — read the actual policy for the facility that billed you, not a ' +
      'general article. Note the limits honestly: this applies to nonprofit 501(c)(3) hospitals, on a ' +
      'facility-by-facility basis, and only to emergency and medically necessary care — a for-profit hospital ' +
      'is not bound by 501(r), though many states impose their own charity care laws. Hospitals may also ' +
      'offer discounts outside the policy that do not carry the Amounts Generally Billed cap. Before any ' +
      'extraordinary collection action (credit reporting, lawsuits, wage garnishment) the hospital must make ' +
      'reasonable efforts to determine whether you are eligible — being in collections is a reason to apply, ' +
      'not a reason it is too late.',
    source_url: 'https://www.irs.gov/charities-non-profits/financial-assistance-policy-and-emergency-medical-care-policy-section-501r4',
  },

  // ── PRESCRIPTIONS ─────────────────────────────────────────────────────────────────────────────────

  {
    name: 'Manufacturer Patient Assistance Programs (PAPs) and State Pharmaceutical Assistance Programs (SPAPs)',
    agency: 'Drug manufacturers (PAPs) and state governments (SPAPs); indexed by Medicare',
    mechanism: 'grant',
    honest_summary:
      'Drug companies run programs that give their own medicines free or nearly free to people who cannot ' +
      'afford them, and many states run their own pharmaceutical assistance programs on top of Medicare. ' +
      'Medicare\'s own cost guidance tells people to check both. These are genuine giveaways of product, not ' +
      'loans and not discounts you repay. The misunderstandings are two. First, people assume PAPs are only ' +
      'for the uninsured — many accept insured and Medicare patients whose out-of-pocket cost is still ' +
      'unaffordable. Second, and this is the one that matters: a discount card is not a PAP. If you are ' +
      'paying hundreds of dollars a month for a brand-name drug with a coupon, a manufacturer PAP will very ' +
      'often take that to zero, and it is worth the paperwork. The application usually needs your prescriber\'s ' +
      'signature, so raise it at the appointment rather than at the pharmacy counter. No legitimate PAP ' +
      'charges an application fee — the paid "we\'ll enroll you in patient assistance" services that take a ' +
      'monthly subscription are filing forms you can file free.',
    eligibility_notes:
      'Every manufacturer sets its own income cut-off, insurance status rules and renewal cycle, so there is ' +
      'no single limit — check the program for the specific drug. Common trip-ups: programs are ' +
      'drug-specific, so a household on five medicines may need five applications; most require ' +
      'recertification annually and lapse silently; and many exclude people who could get the drug through ' +
      'Medicaid or Extra Help, meaning you should apply for those first. For state programs, use Medicare\'s ' +
      'pharmaceutical assistance program lookup at medicare.gov/plan-compare (Pharmaceutical Assistance ' +
      'Program section) — SPAPs exist only in some states, and several are limited to seniors or to specific ' +
      'conditions. For Medicare beneficiaries, apply for Extra Help before anything else here: it is worth ' +
      'more than most PAPs and it covers your whole formulary.',
    source_url: 'https://www.medicare.gov/basics/costs/help/drug-costs',
  },

  {
    name: 'RxAssist — patient assistance program directory',
    agency: 'RxAssist (operated by RxVantage)',
    mechanism: 'service',
    honest_summary:
      'A free searchable directory of the manufacturer patient assistance programs described above, plus ' +
      'practical tools and articles, with a patient center and a provider center. It is information, not ' +
      'money, and it is free to use. Its value is that it collapses the actual hard part of PAPs — finding ' +
      'out which company runs a program for your specific drug and what the current form looks like — into ' +
      'one lookup. Use it before you pay anyone to "find you assistance", because that is precisely what this ' +
      'does for nothing. Be aware of its own stated limits: it offers no medical advice, endorses no drug or ' +
      'pharmacy, and gives no warranty on pricing data, so confirm the terms with the manufacturer program ' +
      'itself before relying on them.',
    eligibility_notes:
      'No eligibility, no account cost to search. Take the results to your prescriber, since most PAP ' +
      'applications require the prescriber to sign or submit. The directory tells you the program exists; the ' +
      'manufacturer decides whether you qualify, and its income and insurance rules are what govern. Check ' +
      'the date on any program entry and verify against the manufacturer\'s own page before assuming the ' +
      'terms are current.',
    source_url: 'https://www.rxassist.org/',
  },

  {
    name: '340B Drug Pricing Program — what it does and does not do for you',
    agency: 'Health Resources and Services Administration, Office of Pharmacy Affairs',
    mechanism: 'varies',
    honest_summary:
      'This entry exists to correct a belief, not to hand you an application. 340B is a price ceiling between ' +
      'drug manufacturers and certain "covered entities" — health centers, some hospitals, and other ' +
      'statutorily defined organizations. Federal regulation requires manufacturers to calculate a ceiling ' +
      'price per drug each quarter (average manufacturer price minus the unit rebate amount); the covered ' +
      'entity may not be charged more than that. Read that carefully: the discount runs to the ORGANIZATION, ' +
      'not to you, and nothing in the program requires the covered entity to pass its savings on to the ' +
      'patient. You cannot apply for 340B, you cannot claim a 340B price at a retail pharmacy, and a hospital ' +
      'being a 340B entity does not by itself mean your bill is lower. What it does mean, practically, is ' +
      'that a community health center\'s own pharmacy is often genuinely cheap, because health centers ' +
      'commonly do pass the savings through. So the useful question is never "is this a 340B hospital" — it ' +
      'is "what will this cost me at your pharmacy, and do you have a sliding scale?"',
    eligibility_notes:
      'There is no patient eligibility because patients are not the participants. Covered entities are ' +
      'defined by statute — federally qualified health centers, Ryan White clinics, certain disproportionate ' +
      'share and rural hospitals, and others. Whether you see any benefit depends entirely on that ' +
      'organization\'s own pricing policy, so ask it directly. Where 340B does reliably show up for patients ' +
      'is at FQHC in-house and contract pharmacies paired with the sliding fee scale — that combination is ' +
      'usually the cheapest legitimate route to a prescription for an uninsured person.',
    source_url: 'https://www.ecfr.gov/current/title-42/chapter-I/subchapter-A/part-10',
  },

  {
    name: 'Prescription discount cards (GoodRx, TrumpRx and similar)',
    agency: 'Private companies; TrumpRx is a federal site. Context from Medicare.gov',
    mechanism: 'service',
    honest_summary:
      'Discount cards are free to you and they genuinely lower the cash price at the counter, sometimes ' +
      'dramatically, particularly on generics. Listed honestly: there is nothing wrong with using one, and no ' +
      'catch in the sense of a bill later. But three things are true that the advertising does not say. ' +
      'First, a discount card is NOT insurance — it covers nothing, guarantees nothing, and disappears the ' +
      'day the company changes its deal. Second, Medicare states the point plainly: discount cards are not ' +
      'creditable coverage, and when you use one INSTEAD of your plan, what you spend does not count toward ' +
      'your deductible or your out-of-pocket maximum — so a card that saves you $20 today can cost you ' +
      'hundreds by delaying the point at which your plan starts paying everything. Third, and this is the ' +
      'free-or-cheaper path people are not told about: for an expensive brand-name drug, a manufacturer ' +
      'patient assistance program or Extra Help usually beats any card, often to zero. Use the card for a ' +
      'cheap generic today; do not let it stop you filing for the program that would make the drug free.',
    eligibility_notes:
      'No eligibility and no income test — anyone can use one, insured or not. The cards make money from the ' +
      'pharmacy benefit chain, which is why they cost you nothing at the counter. Always ask the pharmacist ' +
      'to compare three prices before you pay: your insurance price, the card price, and the pharmacy\'s own ' +
      'cash price — they are frequently different and the lowest is not predictable. If you have Medicare, ' +
      'ask whether using the card instead of your plan will keep the spending off your out-of-pocket total ' +
      'before you choose. Medicare also points beneficiaries to TrumpRx.gov for cash prices, noting you ' +
      'cannot buy drugs there directly and should compare against your plan.',
    source_url: 'https://www.medicare.gov/basics/costs/help/drug-costs',
  },

  {
    name: 'Medicare $35 insulin cap',
    agency: 'Centers for Medicare & Medicaid Services',
    mechanism: 'insurance',
    honest_summary:
      'If you have Medicare, you pay no more than $35 for a one-month supply of each covered insulin product — ' +
      'under Part B and under Part D. It is a statutory price cap inside your coverage, not a coupon and not ' +
      'something you apply for. The misunderstanding that costs people: which part covers your insulin ' +
      'depends on HOW you take it, and people assume they are not covered when they are. Part B covers ' +
      'insulin used with a durable-medical-equipment insulin pump. Part D covers injectable insulin you take ' +
      'with a pen or needle, insulin used with disposable patch pumps and certain reusable cartridge pumps, ' +
      'inhaled insulin, and supplies like syringes, needles, gauze and alcohol swabs. Part B does NOT cover ' +
      'self-administered pen insulin or patch pumps. If you are being charged more than $35 for a covered ' +
      'insulin, that is an error to escalate, not a price to accept.',
    eligibility_notes:
      'You must have Medicare Part B or Part D coverage for the relevant product; the cap applies per covered ' +
      'insulin product per one-month supply, and other costs may still apply. Other supplies, the pump ' +
      'itself, and non-covered products are separate. If you have Extra Help your insulin costs may be lower ' +
      'still. If a pharmacy charges you more, call your plan first and then 1-800-MEDICARE ' +
      '(1-800-633-4227). People without Medicare should look instead at manufacturer insulin assistance ' +
      'programs and health center pharmacies — the $35 cap here is a Medicare rule, not a universal one.',
    source_url: 'https://www.medicare.gov/coverage/insulin',
  },

  {
    name: 'Medicare Prescription Payment Plan',
    agency: 'Centers for Medicare & Medicaid Services',
    mechanism: 'varies',
    honest_summary:
      'This spreads your out-of-pocket drug costs across the calendar year instead of hitting you with them ' +
      'in January. It is worth knowing about and it is worth reading Medicare\'s own sentence about it, ' +
      'because it is unusually honest: "This payment option might help you manage your monthly expenses, but ' +
      'it doesn\'t save you money or lower your drug costs." Nothing is forgiven, nothing is subsidised — it ' +
      'is a smoothing of timing and nothing else. Anyone with Medicare drug coverage can use it. If your ' +
      'problem is that you cannot afford your drugs at all, this is the wrong tool and Extra Help, a ' +
      'manufacturer program, or a health center pharmacy is the right one. If your problem is specifically a ' +
      'large January bill you can afford over twelve months but not in one go, this solves exactly that.',
    eligibility_notes:
      'Open to anyone with a Medicare drug plan; you opt in through your plan. It charges no interest and no ' +
      'fees, but you remain liable for the full amount over the year, and if you leave the plan or the year ' +
      'ends the balance is still yours. It can be a poor fit late in the year, and it is generally not useful ' +
      'if you already have Extra Help (your costs are already capped at a few dollars per prescription). ' +
      'Check whether you qualify for Extra Help before opting into this.',
    source_url: 'https://www.medicare.gov/prescription-payment-plan',
  },

  // ── HOUSING ───────────────────────────────────────────────────────────────────────────────────────

  {
    name: 'Housing Choice Voucher (Section 8)',
    agency: 'U.S. Department of Housing and Urban Development — administered by your local Public Housing Agency (PHA)',
    mechanism: 'grant',
    honest_summary:
      'A voucher that pays part or all of your rent in private housing you choose yourself — a house, a ' +
      'townhouse or an apartment — as long as it meets program requirements. HUD says the program serves over ' +
      '2.3 million families. It is a subsidy, not a loan, and you repay none of it. Now the honest part, ' +
      'because this is the program most misrepresented to desperate people: it is NOT an entitlement. It is ' +
      'funded, and demand far exceeds funding. Waiting lists commonly run for years, and a PHA is allowed to ' +
      'CLOSE its list entirely when more families are on it than it can help. That is why "Section 8 ' +
      'application" is such a heavily farmed search term: paid listing sites, "we\'ll apply for you" services ' +
      'and outright scams sell access to something that is free and that they cannot expedite. Applying to a ' +
      'PHA costs nothing. Nobody can move you up a waiting list for money. The one genuine strategy is ' +
      'breadth: PHAs run their own lists and you may apply to as many as will take you, including in nearby ' +
      'jurisdictions, and there are special-purpose vouchers — HUD-VASH for veterans, Emergency Housing ' +
      'Vouchers, Mainstream vouchers for people with disabilities, and Foster Youth to Independence — with ' +
      'their own separate routes that are far less crowded than the general list.',
    eligibility_notes:
      'Income eligibility is set against HUD\'s area income limits for the county or metro area, so the same ' +
      'household can qualify with one PHA and not another; the PHA also checks family status, age or ' +
      'disability status, and citizenship or eligible immigration status. Apply directly to the PHA, in ' +
      'writing, free. Watch for: lists that open for only a few days and are then drawn by lottery (sign up ' +
      'for the PHA\'s notification list now), local residency preferences, and the requirement to re-certify ' +
      'your place while you wait — people are removed from lists for not answering a letter more often than ' +
      'for income. Once you hold a voucher you still have to find a landlord who will accept it within the ' +
      'time limit, and the unit must pass inspection and fall within the payment standard. Some states and ' +
      'cities make source-of-income discrimination illegal; ask a HUD-approved housing counselor (free) if a ' +
      'landlord refuses.',
    source_url: 'https://www.hud.gov/helping-americans/housing-choice-vouchers',
  },

  {
    name: 'Public Housing',
    agency: 'U.S. Department of Housing and Urban Development — administered by local Housing Agencies (HAs/PHAs)',
    mechanism: 'grant',
    honest_summary:
      'Rental homes owned and managed by a local housing agency and rented at what you can afford — about ' +
      '970,000 households live in them, in everything from scattered single-family houses to apartment ' +
      'buildings. Your rent, called the Total Tenant Payment, is the highest of several formulas including ' +
      '30% of your monthly ADJUSTED income (after allowances), a welfare rent where applicable, and a minimum ' +
      'rent of $25, which an agency may set as high as $50. Allowances that reduce the income the rent is ' +
      'calculated on: $480 per dependent, $400 for an elderly family or a person with a disability, and ' +
      'certain medical deductions for elderly or disabled-headed households — claim them, because nobody ' +
      'volunteers them. The honest part, in HUD\'s own words: demand for housing assistance often exceeds the ' +
      'limited resources available, long waiting periods are common, and an agency may close its waiting list ' +
      'when the list outruns what it can serve. Applying is free and the application must be written. This is ' +
      'not the same program as a Section 8 voucher and you should apply to both.',
    eligibility_notes:
      'Income limits are HUD\'s area figures: "low-income" is 80% and "very low-income" is 50% of the median ' +
      'income for the county or metro area, and they vary enough that you may qualify with one agency and not ' +
      'another. The agency also considers whether you qualify as elderly, a person with a disability, or a ' +
      'family, and citizenship or eligible immigration status, and it will check landlord references — it may ' +
      'deny admission based on habits and practices expected to affect other tenants. It may also visit your ' +
      'current home. Expect to supply names and addresses of current and previous landlords. If you are found ' +
      'eligible you go on a waiting list; agencies may give preference to particular groups. If you are found ' +
      'INELIGIBLE the agency must tell you why in writing, and you can request an informal hearing — do that, ' +
      'because denials on suitability or paperwork grounds are frequently reversed.',
    source_url: 'https://www.hud.gov/helping-americans/public-housing',
  },

  {
    name: 'Emergency Rental Assistance (ERA) — federal program has ENDED',
    agency: 'U.S. Department of the Treasury',
    mechanism: 'varies',
    honest_summary:
      'Read this one before you spend a day on it. The federal Emergency Rental Assistance program is over. ' +
      'Treasury states that the period of performance for ERA2 awards ended on September 30, 2025, that ' +
      'grantees may no longer use ERA2 funds to assist renters, and that final reports were due in January ' +
      '2026. There is no federal ERA application open. This entry exists because the program is still ' +
      'advertised everywhere — old articles, dormant county pages, and lead-generation sites that harvest ' +
      'desperate people\'s details for a program that no longer pays anyone. If a site offers to file your ' +
      'ERA application for a fee, it is selling you nothing. What is real: some states, counties and cities ' +
      'still run their own rental assistance with their own money, and Treasury itself now points renters to ' +
      'the interagency portal hosted by the Consumer Financial Protection Bureau, and to 211. Those are the ' +
      'live routes.',
    eligibility_notes:
      'No federal eligibility exists because the federal program is closed. Where local programs still ' +
      'operate, they set their own rules, funds are small and they open and close without notice — which is ' +
      'why 211 (call 211, free, 24 hours) is the practical way to find what is actually funded in your county ' +
      'this week rather than a list compiled last year. CFPB\'s own guidance notes that even after applying it ' +
      'can take several weeks for rental assistance to arrive, so if you are facing eviction, pursue the ' +
      'eviction-specific steps and a free HUD-approved housing counselor in parallel rather than waiting on ' +
      'an application.',
    source_url: 'https://home.treasury.gov/policy-issues/coronavirus/assistance-for-state-local-and-tribal-governments/emergency-rental-assistance-program',
  },

  {
    name: 'LIHEAP (Low Income Home Energy Assistance Program)',
    agency: 'U.S. Department of Health and Human Services, Office of Community Services — run by state, Tribal and territorial agencies',
    mechanism: 'grant',
    honest_summary:
      'Help paying home energy bills — heating and cooling — plus crisis assistance that can stop a shutoff, ' +
      'reconnect service that has already been cut off, and repair or replace a broken furnace or air ' +
      'conditioner. It is not repaid. Two things people do not know. First, the crisis component: if you have ' +
      'a shutoff notice or no heat, that is a separate, faster track than the regular benefit, and you should ' +
      'say "energy crisis" when you call rather than joining the ordinary queue. Second, renters qualify — ' +
      'people whose heat is included in rent or whose bill is in a landlord\'s name routinely assume they are ' +
      'excluded and are not. The honest limit: LIHEAP is a block grant, not an entitlement. Money is ' +
      'allocated to each state and runs out, usually well before the end of the season, so early in the ' +
      'program year beats a worse emergency later. HHS itself warns that LIHEAP gives no direct grants to ' +
      'individuals and charges no fee for a benefit: if anyone messages you offering a LIHEAP grant or asking ' +
      'for a fee, it is fraud — report it to the HHS Fraud Hotline at 1-800-447-8477.',
    eligibility_notes:
      'Each state, Tribe and territory sets its own income limit and its own rules within federal parameters ' +
      '— commonly a percentage of the federal poverty guidelines or of state median income — so check yours ' +
      'rather than a national figure. Find your state\'s program and application route at energyhelp.us ' +
      '(available in English, Spanish, and Traditional and Simplified Chinese), or call the National Energy ' +
      'Assistance Referral line at 1-866-674-6327. Priority commonly goes to households with elderly members, ' +
      'young children, or a disabled member. Applying for LIHEAP is also the usual doorway to the ' +
      'Weatherization Assistance Program, which fixes the reason the bill is high in the first place — ask ' +
      'to be referred at the same appointment.',
    source_url: 'https://acf.gov/ocs/programs/liheap',
  },

  {
    name: 'LIHWAP (Low Income Household Water Assistance Program) — funding ENDED',
    agency: 'U.S. Department of Health and Human Services, Office of Community Services',
    mechanism: 'varies',
    honest_summary:
      'LIHWAP paid water and wastewater bills for low-income households and, over its life, reached more than ' +
      '1.5 million of them. It is finished: HHS states plainly that funding is no longer available and that ' +
      'households cannot receive LIHWAP benefits at this time. It is listed here so you do not chase it — ' +
      'it is still widely referenced online and a water shutoff is exactly the emergency that makes people ' +
      'click the first promising link. Where to go instead, per HHS\'s own redirect: energyhelp.us for LIHEAP ' +
      '(which in some states can help with water-heating-related energy costs), HHS\'s water assistance ' +
      'resources guide for local water-bill and well/septic help, and 211. Many individual water utilities ' +
      'also run their own hardship funds and payment plans that are never advertised — ask the utility ' +
      'directly for its customer assistance program before assuming there is nothing.',
    eligibility_notes:
      'No current federal eligibility; the program is not accepting households. Note that HHS attaches the ' +
      'same warning it gives for LIHEAP: LIHWAP never provided direct grants to individuals and never charged ' +
      'a fee for a benefit, so any offer of a LIHWAP grant is fraudulent. State and local water assistance ' +
      'that still exists sets its own rules and is usually administered by the utility or a community action ' +
      'agency.',
    source_url: 'https://acf.gov/ocs/programs/lihwap',
  },

  {
    name: 'Weatherization Assistance Program (WAP)',
    agency: 'U.S. Department of Energy — administered by state agencies and local weatherization providers',
    mechanism: 'grant',
    honest_summary:
      'A crew comes to your home, runs a professional energy audit — including a blower-door test and an ' +
      'inspection of your heating equipment and the whole house — and then installs the most cost-effective ' +
      'energy-saving measures, at no cost to you. Insulation, air sealing, heating system work, health and ' +
      'safety fixes. You pay nothing and repay nothing. The two misunderstandings that keep people out: ' +
      'RENTERS ARE ELIGIBLE — DOE says so explicitly; the provider works with you and your landlord to get ' +
      'permission before work starts. And the income limit is far higher than people expect: at or below ' +
      '200% of the poverty guidelines, OR receiving SSI, and states may instead use the LIHEAP standard of ' +
      '60% of state median income. That reaches deep into working households. Unlike a bill-payment program ' +
      'this is permanent — it lowers the bill every month afterward — which is why it is worth joining a ' +
      'waiting list for.',
    eligibility_notes:
      'Households at or below 200% of the federal poverty income guidelines, or receiving Supplemental ' +
      'Security Income, are eligible under DOE guidelines; a state may also accept LIHEAP\'s 60%-of-state-' +
      'median-income test. Priority goes to the elderly, families with a member who has a disability, ' +
      'families with children, high energy users and households with a high energy burden — say so if any ' +
      'apply to you. Apply to your state weatherization administrator, who points you to the local provider; ' +
      'you will need proof of income for the prior year, such as pay stubs or Social Security statements. ' +
      'After you are found income-eligible you go on a WAITING LIST, and it can be long — get on it now ' +
      'rather than next winter. Renters need the landlord\'s permission. Specific eligibility rules vary by ' +
      'state, territory and Tribe, so check yours on the DOE map.',
    source_url: 'https://www.energy.gov/cmei/scep/wap/how-apply-weatherization-assistance',
  },

  {
    name: 'HUD-approved housing counseling agencies',
    agency: 'U.S. Department of Housing and Urban Development, Office of Housing Counseling (locator via CFPB and HUD)',
    mechanism: 'service',
    honest_summary:
      'HUD-approved counselors are trained, federally approved advisers who will help you with renting, ' +
      'buying, defaults, forbearances, foreclosures and credit problems, and they do it at little or no cost ' +
      'to you. This is the strongest free-expertise entry in the housing section and the clearest ' +
      'middleman flag in the whole list. The foreclosure and "loan modification" space is thick with ' +
      'for-profit rescue operations that charge thousands of dollars up front to submit paperwork a ' +
      'HUD-approved counselor will prepare with you for free — and charging an advance fee for mortgage ' +
      'relief services is itself restricted under federal rules. If you are behind on a mortgage or facing ' +
      'eviction, call a HUD-approved agency BEFORE you talk to anyone who found you first. They are also ' +
      'independent: a counselor can tell you whether a set of mortgage terms is actually a good fit for your ' +
      'circumstances, which no one selling you the loan will.',
    eligibility_notes:
      'Anyone can use one — renters as well as owners, before a crisis as well as during. No income test for ' +
      'access, though some specific services are targeted. Find one by ZIP code through the CFPB\'s search ' +
      'tool, which is powered by HUD\'s official list, or call the CFPB at 1-855-411-CFPB (1-855-411-2372); ' +
      'HUD also publishes the nationwide list at hud.gov and runs its own counselor search at ' +
      'answers.hud.gov/housingcounseling. Not every agency offers every service, so check the listed services ' +
      'before booking. Bring your lease or mortgage statement, the notice you received, and your income ' +
      'documents. Act on deadlines: a counselor can do far more with three weeks than with three days.',
    source_url: 'https://www.consumerfinance.gov/find-a-housing-counselor/',
  },

  {
    name: 'USDA Section 502 Direct Home Loan (with payment subsidy)',
    agency: 'U.S. Department of Agriculture, Rural Housing Service',
    mechanism: 'loan',
    honest_summary:
      'This is a LOAN. It is a very good one — USDA lends directly, and a payment subsidy can cut your ' +
      'effective payment down to what you would pay if the loan carried a 1% interest rate — but it is ' +
      'borrowed money secured by your house and you repay it. Say that clearly because "1% government home ' +
      'loan" is sold online as if it were a giveaway. And there is a second thing the advertising leaves out ' +
      'that you must know before signing: the payment subsidy is SUBJECT TO RECAPTURE. Federal regulation is ' +
      'explicit — payment subsidies must be repaid when the borrower transfers title or stops occupying the ' +
      'property. The amount is based on your equity and the property\'s appreciation, capped at the subsidy ' +
      'you received; if there is no equity, the principal reduction attributable to subsidy is not collected, ' +
      'and if you refinance or pay off without selling and keep living there, recapture can be deferred ' +
      'interest-free until you sell or move out. So the subsidy is best understood as a deferred obligation, ' +
      'not free money. That is not a reason to avoid the program — for a rural buyer with no down payment it ' +
      'is often the best terms available anywhere — it is a reason to know what you are signing.',
    eligibility_notes:
      'Your household\'s adjusted income must not exceed the area\'s low-income limit at loan approval and ' +
      'the moderate-income limit at closing. The property must be in an eligible rural area and you must ' +
      'personally occupy it. You must be a US citizen or a qualifying legal alien. Crucially, you must be ' +
      'UNABLE to get credit elsewhere on terms you could reasonably meet — this program exists for people ' +
      'conventional lenders turn down, so a prior mortgage denial helps rather than hurts. Repayment ability ' +
      'is tested: principal, interest, taxes and insurance no more than 33% of repayment income, and total ' +
      'debt no more than 41%; a cosigner or another household member can join the application if you fall ' +
      'short. Credit history is reviewed, and things that count against you include two or more rent payments ' +
      '30+ days late in the last two years and open collection accounts without a payment arrangement. An ' +
      'outstanding federal court judgment against you (other than Tax Court) disqualifies you outright. ' +
      'Payment subsidy requires a loan term of 25 years or more. Apply through your USDA Rural Development ' +
      'state or area office — free, and no broker is needed.',
    source_url: 'https://www.ecfr.gov/current/title-7/subtitle-B/chapter-XXXV/part-3550/subpart-B/section-3550.68',
  },

  {
    name: 'USDA Section 504 Home Repair Loans and Grants',
    agency: 'U.S. Department of Agriculture, Rural Housing Service',
    mechanism: 'varies',
    honest_summary:
      'Two different things under one program number, and confusing them is the mistake that matters. The ' +
      'LOAN is money to repair or improve your home that you repay. The GRANT is money you do not repay, but ' +
      'it is available only to remove health and safety hazards and only to applicants who are 62 OR OLDER at ' +
      'the time of application — that age rule is in the regulation, and it is the thing most people find out ' +
      'too late. A homeowner of 58 who reads an article about "USDA home repair grants" is reading about ' +
      'something they cannot have yet; they can still get the loan. The other rule the advertising skips: you ' +
      'have to spend your own money first. Elderly families must apply net family assets over $20,000, and ' +
      'non-elderly families assets over $15,000, to reduce what they are asking USDA for — excluding the ' +
      'value of the home itself and a minimum adequate site.',
    eligibility_notes:
      'Grant: age 62 or older at application, household adjusted income at or below the area\'s VERY ' +
      'low-income limit, and no ability to obtain credit elsewhere. Loan: same very-low-income limit, plus ' +
      'demonstrated repayment ability supported by a budget (a cosigner or another household member may ' +
      'join). Both require that you own and occupy the home, that you be unable to get help on reasonable ' +
      'terms from non-USDA credit or grant sources, that you have the legal capacity to take on the ' +
      'obligation, and that the asset test above be applied. An outstanding US federal court judgment (other ' +
      'than Tax Court) disqualifies you from a loan or grant. If you hold the property by lease rather than ' +
      'deed, the remaining lease term must be at least 5 years for a grant. Maximum loan and grant amounts ' +
      'are set by the agency and change — get the current figures from your USDA Rural Development office ' +
      'rather than from an article. Apply through that local office; nobody should charge you to do so.',
    source_url: 'https://www.ecfr.gov/current/title-7/subtitle-B/chapter-XXXV/part-3550/subpart-C/section-3550.103',
  },

  {
    name: 'Continuum of Care (CoC) — the homeless services system',
    agency: 'U.S. Department of Housing and Urban Development — through local CoC lead agencies and providers',
    mechanism: 'service',
    honest_summary:
      'The Continuum of Care is how federal homelessness money reaches the ground: HUD funds nonprofit ' +
      'providers and state and local governments in each community to deliver shelter, rapid re-housing and ' +
      'permanent supportive housing, and to connect people to mainstream benefit programs. What matters for ' +
      'someone in trouble is that this is not a program you apply to by name. You enter through your local ' +
      'CoC\'s coordinated entry system — one front door that assesses everyone with the same tool and ' +
      'prioritises by need rather than by who queued first. So the useful instruction is not "apply for CoC"; ' +
      'it is "ask for coordinated entry", and the fastest way to find it is 211. The honest part: ' +
      'permanent supportive housing is scarce and prioritisation means people with the most acute needs go ' +
      'first, so an assessment does not guarantee housing. It does get you into the system that allocates it, ' +
      'and you cannot be allocated anything while outside it.',
    eligibility_notes:
      'Eligibility is defined by HUD\'s homelessness categories and varies by the specific project — some ' +
      'serve people who are literally homeless, others people fleeing domestic violence, others youth or ' +
      'veterans. Being doubled up with family, in a car, or facing imminent loss of housing may or may not ' +
      'qualify depending on the category and the project, which is exactly why the coordinated entry ' +
      'assessment exists rather than you self-screening. Do the assessment even if you think you will not ' +
      'qualify, do it as early as possible (prevention and diversion help is easier to give before you lose ' +
      'the unit), and keep your contact details current with the assessor — people lose placements because ' +
      'the call could not reach them. Veterans should separately ask about HUD-VASH.',
    source_url: 'https://www.hudexchange.info/programs/coc/',
  },

  {
    name: '211 (free local help line)',
    agency: 'United Way Worldwide and local 211 providers',
    mechanism: 'service',
    honest_summary:
      'Dial 211 from any phone and a local specialist will search what is actually funded and open in your ' +
      'county right now — rent and utility help, food, healthcare costs, mental health, substance use, ' +
      'disaster recovery, caregiver support. Free and confidential. It is the single most useful phone ' +
      'number on this page for someone with no money today, because it is the only one that knows which ' +
      'local funds have money left this week. Both the Consumer Financial Protection Bureau and Treasury now ' +
      'point renters here after the federal rental assistance program ended. It is not money and it makes no ' +
      'decisions — it is routing. Use it first when you do not know which program you need, and use it again ' +
      'after any denial, because the specialist usually knows the smaller local fund the denying agency did ' +
      'not mention.',
    eligibility_notes:
      'No eligibility, no income test, no documents, and no cost. Availability and hours vary by locality but ' +
      'most 211s operate around the clock; some areas are text- and chat-enabled and 211.org lets you search ' +
      'online. What programs 211 refers you to have their own rules — 211 tells you what exists, the program ' +
      'decides. Be specific about your deadline (shutoff date, court date, eviction date): specialists ' +
      'triage, and the emergency funds are not the same as the ordinary ones.',
    source_url: 'https://www.211.org/',
  },

  // ── ADJACENT PROGRAMS THAT PUT REAL CASH IN THE SAME HOUSEHOLD'S HANDS ────────────────────────────

  {
    name: 'Earned Income Tax Credit (EITC)',
    agency: 'Internal Revenue Service',
    mechanism: 'tax-credit',
    honest_summary:
      'A refundable tax credit for people who worked and did not earn much. Refundable is the load-bearing ' +
      'word: it is not merely a reduction in tax owed, so if the credit exceeds your tax you get the ' +
      'difference back as an actual refund cheque. For tax year 2025 the maximum is $8,046 with three or ' +
      'more qualifying children, $7,152 with two, $4,328 with one, and $649 with none. That is the largest ' +
      'single sum available to most low-income working households, and the IRS estimates a substantial share ' +
      'of eligible people miss it every year — usually because their income was low enough that they did not ' +
      'think they had to file. You must FILE A RETURN to get it, even with no tax liability. You can also ' +
      'claim it for prior years you missed, generally within three years. It is included here because the ' +
      'most common way people lose money to it is paying for it: refund-anticipation products and ' +
      'percentage-of-refund preparers eat hundreds of dollars out of exactly this credit, and the free ' +
      'alternative is listed directly below.',
    eligibility_notes:
      'Tax year 2025 AGI limits, filing single, head of household, married filing separately or qualifying ' +
      'surviving spouse: $19,104 with no children, $50,434 with one, $57,310 with two, $61,555 with three or ' +
      'more. Married filing jointly: $26,214 / $57,554 / $64,430 / $68,675. Investment income must be ' +
      '$11,950 or less. You need earned income and a valid Social Security number. What trips people up: ' +
      'qualifying-child rules on age, relationship, residency and joint return — a child who does not meet ' +
      'them all drops you to the childless credit; filing as married filing separately used to disqualify ' +
      'you entirely and the rules have changed, so check rather than assume; and claiming a child someone ' +
      'else also claims will freeze your refund. Refunds that include EITC are held by law until mid-February ' +
      'each year, so budget for that rather than buying an advance against it.',
    source_url: 'https://www.irs.gov/credits-deductions/individuals/earned-income-tax-credit/earned-income-and-earned-income-tax-credit-eitc-tables',
  },

  {
    name: 'VITA and TCE — free tax return preparation',
    agency: 'Internal Revenue Service (Volunteer Income Tax Assistance; Tax Counseling for the Elderly)',
    mechanism: 'service',
    honest_summary:
      'IRS-run programs that prepare and file your tax return for free, at thousands of sites across the ' +
      'country, staffed by trained and certified volunteers. TCE focuses on older taxpayers and much of it ' +
      'is delivered through AARP. This is the direct answer to the paid-preparer problem attached to the ' +
      'EITC entry above: a storefront that charges a fee plus a "refund transfer" plus interest on an ' +
      'advance can take a meaningful slice of the biggest cheque a low-income household sees all year, for ' +
      'work these sites do for nothing. Volunteers are certified to the returns they handle, they catch ' +
      'credits people miss — EITC, the child credits, education credits — and they will file prior-year ' +
      'returns, which is how you claim credits from years you did not file.',
    eligibility_notes:
      'VITA serves taxpayers who qualify — generally lower- and moderate-income filers, people with ' +
      'disabilities, and people with limited English; TCE serves older taxpayers, with priority to those 60 ' +
      'and over. Sites have scope limits and will turn away complex returns (rental property, large ' +
      'self-employment losses, certain investment situations), so call ahead and describe your situation. ' +
      'Find locations with the IRS VITA site locator or the AARP site locator, both linked from the source ' +
      'page. Bring photo ID, Social Security cards or ITIN letters for everyone on the return, all income ' +
      'documents, last year\'s return if you have it, and bank details for direct deposit — direct deposit is ' +
      'free and faster than any product a paid preparer will sell you. Both spouses must be present to sign ' +
      'a joint return. Sites fill up; go early in the season.',
    source_url: 'https://www.irs.gov/individuals/irs-free-tax-return-preparation-programs',
  },

  {
    name: 'SSI and SSDI (disability and aged benefits)',
    agency: 'Social Security Administration',
    mechanism: 'grant',
    honest_summary:
      'Two different programs that people constantly confuse, and the confusion stops them applying. SSDI is ' +
      'tied to your work history — you paid in, and it pays you and certain family members if you have a ' +
      'qualifying disability. SSI does NOT require any work history at all: it provides money for basics ' +
      'like food, clothing and housing if you are 65 or older or have a disability. So "I never worked ' +
      'enough" rules you out of SSDI and rules you into consideration for SSI, not out of both. You can ' +
      'receive both at once — that is called concurrent benefits, and you apply for them together. Neither ' +
      'is repaid. Applying is free, through Social Security, and this is another field dense with paid ' +
      'middlemen: representatives are legitimate and their fees are capped and paid out of back pay if you ' +
      'win, but nobody should charge you up front to file an initial application, and no service can ' +
      'guarantee approval.',
    eligibility_notes:
      'SSDI requires a qualifying disability and enough recent work credits. SSI requires being 65 or older ' +
      'or having a qualifying disability, plus strict income and resource limits — which is why SSI ' +
      'recipients are usually also automatically eligible for Medicaid, for Extra Help on Medicare drugs, ' +
      'and for Weatherization, and why SSI resources do not count against SNAP. Apply to the Social Security ' +
      'Administration; the Administration will tell you whether you qualify for one or both. What trips ' +
      'people up: most initial claims are denied and most people stop there — appeal, because a large share ' +
      'of awards come at the appeal stage; medical evidence is what decides it, so get your treating ' +
      'clinicians to document function, not just diagnosis; and gaps in treatment because you could not ' +
      'afford care hurt the claim, which is another reason to get to a sliding-scale health center now.',
    source_url: 'https://www.usa.gov/social-security-disability',
  },
  // ── INCOME · TAX · EDUCATION · WORK · VETERANS · LEGAL (verified 14 Sept 2026) ────────────────────

  // ── INCOME AND TAX ──────────────────────────────────────────────────────────────────────────────
  {
    name: 'Amended return (Form 1040-X) — claiming a credit you missed in an earlier year',
    agency: 'Internal Revenue Service',
    mechanism: 'tax-credit',
    honest_summary:
      'If you were eligible for EITC, the Child Tax Credit or another refundable credit in a past year ' +
      'and did not claim it, the money is usually still claimable. You file Form 1040-X for that year. ' +
      'The deadline is the LATER of three years after you filed the original return or two years after ' +
      'you paid the tax. That means roughly three filing seasons of back credits are typically still ' +
      'open at any time. This is the single most overlooked money in this whole list, and it is free to ' +
      'claim — VITA volunteers (below) prepare prior-year returns at no charge. Expect 8 to 12 weeks, ' +
      'sometimes 16, for processing; this is slow money, not today money.',
    eligibility_notes:
      'You must have been eligible in the year you are amending — amending does not create eligibility. ' +
      'Returns filed before the due date count as filed on the due date for the three-year clock. If you ' +
      'never filed at all for that year, you file an original late return rather than a 1040-X. Check ' +
      'status with "Where’s My Amended Return?" or 866-464-2050 after three weeks.',
    source_url: 'https://www.irs.gov/taxtopics/tc308',
  },
  {
    name: 'Child Tax Credit and Additional Child Tax Credit',
    agency: 'Internal Revenue Service',
    mechanism: 'tax-credit',
    honest_summary:
      'The Child Tax Credit is worth up to $2,200 per qualifying child. Most of it only reduces tax you ' +
      'owe — but the ADDITIONAL Child Tax Credit is the refundable piece, up to $1,700 per child, paid ' +
      'to you as cash even if you owe no tax. That distinction is the thing people miss. If your income ' +
      'is low, the refundable $1,700 is the part that actually reaches your bank account, and you have ' +
      'to file a return to get it. There is also a separate Credit for Other Dependents worth up to $500 ' +
      'for dependents who do not qualify for the CTC — an older teenager, a parent you support.',
    eligibility_notes:
      'The child must be under 17 at the end of the tax year and have a Social Security number valid for ' +
      'employment, issued before the return’s due date including extensions. You need an SSN too. Full ' +
      'credit up to $200,000 income ($400,000 married filing jointly), partial above that. For the ' +
      'refundable Additional CTC you must have at least $2,500 of earned income. The Credit for Other ' +
      'Dependents accepts an ITIN or ATIN, the CTC does not.',
    source_url: 'https://www.irs.gov/credits-deductions/individuals/child-tax-credit',
  },
  {
    name: 'Child and Dependent Care Credit',
    agency: 'Internal Revenue Service',
    mechanism: 'tax-credit',
    honest_summary:
      'If you paid someone to care for a child under 13, or for a spouse or dependent who cannot care ' +
      'for themselves, SO THAT you could work or look for work, part of what you paid comes back as a ' +
      'tax credit. It is calculated as a percentage of your care expenses, and the percentage depends on ' +
      'your income. This is not a payment toward childcare going forward — it is money back after the ' +
      'fact, on your return. The commonest misunderstanding is that any childcare counts: it does not. ' +
      'The care has to have been what allowed you to work or job-hunt, and food, lodging, clothing, ' +
      'schooling and entertainment are excluded from the expenses.',
    eligibility_notes:
      'You (and your spouse if filing jointly) must have earned income. The qualifying person is ' +
      'generally a dependent under 13, or a spouse or dependent of any age incapable of self-care who ' +
      'lived with you more than half the year. The hard requirement that stops most claims: you must ' +
      'name the care provider on Form 2441 with their address and taxpayer ID number. An under-the-table ' +
      'sitter who will not give you a number means no credit.',
    source_url: 'https://www.irs.gov/credits-deductions/individuals/child-and-dependent-care-credit-information',
  },
  {
    name: 'Saver’s Credit (Retirement Savings Contributions Credit)',
    agency: 'Internal Revenue Service',
    mechanism: 'tax-credit',
    honest_summary:
      'If you put money into a 401(k), IRA or ABLE account on a low income, the IRS gives you back 50%, ' +
      '20% or 10% of up to $2,000 of what you contributed ($4,000 married filing jointly) — a credit of ' +
      'up to $1,000, or $2,000 jointly. The rate falls in steps as income rises. Be clear-eyed about ' +
      'this one: it rewards money you have already set aside, so it does nothing for someone with ' +
      'nothing spare this month. It matters if you are contributing at work and did not know the credit ' +
      'existed, which is common, because payroll deduction happens quietly.',
    eligibility_notes:
      'For tax year 2024 the 50% rate ran to $23,000 AGI single / $34,500 head of household / $46,000 ' +
      'joint, stepping down to 10% up to $38,250 / $57,375 / $76,500 — check the current year’s figures ' +
      'on the IRS page, they move annually. You are excluded if you are under 18, claimed as someone ' +
      'else’s dependent, or were a full-time student for five calendar months of the year. That student ' +
      'exclusion catches a lot of people.',
    source_url: 'https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-savings-contributions-savers-credit',
  },
  {
    name: 'VITA and TCE — free tax preparation by IRS-certified volunteers',
    agency: 'Internal Revenue Service (with AARP Foundation Tax-Aide for many TCE sites)',
    mechanism: 'service',
    honest_summary:
      'A real person prepares and files your return, in person, for nothing. VITA has done this for over ' +
      'fifty years; TCE is the same thing aimed at older filers. The volunteers are not amateurs — the ' +
      'IRS requires every volunteer who prepares returns to pass tax-law training meeting or exceeding ' +
      'IRS standards, and every return gets a quality review before it is filed. This is the answer for ' +
      'anyone about to pay $200 or more at a storefront preparer, and it is the answer for prior-year ' +
      'returns too. Bring photo ID, Social Security cards for everyone on the return, and every income ' +
      'form you have. Locator: https://freetaxassistance.for.irs.gov/s/sitelocator or 800-906-9887. AARP ' +
      'Tax-Aide sites: 888-227-7669.',
    eligibility_notes:
      'VITA is for people who generally make $69,000 or less, people with disabilities, and people with ' +
      'limited English. TCE prioritises filers 60 and over, with emphasis on pensions and retirement ' +
      'questions. What trips people up: sites are seasonal and appointment slots fill in February — ' +
      'call in January. Individual sites also decline unusually complex returns (rental property, ' +
      'complicated self-employment), so ask when you book.',
    source_url: 'https://www.irs.gov/individuals/free-tax-return-preparation-for-qualifying-taxpayers',
  },
  {
    name: 'IRS Free File',
    agency: 'Internal Revenue Service',
    mechanism: 'service',
    honest_summary:
      'Free brand-name tax software, provided through the IRS, for filers with adjusted gross income of ' +
      '$89,000 or less. There is also Free File Fillable Forms, which has no income limit at all but ' +
      'gives you no guidance and no state return — it is the paper form on a screen. The critical ' +
      'detail: you must start at IRS.gov/freefile. Going straight to a tax company’s own website does ' +
      'NOT get you the Free File offer, and that is exactly how people who qualify for free filing end ' +
      'up paying. Free File handles the current year only — a prior-year return has to go elsewhere ' +
      '(VITA, above).',
    eligibility_notes:
      'AGI of $89,000 or less for the guided software; any income for Fillable Forms. Individual ' +
      'partner companies set narrower rules on top of the federal threshold (age, state, military ' +
      'status), so the IRS lookup tool matters. Free state filing is offered by some partners and not ' +
      'others. Form 4868 extends the filing deadline to October 15 but does NOT extend the deadline to ' +
      'pay — tax owed is still due in April.',
    source_url: 'https://www.irs.gov/filing/irs-free-file-do-your-taxes-for-free',
  },
  {
    name: 'IRS Direct File — check before you count on it',
    agency: 'Internal Revenue Service',
    mechanism: 'service',
    honest_summary:
      'Direct File was the IRS’s own free filing tool, run directly by the government rather than by a ' +
      'tax company. Do not plan around it without checking first. Verified on 2026-09-14: ' +
      'directfile.irs.gov did not resolve, and the IRS filing hub and the IRS Free File page carried no ' +
      'mention of Direct File. That is what the official sources showed on that date, and it is stated ' +
      'here rather than guessed at. If you were relying on Direct File, the substitutes that ARE ' +
      'verifiably live are IRS Free File and a VITA site — both free, both above.',
    eligibility_notes:
      'Nothing to be eligible for unless and until the IRS lists it again. Check irs.gov/filing at the ' +
      'start of the filing season. Treat any non-government site claiming to be "IRS Direct File" as ' +
      'what it is — someone else’s product using the name.',
    source_url: 'https://www.irs.gov/filing/irs-free-file-do-your-taxes-for-free',
  },
  {
    name: 'Taxpayer Advocate Service',
    agency: 'Taxpayer Advocate Service (independent organization within the IRS)',
    mechanism: 'service',
    honest_summary:
      'When the IRS has gone wrong and normal channels have not fixed it, TAS is the inside route that ' +
      'costs nothing. It is an independent organization within the IRS, created by Congress in 1996, ' +
      'with an office in every state, DC and Puerto Rico. It is for the case where a refund has been ' +
      'frozen for months, a levy is causing real hardship, or an IRS system has simply failed. It is NOT ' +
      'a way to lower a bill you legitimately owe, and it is not a substitute for filing. File Form 911 ' +
      'or call 877-777-4778; expect a response within 30 days.',
    eligibility_notes:
      'You qualify if your tax problem is causing financial hardship, if you have tried the normal IRS ' +
      'channels and the problem is unresolved, or if an IRS process is not working as it should. There ' +
      'is no income test. What trips people up: TAS generally wants you to have tried the ordinary route ' +
      'first, so keep the notice numbers and dates of your earlier attempts.',
    source_url: 'https://www.taxpayeradvocate.irs.gov/about-us/',
  },
  {
    name: 'Low Income Taxpayer Clinics (LITC)',
    agency: 'Independent clinics, listed by the Taxpayer Advocate Service',
    mechanism: 'service',
    honest_summary:
      'Free or small-fee legal representation in a fight with the IRS — audits, appeals, collection, ' +
      'and cases in court. These clinics are independent of the IRS and of the Taxpayer Advocate ' +
      'Service, which is what makes them able to argue against the IRS on your behalf. This is the ' +
      'alternative most people do not know exists when they are being quoted thousands by a "tax ' +
      'resolution" firm for the same work. Clinics also help with ESL taxpayers and with fixing account ' +
      'problems and answering notices.',
    eligibility_notes:
      'Income eligibility is based on 250% of the federal poverty guidelines — for 2026 that is up to ' +
      'about $39,900 for a single person in the contiguous states, higher in Alaska and Hawaii and ' +
      'rising with family size. The amount in dispute also has to be under a threshold. Clinics have ' +
      'limited capacity and waiting lists; call early in a dispute, not the week before a deadline.',
    source_url: 'https://www.taxpayeradvocate.irs.gov/about-us/low-income-taxpayer-clinics-litc/',
  },
  {
    name: 'IRS Offer in Compromise',
    agency: 'Internal Revenue Service',
    mechanism: 'service',
    honest_summary:
      'An offer in compromise settles a tax debt for less than the full amount, when you genuinely ' +
      'cannot pay it or paying would cause hardship. You apply yourself. The application fee is $205 ' +
      '(waivable on low income), and the IRS publishes a free Pre-Qualifier tool that tells you whether ' +
      'you are likely to qualify before you spend anything. ⚠️ This is the single most heavily ' +
      'monetised free thing in the tax system: the "settle your tax debt for pennies" adverts sell you ' +
      'help with a form you can file yourself. See the next entry — the IRS names the practice ' +
      'explicitly.',
    eligibility_notes:
      'You must have filed all required returns, made all required estimated payments, not be in an open ' +
      'bankruptcy, and, if self-employed with employees, have made tax deposits for the current and prior ' +
      'two quarters. The unfiled-returns requirement is what stops most people — get current first. Most ' +
      'offers are rejected where the IRS calculates you can pay over time; an installment agreement or ' +
      '"currently not collectible" status is often the realistic outcome.',
    source_url: 'https://www.irs.gov/payments/offer-in-compromise',
  },
  {
    name: '⚠️ "Tax settlement" and Offer in Compromise mills — what the IRS itself says',
    agency: 'Internal Revenue Service',
    mechanism: 'service',
    honest_summary:
      'The IRS names this one directly. Promoters advertise on radio and TV claiming they can settle ' +
      'your IRS debt cheaply through an offer in compromise. The IRS’s own words: "In reality, you pay ' +
      'the promoter for what you can do yourself with the IRS." The free path is the Pre-Qualifier tool ' +
      'and Form 656 direct to the IRS, plus an LITC if you need representation and qualify. The same ' +
      'page warns about ghost preparers: a preparer who will not sign your return, has no PTIN, wants ' +
      'cash only with no receipt, or routes your refund into their own account. A paid preparer is ' +
      'required to sign.',
    eligibility_notes:
      'Nothing to qualify for — this is a warning, not a program. Before paying anyone: run the free ' +
      'Pre-Qualifier, check whether you are under the LITC income limit (250% of poverty), and verify ' +
      'any preparer has a PTIN and will sign. Complaints about a preparer go to the IRS through its ' +
      'formal complaint process.',
    source_url: 'https://www.irs.gov/help/tax-scams',
  },
  {
    name: 'Temporary Assistance for Needy Families (TANF)',
    agency: 'U.S. Department of Health and Human Services, Office of Family Assistance — administered by states and tribes',
    mechanism: 'grant',
    honest_summary:
      'TANF is the programme most people still call "welfare": cash and services for families with ' +
      'children on a low income. The federal government block-grants the money to states, and states ' +
      'design and run their own programmes — so the name, the benefit amount, the work requirements and ' +
      'the eligibility rules are all different where you live, and can be startlingly low. Money you ' +
      'receive is not repaid. The commonest misunderstanding is that TANF is one national programme with ' +
      'one set of rules; it is fifty-plus different programmes sharing a federal funding stream.',
    eligibility_notes:
      'Generally for families with dependent children; income and asset limits, work-participation ' +
      'requirements and time limits are set by your state or tribe. You apply in the state you live in. ' +
      'Childless adults are usually excluded entirely. Find your state office through the HHS TANF ' +
      'programmes-by-state directory linked from this page, or your county social services office.',
    source_url: 'https://acf.gov/ofa/programs/tanf',
  },
  {
    name: 'State and county cash assistance (including General Assistance)',
    agency: 'State and county social services departments',
    mechanism: 'varies',
    honest_summary:
      'There is no federal General Assistance programme. Verified this session: the federal benefits ' +
      'directory at USA.gov lists TANF and describes it as federally funded and state-run, and does not ' +
      'list any General Assistance programme — because GA, where it exists, is created and paid for by a ' +
      'state or county with its own money. Some states run one for adults without children; many do not; ' +
      'several run it only as a short-term loan against a pending SSI award, which is repaid out of your ' +
      'back pay. Ask your county social services office by name: "do you have General Assistance or ' +
      'general relief, and is it a grant or is it recovered from SSI back pay?" The answer decides ' +
      'whether this is money or a debt.',
    eligibility_notes:
      'Set entirely locally. Where GA exists it typically requires very low or no income, few assets, ' +
      'and often a disability or an inability to work; benefits are small and frequently time-limited. ' +
      'Because rules are county-level, a neighbouring county can answer differently. USA.gov’s benefits ' +
      'pages route you to the state office that will know.',
    source_url: 'https://www.usa.gov/welfare-benefits',
  },
  {
    name: 'Unemployment Insurance',
    agency: 'U.S. Department of Labor with state unemployment agencies',
    mechanism: 'insurance',
    honest_summary:
      'Cash benefits for workers who lost a job through no fault of their own. It is insurance your ' +
      'employer paid premiums into, not a handout and not a loan — you do not repay it. It is a joint ' +
      'federal-state programme, and each state runs a separate programme with its own eligibility rules ' +
      'and benefit amounts. Filing costs nothing. Two things people get wrong: you file with the state ' +
      'where you WORKED, not where you live, and you should file immediately on becoming unemployed ' +
      'because benefits generally run from the claim date, not the job-loss date. Expect two to three ' +
      'weeks to the first payment.',
    eligibility_notes:
      'You must meet your state’s requirements on past wages and work history and be out of work through ' +
      'no fault of your own. Being fired for cause or quitting voluntarily usually disqualifies you, but ' +
      'both are appealable and "voluntary" is narrower than employers claim. Most states require you to ' +
      'keep certifying and looking for work every week — miss a certification and payment stops.',
    source_url: 'https://www.dol.gov/general/topic/unemployment-insurance',
  },
  {
    name: 'Supplemental Security Income (SSI)',
    agency: 'Social Security Administration',
    mechanism: 'grant',
    honest_summary:
      'SSI is monthly cash for people who are 65 or older, blind, or disabled, and who have little or no ' +
      'income and few resources. It does NOT require a work history — that is the difference from SSDI ' +
      'and the reason it exists. Applying is free at ssa.gov, by phone, or at an office; nobody has to ' +
      'be paid to submit it for you. The commonest misunderstanding is that you must have worked or paid ' +
      'in. You need not have. You can also receive SSI and SSDI at the same time if you qualify for ' +
      'both, and SSA decides that from one application. (Note: ssa.gov blocked automated retrieval on ' +
      '2026-09-14, so this entry is verified against USA.gov, the government’s own directory.)',
    eligibility_notes:
      'Little or no income, and either a disability, blindness, or age 65+. There are strict resource ' +
      'limits, which is what trips people up — savings, a second vehicle, or money sitting in someone ' +
      'else’s account "for" you can disqualify you, and an ABLE account (below) is the legal way around ' +
      'part of that. Children’s SSI claims must be started online but finished by phone or in person.',
    source_url: 'https://www.usa.gov/social-security-disability',
  },
  {
    name: 'Social Security Disability Insurance (SSDI)',
    agency: 'Social Security Administration',
    mechanism: 'insurance',
    honest_summary:
      'SSDI pays you, and in some cases your family members, if you have a disability and worked long ' +
      'enough paying Social Security taxes. It is tied to your work record — you paid for it out of ' +
      'every paycheck. Applying is free; you can apply online, by phone or in person. Two hard truths: ' +
      'there is a five-month waiting period after approval before benefits start, and first applications ' +
      'are frequently denied, so the appeal is part of the ordinary process rather than a sign your ' +
      'claim is bad. (ssa.gov blocked automated retrieval on 2026-09-14; verified against USA.gov.)',
    eligibility_notes:
      'Eligibility depends on your age, your disability, and how long you worked. Family members may ' +
      'qualify on your record. If your work history is too short you may still qualify for SSI instead, ' +
      'and SSA considers both from one application. What trips people up: missing medical evidence. The ' +
      'decision is made on the file, so the names and dates of every treating doctor matter more than ' +
      'how you describe the condition.',
    source_url: 'https://www.usa.gov/social-security-disability',
  },
  {
    name: '⚠️ Paid help with a Social Security claim — 42 U.S.C. § 406',
    agency: 'Congress / Social Security Administration (statute)',
    mechanism: 'service',
    honest_summary:
      'Applying for SSI or SSDI is free, and helping someone fill in the application is not a regulated ' +
      'activity — a friend, a caseworker, or a community organisation can sit with you and do it. What ' +
      'IS regulated is being paid for it. Under 42 U.S.C. § 406 a representative must have the fee ' +
      'authorised by SSA. For a written fee agreement the fee is capped at the lesser of 25% of past-due ' +
      'benefits or a dollar cap set by the statute and adjusted over time; in court, a judge may award ' +
      'no more than 25% of past-due benefits. Charging more than the authorised amount carries criminal ' +
      'penalties under the same section. So: nobody may lawfully take a cut of your back pay that SSA ' +
      'has not approved, and nobody may charge you a fee just to file.',
    eligibility_notes:
      'These rules bind the representative, not you. Practical checks: ask whether they have filed a fee ' +
      'agreement with SSA, ask what happens to the fee if you lose (under an approved agreement, ' +
      'typically nothing is owed because the fee comes out of past-due benefits), and never pay a ' +
      'percentage of ongoing monthly benefits — the cap applies to past-due benefits only.',
    source_url: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title42-section406&num=0&edition=prelim',
  },
  {
    name: 'Ticket to Work',
    agency: 'Social Security Administration',
    mechanism: 'service',
    honest_summary:
      'Free employment support for people already receiving SSDI or SSI who want to try working: career ' +
      'counselling, vocational rehabilitation, job placement. It is free and voluntary. The part that ' +
      'actually matters to most people is the protection — if you assign your Ticket before you receive ' +
      'a continuing disability review notice and you keep making timely progress on your employment ' +
      'plan, SSA will not conduct a medical review of your condition while you participate. That removes ' +
      'the main fear, which is that trying a job will cost you your benefits. Help line 1-866-968-7842 ' +
      '(TTY 1-866-833-2967), Monday to Friday 8am-8pm ET.',
    eligibility_notes:
      'Everyone aged 18 through 64 receiving SSDI and/or SSI on the basis of disability is eligible. ' +
      'The medical-review protection only applies if you assign the Ticket BEFORE a review notice ' +
      'arrives and keep up timely progress — assigning it after a notice does not stop that review. ' +
      'Earnings still affect benefits under the ordinary work rules; the protection is from medical ' +
      'review, not from income rules.',
    source_url: 'https://choosework.ssa.gov/about/how-it-works',
  },
  {
    name: 'ABLE accounts (529A)',
    agency: 'Internal Revenue Service / state ABLE programs',
    mechanism: 'varies',
    honest_summary:
      'A tax-advantaged savings account for a person with a disability. Money grows tax-free and comes ' +
      'out tax-free when spent on qualified disability expenses. Its real function for someone on ' +
      'benefits is that it is a legal place to hold savings that the strict SSI resource limits would ' +
      'otherwise punish you for having. It is not free money and not income — it is your own money, ' +
      'sheltered. A working beneficiary may contribute their own earnings above the standard annual ' +
      'limit, up to the poverty line amount for a one-person household.',
    eligibility_notes:
      'For eligible people with disabilities as the designated beneficiary; the IRS page above sets out ' +
      'the account rules and the annual contribution limit, which is tied to the gift tax exclusion and ' +
      'changes over time — confirm the current figure before contributing. The interaction with SSI ' +
      'resource counting is governed by SSA rather than the IRS; check SSA’s ABLE guidance before ' +
      'relying on it, and open the account through your state’s ABLE programme.',
    source_url: 'https://www.irs.gov/government-entities/federal-state-local-governments/able-accounts-tax-benefit-for-people-with-disabilities',
  },
  {
    name: 'Low Income Home Energy Assistance Program (LIHEAP)',
    agency: 'U.S. Department of Health and Human Services, Office of Community Services — administered by states and tribes',
    mechanism: 'grant',
    honest_summary:
      'Federally funded help with home energy: heating bills, cooling bills, energy crises, ' +
      'weatherization and minor energy-related home repairs. It is assistance, not a loan — you do not ' +
      'repay it. LIHEAP funds can prevent a shutoff, reconnect service that has already been cut, and ' +
      'repair or replace heating equipment. The crisis component is the one to ask for by name when a ' +
      'shutoff notice is in your hand; it moves faster than the regular benefit. Money usually goes ' +
      'straight to the utility rather than to you.',
    eligibility_notes:
      'Income limits and application processes are set by each state, territory or tribe, and funds are ' +
      'finite — many states open applications on a date and close when money runs out, which is the ' +
      'thing that catches people. Apply through your state or tribal LIHEAP office, not through HHS. ' +
      'Renters whose heat is included in rent are often still eligible; ask.',
    source_url: 'https://acf.gov/ocs/programs/liheap',
  },

  // ── EDUCATION AND TRAINING ──────────────────────────────────────────────────────────────────────
  {
    name: 'FAFSA — the single door to federal student aid (20 U.S.C. § 1090)',
    agency: 'U.S. Department of Education, Federal Student Aid',
    mechanism: 'service',
    honest_summary:
      'The FAFSA is not aid. It is the one form that decides whether you get aid, and by statute it is ' +
      'free. 20 U.S.C. § 1090 requires the Secretary of Education to produce a single common form and ' +
      'states that "no parent or student shall be charged a fee by the Secretary, a contractor, a ' +
      'third-party servicer or private software provider, or any other public or private entity for the ' +
      'collection, processing, or delivery of Federal financial aid through the use of such ' +
      'application." The same section provides that eligibility for federal aid may be determined ONLY ' +
      'by using the FAFSA. So any site charging to file it, or promising to find you aid the FAFSA ' +
      'cannot, is selling you something the law says is free. One form opens Pell, FSEOG, Work-Study, ' +
      'federal loans, and most state and school aid.',
    eligibility_notes:
      'Everyone applying for federal student aid files it, and filing it is how you find out whether you ' +
      'qualify — do not self-disqualify on a guess about income. The form is available from October 1 ' +
      'before the enrolment year and must be offered in multiple languages and accessible formats. ' +
      'States and schools may not demand an additional financial form as a condition of packaging your ' +
      'federal aid. File early: state and school funds are often first-come.',
    source_url: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title20-section1090&num=0&edition=prelim',
  },
  {
    name: 'Federal Supplemental Educational Opportunity Grant (FSEOG)',
    agency: 'U.S. Department of Education, Federal Student Aid (administered by participating schools)',
    mechanism: 'grant',
    honest_summary:
      'A grant you do not repay, on top of Pell, for undergraduates with exceptional financial need. By ' +
      'statute (20 U.S.C. § 1070b-1) the award is the lesser of what your course of study requires or ' +
      '$4,000 per academic year, and no payment is made where the calculated amount is under $100. The ' +
      'thing to understand about FSEOG: the money is handed to individual SCHOOLS in a fixed pot, and ' +
      'the school awards it until the pot is empty. It is not an entitlement like Pell. Two students ' +
      'with identical need can get different answers at different schools, or at the same school in ' +
      'different months. File the FAFSA as early as you can — that is the entire lever you have.',
    eligibility_notes:
      'Undergraduate with exceptional need, established by the FAFSA, at a participating school — not ' +
      'every school participates in the programme, so ask the financial aid office directly whether ' +
      'yours does. Study-abroad students may receive up to $400 above the annual maximum where costs ' +
      'exceed home-institution costs. The $100 floor is reduced proportionately for part-time students.',
    source_url: 'https://www.govinfo.gov/content/pkg/USCODE-2023-title20/html/USCODE-2023-title20-chap28-subchapIV-partA-subpart3-sec1070b-1.htm',
  },
  {
    name: 'Federal Work-Study',
    agency: 'U.S. Department of Education, Federal Student Aid (administered by participating schools)',
    mechanism: 'service',
    honest_summary:
      'Work-Study is a JOB, not a grant. The statute (20 U.S.C. § 1087-51) describes its purpose as ' +
      'stimulating and promoting part-time employment for students who need the earnings to pay for ' +
      'their education. You are awarded an amount you are allowed to EARN, and you receive it only as ' +
      'wages for hours actually worked. That is the misunderstanding that costs students money every ' +
      'year: seeing the figure on an award letter and budgeting it as though it had already arrived. It ' +
      'has not. You must find and take the job, and the award is a ceiling on earnings, not a payment. ' +
      'The statute also directs the programme toward community-service work — healthcare, literacy ' +
      'training, housing, public safety, mentoring.',
    eligibility_notes:
      'Financial need established by the FAFSA, at a participating school — again, not every school ' +
      'participates. Undergraduate, graduate and professional students can be eligible. Jobs are ' +
      'limited and go quickly at the start of term; apply for the position the moment the award ' +
      'appears, and ask the aid office what happens to unearned award money (usually nothing — it ' +
      'simply goes unpaid).',
    source_url: 'https://www.govinfo.gov/content/pkg/USCODE-2023-title20/html/USCODE-2023-title20-chap28-subchapIV-partC-sec1087-51.htm',
  },
  {
    name: 'Federal TRIO Programs',
    agency: 'U.S. Department of Education, Office of Postsecondary Education',
    mechanism: 'service',
    honest_summary:
      'Eight federal outreach and student-services programmes for people from disadvantaged backgrounds, ' +
      'carrying students "through the academic pipeline from middle school to postbaccalaureate ' +
      'programs": Educational Opportunity Centers, Ronald E. McNair Postbaccalaureate Achievement, ' +
      'Student Support Services, Talent Search, Upward Bound, Upward Bound Math-Science, Veterans Upward ' +
      'Bound, and a staff training programme. This is help, not cash: tutoring, advising, help with ' +
      'applications and financial aid forms. The structural point people miss is that YOU do not apply ' +
      'for a TRIO grant — institutions and community organisations hold the grants, and you apply to be ' +
      'accepted into a funded project near you.',
    eligibility_notes:
      'Targeted at low-income individuals, first-generation college students, and individuals with ' +
      'disabilities. You must be eligible for services and accepted into a funded project, so the ' +
      'practical first step is finding which local college or organisation holds a TRIO grant — ask any ' +
      'community college financial aid office. Veterans Upward Bound is a separate door worth naming if ' +
      'you served.',
    source_url: 'https://www.ed.gov/grants-and-programs/grants-higher-education/trio-home-page',
  },
  {
    name: 'Job Corps',
    agency: 'U.S. Department of Labor',
    mechanism: 'service',
    honest_summary:
      'The nation’s largest free residential career training and education programme for low-income ' +
      'young adults. Free means free: training in fields like manufacturing, healthcare, technology and ' +
      'construction, plus housing, meals, basic medical care and a living allowance, at no cost to the ' +
      'student. For someone aged 16 to 24 with nowhere to live and no income, this is one of the very ' +
      'few doors in this entire list that provides housing and training at the same time. It is not a ' +
      'loan and there is no tuition debt at the end.',
    eligibility_notes:
      'Ages 16 to 24, low income. Centres are residential but some students attend non-residentially. ' +
      'Admission is through a Job Corps admissions counsellor rather than an online-only process, and ' +
      'placement depends on which centres have capacity in which trades — be flexible about location. ' +
      'Check current centre availability before making plans, as the centre network changes.',
    source_url: 'https://www.jobcorps.gov/',
  },
  {
    name: 'WIOA Title I and the American Job Center network',
    agency: 'U.S. Department of Labor, Employment and Training Administration',
    mechanism: 'service',
    honest_summary:
      'The Workforce Innovation and Opportunity Act is the law behind the public workforce system, and ' +
      'its services reach you through American Job Centers — the physical offices in most metropolitan ' +
      'areas. WIOA is designed so job seekers can access "employment, education, training, and support ' +
      'services," with separate Adult, Dislocated Worker and Youth programmes. In practice the Job ' +
      'Center is where a person with no money can get resume help, job search, skills assessment and, ' +
      'crucially, funded training in a specific trade. Most people walk past these offices without ' +
      'knowing what is inside. Ask at the front desk for an eligibility interview for WIOA-funded ' +
      'training, not just for the job board.',
    eligibility_notes:
      'Basic career services are broadly available; individualised services and funded training are ' +
      'rationed by eligibility category (adult, dislocated worker, youth) and by local priority rules, ' +
      'which generally favour low-income individuals, recipients of public assistance, and people ' +
      'laid off. Funding is annual and local — the same request can be answered differently in ' +
      'different counties and at different points in the programme year.',
    source_url: 'https://www.dol.gov/agencies/eta/wioa',
  },
  {
    name: 'YouthBuild',
    agency: 'U.S. Department of Labor, Employment and Training Administration',
    mechanism: 'service',
    honest_summary:
      'A community-based pre-apprenticeship programme for young people aged 16 to 24 who left school ' +
      'without a diploma. Participants work toward a high school diploma or equivalency while learning ' +
      'construction trades, and the construction work is real — building or rehabilitating affordable ' +
      'housing for low-income or homeless families in their own neighbourhoods. Programmes provide ' +
      'supportive services such as transportation, childcare and equipment. It is a route into the ' +
      'trades for someone the education system has already lost, without tuition debt.',
    eligibility_notes:
      'Ages 16 to 24, out of school without a secondary diploma. YouthBuild is delivered by local ' +
      'grantee organisations, so availability depends entirely on whether one operates near you and ' +
      'when its next cohort starts — the DOL page lists grantees. Cohorts are intake-based, not ' +
      'rolling, so find the start date before you plan around it.',
    source_url: 'https://www.dol.gov/agencies/eta/youth/youthbuild',
  },
  {
    name: 'Adult education and family literacy',
    agency: 'U.S. Department of Education, Office of Career, Technical, and Adult Education',
    mechanism: 'service',
    honest_summary:
      'Federal grant money flows through OCTAE’s Division of Adult Education and Literacy to state and ' +
      'local programmes so adults can "acquire the basic skills necessary to function in today’s ' +
      'society" — completing secondary education, family literacy, working toward citizenship, and ' +
      'preparing for job training. In practice this is the free adult basic education, high school ' +
      'equivalency preparation and English class at a community college or public library near you. ' +
      'These classes are the unglamorous prerequisite for almost everything else in this list: a ' +
      'training programme or an apprenticeship that requires a diploma becomes reachable once this is ' +
      'done, and it costs nothing.',
    eligibility_notes:
      'Adults seeking to complete secondary school, improve family literacy, attain citizenship, or ' +
      'enter job training or retraining. Delivered locally, so enrolment, testing and schedules are set ' +
      'by the local provider. Start with your community college’s adult education department or your ' +
      'state’s adult education office rather than with the federal page.',
    source_url: 'https://www.ed.gov/about/ed-offices/octae',
  },
  {
    name: 'State "promise" and last-dollar scholarship programs (example: Tennessee Promise)',
    agency: 'State higher education agencies — example verified: Tennessee',
    mechanism: 'grant',
    honest_summary:
      'Many states run a "promise" scholarship covering community or technical college. Understand the ' +
      'phrase LAST-DOLLAR, because it is the whole design: the state pays tuition and mandatory fees ' +
      'NOT already covered by gift aid. If Pell covers your tuition, the promise scholarship adds ' +
      'nothing on top of it, and it does not pay rent, food or transport — the costs that actually stop ' +
      'people finishing. Tennessee Promise, verified, is a scholarship plus mentoring programme running ' +
      'since 2014 covering tuition and mandatory fees at 13 community colleges and 22 colleges of ' +
      'applied technology. Check whether your own state has an equivalent, and read whether it is ' +
      'last-dollar or first-dollar.',
    eligibility_notes:
      'These programmes live or die on deadlines and on non-financial obligations. Tennessee Promise ' +
      'requires the state application by November 2, the FAFSA by April 1, attendance at a mandatory ' +
      'meeting, and 16 hours of community service each year reported to a partnering organisation — ' +
      'miss any one and eligibility ends. Assume your state’s version has similar tripwires and ' +
      'calendar them.',
    source_url: 'https://www.collegefortn.org/tnpromise/',
  },
  {
    name: 'Public Service Loan Forgiveness (PSLF)',
    agency: 'U.S. Department of Education (explained here by the Consumer Financial Protection Bureau)',
    mechanism: 'service',
    honest_summary:
      'PSLF cancels the remaining balance on federal Direct Loans after 120 qualifying monthly payments ' +
      'made while working for a qualifying employer — federal, state, local or tribal government, the ' +
      'US military, or certain non-profits. Only federal Direct Loans qualify; other federal loans can ' +
      'be consolidated into a Direct Consolidation Loan to become eligible. Income-driven repayment is ' +
      'the natural pairing, because lower payments now mean more forgiven later. ⚠️ Applying costs ' +
      'nothing and is done through the Department of Education. Every "student loan relief" company ' +
      'charging a fee to enrol you in PSLF is charging for a free federal form — and the FTC’s guidance ' +
      'is blunt that for student loans these services exist at no charge through official government ' +
      'channels.',
    eligibility_notes:
      '120 qualifying payments (they need not be consecutive), full-time work for a qualifying employer ' +
      'at the time each payment is made, Direct Loans, and a qualifying repayment plan. What trips ' +
      'people up: years of payments made on the wrong loan type or the wrong plan do not count, and ' +
      'that is usually discovered late. Certify your employment annually rather than at the end, so ' +
      'errors surface while they are still fixable.',
    source_url: 'https://www.consumerfinance.gov/ask-cfpb/what-is-public-service-loan-forgiveness-pslf-en-641/',
  },
  {
    name: 'Income-driven repayment (IDR) for federal student loans',
    agency: 'U.S. Department of Education (explained here by the Consumer Financial Protection Bureau)',
    mechanism: 'service',
    honest_summary:
      'An IDR plan sets your federal student loan payment from your income and family size rather than ' +
      'your balance, and forgives the remaining balance after 20 to 25 years of payments depending on ' +
      'the plan. For someone with no money this month it is the difference between a default and a ' +
      'payment that might be very small. It is NOT debt cancellation now, and unpaid interest behaviour ' +
      'differs between plans, so the balance can grow while you pay. ⚠️ You enrol free through your ' +
      'loan servicer or at studentaid.gov. Nobody needs to be paid to do it. The plans available change ' +
      'with litigation and legislation, so confirm which are currently accepting applications before ' +
      'choosing.',
    eligibility_notes:
      'Federal student loans only — private loans have no IDR equivalent, and no company can create one. ' +
      'You must recertify income every year; missing recertification is the standard way a manageable ' +
      'payment snaps back to an unmanageable one. Forgiven balances may have tax consequences depending ' +
      'on the law in the year of forgiveness. If you are already in default, ask the servicer about ' +
      'rehabilitation first — IDR generally follows getting out of default.',
    source_url: 'https://www.consumerfinance.gov/ask-cfpb/what-is-an-income-driven-repayment-plan-en-1555/',
  },
  {
    name: 'Registered Apprenticeship',
    agency: 'U.S. Department of Labor',
    mechanism: 'service',
    honest_summary:
      'An apprenticeship pays you wages while you learn the trade and ends with a nationally recognised ' +
      'credential. There is no tuition debt at the end, which is the entire difference between this and ' +
      'a for-profit trade school selling the same skills on credit. The Apprenticeship Job Finder at ' +
      'apprenticeship.gov is the search tool. The programme reports 93% employment retention after ' +
      'completion. Treat the headline earnings figures on the site as programme-wide averages across ' +
      'all trades and regions, not a promise about your trade or your town.',
    eligibility_notes:
      'Requirements are set by each sponsor — typically a minimum age, a high school diploma or ' +
      'equivalency for many trades, and sometimes an aptitude test or physical requirements. Competitive ' +
      'trades take applications in windows, not continuously. If you lack the diploma, the adult ' +
      'education entry above is the step before this one; some pre-apprenticeship programmes ' +
      '(YouthBuild, above) exist precisely to bridge that gap.',
    source_url: 'https://www.apprenticeship.gov/',
  },

  // ── WORK AND SMALL BUSINESS ─────────────────────────────────────────────────────────────────────
  {
    name: 'Small Business Development Centers (SBDC)',
    agency: 'U.S. Small Business Administration resource partner network',
    mechanism: 'service',
    honest_summary:
      'Free to low-cost, individualised business advising and technical assistance, for people already ' +
      'in business and for people who have not started yet. Business planning, strategy, operations, ' +
      'financial management, personnel, marketing, export help, sales. This is a professional advisor ' +
      'you would otherwise be paying by the hour, funded so that you do not have to. It is advice, not ' +
      'money — an SBDC cannot give you a grant, and an advisor who is honest with you may tell you your ' +
      'plan does not work, which is worth more than a consultant paid to agree. Find one by ZIP code at ' +
      'https://www.sba.gov/local-assistance/district.',
    eligibility_notes:
      'Open to small businesses and pre-venture entrepreneurs; no fee for counselling, though training ' +
      'courses may carry a small charge. Centres are hosted by universities and state agencies, so ' +
      'depth of expertise varies by location — ask to be matched with an advisor who knows your ' +
      'industry, and ask early about capital readiness rather than after a loan denial.',
    source_url: 'https://www.sba.gov/local-assistance/resource-partners/small-business-development-centers-sbdc',
  },
  {
    name: 'SCORE business mentoring',
    agency: 'SCORE (nonprofit), an SBA resource partner',
    mechanism: 'service',
    honest_summary:
      'The nation’s largest network of volunteer expert business mentors, free. Mentors are unpaid ' +
      'volunteers with real operating experience, and they will meet by email, phone or video as well as ' +
      'in person. Alongside one-to-one mentoring there are training sessions, webinars, online workshops ' +
      'and a resource library, all free. The value is in the ongoing relationship rather than a single ' +
      'session — a mentor who has watched your numbers for six months gives different advice from one ' +
      'meeting you once. Again: this is expertise, not capital.',
    eligibility_notes:
      'Open to anyone planning, launching, managing or growing a small business. Mentors are matched by ' +
      'ZIP code through the SBA local assistance tool. Quality varies with the individual volunteer — if ' +
      'a mentor is a poor fit for your sector, ask for a different match rather than concluding the ' +
      'programme is useless.',
    source_url: 'https://www.sba.gov/local-assistance/resource-partners/score-business-mentoring',
  },
  {
    name: 'Women’s Business Centers (WBC)',
    agency: 'U.S. Small Business Administration resource partner network',
    mechanism: 'service',
    honest_summary:
      'A national network of entrepreneurship centres designed to help women start and grow small ' +
      'businesses, offering free to low-cost counselling and training, plus help with federal ' +
      'contracting and with access to credit and capital. The access-to-capital work is the part that ' +
      'is genuinely hard to buy elsewhere: help assembling the financials and the story a lender needs ' +
      'to say yes. It is still counselling, not a grant. Find your nearest centre through the SBA local ' +
      'assistance search.',
    eligibility_notes:
      'Aimed at women entrepreneurs, though centres serve broadly; there is no income test for ' +
      'counselling. Each WBC is run by a local host organisation with its own specialisms and class ' +
      'schedule, so two centres in the same state can offer quite different programmes. Training ' +
      'courses may carry a small fee; counselling is free.',
    source_url: 'https://www.sba.gov/local-assistance/resource-partners/womens-business-centers',
  },
  {
    name: 'Veterans Business Outreach Centers (VBOC)',
    agency: 'U.S. Small Business Administration',
    mechanism: 'service',
    honest_summary:
      'Free entrepreneurial development services for service members, veterans, National Guard and ' +
      'Reserve members, military spouses and family members: workshops, one-to-one counselling and ' +
      'mentorship, business plan development, financial statement review, and specialised training in ' +
      'manufacturing, international trade, franchising and internet marketing. The Boots to Business ' +
      'course runs for transitioning service members and B2B Reboot for veterans already out. No charge ' +
      'to eligible participants. Note that military spouses and family members are explicitly included — ' +
      'that is frequently missed.',
    eligibility_notes:
      'Veterans of all eras, active-duty service members, National Guard and Reserve, military spouses, ' +
      'and family members of those groups. Centres are organised by region; the SBA page lists them with ' +
      'contact details. Boots to Business is delivered on installations for those still serving, so ask ' +
      'your transition office as well as the VBOC.',
    source_url: 'https://www.sba.gov/local-assistance/resource-partners/veterans-business-outreach-center-vboc-program',
  },
  {
    name: 'SBA 7(a) loan',
    agency: 'U.S. Small Business Administration (loans made by participating lenders)',
    mechanism: 'loan',
    honest_summary:
      'This is a LOAN. You repay it, with interest, in monthly payments of principal and interest out of ' +
      'the business’s cash flow. The SBA does not lend you the money — it guarantees part of what a ' +
      'bank lends (85% on loans under $150,000 and 75% above that for the Working Capital Pilot), which ' +
      'is why a bank will consider a borrower it would otherwise refuse. Maximum $5 million. It can be ' +
      'used for real estate, working capital, equipment, refinancing business debt and changes of ' +
      'ownership. Anyone describing an SBA 7(a) as government money for your business is describing debt ' +
      'with a federal backstop for the lender, not for you.',
    eligibility_notes:
      'You must show creditworthiness and "a reasonable ability to repay." Expect the lender to require ' +
      'collateral where available and personal guarantees from owners — the SBA guarantee protects the ' +
      'lender, not you, and you can still lose pledged personal assets. Approval runs through the bank, ' +
      'so shop lenders: two SBA lenders will answer the same file differently. Talk to an SBDC before ' +
      'applying, not after a denial.',
    source_url: 'https://www.sba.gov/funding-programs/loans/7a-loans',
  },
  {
    name: 'SBA 504 loan',
    agency: 'U.S. Small Business Administration, through Certified Development Companies',
    mechanism: 'loan',
    honest_summary:
      'Also a LOAN — long-term fixed-rate financing for major fixed assets, originated by a Certified ' +
      'Development Company alongside a senior lender. Up to $5.5 million, over 10, 20 or 25 years, at ' +
      'rates pegged above 10-year Treasury yields. It buys property, construction or renovation, and ' +
      'long-life machinery and equipment, and can refinance qualifying debt. What it CANNOT do is the ' +
      'thing most struggling businesses actually need: it cannot be used for working capital or ' +
      'inventory, and not for real estate speculation. If cash flow is the problem, 504 is the wrong ' +
      'door.',
    eligibility_notes:
      'For fixed assets with long useful life (equipment generally 10 years or more). Structured through ' +
      'a CDC, which is a community-based non-profit — find the CDC covering your area. Job creation or ' +
      'public policy goals are part of the programme’s design, so expect to document them. Repayment ' +
      'is usually by ACH draw through a Central Servicing Agent, meaning a missed month is immediate ' +
      'and visible.',
    source_url: 'https://www.sba.gov/funding-programs/loans/504-loans',
  },
  {
    name: 'SBA microloan',
    agency: 'U.S. Small Business Administration, through intermediary lenders',
    mechanism: 'loan',
    honest_summary:
      'A LOAN of up to $50,000, though the average is about $13,000, made by SBA-designated intermediary ' +
      'lenders — usually community non-profits. Interest generally runs 8% to 13%, with up to seven ' +
      'years to repay. It is genuinely easier to get than a bank loan and the intermediaries often ' +
      'provide business training alongside it. Two limits to know before you plan around it: microloan ' +
      'money cannot be used to pay existing debts and cannot buy real estate. So it will not refinance ' +
      'the credit card you used to keep the business alive, which is the most common reason people ' +
      'come looking.',
    eligibility_notes:
      'The intermediary lender makes all credit decisions and sets the terms, so eligibility varies by ' +
      'lender and by region — a refusal from one intermediary is not a refusal from the programme. ' +
      'Expect collateral and a personal guarantee even at small amounts. Many intermediaries require ' +
      'you to complete their business training as a condition, which is free and worth doing.',
    source_url: 'https://www.sba.gov/funding-programs/loans/microloans',
  },
  {
    name: 'SBA Office of the National Ombudsman (15 U.S.C. § 657b)',
    agency: 'U.S. Small Business Administration',
    mechanism: 'service',
    honest_summary:
      'If a federal agency has treated your small business, non-profit or small government entity ' +
      'unfairly in enforcement — an excessive fine, a punitive audit, an inspection that felt like ' +
      'retaliation — this is the office created by the Small Business Regulatory Enforcement Fairness ' +
      'Act to hear about it. It is free, independent and confidential, it takes your comment to the ' +
      'agency for a high-level review, and it reports annually to Congress on how responsive each ' +
      'agency was. Filing "does not limit your rights or obligations related to the federal agency ' +
      'involved" — it runs alongside your appeal rather than replacing it. Almost nobody outside ' +
      'Washington knows this exists. File at federalcomments.sba.gov, email a PDF to ombudsman@sba.gov, ' +
      'or call 888-REG-FAIR.',
    eligibility_notes:
      'Open to small businesses, small government entities and not-for-profit organisations — not to ' +
      'individuals in a personal capacity. It covers federal agency conduct: enforcement actions, ' +
      'audits, inspections, compliance contacts, and concerns about existing regulations. It does not ' +
      'cover state or local agencies, and it is not an appeals tribunal — keep filing your actual ' +
      'appeal on its own deadline.',
    source_url: 'https://www.sba.gov/about-sba/oversight-advocacy/office-national-ombudsman',
  },

  // ── VETERANS ────────────────────────────────────────────────────────────────────────────────────
  {
    name: 'VA health care',
    agency: 'U.S. Department of Veterans Affairs',
    mechanism: 'service',
    honest_summary:
      'Health care through the VA, with your access and costs determined by a priority group system. ' +
      'Copays apply for some care, tests and medications — VA publishes current copay rates — but ' +
      'income affects both eligibility and cost, and veterans below income thresholds may be eligible ' +
      'for free or reduced-cost care. The mistake that costs veterans years of care is assuming they ' +
      'are not eligible and never applying. Eligibility and priority groups are determined by the VA on ' +
      'application, not by your own reading of the rules.',
    eligibility_notes:
      'Based on service history, service-connected conditions, income and other factors, which together ' +
      'set your priority group. Enrolment is a separate act from being a veteran — apply and let VA ' +
      'determine the group. If you were told no in an earlier era, the rules have changed repeatedly ' +
      'since; a previous denial is not a current answer.',
    source_url: 'https://www.va.gov/health-care/',
  },
  {
    name: 'VA disability compensation',
    agency: 'U.S. Department of Veterans Affairs',
    mechanism: 'insurance',
    honest_summary:
      'A monthly TAX-FREE payment to veterans who got sick or injured while serving, or whose existing ' +
      'condition was made worse by service. It covers physical conditions and mental health conditions ' +
      'including PTSD, and a condition that appeared after service can still be service-connected. You ' +
      'file online, by phone, by mail or by fax. It is not means-tested — it is compensation for ' +
      'service-connected disability, not aid, and you do not repay it. VA itself recommends working with ' +
      'an accredited representative; see the next entry for why the word "accredited" is load-bearing.',
    eligibility_notes:
      'You need a current condition, an in-service event or exposure, and a link between them — the ' +
      'medical nexus is what claims turn on. A denial is not the end: supplemental claims and appeals ' +
      'are part of the ordinary process. Do not file a bare claim and hope; gather service treatment ' +
      'records and a current diagnosis first, which is exactly what a free VSO will help you do.',
    source_url: 'https://www.va.gov/disability/',
  },
  {
    name: '⚠️ Accredited representatives and VSOs — free help with a VA claim',
    agency: 'U.S. Department of Veterans Affairs',
    mechanism: 'service',
    honest_summary:
      'VA states it plainly: "the services an accredited VSO representative provides on your VA benefit ' +
      'claims are always free." Accredited attorneys and claims agents, by contrast, CAN charge fees. ' +
      'That is the fork in the road. A large industry has grown up charging veterans a percentage of ' +
      'their back pay — often several months of it — for filing a claim a VSO would have filed for ' +
      'nothing, and VA’s own guidance cautions claimants to "exercise caution when selecting a ' +
      'representative." Before you sign anything, check the person in VA’s Accreditation and ' +
      'Recognition Search. If they are not in it, they may not lawfully represent you before VA at all.',
    eligibility_notes:
      'Any veteran or claimant can appoint an accredited VSO representative at no cost; the major ' +
      'veterans organisations and many state and county veterans service offices employ them. ' +
      'Accreditation is required for the sole purpose of representing claimants before VA, and fee ' +
      'agreements must be filed with VA. Practical test before signing: "Are you VA-accredited, what is ' +
      'your accreditation number, and is your fee agreement on file with VA?"',
    source_url: 'https://www.va.gov/get-help-from-accredited-representative/',
  },
  {
    name: 'Post-9/11 GI Bill (Chapter 33)',
    agency: 'U.S. Department of Veterans Affairs',
    mechanism: 'grant',
    honest_summary:
      'Education benefits you earned by serving: the full cost of public in-state tuition and fees, a ' +
      'monthly housing allowance based on the school’s location if you attend more than half-time, and ' +
      'a yearly books and supplies stipend. It also covers tutorial assistance, national exam ' +
      'reimbursement, licensing and certification tests, and work-study. Standard entitlement is 36 ' +
      'months, with up to 48 months available through certain provisions. Not a loan. The housing ' +
      'allowance is the part people underestimate — for many students it is the larger benefit, and it ' +
      'depends on rate of pursuit and on attending in person.',
    eligibility_notes:
      'At least 90 days of active duty after September 10, 2001; or a Purple Heart after that date with ' +
      'an honourable discharge; or 30+ continuous days after that date with an honourable discharge for ' +
      'a service-connected disability; or as a dependent receiving transferred benefits. Time limits ' +
      'depend on discharge date — separated before January 1, 2013 means a 15-year window; later ' +
      'discharges have no expiration under the Forever GI Bill. Licensing and certification test ' +
      'reimbursement is widely unused; ask about it.',
    source_url: 'https://www.va.gov/education/about-gi-bill-benefits/post-9-11/',
  },
  {
    name: 'Veteran Readiness and Employment — VR&E (Chapter 31)',
    agency: 'U.S. Department of Veterans Affairs',
    mechanism: 'service',
    honest_summary:
      'For service members and veterans with service-connected disabilities: help to explore employment ' +
      'options and meet education or training needs. It runs on five tracks — reemployment, rapid access ' +
      'to employment, self-employment, long-term services, and independent living for those for whom ' +
      'work is not currently a realistic goal. It is worth comparing against the GI Bill rather than ' +
      'assuming the GI Bill is the better deal, because Chapter 31 is built around an employment plan ' +
      'and can cover training, equipment and support the GI Bill does not, and it does not consume your ' +
      'Chapter 33 entitlement in the same way. Talk to a VR&E counsellor before choosing.',
    eligibility_notes:
      'For service members and veterans with service-connected disabilities affecting employment; apply ' +
      'through VA.gov, or through the Integrated Disability Evaluation System if you are still on active ' +
      'duty wounded, injured or ill. A Vocational Rehabilitation Counselor determines entitlement and ' +
      'builds the plan with you — the plan is the programme, so what it says is what gets funded.',
    source_url: 'https://www.va.gov/careers-employment/vocational-rehabilitation/',
  },
  {
    name: 'HUD-VASH',
    agency: 'U.S. Department of Housing and Urban Development with the U.S. Department of Veterans Affairs',
    mechanism: 'varies',
    honest_summary:
      'For veterans experiencing homelessness: a HUD Housing Choice Voucher that helps pay rent on a ' +
      'privately owned apartment or house, PAIRED with a VA case manager who provides clinical support ' +
      '(primary care, mental health, substance use treatment), practical help with budgeting and ' +
      'understanding a lease, and long-term follow-up. The pairing is the point — the voucher without ' +
      'the case management is what fails. Over 95,000 formerly homeless veterans were housed through it ' +
      'as of March 2026, with roughly 250,000 served since 2008. The door is the National Call Center ' +
      'for Homeless Veterans, 877-424-3838 — free, confidential, 24 hours a day — which connects you to ' +
      'your nearest VA.',
    eligibility_notes:
      'For veterans experiencing homelessness who need ongoing intensive case management because of more ' +
      'complex challenges, including chronic health conditions that make housing hard to keep. The ' +
      'voucher still has to be used with a landlord who accepts it, which is the real-world bottleneck ' +
      'in tight rental markets — the case manager is there partly for that. Call the line even if you ' +
      'are only at imminent risk rather than already on the street.',
    source_url: 'https://department.va.gov/homeless/hud-vash/',
  },
  {
    name: 'Specially Adapted Housing (SAH) and Special Home Adaptation (SHA) grants',
    agency: 'U.S. Department of Veterans Affairs',
    mechanism: 'grant',
    honest_summary:
      'These are GRANTS, not loans — you do not repay them. They pay to buy, build or modify a permanent ' +
      'home so a veteran with a severe service-connected disability can live in it. For fiscal year ' +
      '2026 the SAH maximum is $126,526 and the SHA maximum is $25,350. You do not have to spend it all ' +
      'at once: the money can be used across multiple adaptations over a lifetime, up to the total. A ' +
      'common misunderstanding is that you must already own a suitable home — the grant can go toward ' +
      'buying or building one.',
    eligibility_notes:
      'You must own or will own the home (for SHA a family member may own it) and have a qualifying ' +
      'service-connected disability — limb loss, blindness in both eyes, severe burns, certain ' +
      'respiratory injuries, among others. One narrow category is rationed: only 120 veterans and ' +
      'service members each fiscal year can qualify based on the loss of one lower extremity after ' +
      'September 11, 2001. Apply early in the fiscal year if that is your basis.',
    source_url: 'https://www.va.gov/housing-assistance/disability-housing-grants/',
  },

  // ── LEGAL AND CONSUMER ──────────────────────────────────────────────────────────────────────────
  {
    name: 'LSC-funded civil legal aid',
    agency: 'Legal Services Corporation and its 129 grantee legal aid organizations',
    mechanism: 'service',
    honest_summary:
      'Free lawyers for civil problems — eviction, foreclosure, custody, child support, domestic ' +
      'violence protection, veterans benefits, employment, and access to benefits such as Medicare and ' +
      'Social Security. LSC is the largest funder of civil legal services in the United States and ' +
      'funds 129 independent non-profit legal aid organisations covering every state, DC and the ' +
      'territories. This is the single most valuable free thing available to someone facing eviction ' +
      'next week. It is CIVIL only — a criminal charge goes to a public defender instead, which is a ' +
      'different and separate right. Find your local office through the LSC locator.',
    eligibility_notes:
      'Under 45 C.F.R. § 1611.3, every LSC recipient must set annual income ceilings that may not ' +
      'exceed 125% of the federal poverty guidelines, with limited authority to serve applicants up to ' +
      '200% on specified factors — so being slightly over the line is worth a phone call rather than an ' +
      'assumption. Offices are overwhelmed and triage by urgency: say the words "I have an eviction ' +
      'hearing on [date]" at the start of the call, not the end.',
    source_url: 'https://www.lsc.gov/about-lsc/what-legal-aid/get-legal-help',
  },
  {
    name: 'Proceeding in forma pauperis — 28 U.S.C. § 1915',
    agency: 'Federal courts (statute)',
    mechanism: 'service',
    honest_summary:
      'You can begin a civil or criminal action in a federal court WITHOUT prepaying fees if you file an ' +
      'affidavit showing you cannot afford them. Being broke does not close the courthouse. The same ' +
      'section lets a court request that an attorney represent someone unable to afford counsel. Two ' +
      'honest limits: prisoners are treated differently and must still pay the filing fee over time out ' +
      'of their trust account (an initial 20% of average monthly deposits, then 20% of the prior ' +
      'month’s income monthly), and a prisoner with three prior dismissals as frivolous or meritless ' +
      'generally loses IFP access unless in imminent danger of serious physical injury. Courts can also ' +
      'dismiss a case they find frivolous or failing to state a claim.',
    eligibility_notes:
      'File the affidavit of financial inability with your complaint; prisoners must add a certified ' +
      'trust fund account statement for the preceding six months. Waiver of prepayment is not waiver of ' +
      'the case’s merits, and it does not pay for a lawyer by itself. State courts have their own ' +
      'separate fee waiver process — see the next entry.',
    source_url: 'https://www.govinfo.gov/content/pkg/USCODE-2023-title28/html/USCODE-2023-title28-partV-chap123-sec1915.htm',
  },
  {
    name: 'State court fee waivers and self-help centers (example: California)',
    agency: 'State courts — example verified: Judicial Council of California',
    mechanism: 'service',
    honest_summary:
      'Every state has some version of this: if you cannot afford court filing fees, you ask the court to ' +
      'waive them, and applying for the waiver is itself free. In California you qualify by meeting ANY ' +
      'ONE of three tests — you receive public benefits (unemployment, Medi-Cal, CalFresh, WIC, ' +
      'CalWORKs, SSI/SSP or similar), your household income is below the threshold printed on form ' +
      'FW-001, or you cannot afford both basic household needs and the filing fee. The court answers on ' +
      'form FW-003. Court self-help centers are free and will help you understand an order and what to ' +
      'do next. What the waiver does NOT cover: lawyer fees, court reporter transcripts and fines. It ' +
      'expires 60 days after judgment, dismissal or final decision.',
    eligibility_notes:
      'The public-benefits route is the fastest — if you are on one of the listed programmes, you do not ' +
      'have to argue about income at all. Forms and thresholds differ in every state; ask the clerk of ' +
      'the court you are filing in for "the fee waiver form" and ask where the self-help center is. ' +
      'Self-help center staff cannot be your lawyer and cannot give legal advice, but they can tell you ' +
      'which form and which deadline, which is often the whole problem.',
    source_url: 'https://selfhelp.courts.ca.gov/fee-waiver',
  },
  {
    name: 'Free credit reports at AnnualCreditReport.com',
    agency: 'Federal Trade Commission (site operated by the three nationwide credit bureaus under federal law)',
    mechanism: 'service',
    honest_summary:
      'AnnualCreditReport.com is the ONLY site authorised to give you the free credit reports federal law ' +
      'entitles you to. Equifax, Experian and TransUnion each must give you one free report every 12 ' +
      'months, and the bureaus have made weekly free reports permanently available through that site. ' +
      'You can also call 1-877-322-8228 or mail the request form to P.O. Box 105281, Atlanta, GA ' +
      '30348-5281. ⚠️ The FTC warns that many imposter sites use similar names or misspelled URLs ' +
      'and exist to sell you services or to collect and misuse your personal information. Requesting ' +
      'your own report does NOT hurt your credit score — that belief is why people avoid checking.',
    eligibility_notes:
      'Everyone is entitled; there is no income test and no charge. Pull all three reports, because each ' +
      'bureau holds different information from different furnishers. A legitimate bureau will not email ' +
      'you asking for your Social Security number or account details. If a site asks for a credit card, ' +
      'you are on the wrong site.',
    source_url: 'https://consumer.ftc.gov/articles/free-credit-reports',
  },
  {
    name: 'Disputing a credit report error — FCRA § 611, 15 U.S.C. § 1681i',
    agency: 'Congress / Consumer Financial Protection Bureau (statute and guidance)',
    mechanism: 'service',
    honest_summary:
      'You have a statutory right to dispute anything incomplete or inaccurate in your credit file, and ' +
      'the reinvestigation is by law "free of charge." The agency must conduct a reasonable ' +
      'reinvestigation within 30 days (extendable by 15 if you supply more information during that ' +
      'window), must notify the furnisher within 5 business days, and must PROMPTLY DELETE or modify ' +
      'information it cannot verify or finds inaccurate. Deleted information cannot be reinserted unless ' +
      'the furnisher certifies it is accurate. ⚠️ This is the exact service credit repair companies ' +
      'sell. The CFPB says it directly: there is no need to pay a credit repair company to do this for ' +
      'you. Dispute with the bureau in writing with documents, and separately with the furnisher — the ' +
      'bank or collector that reported it.',
    eligibility_notes:
      'Open to every consumer, no fee. You may also add a statement of dispute to your file if the ' +
      'investigation goes against you. Veterans have a simplified route for disputing medical debt using ' +
      'VA documentation. Keep copies and send by a method that proves delivery — the 30-day clock runs ' +
      'from receipt. If it is not resolved, file a CFPB complaint (next entry), or go to ' +
      'IdentityTheft.gov if identity theft is involved. Accurate negative information cannot be removed ' +
      'by anyone, at any price.',
    source_url: 'https://www.govinfo.gov/content/pkg/USCODE-2023-title15/html/USCODE-2023-title15-chap41-subchapIII-sec1681i.htm',
  },
  {
    name: 'CFPB consumer complaint',
    agency: 'Consumer Financial Protection Bureau',
    mechanism: 'service',
    honest_summary:
      'A free complaint that a company has to answer. The CFPB routes your complaint to the company and ' +
      'most companies respond within 15 days, with up to 60 days where a response is still in progress. ' +
      'Covered: checking and savings accounts, credit cards, credit reports, debt collection, mortgages, ' +
      'payday loans, personal loans, prepaid cards, student loans, vehicle loans and leases, money ' +
      'transfers and virtual currency. Submitting online usually takes under ten minutes. This is the ' +
      'lever that most often produces an actual response from a company that has been ignoring you — it ' +
      'is not a guarantee of the outcome you want, but the company is answering on a public record.',
    eligibility_notes:
      'Anyone; no cost, no eligibility test. You get email updates and can track status. Complaints are ' +
      'published in anonymised form in the Consumer Complaint Database. Write it with dates, dollar ' +
      'amounts and account numbers — a vague complaint gets a vague answer. Use this alongside, not ' +
      'instead of, a written dispute to the company itself.',
    source_url: 'https://www.consumerfinance.gov/complaint/',
  },
  {
    name: 'ReportFraud.ftc.gov',
    agency: 'Federal Trade Commission, Bureau of Consumer Protection',
    mechanism: 'service',
    honest_summary:
      'The FTC’s reporting channel for scams and businesses that did not make good on their promises. ' +
      'Be clear about what it is and is not: the FTC does NOT resolve individual consumer complaints. ' +
      'In its own words, it shares reports with law enforcement partners and uses them "to investigate ' +
      'fraud and eliminate unfair business practices." So reporting protects the next person and builds ' +
      'the case that eventually shuts an operation down — it does not get your money back. For money ' +
      'back from a financial product, the CFPB complaint above is the route that makes a company answer ' +
      'you; for a local business, your state attorney general’s consumer division is the next entry.',
    eligibility_notes:
      'Anyone can report; no eligibility test. Report even when you did not lose money and even when you ' +
      'feel foolish — pattern data is the entire value. Keep your own evidence (screenshots, receipts, ' +
      'phone numbers), because you will need it for the channels that can actually recover funds.',
    source_url: 'https://www.ftc.gov/about-ftc/bureaus-offices/bureau-consumer-protection',
  },
  {
    name: 'State consumer protection offices and state attorneys general',
    agency: 'State attorneys general and state consumer protection offices (directory at USA.gov)',
    mechanism: 'service',
    honest_summary:
      'Every state, DC and the territories has a consumer protection office, usually inside the state ' +
      'attorney general’s office, handling complaints against businesses and investigating scams and ' +
      'fraud. These are the people with subpoena power in your state, and unlike the federal agencies ' +
      'they will often mediate an individual dispute with a local business. Use them for landlords, ' +
      'contractors, car dealers, debt collectors and any business physically in your state. USA.gov ' +
      'keeps the directory of all of them, which saves you guessing the URL.',
    eligibility_notes:
      'Open to residents; no cost. They enforce state consumer law, so what they can do varies by state ' +
      '— some have strong mediation programmes, some primarily gather complaints for enforcement. Many ' +
      'states also license contractors and debt collectors, so the same office can tell you whether the ' +
      'business is licensed at all, which is frequently the fastest answer.',
    source_url: 'https://www.usa.gov/state-consumer',
  },
  {
    name: '⚠️ Unclaimed property — free at your state office (NAUPA / MissingMoney)',
    agency: 'State unclaimed property offices, through the National Association of Unclaimed Property Administrators',
    mechanism: 'service',
    honest_summary:
      'Searching for unclaimed property is free, and NAUPA says so on its own front page: "Search for ' +
      'your unclaimed property (it’s free)," through MissingMoney.com, "a free website, managed by ' +
      'NAUPA." ⚠️ Finder and heir-finder firms charge a percentage to tell you what that free search ' +
      'would have told you in two minutes, and most states cap what a finder may lawfully charge. Search ' +
      'your own state’s official office first and then every state you have ever lived or worked in — ' +
      'old deposits, final paychecks, insurance refunds and forgotten accounts are the usual finds. ' +
      'Filing the claim is free too.',
    eligibility_notes:
      'No eligibility test. You will need identification and proof of your connection to the address or ' +
      'account on file, which is why old addresses matter — search every variation of your name and ' +
      'every former address. Claims for a deceased relative’s property require estate documentation. ' +
      'If a letter arrives offering to recover money "you may be owed" for a share, search the state ' +
      'site yourself before signing.',
    source_url: 'https://www.unclaimed.org/',
  },
  {
    name: '⚠️ Debt relief, credit counseling, and the advance-fee rule',
    agency: 'Federal Trade Commission',
    mechanism: 'service',
    honest_summary:
      'The FTC’s position is unambiguous: "You don’t need to pay a company to talk to your credit card ' +
      'company on your behalf — you can do it yourself, for free," and for student loans the free ' +
      'services exist through official government channels. On fees: "Only scammers will try to collect ' +
      'fees from you before they settle any of your debts." A telemarketed debt relief company may not ' +
      'charge until a debt is actually settled, and then only as a proportionate share as each ' +
      'creditor agreement is finalised. For counselling, the FTC points to credit unions, universities ' +
      'and Cooperative Extension branches, and says a reputable counsellor will review your whole ' +
      'finances before recommending any plan. Ask for the fee in dollars, up front.',
    eligibility_notes:
      'Nothing to qualify for — this is the rule set that governs anyone selling you debt help. Red ' +
      'flags in order of seriousness: a fee demanded before any debt is settled; a guarantee that debts ' +
      'will be gone; advice to stop talking to your creditors; refusal to state the fee in dollars. ' +
      'A non-profit agency should be able to tell you its 501(c)(3) status and whether creditors pay it.',
    source_url: 'https://consumer.ftc.gov/articles/how-get-out-debt',
  },
  // ── THE SUBSTITUTION ENTRIES ─────────────────────────────────────────────────────────────────────
  // Added 2026-09-14. Each of these exists because a commercial app monetises the gap between what a
  // person is shown and the free federal thing it is derived from. The pattern is always the same: quote
  // a real federal maximum, omit that it is an entitlement you claim for free, and sell the lead.
  {
    name: 'Federal Pell Grant',
    agency: 'U.S. Department of Education, Federal Student Aid',
    mechanism: 'grant',
    honest_summary:
      'If you have been shown an advert offering "up to $7,395 in educational grants if you qualify," ' +
      'that number is the FEDERAL PELL GRANT MAXIMUM. Pell is a federal grant you do not repay, and the ' +
      'ONLY way to get it is to file the FAFSA, which is FREE at studentaid.gov. No company can get you ' +
      'Pell, increase your Pell, or qualify you for Pell. Sites that quote that figure are lead ' +
      'generators paid by schools for your contact details. File the FAFSA yourself; it costs nothing.',
    eligibility_notes:
      'Undergraduate, no prior bachelor\'s degree, demonstrated financial need per the FAFSA, enrolled ' +
      'or accepted at a participating school, valid SSN, satisfactory academic progress. The maximum ' +
      'changes each award year — check the current figure at studentaid.gov rather than trusting an advert.',
    source_url: 'https://studentaid.gov/understand-aid/types/grants/pell',
  },
  {
    name: 'Nonprofit Credit Counseling (NFCC member agencies)',
    agency: 'National Foundation for Credit Counseling (nonprofit network)',
    mechanism: 'service',
    honest_summary:
      'If you have been shown "debt settlement" offers quoting a 14%-25% ENROLLMENT FEE, understand what ' +
      'that fee is: a percentage of the debt you enroll, paid to a for-profit company. A nonprofit credit ' +
      'counselling agency will review your whole budget at no charge, and a debt management plan typically ' +
      'costs a small monthly administrative fee rather than a percentage of the balance. Know also that ' +
      'under the FTC Telemarketing Sales Rule, 16 C.F.R. section 310.4(a)(5), a debt relief company that ' +
      'sells to you by telephone may NOT collect any fee before it has actually settled a debt. Several ' +
      'states bar the practice outright, which is why those offers list state exclusions.',
    eligibility_notes:
      'Open to anyone; no minimum debt. Initial counselling session is free. Ask any agency whether it is ' +
      'a 501(c)(3), what the monthly fee is in dollars, and whether it is paid by the creditors.',
    source_url: 'https://www.nfcc.org/',
  },
  {
    name: 'Unclaimed Property — your State Treasurer',
    agency: 'State unclaimed property offices (via NAUPA / MissingMoney)',
    mechanism: 'service',
    honest_summary:
      'If you have been shown "the government may owe you unclaimed funds," that is true and the search ' +
      'is FREE. Every state runs an unclaimed property office and searching it costs nothing. Finder ' +
      'services charge a percentage to tell you what a free search would have told you, and most states ' +
      'cap what a finder may charge. Search your own state first, and every state you have lived in.',
    eligibility_notes:
      'No eligibility test. You will need identification and proof of your connection to the address or ' +
      'account on file. Claims are free to file in every state.',
    source_url: 'https://www.usa.gov/unclaimed-money',
  },
  {
    name: 'USDA NRCS EQIP — Seasonal High Tunnel (Practice 325)',
    agency: 'USDA Natural Resources Conservation Service',
    mechanism: 'cost-share-reimbursement',
    honest_summary:
      'USDA pays for most of a greenhouse on your land — but this is a COST-SHARE, not free money, and ' +
      'the order of operations decides whether you get paid. Up to 75% of estimated costs incurred ' +
      '(7 CFR 1466.23(b)(1)(i)). A HISTORICALLY UNDERSERVED producer — beginning, veteran, socially ' +
      'disadvantaged, or limited-resource — gets the applicable rate PLUS not less than 25 percentage ' +
      'points, capped at 90% (1466.23(b)(3)), AND may receive an ADVANCE PAYMENT of at least 50% and up ' +
      'to 100% of anticipated costs BEFORE building (1466.24(d)(1)). For those producers the pay-first ' +
      'problem largely disappears, and NRCS is required to tell you about the advance at enrollment ' +
      '(1466.5(d)) — if nobody did, ask in writing. Dollars per square foot are set in your STATE payment ' +
      'schedule, re-evaluated yearly; roughly $6–$12/sq ft is typical but the real number and any ' +
      'square-footage cap come from your state office, not from a national figure. Drip irrigation, ' +
      'mulching and drainage can be funded in the same contract.',
    eligibility_notes:
      'Must control the land, have a farm number from USDA FSA (free), and sign the EQIP contract ' +
      'BEFORE construction begins — there is no payment authority for work done before the contract ' +
      '(7 CFR 1466.21(a)). Applications are continuous but funded at state ranking dates. Advance ' +
      'payments require an NRCS-approved practice design first and must be spent within 90 days.',
    source_url: 'https://www.nrcs.usda.gov/programs-initiatives/eqip-environmental-quality-incentives',
  },
  {
    name: 'SARE Farmer/Rancher Grants',
    agency: 'USDA NIFA via the four regional SARE offices',
    mechanism: 'grant',
    honest_summary:
      'A real grant with a working farmer\'s own name on the award — the rarest thing on this page. North ' +
      'Central: $15,000 individual / $30,000 team, about 40 funded a year. Northeast: $5,000–$30,000. ' +
      'Southern ("Producer Grants"): $20,000 individual / $25,000 organization. Western: up to $35,000. ' +
      'It funds RESEARCH on your farm — your time, materials, soil tests, consulting, outreach. It will ' +
      'NOT buy the barn or the greenhouse; that is EQIP. Pairing a SARE grant with an EQIP high tunnel is ' +
      'the most useful combination in USDA farm funding.',
    eligibility_notes:
      'The bar is low: about $1,000 of annual farm sales (the Census of Agriculture farm definition). No ' +
      'restriction on farm size or years farming, and FARM EMPLOYEES are eligible in the Northeast and ' +
      'Southern regions. Paid by reimbursement — Northeast states plainly that advance payments are not ' +
      'possible. Southern calls open in September, awards in February.',
    source_url: 'https://www.sare.org/grants/',
  },
  {
    name: 'REAP — Rural Energy for America Program',
    agency: 'USDA Rural Development',
    mechanism: 'grant',
    honest_summary:
      'A grant for renewable energy ($2,500–$1,000,000) or energy efficiency ($1,500–$500,000) on a farm ' +
      'or rural small business. The federal share is 25% of project cost for most projects; 50% only if ' +
      'the project is a zero-greenhouse-gas system, in an Energy Community under 26 U.S.C. 45(b)(11)(B), ' +
      'an energy efficiency improvement, or from an eligible Tribal entity. Accepted year-round at your ' +
      'local office — there is no deadline to miss. There is also a separate REAP loan guarantee; that is ' +
      'borrowed money and a different thing.',
    eligibility_notes:
      'Agricultural producers with at least 50% of gross income from the ag operation, or small businesses ' +
      'in areas of 50,000 residents or fewer. Producers may site projects in non-rural areas if tied to an ' +
      'on-site production operation. No delinquent federal taxes, debt, judgment or debarment. Efficiency ' +
      'projects need an energy audit. EVERY project needs an environmental review BEFORE award or ' +
      'construction — installing first is how people lose a REAP grant. 7 CFR Part 4280.',
    source_url: 'https://www.rd.usda.gov/programs-services/energy-programs/rural-energy-america-program-renewable-energy-systems-energy-efficiency-improvement-guaranteed-loans',
  },
  {
    name: 'OCCSP — Organic Certification Cost Share',
    agency: 'USDA Farm Service Agency (or a participating state agency)',
    mechanism: 'cost-share-reimbursement',
    honest_summary:
      'The closest thing to free money on this page: 75% of your organic certification costs back, up to ' +
      '$750 per certification scope, and there are five scopes (crops, wild crops, livestock, ' +
      'processing/handling, state organic program fees). Non-competitive — no ranking, no match, no ' +
      'proposal. You paid a certifier, you send FSA the receipts, you get paid. Anyone charging a fee to ' +
      '"file your OCCSP" is charging you to fill in a short form at a county office.',
    eligibility_notes:
      'Certified organic operations. Eligible costs include application and administrative fees, ' +
      'inspection fees and inspector travel/per diem, state organic program fees, user fees and sales ' +
      'assessments, and postage for certification materials. Deadline 31 December 2026 covers BOTH the ' +
      '2025 and 2026 program years. Apply at your local USDA Service Center or a participating state ' +
      'agency — not both for the same scope.',
    source_url: 'https://www.fsa.usda.gov/resources/programs/organic-certification-cost-share-program-occsp',
  },
  {
    name: 'VAPG — Value-Added Producer Grants',
    agency: 'USDA Rural Development',
    mechanism: 'grant',
    honest_summary:
      'A grant to turn your raw commodity into something worth more — jam from your berries, cheese from ' +
      'your milk, flour from your grain. Planning grants up to $50,000; working-capital grants up to ' +
      '$200,000. The catch is a 1:1 MATCH — you must bring dollar for dollar, cash or eligible in-kind. ' +
      'Annual cycle, roughly $25 million nationally.',
    eligibility_notes:
      'You must own and produce more than 50% of the raw commodity and show the value-added product will ' +
      'return greater revenue than the raw one. 10% of funds are reserved for beginning, veteran and ' +
      'socially disadvantaged farmers, mid-tier value chains and market-access food-safety projects. RD ' +
      'advises contacting your state program official first: preparation runs from a few weeks to several ' +
      'months. 7 CFR Part 4284 Subpart J.',
    source_url: 'https://www.rd.usda.gov/programs-services/business-programs/value-added-producer-grants',
  },
  {
    name: 'SCBGP — Specialty Crop Block Grants (through your state)',
    agency: 'USDA AMS, sub-awarded by state departments of agriculture',
    mechanism: 'grant',
    honest_summary:
      'A grant for fruit, vegetable, tree nut, dried fruit, horticulture and nursery/floriculture work — ' +
      'with NO federal cost-sharing or matching requirement, which almost no other USDA competitive grant ' +
      'can say. You do not apply to USDA. Applications go to your STATE department of agriculture, which ' +
      'runs its own competition on its own calendar against its own priorities — a smaller field than a ' +
      'national one.',
    eligibility_notes:
      'Individuals and other non-federal entities apply through the appropriate state department of ' +
      'agriculture. AMS posts the annual list of state RFPs; each state publishes its own request for ' +
      'proposals with its own deadline.',
    source_url: 'https://www.ams.usda.gov/services/grants/scbgp',
  },
  {
    name: 'CRP — Conservation Reserve Program (annual rent on your own land)',
    agency: 'USDA Farm Service Agency',
    mechanism: 'varies',
    honest_summary:
      'Not a grant, not a loan, not cost-share — a RENTAL PAYMENT. You take environmentally sensitive ' +
      'acreage out of production, plant resource-conserving cover, and FSA pays you annually for the ' +
      'contract term, plus cost-share to establish the cover. Continuous, General, Grassland and CREP ' +
      'signups run on separate calendars; the Grassland signup is usually the widest door.',
    eligibility_notes:
      'Offers go to your local FSA office. Re-enrollment of expiring continuous acreage is first-come, ' +
      'first-served; new continuous acreage is first-come, first-served subject to available acres and ' +
      'USDA conservation priorities (filter strips, grass waterways, native ecosystem restoration). FSA ' +
      'cannot guarantee acceptance of a continuous offer. Related: CREP, Farmable Wetlands, CRP ' +
      'Grasslands, the Transition Incentives Program.',
    source_url: 'https://www.fsa.usda.gov/resources/conservation/conservation-reserve-program',
  },
  {
    name: 'CSP — Conservation Stewardship Program',
    agency: 'USDA Natural Resources Conservation Service',
    mechanism: 'varies',
    honest_summary:
      'ANNUAL PAYMENTS across your whole operation for stewardship — it pays partly for what you already ' +
      'do, not only for new construction, which makes it different from EQIP. Minimum $4,000 annual ' +
      'payment for most participants in any year the total falls below it. Contract cap $200,000 over the ' +
      'term, $400,000 for a joint operation. Cover crop activities are paid at not less than 125% of the ' +
      'annual amount; resource-conserving crop rotation and advanced grazing carry supplemental payments ' +
      'at not less than 150%.',
    eligibility_notes:
      'Five-year contract, renewable once in year five — to renew you must agree to address two ' +
      'additional priority resource concerns or reach higher levels on two existing ones. Continuous ' +
      'application, funded at state ranking dates. 7 CFR Part 1470.',
    source_url: 'https://www.nrcs.usda.gov/programs-initiatives/csp-conservation-stewardship-program',
  },
  {
    name: 'NRCS Conservation Technical Assistance — a free conservation plan',
    agency: 'USDA Natural Resources Conservation Service',
    mechanism: 'service',
    honest_summary:
      'A professional conservation planner walks your land with you and writes an engineering-and-agronomy ' +
      'plan for your specific acres — resource assessment, practice design, resource monitoring — at NO ' +
      'COST, and you are under no obligation to enroll in any program afterwards. People pay consultants ' +
      'for a weaker version of this document. Ask for it before you apply for anything, because it is what ' +
      'the applications are built on.',
    eligibility_notes:
      'Farmers, ranchers and forestland owners. Walk into your local NRCS field office — typically in the ' +
      'same building as the FSA office. Certified Technical Service Providers can do design work too, and ' +
      'where a TSP is written into an EQIP contract the technical services may be paid out of the ' +
      'contract rather than out of your pocket (7 CFR 1466.21(a)).',
    source_url: 'https://www.nrcs.usda.gov/getting-assistance',
  },
  {
    name: 'USDA FSA Farm Number — free, and the key to everything else',
    agency: 'USDA Farm Service Agency',
    mechanism: 'service',
    honest_summary:
      'A farm number costs nothing and you cannot receive NRCS or FSA financial assistance without one. ' +
      'It is also required for lending, disaster programs and county committee participation. Get it ' +
      'first; every other program on this farm list assumes you have it.',
    eligibility_notes:
      'Free at your local FSA office. HEIRS\' PROPERTY: the 2018 Farm Bill authorized alternative ' +
      'documentation, so an operator who cannot provide owner verification or a lease may submit other ' +
      'documents substantiating general control of the farming operation.',
    source_url: 'https://www.farmers.gov/working-with-us/heirs-property-eligibility',
  },
  {
    name: 'Cooperative Extension — free county-level expertise',
    agency: 'USDA NIFA and the land-grant university system',
    mechanism: 'service',
    honest_summary:
      'More than 100 land-grant colleges are obligated to share research-based knowledge with EVERY county ' +
      'in the United States, through county Extension agents — a public system from the Smith-Lever Act ' +
      'of 1914 that most people never use. Soil testing is the classic service: some states test free for ' +
      'residents, most charge a modest per-sample fee, and a commercial lab is usually the expensive way ' +
      'to get the same answer. Call the county office before you pay anyone.',
    eligibility_notes:
      'Open to the public. Find yours through the NIFA Land-grant University Website Directory. If a soil ' +
      'test is part of a funded project, SARE explicitly allows it as a project cost.',
    source_url: 'https://www.nifa.usda.gov/about-nifa/how-we-work/extension/cooperative-extension-system',
  },
  {
    name: 'ATTRA / NCAT — free national sustainable-agriculture helpline',
    agency: 'National Center for Appropriate Technology, under an agreement with USDA Rural Development',
    mechanism: 'service',
    honest_summary:
      'Agriculture specialists answer roughly 35,000 farmers a year — regenerative grazing, organic ' +
      'production, marketing strategy, climate resilience — free to the farmer, since 1987. Hands-on ' +
      'technical assistance, not a brochure.',
    eligibility_notes: 'Open to any farmer or rancher. Phone, email and a large free multimedia library.',
    source_url: 'https://attra.ncat.org/',
  },
  {
    name: 'USDA 2501 grantees — the organization funded to do your paperwork, free',
    agency: 'USDA Office of Partnerships and Public Engagement (2501 Program grantees)',
    mechanism: 'service',
    honest_summary:
      'Read this one correctly: the 2501 Program does NOT give money to individual farmers. It pays ' +
      'community organizations, nonprofits, universities and Tribal entities — about $22.3 million in ' +
      'FY2024, more than $194 million across 615 grants since 2010 — whose entire job is helping ' +
      'underserved and veteran farmers own and operate successful farms. So your play is not to apply. ' +
      'It is to find the 2501 grantee near you and use them, because they are already paid to sit down ' +
      'with you and fill out the application. The same is true of BFRDP grantees, which fund beginning-' +
      'farmer training organizations rather than farmers.',
    eligibility_notes:
      'Underserved and veteran farmers and ranchers. Ask USDA OPPE (partnerships@usda.gov, 202-720-6350) ' +
      'or search grants.gov award records for the 2501 grantee serving your state.',
    source_url: 'https://www.usda.gov/about-usda/general-information/staff-offices/office-partnerships-and-public-engagement',
  },
  {
    name: 'NAP — Noninsured Crop Disaster Assistance',
    agency: 'USDA Farm Service Agency',
    mechanism: 'insurance',
    honest_summary:
      'INSURANCE YOU BUY, for crops with no federal crop insurance available — fruits, vegetables, ' +
      'aquaculture, floriculture, mushrooms, turfgrass, ginseng, honey, maple sap. Catastrophic coverage ' +
      'is 50% of approved yield at 55% of average market price; buy-up goes to 65% of yield at 100% of ' +
      'price with an added premium. Service fee $325 per crop per county, capped at $825 per producer per ' +
      'county or $1,950 across counties.',
    eligibility_notes:
      'You must apply by the CROP-SPECIFIC closing date — miss it and there is no coverage, with no ' +
      'remedy. The recurring trap across all FSA disaster programs is the acreage report: file it on ' +
      'time or the loss is not payable.',
    source_url: 'https://www.fsa.usda.gov/resources/programs/noninsured-crop-disaster-assistance-program-nap',
  },
  {
    name: 'SBA 7(a) Loan',
    agency: 'U.S. Small Business Administration',
    mechanism: 'loan',
    honest_summary:
      'A LOAN — you repay it with interest. The SBA does not hand you cash; it guarantees a bank loan so ' +
      'a lender is more willing to approve you. There is no "SBA grant" version of this. Calling it free ' +
      'money is simply wrong.',
    eligibility_notes:
      'For-profit US small business, owner-invested equity, demonstrated repayment ability; applied for ' +
      'through an SBA-approved lender, not the SBA directly.',
    source_url: 'https://www.sba.gov/funding-programs/loans/7a-loans',
  },
  {
    name: 'SBA Microloan',
    agency: 'U.S. Small Business Administration',
    mechanism: 'loan',
    honest_summary:
      'A LOAN of up to $50,000 (average around $13,000), made through nonprofit intermediary lenders — ' +
      'you repay it with interest. Useful for startups and small needs, but it is borrowed money, not a ' +
      'grant.',
    eligibility_notes:
      'Apply through an SBA-approved nonprofit microlender; terms and credit requirements set by the ' +
      'intermediary. Repaid over up to ~6 years.',
    source_url: 'https://www.sba.gov/funding-programs/loans/microloans',
  },
  {
    name: 'Grants.gov — Federal Grant Opportunities',
    agency: 'Grants.gov (cross-agency)',
    mechanism: 'grant',
    honest_summary:
      'Real grants you do not repay — but they are competitive and tightly eligibility-gated, and most ' +
      'are for organizations, governments, and researchers rather than individuals. "Free money for ' +
      'anyone" is a myth; read each opportunity\'s eligibility section.',
    eligibility_notes:
      'Eligibility varies per opportunity (nonprofits, states/locals, tribes, institutions, sometimes ' +
      'individuals). Requires SAM.gov registration for most awards.',
    source_url: 'https://www.grants.gov/',
  },
  {
    name: 'Benefits.gov — Benefit Programs Finder',
    agency: 'Benefits.gov (cross-agency)',
    mechanism: 'varies',
    honest_summary:
      'A finder across hundreds of federal/state benefit programs. What you get VARIES wildly — some are ' +
      'assistance payments, many are services, loans, or tax credits. The tool tells you what you may ' +
      'qualify for; it does not mean cash will be mailed to you.',
    eligibility_notes:
      'Each linked program has its own income, household, status, and residency rules. The finder is a ' +
      'screening tool, not an application or an entitlement.',
    source_url: 'https://www.benefits.gov/',
  },
  {
    name: 'SCORE Mentoring',
    agency: 'SCORE (SBA resource partner)',
    mechanism: 'service',
    honest_summary:
      'Free expert business mentoring — NOT money. Experienced volunteers help you plan, but no funds ' +
      'change hands. Valuable, free, and honest about being a service rather than a grant.',
    eligibility_notes: 'Open to any US small business owner or aspiring entrepreneur. Free of charge.',
    source_url: 'https://www.score.org/',
  },
];

// ── classifyMechanism(text) — infer the mechanism from program text (pure, keyword heuristics) ────────
// Order matters: the most truth-protecting / most specific signals win. A program that says "free" but
// also "repay" is a LOAN — the loan signal must beat the free-money framing.
export function classifyMechanism(text) {
  const t = str(text).toLowerCase();
  if (!t) return 'varies';
  // Cost-share / reimbursement — you pay first.
  if (/reimburs|cost[\s-]?share|pay first|after (?:inspection|completion|installation)|advance payment/.test(t)) {
    return 'cost-share-reimbursement';
  }
  // Grant escape hatch: "no repayment" / "does not have to be repaid" / "forgivable" is a GRANT signal,
  // not a loan — check it before the loan keywords so "no repayment required" isn't read as a loan.
  if (/no repayment|do(?:es)? not (?:have to )?(?:be )?repaid|not repaid|forgivable/.test(t)) return 'grant';
  // Loan — you repay, with interest. Beats any "free money" wording in the same text.
  if (/\bloan\b|repay|repaid|interest rate|amortiz|principal|borrow|lender|guaranteed by the sba/.test(t)) {
    return 'loan';
  }
  // Tax credit.
  if (/tax credit|tax[\s-]?deduction|reduces? (?:your )?tax|offset.*tax/.test(t)) return 'tax-credit';
  // Insurance.
  if (/\binsurance\b|premium|indemnity|risk coverage|crop insurance/.test(t)) return 'insurance';
  // Free service / mentoring / advising — help, not money.
  if (/mentor|advising|counsel|technical assistance|free (?:help|service|training|consult)/.test(t)) {
    return 'service';
  }
  // Grant — money you don't repay. Require an award-ish signal, not just the word "free".
  if (/\bgrant\b|award(?:ed)?|stipend|no repayment|do(?:es)? not (?:have to )?(?:be )?repay|forgivable/.test(t)) {
    return 'grant';
  }
  return 'varies';
}

// ── classifyProgram(p) — the TRUTH-TELLING classifier (v3 §3) → { kind, honestSummary } ───────────────
// Given a loose program object {name, agency, summary/description/honest_summary, mechanism, ...}, infer
// the program's KIND from the task's restricted vocabulary and write a plain-English honest summary that
// states what the money ACTUALLY is. `kind` ∈ 'grant' | 'loan' | 'cost-share-reimbursement' |
// 'tax-credit' | 'other' (mechanisms outside this set — service / insurance / varies — fold into 'other').
//
// Keyword/agency rules:
//   • USDA NRCS EQIP / high tunnel / conservation cost-share → cost-share-reimbursement. THE canonical
//     case: you sign the contract FIRST, build, then get REIMBURSED only after it passes inspection —
//     encoded here verbatim so the navigator can never mislabel it "free money."
//   • SBA loans / "loan" / repay / interest → loan (beats any "free money" framing).
//   • "tax credit" → tax-credit.  Award/grant signals → grant.  Everything else → other.
const KIND_SET = new Set(['grant', 'loan', 'cost-share-reimbursement', 'tax-credit', 'other']);

// Plain-English honest summary per kind (used when the program doesn't carry its own honest_summary).
const KIND_SUMMARY = {
  grant: 'A grant — money you do not repay — but competitive and tightly eligibility-gated, often for ' +
    'organizations rather than individuals. Read the eligibility section; "free money for anyone" is a myth.',
  loan: 'A LOAN — you repay it, with interest. This is borrowed money, not a gift. There is no ' +
    '"free money" version of a loan.',
  'cost-share-reimbursement': 'A COST-SHARE you are REIMBURSED for AFTER you build and pass inspection — ' +
    'you pay out of pocket first, and you must sign the contract BEFORE you build. Not free money.',
  'tax-credit': 'A TAX CREDIT — it reduces the taxes you owe. No cash is handed to you up front.',
  other: 'Not a simple cash grant — this may be a service, insurance, or a mixed program. Check the ' +
    'specific terms at the source before assuming money will come to you.',
};

export function classifyProgram(p = {}) {
  const obj = p || {};
  const name = str(obj.name || obj.title);
  const agency = str(obj.agency);
  const text = [name, agency, obj.honest_summary, obj.summary, obj.description, obj.raw, obj.type]
    .map(str).join(' \n ').toLowerCase();

  // 1) USDA NRCS EQIP / high-tunnel / conservation cost-share — the canonical pay-first case.
  const isEqip = /\beqip\b|environmental quality incentives|high tunnel/.test(text)
    || (/\bnrcs\b|natural resources conservation/.test(text) && /cost[\s-]?share|conservation|tunnel/.test(text));
  if (isEqip) {
    return {
      kind: 'cost-share-reimbursement',
      honestSummary:
        'This is NOT free money. USDA NRCS EQIP (e.g. the seasonal high tunnel) is a COST-SHARE you get ' +
        'REIMBURSED for AFTER you build it and it passes inspection — you pay out of pocket first. You ' +
        'must sign the EQIP contract BEFORE you build; building first disqualifies the expense. ' +
        'Historically-underserved applicants may get an advance; everyone else is paid only on completion.',
    };
  }

  // 2) Map the existing mechanism classifier onto the restricted kind set, then refine.
  let kind = str(obj.mechanism) || classifyMechanism(text);
  if (kind === 'cost-share-reimbursement' || kind === 'loan' || kind === 'tax-credit' || kind === 'grant') {
    // keep as-is
  } else {
    kind = 'other'; // service / insurance / varies / anything unknown
  }
  if (!KIND_SET.has(kind)) kind = 'other';

  // Prefer the program's own honest summary when present; otherwise the canonical per-kind line.
  const honestSummary = str(obj.honest_summary) || KIND_SUMMARY[kind] || KIND_SUMMARY.other;
  return { kind, honestSummary };
}

// ── truthCheck(program) — flag "free money" framing that mismatches the real mechanism ────────────────
// Scans the program's text for free-money framing. If the text sells "free money / grant / no strings"
// but the classified mechanism is a loan, cost-share, tax-credit, or insurance, we flag it as dishonest.
// Free-money framing — but NOT when negated ("NOT free money", "this is not free money"). The negative
// lookbehind keeps an honest program that says "this is NOT free money" from being flagged as dishonest.
const FREE_MONEY_RE = /(?<!\bnot\s)(?<!\bnot\b)(?:free money|free (?:government )?(?:cash|grant|funds?)|no strings|never (?:pay|repay) (?:it )?back)/i;
const NON_GIFT = new Set(['loan', 'cost-share-reimbursement', 'tax-credit', 'insurance']);

export function truthCheck(program = {}) {
  const text = [program.name, program.honest_summary, program.eligibility_notes, program.raw, program.description]
    .map(str).join(' \n ');
  const mechanism = str(program.mechanism) || classifyMechanism(text);
  // A program that WARNS "this is not free money" must not be flagged for containing the phrase it is
  // warning about. Strip negated occurrences before testing, or the guard fires on its own disclaimer.
  const NEGATED = /\b(?:not|never|no|isn't|is not|aren't|are not|rather than|as opposed to|unlike)\b[^.!?]{0,40}?(free money|free cash|money you do ?n[o']t repay|handed to you|given to you|a gift)/gi;
  const tested = text.replace(NEGATED, ' ');
  const claimsFree = FREE_MONEY_RE.test(tested);
  if (claimsFree && NON_GIFT.has(mechanism)) {
    return {
      honest: false,
      mechanism,
      why: `Text uses "free money" framing, but this is a ${mechanism.replace(/-/g, ' ')} — ` +
        (mechanism === 'loan' ? 'you repay it, with interest.'
          : mechanism === 'cost-share-reimbursement' ? 'you pay first and are reimbursed only after inspection.'
          : mechanism === 'tax-credit' ? 'it reduces taxes owed; it is not cash handed to you.'
          : 'it is risk coverage with premiums, not a gift.'),
    };
  }
  if (claimsFree && mechanism === 'service') {
    return { honest: false, mechanism, why: 'Text uses "free money" framing, but this is a free service — no money is given.' };
  }
  return { honest: true, mechanism, why: '' };
}

// Normalize a live fed-opportunities row (or any loose object) into a navigator program with an honest
// mechanism + summary. Live grant rows are mechanism 'grant' but still carry the eligibility caveat.
function normalizeLive(row = {}) {
  const name = str(row.title || row.name) || 'Untitled opportunity';
  const text = [name, row.agency, row.honest_summary, row.description, row.raw, row.type].map(str).join(' \n ');
  const mechanism = str(row.mechanism) || classifyMechanism(text) || (row.type === 'grant' ? 'grant' : 'varies');
  return {
    name,
    agency: str(row.agency) || null,
    mechanism,
    honest_summary: str(row.honest_summary) ||
      (mechanism === 'grant'
        ? 'A federal grant opportunity — money you do not repay, but competitive and eligibility-gated. Read the full eligibility section before applying.'
        : `Live opportunity classified as ${mechanism.replace(/-/g, ' ')}. ${MECHANISM_BADGE[mechanism] || ''}`),
    eligibility_notes: str(row.eligibility_notes) || 'See the source listing for eligibility and deadlines.',
    source_url: str(row.url || row.source_url) || null,
    live: true,
  };
}

// Defensive dynamic import of a live federal reader. If the module is missing or throws on import, we
// return null and the navigator falls back to the curated seed alone — a break there cannot break us.
// We prefer the dedicated grants-gov.mjs reader (search by keyword/agency/status) and fall back to
// fed-opportunities.mjs (its `grants`) if the dedicated one is unavailable.
async function loadGrantsReader() {
  for (const [path, fn] of [
    ['./grants-gov.mjs', (mod) => (kw) => mod.search({ keyword: kw })],
    ['./fed-opportunities.mjs', (mod) => (kw) => mod.grants({ keyword: kw })],
  ]) {
    try {
      const mod = await import(path);
      // Mirror our injected fetch into the live reader so tests stay offline + deterministic.
      if (typeof mod.__setFetch === 'function') { try { mod.__setFetch(_fetch); } catch { /* ignore */ } }
      if (typeof mod.search === 'function' || typeof mod.grants === 'function') return fn(mod);
    } catch { /* try next */ }
  }
  return null;
}

// ── staleRate(text, { now, maxDays }) — the "APY as of" check ────────────────────────────────────────
// A rate comparison screen is only honest if the rates are current. Commercial offer walls routinely
// print "APY as of <date>" in small type and leave the figure standing for a year or more. This finds any
// such date in an offer and reports how old it is, so the navigator can label it instead of repeating it.
// Pure; no I/O. Returns { found, asOf, ageDays, stale, note }.
export function staleRate(text = '', { now = new Date(), maxDays = 90 } = {}) {
  const t = String(text || '');
  const m = t.match(/(?:APY|rate)\s+as\s+of\s+([A-Z][a-z]+\s+\d{1,2}(?:,?\s*\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (!m) return { found: false, asOf: null, ageDays: null, stale: false, note: '' };
  const raw = m[1];
  const ref = now instanceof Date ? now : new Date(now);
  let d = new Date(/\d{4}/.test(raw) ? raw : `${raw} ${ref.getUTCFullYear()}`);
  if (isNaN(d)) return { found: true, asOf: raw, ageDays: null, stale: false, note: `Quoted "as of ${raw}" — date could not be parsed; verify the current rate with the institution.` };
  if (d > ref) d = new Date(d.setUTCFullYear(d.getUTCFullYear() - 1)); // an undated month/day in the future means last year
  const ageDays = Math.floor((ref - d) / 86400000);
  const stale = ageDays > maxDays;
  return {
    found: true, asOf: raw, ageDays, stale,
    note: stale
      ? `THIS RATE IS ${ageDays} DAYS OLD. It is quoted "as of ${raw}" and is not necessarily the rate on offer today. Confirm the current rate with the institution before relying on it.`
      : `Quoted "as of ${raw}" (${ageDays} days old).`,
  };
}

// ── searchPrograms(query, { fetchers }) — merge curated PROGRAMS + live feeds, all honestly classified ─
// `fetchers` (optional) lets a caller inject live feed functions for tests/offline:
//   { grants: async (q) => [...rows] }  — each returned row is normalized + classified.
// When no fetchers are injected, we defensively import fed-opportunities.mjs and use its `grants`. Every
// branch soft-fails: a thrown/absent feed yields the curated results alone, never an error.
export async function searchPrograms(query = '', { fetchers = null } = {}) {
  const q = str(query).toLowerCase();
  const matches = (p) => {
    if (!q) return true;
    return [p.name, p.agency, p.honest_summary, p.eligibility_notes, p.mechanism]
      .some((f) => str(f).toLowerCase().includes(q));
  };
  const curated = PROGRAMS.filter(matches).map((p) => ({ ...p, source: 'curated' }));

  // Resolve the live grant feed: injected fetcher first, else the defensively-imported reader.
  let liveRows = [];
  try {
    let grantsFn = fetchers && typeof fetchers.grants === 'function' ? fetchers.grants : null;
    if (!grantsFn) grantsFn = await loadGrantsReader();
    if (grantsFn) {
      const raw = await grantsFn(query);
      if (Array.isArray(raw)) liveRows = raw.map((r) => ({ ...normalizeLive(r), source: 'live' }));
    }
  } catch { liveRows = []; }

  // Attach the honest `kind` (the restricted v3 vocabulary) to every row, curated + live.
  const withKind = (p) => ({ ...p, kind: classifyProgram(p).kind });
  return [...curated, ...liveRows].map(withKind);
}

// ── renderPage(results) — escaped HTML with the mechanism BADGE on every program + the not-advice line ─
export function renderPage(results = []) {
  const rows = Array.isArray(results) ? results : [];
  const cards = rows.map((p) => {
    const mech = str(p.mechanism) || 'varies';
    const badge = MECHANISM_BADGE[mech] || MECHANISM_BADGE.varies;
    const tc = truthCheck(p);
    const warn = tc.honest ? '' :
      `\n      <p class="truth-warning"><strong>Heads up:</strong> ${esc(tc.why)}</p>`;
    const link = p.source_url
      ? `<a href="${esc(p.source_url)}">${esc(p.name)}</a>` : esc(p.name);
    return `    <article class="program mechanism-${esc(mech)}">
      <h3>${link}</h3>
      <p class="agency">${esc(p.agency)}</p>
      <p class="mechanism-badge"><strong>${esc(badge)}</strong></p>
      <p class="honest-summary">${esc(p.honest_summary)}</p>
      <p class="eligibility"><em>Eligibility:</em> ${esc(p.eligibility_notes)}</p>${warn}
    </article>`;
  }).join('\n');
  const list = cards || '    <p class="empty">No programs found.</p>';
  return `<section class="benefits-navigator">
  <h2>Benefits Navigator — Honest Funding Finder</h2>
  <p class="intro">Real official programs, labeled by what they actually are. A loan is never "free money."</p>
${list}
  <p class="not-advice">${esc(NOT_ADVICE)}</p>
</section>`;
}

// ── CLI: node integrations/soapbox/benefits-navigator.mjs <query> ─────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('benefits-navigator.mjs')) {
  const query = process.argv.slice(2).join(' ');
  const results = await searchPrograms(query);
  console.log(`\n# Benefits Navigator${query ? `: ${query}` : ''} (${results.length})\n`);
  for (const p of results) {
    console.log(`  - ${p.name} [${p.mechanism}]`);
    console.log(`      ${MECHANISM_BADGE[p.mechanism] || MECHANISM_BADGE.varies}`);
    const tc = truthCheck(p);
    if (!tc.honest) console.log(`      ⚠ ${tc.why}`);
  }
  console.log(`\n${NOT_ADVICE}`);
}
