// pentecaust/groups/paperwork.mjs — THE PAPERWORK A REAL CLUB ACTUALLY NEEDS.
//
// A club on Pact is not only a page: people form real auto clubs, precious-metals clubs, benefit
// societies and study circles, and every one of them hits the same wall — what do we actually have to
// file, sign and keep? This module answers that in plain words, per program, with the real form names
// and who issues them, so a club can see the whole list in one place and work down it.
//
// ⚖️ WHAT THIS IS NOT. This is a CHECKLIST AND A SET OF STARTING TEMPLATES — general information, the
// same as a library book. It is not legal, tax or financial advice, it is not a substitute for a lawyer
// or an accountant, and nothing here is filed for anyone. Rules differ by state and country, and a club
// that holds money or promises a benefit can cross into regulated territory (see the licensing note in
// integrations/benefit-society.mjs). Every kit says so, in the kit.
//
// PURE: no network, no I/O, no account data. Strings in, strings out, so it is trivially testable.
//
//   import { kitFor, PROGRAM_KITS, COMMON, renderKit } from './paperwork.mjs'

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const doc = (title, what, who = '', note = '') => ({ title, what, who, note });

// What every club that meets and keeps a treasury needs, whatever it is about.
export const COMMON = [
  doc('Bylaws (or a charter)', 'The club\'s own rules: its purpose, who may join, the officers and how they are chosen, how dues are set, how a meeting is called, and how the club closes and what happens to what is left.', 'written by the members and adopted at a meeting', 'On Pact this is the pact\'s charter — the terms everyone agrees to.'),
  doc('Membership roll', 'Who is a member, when they joined, their standing and their role.', 'kept by the secretary', 'Pact keeps this for you; export it any time.'),
  doc('Meeting minutes', 'What was decided at each meeting, who was there, and the result of each vote. The record that proves the club acted as a club.', 'kept by the secretary'),
  doc('Treasurer\'s ledger', 'Every dollar in and out, with receipts. Dues collected, costs paid, the balance.', 'kept by the treasurer', 'Pact records what dues are owed; it never holds the money.'),
  doc('EIN (Employer Identification Number)', 'A free federal tax number for the club. A bank will ask for it before opening an account in the club\'s name.', 'IRS Form SS-4 — free, online, same day', 'Free. Never pay a site that charges for this.'),
  doc('A club bank account', 'So club money is not in a member\'s personal account. Usually needs the EIN, the bylaws, and minutes naming who may sign.', 'any bank or credit union'),
  doc('Unincorporated association or nonprofit corporation', 'A club can simply exist as an unincorporated association. Incorporating in your state separates members from the club\'s debts, which matters once there is money, property or an event.', 'your Secretary of State', 'Costs and names differ by state.'),
  doc('Tax filing', 'Even a small club usually has a yearly filing. A tax-exempt social club files a 990-series return; others may file an ordinary return.', 'IRS (and your state)', 'Ask an accountant once there is real money.'),
];

export const PROGRAM_KITS = {
  'auto-club': {
    label: 'Auto club',
    blurb: 'A real car club: meets, cruises, shows and track days. The paperwork is mostly about who is driving, where you are gathering, and who is covered if something happens.',
    docs: [
      doc('Event waiver / release', 'Signed by everyone taking part in a drive, show or track day, before they take part. A club collects these at every event, not once.', 'drafted with a lawyer; venues often require their own'),
      doc('Event insurance', 'A one-off policy for a show, cruise or track day. Most venues and car parks will not let a club in without a certificate naming them.', 'a specialist motorsport/event broker'),
      doc('General liability insurance', 'Year-round cover for the club itself.', 'an insurance broker'),
      doc('Venue or parking permission', 'Written permission for the lot, park or street you meet on, and any permit the city needs for a gathering, road closure or parade.', 'the property owner and your city'),
      doc('Driver and vehicle rules', 'What the club requires: a valid licence, insurance on the car, a safety inspection for track days, helmets where needed, and conduct on public roads.', 'the club\'s own rules'),
      doc('Photo and video release', 'So the club may post pictures from the event.', 'the club\'s own form'),
    ],
  },
  'metals-club': {
    label: 'Precious-metals club',
    blurb: 'Members learning about and buying precious metals together. The whole design rests on one line: the club keeps records and shares knowledge — it never takes custody of anyone\'s metal or money, which is the line between a club and a regulated dealer or money transmitter.',
    docs: [
      doc('A written custody rule', 'Stated plainly in the bylaws: each member buys in their own name and holds their own metal. The club does not pool funds, does not buy on anyone\'s behalf and does not store metal for members.', 'the club\'s own bylaws', 'This is the rule that keeps a club a club.'),
      doc('Group-buy ground rules (if you do one)', 'If members order together to reach a better price, every member pays the dealer directly and the dealer ships to each member. No club account in the middle.', 'the club\'s own rules'),
      doc('Purchase records', 'Each member\'s own record: date, dealer, metal, weight, purity, serial where there is one, price paid, and the invoice. This is what a tax basis is proven with.', 'kept by each member', 'Keep it even for small buys — the basis matters at sale.'),
      doc('Storage and insurance notes', 'Home safe, bank box or a third-party vault, and what a homeowner policy does and does not cover for bullion (usually very little).', 'your insurer'),
      doc('Tax notes', 'In the US, physical bullion is generally taxed as a collectible when sold at a gain, and dealers have their own reporting on some transactions. Rules differ by country.', 'an accountant', 'General information only — ask an accountant about your own sale.'),
      doc('Testing and authenticity', 'How the club checks what members bought: a scale, calipers, a magnet slide, ultrasonic or XRF testing, and known-good dealers.', 'the club\'s own practice'),
    ],
  },
  'benefit-society': {
    label: 'Benefit society (mutual aid)',
    blurb: 'The oldest form of mutual aid: members join under a charter, pay in, and the group helps whoever is in need. The paperwork matters more here than anywhere else, because a group that pools money and pays out benefits can be regulated as an insurer.',
    docs: [
      doc('Charter and standing rules', 'Purpose, who may join, dues, and the degrees of standing — what happens when someone falls behind or breaks the pact.', 'the members'),
      doc('A written limit on what the society promises', 'The society coordinates and records mutual aid; it does not promise or pay a benefit as an insurer would, and does not hold members\' money.', 'the charter', 'This is the licensing line. A society that pools and pays out is an insurer under state law in essentially every US state.'),
      doc('Aid ledger', 'Who asked, what the group decided, what was given and by whom — member to member.', 'the secretary'),
      doc('Claims or request process', 'How someone asks for help, who decides, and in what time.', 'the charter'),
      doc('501(c)(8) / 501(c)(10) reading', 'The two federal categories fraternal societies use, and the difference: (c)(8) pays benefits, (c)(10) does not and devotes earnings to charity.', 'IRS Publication 557', 'Which lane you are in follows from what the society actually does.'),
    ],
  },
  'mystery-school': {
    label: 'Mystery school',
    blurb: 'A course of study with degrees. The paperwork is about what a degree means, what a student is promised, and staying clear of the rules that govern schools that grant credentials.',
    docs: [
      doc('Course of study and degrees', 'Each degree in order: what is read, what is practised, what is required to advance.', 'the school'),
      doc('What a degree is and is not', 'Stated plainly: a degree here is internal recognition within the school. It is not an accredited academic degree, a licence, or a professional credential.', 'the school', 'States regulate who may grant "degrees" and use school names — say what yours is.'),
      doc('Religious or educational purpose statement', 'What the school is for. This is what a nonprofit filing and any exemption rests on.', 'the charter'),
      doc('Fees and refunds', 'What members pay, what they get, and what happens if they leave.', 'the charter'),
      doc('Safeguarding and conduct rules', 'How the school handles conduct, and anything involving minors.', 'the school'),
    ],
  },
  'study-circle': {
    label: 'Study circle',
    blurb: 'A reading group working through a shelf of the Library. The lightest paperwork of any club.',
    docs: [
      doc('Reading list and schedule', 'What is read, in what order, and when you meet.', 'the circle'),
      doc('A note on sources', 'Where the texts come from, and that public-domain and open-licensed ones may be shared freely while others may not.', 'the circle'),
    ],
  },
  'social-club': {
    label: 'Social club',
    blurb: 'Any club that meets and keeps a treasury.',
    docs: [
      doc('Event permissions and insurance', 'Whatever the venue asks for when the club gathers.', 'the venue and an insurance broker'),
      doc('501(c)(7) reading', 'The federal category for social and recreational clubs, and its limits on income from non-members.', 'IRS Publication 557'),
    ],
  },
};

export const DISCLAIMER =
  'General information and starting templates only — the same as a library book, not legal, tax or '
  + 'financial advice, and nothing here is filed for you. Rules differ by state and country. Once a club '
  + 'holds money, property, or promises anyone a benefit, have a lawyer and an accountant look at it.';

/** The whole kit for a program: what everyone needs, then what this kind of club needs. */
export function kitFor(program) {
  const k = PROGRAM_KITS[String(program || '').toLowerCase()];
  if (!k) return { ok: false, reason: 'no paperwork kit for that kind of club', programs: Object.keys(PROGRAM_KITS) };
  return { ok: true, program: String(program).toLowerCase(), label: k.label, blurb: k.blurb, common: COMMON, docs: k.docs, disclaimer: DISCLAIMER };
}

/** Escaped HTML for a kit — the same markup on Pact, MELEK and anywhere else it is shown. */
export function renderKit(program) {
  const k = kitFor(program);
  if (!k.ok) return `<p class=mut>${esc(k.reason)}</p>`;
  const row = (d) => `<div class=pw><b>${esc(d.title)}</b><div>${esc(d.what)}</div>`
    + `${d.who ? `<div class=mut>Where it comes from: ${esc(d.who)}</div>` : ''}`
    + `${d.note ? `<div class=mut>${esc(d.note)}</div>` : ''}</div>`;
  return `<section class=paperwork><h2>Paperwork for a ${esc(k.label.toLowerCase())}</h2>
<p class=lead>${esc(k.blurb)}</p>
<h3>What this kind of club needs</h3>${k.docs.map(row).join('')}
<h3>What every club needs</h3>${k.common.map(row).join('')}
<p class=mut><b>Please read:</b> ${esc(k.disclaimer)}</p></section>`;
}
