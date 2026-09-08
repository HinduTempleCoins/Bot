// records-requests.mjs — the RECORDS-REQUEST CRM.
//
// The problem this solves. A serious records campaign is not one letter; it is sixty offices, each
// with its own statute, its own clock, its own fee rule, and — the part that actually breaks people
// — its own INTAKE CHANNEL. Some take email. Some take email only at ONE address and silently bin
// anything sent elsewhere. Some are portal-only. Some still want a fax. Some are judicial-branch
// bodies that are not subject to the public-records act at all and will refuse a request captioned
// under it. Get the channel wrong and the request does not come back "denied" — it comes back
// nothing, and you do not find out for a month.
//
// So the registry below records, for every office, the four things that decide whether a request
// lands: CHANNEL, ADDRESS, STATUTE, and CLOCK. Everything else is composition.
//
// WHY CHANNEL IS A FIRST-CLASS FIELD AND NOT A NOTE. DART's own published page says a request sent
// to any address other than its designated one "will not be processed as a request for information."
// A note in a spreadsheet does not stop you sending it to a board member; a `channel` the composer
// refuses to render without a matching address does.
//
// WHY `subjectTo` MATTERS. Texas courts and Judicial Branch agencies are OUTSIDE the Public
// Information Act (Tex. Gov't Code § 552.0035); they answer under Rule 12 of the Rules of Judicial
// Administration instead. A PIA-captioned request to a court is refused on the caption. The registry
// carries the regime so the composer picks the right statute and the right deadline automatically.
//
// NOTHING CASE-SPECIFIC LIVES HERE. The registry is published intake information — the same facts
// any requester can read off an agency's own site. Requester identity, subject matter and the log of
// what was actually sent stay with the caller.

import * as bh from './soapbox/business-hours.mjs';

export const CHANNELS = Object.freeze({
  EMAIL: 'email',        // a designated mailbox
  PORTAL: 'portal',      // a web application, usually needing an account
  WEBFORM: 'webform',    // a plain form, no account
  FAX: 'fax',            // still real; a transmission report is timestamped proof email is not
  MAIL: 'mail',          // paper only
  PHONE: 'phone',        // intake by telephone; never a records request on its own
});

// Response regimes. `days` is the statutory response period; `basis` says what it counts.
export const REGIMES = Object.freeze({
  TX_PIA: {
    label: 'Texas Public Information Act, Tex. Gov\'t Code ch. 552',
    days: 10, basis: 'business',
    note: 'Ten business days is the deadline to SEEK an AG ruling (§ 552.301), not to produce; '
        + 'production is "promptly" (§ 552.221). § 552.302 presumes information public if no timely '
        + 'ruling is sought.',
  },
  TX_RULE12: {
    label: 'Rule 12, Texas Rules of Judicial Administration',
    days: 14, basis: 'calendar',
    note: 'Courts and Judicial Branch agencies are NOT subject to the PIA (§ 552.0035). '
        + 'The custodian is usually the judge; for an agency, its director.',
  },
  US_FOIA: {
    label: 'Freedom of Information Act, 5 U.S.C. § 552',
    days: 20, basis: 'business',
    note: 'Appeal window is 90 days from the determination letter.',
  },
  US_PRIVACY: {
    label: 'Privacy Act, 5 U.S.C. § 552a(d)',
    days: 20, basis: 'business',
    note: 'Fees may be assessed for DUPLICATION only — § 552a(f)(5). No search or review fee. '
        + 'DOJ components require a signed Form DOJ-361.',
  },
  WI_PRL: {
    label: 'Wisconsin Public Records Law, Wis. Stat. §§ 19.31–19.39',
    days: null, basis: 'asap',
    note: '§ 19.35(4)(a): "as soon as practicable and without delay" — no fixed day count. '
        + '§ 19.35(1)(am) gives an individual a right to records containing their own '
        + 'personally identifiable information.',
  },
  HIPAA: {
    label: '45 C.F.R. § 164.524 — right of access to the designated record set',
    days: 30, basis: 'calendar',
    note: 'One 30-day extension permitted with written notice.',
  },
  NONE: {
    label: 'no statutory right — courtesy request only',
    days: null, basis: 'none',
    note: 'Private body, or a public body outside any records statute. Log as NOTICE, not as a '
        + 'records failure.',
  },
});

// Offices. Every `address` here is published intake information.
// `verified` records HOW the channel was established — never assume, never guess.
export const REGISTRY = Object.freeze([
  { id: 'tx-dart', name: 'Dallas Area Rapid Transit', jurisdiction: 'TX/local',
    regime: 'TX_PIA', channel: CHANNELS.EMAIL, address: 'openrecords@dart.org',
    verified: 'DART published PIA page',
    gotcha: 'DART states a request sent to any other address — including an individual employee or '
          + 'Board member — WILL NOT BE PROCESSED. Put "Public Information Act request" in the subject.' },

  { id: 'tx-dps', name: 'Texas Department of Public Safety', jurisdiction: 'TX/state',
    regime: 'TX_PIA', channel: CHANNELS.EMAIL, address: 'publicrecords@dps.texas.gov',
    verified: 'DPS Office of General Counsel page',
    gotcha: 'Fax not accepted since 1 Sept 2019. Telephone requests are not requests.' },

  { id: 'tx-parkland', name: 'Parkland Health & Hospital System (Dallas County Hospital District)',
    jurisdiction: 'TX/local', regime: 'TX_PIA', channel: CHANNELS.EMAIL,
    address: 'piarequest@phhs.org', verified: 'Parkland Texas Public Information Act page',
    gotcha: 'A governmental body (Tex. Health & Safety Code ch. 281), so administrative and property '
          + 'records go by PIA with no medical authorization. Patient records are a SEPARATE '
          + 'HIPAA § 164.524 request — split them or the medical side holds up the rest.' },

  { id: 'tx-dallas-city', name: 'City of Dallas — Open Records', jurisdiction: 'TX/local',
    regime: 'TX_PIA', channel: CHANNELS.EMAIL, address: 'openrecords@dallas.gov',
    verified: 'City Secretary open-records page', altAddress: 'openrecordunit@dpd.ci.dallas.tx.us' },

  { id: 'tx-oca', name: 'Texas Office of Court Administration', jurisdiction: 'TX/judicial',
    regime: 'TX_RULE12', channel: CHANNELS.MAIL, address: null,
    verified: 'txcourts.gov open-records policy',
    gotcha: 'JUDICIAL BRANCH AGENCY — NOT subject to the PIA. Rule 12 applies and the agency '
          + 'DIRECTOR is the custodian. A PIA-captioned request is refused on the caption.' },

  { id: 'wi-doa', name: 'Wisconsin Dept of Administration (incl. Capitol Police)',
    jurisdiction: 'WI/state', regime: 'WI_PRL', channel: CHANNELS.EMAIL,
    address: 'DOAPublicRecords@Wisconsin.gov', verified: 'DOA public-records notice, Rev. 11/2016',
    gotcha: 'The DOA notice expressly covers the Capitol Police division. Custodian is the Secretary, '
          + 'delegated to Chief Legal Counsel.' },

  { id: 'us-dea-foia', name: 'Drug Enforcement Administration — FOIA/PA Unit',
    jurisdiction: 'US/federal', regime: 'US_PRIVACY', channel: CHANNELS.EMAIL,
    address: 'DEA.FOIA@dea.gov', verified: 'DEA published FOIA page',
    gotcha: 'REQUIRES a signed Form DOJ-361 in the same message or the request is closed unprocessed. '
          + 'The form needs no notary — 28 U.S.C. § 1746 declaration is accepted.' },

  { id: 'us-oip-appeal', name: 'DOJ Office of Information Policy — FOIA appeals',
    jurisdiction: 'US/federal', regime: 'US_FOIA', channel: CHANNELS.PORTAL,
    address: 'https://foiastar.doj.gov', verified: 'DOJ determination letters',
    gotcha: 'APPEAL CLOCK: 90 days from the date of the determination letter. Diary it the day the '
          + 'letter arrives.' },

  { id: 'tx-bar-cdc', name: 'State Bar of Texas — Chief Disciplinary Counsel',
    jurisdiction: 'TX/state', regime: 'NONE', channel: CHANNELS.PORTAL,
    address: 'https://www.texasbar.com', fax: '(512) 427-4315',
    verified: 'State Bar grievance page',
    gotcha: 'NEVER EMAIL. Portal, fax or mail only. Uploads accept .pdf .jpg .jpeg .gif .png .mp3 '
          + '.mp4 .wav ONLY — no .docx, no .txt. Redact third-party health information or the '
          + 'grievance is returned unconsidered.' },

  { id: 'tx-scjc', name: 'Texas State Commission on Judicial Conduct', jurisdiction: 'TX/state',
    regime: 'NONE', channel: CHANNELS.MAIL, address: 'P.O. Box 12265, Austin TX 78711',
    verified: 'SCJC filing page',
    gotcha: 'MAIL ONLY. Not online, not phone, not email, not fax.' },

  { id: 'us-dhs-foia', name: 'U.S. Department of Homeland Security — FOIA', jurisdiction: 'US/federal',
    regime: 'US_FOIA', channel: CHANNELS.PORTAL, address: 'https://www.foia.gov',
    verified: 'DHS FOIA handbook / dhs.gov FOIA pages',
    gotcha: 'EFFECTIVE 22 JANUARY 2026 DHS NO LONGER ACCEPTS MAILED OR EMAILED FOIA/Privacy Act '
          + 'requests. Portal only — foia.gov or a DHS component portal (SecureRelease). '
          + 'An email to foia@hq.dhs.gov is now for QUESTIONS, not requests, and a request sent '
          + 'there will not be processed.' },

  { id: 'tx-tcoommi', name: 'TCOOMMI (Texas Correctional Office on Offenders with Medical or Mental Impairments)',
    jurisdiction: 'TX/state', regime: 'TX_PIA', channel: CHANNELS.MAIL, address: null,
    verified: 'TDCJ TCOOMMI division pages',
    gotcha: 'Sits inside TDCJ. Art. 46B.025(d) requires the competency report to be on the form '
          + 'TCOOMMI approves under Tex. Health & Safety Code § 614.0032(b) — so TCOOMMI holds the '
          + 'BLANK APPROVED FORM, which is the document that shows whether a "tests administered" '
          + 'field exists and was left empty.' },

  { id: 'us-usps-inspection', name: 'U.S. Postal Inspection Service — FOIA (mail covers)',
    jurisdiction: 'US/federal', regime: 'US_FOIA', channel: CHANNELS.MAIL, address: null,
    verified: '39 C.F.R. § 233.3; USPS AS-353 privacy/FOIA guide',
    gotcha: 'Mail covers are governed by 39 C.F.R. § 233.3 and may be ordered ONLY by the Chief '
          + 'Postal Inspector, the Manager of Inspection Service Operations Support Group, or their '
          + 'designees — so a request should name that authority. No published request mailbox located.' },

  { id: 'tx-tec', name: 'Texas Ethics Commission — campaign finance', jurisdiction: 'TX/state',
    regime: 'TX_PIA', channel: CHANNELS.WEBFORM, address: 'https://www.ethics.state.tx.us/search/cf/',
    verified: 'TEC campaign-finance search pages', altAddress: 'openrecords@ethics.state.tx.us',
    gotcha: 'Electronically filed reports since July 2000 are SEARCHABLE FREE — no request needed. '
          + 'Judicial filers are online back to 2016 only; earlier judicial reports come by request '
          + 'to openrecords@ethics.state.tx.us. LOCAL filers do not file with TEC at all — go to the '
          + 'local filing authority (county clerk or elections administrator).' },

  { id: 'us-texaslawyer', name: 'Texas Lawyer (ALM) — news desk', jurisdiction: 'press',
    regime: 'NONE', channel: CHANNELS.WEBFORM, address: 'https://www.law.com/texaslawyer/static/contact-us/',
    verified: 'law.com contact page',
    gotcha: 'No published newsroom mailbox — contact form only. A tip emailed anywhere else does not '
          + 'reach the desk.' },

  { id: 'us-house-judiciary', name: 'U.S. House Judiciary Committee — whistleblower/tip intake',
    jurisdiction: 'US/congress', regime: 'NONE', channel: CHANNELS.EMAIL,
    address: 'Judiciary_Whistleblower@mail.house.gov',
    verified: 'House Judiciary whistleblower tipline page',
    gotcha: 'CONGRESS IS EXEMPT FROM FOIA — 5 U.S.C. § 551(1)(A). Never caption anything to a '
          + 'committee as a records request; it is an OVERSIGHT REFERRAL. And if the sender is not '
          + 'a federal employee, say so plainly rather than presenting as a statutory whistleblower.' },

  { id: 'us-house-homeland', name: 'U.S. House Homeland Security Committee', jurisdiction: 'US/congress',
    regime: 'NONE', channel: CHANNELS.WEBFORM, address: 'https://homeland.house.gov/contact/',
    verified: 'House Homeland Security contact page / Whistleblower Ombuds resources',
    gotcha: 'Form or Signal (+1 202-924-2065) only — no disclosure mailbox. '
          + 'WhistleblowerOffice@mail.house.gov is the OMBUDS and states it CANNOT RECEIVE '
          + 'disclosures; it advises the House. Sending a disclosure there reaches nobody.' },

  { id: 'us-senate-hsgac', name: 'U.S. Senate Homeland Security & Governmental Affairs',
    jurisdiction: 'US/congress', regime: 'NONE', channel: CHANNELS.WEBFORM, address: null,
    verified: 'hsgac.senate.gov',
    gotcha: '⚠️ DEAD ADDRESS TRAP: search results still surface '
          + '"whistleblowers@mccaskill.senate.gov" as the committee whistleblower contact. '
          + 'Senator McCaskill LEFT THE SENATE IN 2019 and that mailbox is not live. '
          + 'Use the current committee contact page.' },

  { id: 'us-senate-judiciary', name: 'U.S. Senate Judiciary Committee', jurisdiction: 'US/congress',
    regime: 'NONE', channel: CHANNELS.MAIL,
    address: '224 Dirksen Senate Office Building, Washington DC 20510',
    verified: 'judiciary.senate.gov', gotcha: 'No published intake mailbox. Phone (202) 224-5225.' },

  { id: 'us-ao-courts', name: 'Administrative Office of the U.S. Courts', jurisdiction: 'US/judicial',
    regime: 'NONE', channel: CHANNELS.MAIL,
    address: 'Thurgood Marshall Federal Judiciary Building, One Columbus Circle NE, Washington DC 20544',
    verified: 'uscourts.gov contact pages',
    gotcha: 'JUDICIAL BRANCH — outside FOIA entirely. No published public-information mailbox; '
          + 'Public Affairs (202) 502-2600. Supervised by the Judicial Conference.' },

  { id: 'tx-house-member', name: 'Texas House of Representatives — member office',
    jurisdiction: 'TX/state', regime: 'TX_PIA', channel: CHANNELS.EMAIL,
    address: 'firstname.lastname@house.texas.gov',
    verified: 'delivered sends to 65 member offices',
    gotcha: 'The Texas LEGISLATURE *is* a governmental body under § 552.003(1)(A) — unlike the '
          + 'judiciary — so member offices take PIA requests. But addresses follow the PERSON, not '
          + 'the seat: a former member\'s address bounces, and the institutional custodian is the '
          + 'Chief Clerk (no published email; (512) 463-0845).' },

  { id: 'tx-tidc', name: 'Texas Indigent Defense Commission', jurisdiction: 'TX/state',
    regime: 'NONE', channel: CHANNELS.PORTAL, address: 'https://tidc.tamu.edu/Complaint/',
    verified: 'TIDC complaint page',
    gotcha: 'PORTAL ONLY — not phone, fax or email. The upload control only appears after the first save.' },
]);

const byId = new Map(REGISTRY.map((o) => [o.id, o]));
export const office = (id) => byId.get(id) || null;

/** Offices whose channel is a mailbox we can actually send to right now. */
export const emailable = () =>
  REGISTRY.filter((o) => o.channel === CHANNELS.EMAIL && o.address);

/** Offices that CANNOT be emailed — the ones a naive campaign silently drops. */
export const notEmailable = () =>
  REGISTRY.filter((o) => o.channel !== CHANNELS.EMAIL || !o.address);

// Weekends are not the definition. Tex. Gov't Code § 552.0031 (H.B. 3033, eff. 1 Sept 2023)
// excludes national holidays under § 662.003(a) AND state holidays under § 662.003(b) -- and the
// Texas state list carries 24 and 26 December, the Friday after Thanksgiving, and four dates no
// federal calendar has. Counting weekends alone overstates how late a records officer is.
function addBusinessDays(date, n, regime) {
  const start = date.toISOString().slice(0, 10);
  const kind = String(regime || '').startsWith('US_') || regime === 'FOIA' ? 'FEDERAL' : 'TX_PIA';
  const r = bh.addBusinessDays(start, n, { regime: kind });
  return r ? new Date(`${r.date}T12:00:00Z`) : date;
}

/**
 * When is a response due? Returns null where the regime sets no fixed period —
 * "as soon as practicable" is not a date and pretending it is invites a false deadline.
 */
export function deadlineFor(officeId, sentISO) {
  const o = office(officeId);
  if (!o) return null;
  const r = REGIMES[o.regime];
  if (!r || !r.days) return null;
  const sent = new Date(sentISO);
  if (Number.isNaN(sent.getTime())) return null;
  const due = r.basis === 'business'
    ? addBusinessDays(sent, r.days, o.regime)
    : new Date(sent.getTime() + r.days * 86400000);
  return due.toISOString().slice(0, 10);
}

/**
 * Triage a send log. Each entry: { officeId, sentISO, respondedISO? }.
 * `asOfISO` lets tests pin "today" instead of depending on the clock.
 */
export function triage(log = [], asOfISO = new Date().toISOString()) {
  const asOf = new Date(asOfISO);
  const out = { overdue: [], pending: [], answered: [], noClock: [], unknownOffice: [] };
  for (const e of log) {
    const o = office(e.officeId);
    if (!o) { out.unknownOffice.push(e); continue; }
    if (e.respondedISO) { out.answered.push({ ...e, name: o.name }); continue; }
    const due = deadlineFor(e.officeId, e.sentISO);
    if (!due) { out.noClock.push({ ...e, name: o.name, regime: REGIMES[o.regime].label }); continue; }
    const row = { ...e, name: o.name, due, regime: REGIMES[o.regime].label };
    (new Date(due) < asOf ? out.overdue : out.pending).push(row);
  }
  out.overdue.sort((a, b) => a.due.localeCompare(b.due));
  out.pending.sort((a, b) => a.due.localeCompare(b.due));
  return out;
}

const esc = (s) => String(s == null ? '' : s);

/**
 * Compose a request. Deliberately refuses rather than guessing:
 * an office with no address, or a channel that is not a mailbox, returns `sendable: false`
 * and says why — because a request sent to the wrong place looks sent and never arrives.
 */
export function composeRequest({ officeId, requester = {}, items = [], subject = '', periodFrom = '', periodTo = '' } = {}) {
  const o = office(officeId);
  if (!o) return { ok: false, reason: `unknown office: ${esc(officeId)}` };
  const r = REGIMES[o.regime];
  const sendable = o.channel === CHANNELS.EMAIL && Boolean(o.address);

  const head = [
    `TO:   ${esc(o.name)}`,
    o.address ? `      ${esc(o.address)}` : '      (no published mailbox — see channel note)',
    '',
    `FROM: ${esc(requester.name)}`,
    requester.address ? `      ${esc(requester.address)}` : null,
    requester.contact ? `      ${esc(requester.contact)}` : null,
    '',
    `RE:   Request under ${esc(r.label)}`,
    subject ? `      ${esc(subject)}` : null,
  ].filter(Boolean).join('\n');

  const window = (periodFrom || periodTo)
    ? `\nTIME PERIOD: ${esc(periodFrom)} through ${esc(periodTo)}.\n` : '\n';

  const body = items.length
    ? '\nRECORDS REQUESTED\n\n' + items.map((it, i) => `${i + 1}. ${esc(it)}`).join('\n\n')
    : '\nRECORDS REQUESTED\n\n(none specified)';

  const noRecords = '\n\nIf you hold NO responsive record in a category, I am expressly requesting '
    + 'that statement in writing. A written "no records" answer is itself information I am seeking '
    + 'and I am requesting it, not treating it as a default.';

  const regimeNote = r.note ? `\n\nNOTE ON THE APPLICABLE REGIME\n\n${esc(r.note)}` : '';
  const gotcha = o.gotcha ? `\n\n[INTAKE NOTE — not part of the request]\n${esc(o.gotcha)}` : '';

  return {
    ok: true,
    sendable,
    reason: sendable ? null
      : `channel is ${esc(o.channel)}${o.address ? '' : ' and no address is published'} — do not email`,
    office: o,
    regime: r,
    deadlineDays: r.days,
    text: head + window + body + noRecords + regimeNote + gotcha,
  };
}

/** HTTP surface. GET ?office=<id> for one, no query for the roster. */
export function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const id = url.searchParams.get('office');
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj, null, 2));
  };
  try {
    if (id) {
      const o = office(id);
      if (!o) return send(404, { error: 'unknown office', id });
      return send(200, { office: o, regime: REGIMES[o.regime] });
    }
    return send(200, {
      total: REGISTRY.length,
      emailable: emailable().map((o) => o.id),
      needsAnotherChannel: notEmailable().map((o) => ({ id: o.id, channel: o.channel })),
      offices: REGISTRY,
    });
  } catch (e) {
    return send(500, { error: String((e && e.message) || e) });
  }
}

if (process.argv[1] && process.argv[1].endsWith('records-requests.mjs')) {
  const e = emailable(), n = notEmailable();
  console.log(`records-requests: ${REGISTRY.length} offices — ${e.length} emailable, ${n.length} not`);
  for (const o of n) console.log(`  [${o.channel}] ${o.name}${o.gotcha ? ' — ' + o.gotcha.split('.')[0] : ''}`);
}
