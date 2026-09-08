// fax-system — the layer that turns a document into a SENT fax with a receipt.
//
// We already had three separate pieces and no system:
//   docconvert.mjs   markdown/html/docx -> PDF
//   doc-services.mjs the provider catalog, per-page cost, and "which provider should I use"
//   fax-service.mjs  submit -> poll -> retry -> receipt, against Telnyx / ClickSend / Phaxio
//
// None of them knew about each other, and none of them knew who we actually fax. This module is
// the join: recipient book -> cover sheet -> job -> dispatch -> receipt -> queue.
//
// The design constraint that shaped this file: MOST DAYS THERE IS NO API KEY. A fax system that
// only works once somebody buys Telnyx credit is a fax system that does not work. So `dispatch()`
// has a MANUAL mode that is a first-class outcome, not an error path: it renders the complete
// packet, tells you the number, the page count and the cover text, and records the same queue
// entry an API send would have. Walking a packet to a fax machine is a legitimate way to send a
// fax, and the queue should be able to say it happened.
//
// House rules: ESM, injectable fetch, soft-fail-never-throw, esc() all interpolation.

import { REGISTRY, office, CHANNELS } from '../records-requests.mjs';
import * as faxService from './fax-service.mjs';
import { scheduleSend, isOpen, DEFAULT_HOURS, RECEIPT_NOTES } from './business-hours.mjs';

const str = (v) => String(v == null ? '' : v);
const now = () => new Date().toISOString();

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// ---------------------------------------------------------------------------
// 1. THE RECIPIENT BOOK
//
// Fax numbers verified against the body's own published page. `note` is why the number matters or
// what it does NOT accept -- a fax to a records unit that only takes portal submissions is a
// wasted page and, worse, a request that never started the statutory clock.
// ---------------------------------------------------------------------------

export const FAX_BOOK = Object.freeze({
  'tx-dallas-sheriff': {
    name: "Dallas County Sheriff's Department — Public Information",
    fax: '+12146533420',
    attn: 'Public Information / Open Records',
    mail: 'Frank Crowley Courts Building, 133 N. Riverfront Blvd., Dallas, TX 75207',
    phone: '(214) 749-8641',
    regime: 'TX_PIA',
    tz: 'America/Chicago',
    hours: { open: '08:00', close: '16:30' },
    verified: "Sheriff's Department public-information-requests page, checked 2026-09-08",
    note: 'The Sheriff publishes NO open-records email address. Fax and mail are the channels that '
        + 'start the § 552.301 clock. There is no Dallas COUNTY GovQA portal — dallastx.govqa.us '
        + 'is the CITY of Dallas and a county request sent there is not received.',
  },
  'tx-bar-cdc': {
    name: 'State Bar of Texas — Chief Disciplinary Counsel',
    fax: '+15124274315',
    regime: 'TX_OTHER',
    tz: 'America/Chicago',
    verified: 'records-requests REGISTRY (tx-bar-cdc)',
    note: 'NEVER EMAIL. Portal, fax or mail only.',
  },
});

// Merge the standalone book with any REGISTRY office that published a fax number, so a caller can
// name either. The book wins on conflict -- it is the hand-verified side.
export function recipients() {
  const out = new Map();
  for (const o of REGISTRY) {
    const raw = str(o && o.fax).trim();
    if (!raw) continue;
    out.set(o.id, {
      id: o.id, name: o.name, fax: faxService.normalizeFax(raw),
      regime: o.regime, tz: o.tz || DEFAULT_HOURS.tz,
      verified: o.verified || 'records-requests REGISTRY',
      note: o.gotcha || '', source: 'registry',
    });
  }
  for (const [id, r] of Object.entries(FAX_BOOK)) {
    out.set(id, { id, ...r, fax: faxService.normalizeFax(r.fax), source: 'fax-book' });
  }
  return [...out.values()];
}

export function recipient(idOrObj) {
  if (idOrObj && typeof idOrObj === 'object') {
    const fax = faxService.normalizeFax(idOrObj.fax);
    if (!fax) return null;
    return {
      id: str(idOrObj.id) || 'ad-hoc', name: str(idOrObj.name) || 'Recipient',
      fax, regime: str(idOrObj.regime), tz: str(idOrObj.tz) || DEFAULT_HOURS.tz,
      hours: idOrObj.hours || null, note: str(idOrObj.note),
      verified: str(idOrObj.verified) || 'caller-supplied — NOT verified by this module',
      source: 'ad-hoc',
    };
  }
  const id = str(idOrObj);
  return recipients().find((r) => r.id === id) || null;
}

/** The business-hours spec for a recipient: its own zone and counter hours, its own holiday regime. */
export function windowFor(rcpt) {
  const r = rcpt || {};
  return {
    tz: str(r.tz) || DEFAULT_HOURS.tz,
    regime: r.regime === 'FEDERAL' || r.regime === 'FOIA' ? 'FEDERAL' : 'TX_PIA',
    ...(r.hours || {}),
  };
}

// ---------------------------------------------------------------------------
// 2. THE COVER SHEET
//
// A fax cover sheet is not decoration. For a records request it carries the three things a clerk
// needs in the first two seconds -- who it is for, how many pages should have arrived, and what
// statute it is under -- and the page count is what lets the recipient tell you the transmission
// was short rather than silently working from a truncated request.
// ---------------------------------------------------------------------------

export function coverSheet({
  to = {}, from = {}, subject = '', pages = 1, statute = '', notes = '', dateISO = '',
} = {}) {
  const d = str(dateISO) || now();
  const date = d.slice(0, 10);
  const total = Math.max(1, Number(pages) || 1) + 1; // +1 for this cover sheet

  const lines = [
    'FACSIMILE TRANSMITTAL',
    '',
    `DATE:              ${date}`,
    `TO:                ${str(to.name)}`,
    to.attn ? `ATTN:              ${str(to.attn)}` : '',
    `FAX:               ${formatFax(to.fax)}`,
    `FROM:              ${str(from.name)}`,
    from.address ? `                   ${str(from.address)}` : '',
    from.phone ? `PHONE:             ${str(from.phone)}` : '',
    from.email ? `EMAIL:             ${str(from.email)}` : '',
    `PAGES:             ${total} (including this cover sheet)`,
    `SUBJECT:           ${str(subject)}`,
    statute ? `SUBMITTED UNDER:   ${str(statute)}` : '',
    '',
    '-'.repeat(72),
    '',
    notes ? str(notes) : '',
    notes ? '' : '',
    `If this transmission is incomplete or illegible, please contact the sender at the number or`,
    `address above. The sender requests written acknowledgement of receipt and the date of receipt.`,
    '',
    '-'.repeat(72),
  ].filter((l) => l !== null);

  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n');

  const html = [
    '<section class="fax-cover">',
    '<h1>Facsimile Transmittal</h1>',
    '<dl>',
    `<dt>Date</dt><dd>${esc(date)}</dd>`,
    `<dt>To</dt><dd>${esc(to.name)}${to.attn ? ` &mdash; ${esc(to.attn)}` : ''}</dd>`,
    `<dt>Fax</dt><dd>${esc(formatFax(to.fax))}</dd>`,
    `<dt>From</dt><dd>${esc(from.name)}</dd>`,
    `<dt>Pages</dt><dd>${esc(total)} (including this cover sheet)</dd>`,
    `<dt>Subject</dt><dd>${esc(subject)}</dd>`,
    statute ? `<dt>Submitted under</dt><dd>${esc(statute)}</dd>` : '',
    '</dl>',
    notes ? `<p>${esc(notes)}</p>` : '',
    '<p>If this transmission is incomplete or illegible, please contact the sender. '
      + 'The sender requests written acknowledgement of receipt and the date of receipt.</p>',
    '</section>',
  ].filter(Boolean).join('\n');

  return { text, html, pages: total, date };
}

export function formatFax(e164) {
  const n = str(e164).replace(/[^\d+]/g, '');
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(n);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (n || '');
}

// Faxes are monochrome and dumb. Markdown emphasis, blockquote carets and the star/warning marks
// this archive uses for triage all survive into the printed page as literal punctuation, which
// makes a records request look unserious to the clerk who has to read it. Strip them at the
// boundary rather than keeping a separate plain-text copy of every document in sync by hand.
export function plain(md) {
  return str(md)
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')           // blockquote carets ( \s would eat the blank line )
    .replace(/\*\*\*(.+?)\*\*\*/gs, '$1')
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/(^|[^*\n])\*((?:[^*\n]|\n(?!\n))+?)\*/g, '$1$2')  // italics, incl. wrapped; not bullets
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')                   // ATX headings
    .replace(/[⭐⚠️☐☑⏰✅❌]/g, '')  // triage marks
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// A fax is billed and timed by the page, so a bad estimate costs money and makes the cover sheet
// lie. This is deliberately crude and deliberately labelled as an estimate.
export function estimatePages(body, { linesPerPage = 46 } = {}) {
  const s = str(body);
  if (!s.trim()) return 1;
  const lines = s.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 92)), 0);
  return Math.max(1, Math.ceil(lines / linesPerPage));
}

// ---------------------------------------------------------------------------
// 3. THE JOB
// ---------------------------------------------------------------------------

export function buildJob({
  to, from = {}, subject = '', body = '', mediaUrl = '', statute = '', notes = '', dateISO = '',
} = {}) {
  const rcpt = recipient(to);
  const text = plain(body);
  const problems = [];
  if (!rcpt) problems.push('no recipient — pass a known id or an object with a fax number');
  if (!text && !str(mediaUrl).trim()) problems.push('nothing to send — pass body or mediaUrl');
  if (!str(from.name).trim()) problems.push('no sender name — a records request from nobody is not a request');

  const pages = text ? estimatePages(text) : 1;
  const cover = rcpt
    ? coverSheet({ to: rcpt, from, subject, pages, statute, notes, dateISO })
    : null;

  return {
    ok: problems.length === 0,
    problems,
    id: jobId(rcpt, dateISO),
    to: rcpt,
    from: { name: str(from.name), address: str(from.address), phone: str(from.phone), email: str(from.email) },
    subject: str(subject),
    statute: str(statute),
    body: text,
    mediaUrl: str(mediaUrl),
    cover,
    pages: cover ? cover.pages : pages,
    createdAt: str(dateISO) || now(),
  };
}

function jobId(rcpt, dateISO) {
  const base = (rcpt && rcpt.id) || 'unknown';
  const t = (str(dateISO) || now()).replace(/[^\d]/g, '').slice(0, 14);
  return `fax_${base}_${t}`;
}

// The whole packet as one plain-text document: cover sheet, then the body. This is what gets
// converted to PDF, and it is also exactly what a human prints when there is no API key.
export function renderPacket(job) {
  if (!job || !job.cover) return '';
  return `${job.cover.text}\n\n${str(job.body)}\n`;
}

// ---------------------------------------------------------------------------
// 4. DISPATCH
//
// Three outcomes, and MANUAL is a real one:
//   sent     the provider accepted it and we have a provider id to poll
//   manual   no usable credentials -> here is the packet, the number, and what to do
//   blocked  the job itself is not sendable, and we say why rather than half-sending it
// ---------------------------------------------------------------------------

export async function dispatch(job, {
  providerId = 'telnyx', credentials = {}, fromFax = '', poll = false, maxChecks = 6,
  nowISO = '', ignoreHours = false,
} = {}) {
  if (!job || !job.ok) {
    return {
      mode: 'blocked', ok: false, jobId: job && job.id,
      problems: (job && job.problems) || ['no job'],
      at: now(),
    };
  }

  // Business hours first. A fax to a dark room is a wasted page and, worse, a transmission report
  // whose timestamp will not match the date the office stamps on the request.
  const win = windowFor(job.to);
  const at = str(nowISO) || now();
  const sched = scheduleSend(at, win);
  if (!sched.sendNow && !ignoreHours) {
    return {
      mode: 'held', ok: true, jobId: job.id,
      to: job.to.name, fax: formatFax(job.to.fax), pages: job.pages,
      reason: sched.reason,
      localNow: sched.localNow,
      resendAt: sched.at,
      waitMs: sched.waitMs,
      packet: renderPacket(job),
      note: RECEIPT_NOTES.fax,
      at,
    };
  }

  const creds = faxService.checkCredentials(providerId, credentials);
  const haveMedia = !!str(job.mediaUrl).trim();

  // No credentials, or nothing hosted to send: fall back to the packet a person can walk over.
  if (!creds.ok || !haveMedia) {
    return {
      mode: 'manual', ok: true, jobId: job.id,
      to: job.to.name, fax: formatFax(job.to.fax), rawFax: job.to.fax,
      pages: job.pages,
      packet: renderPacket(job),
      reason: !creds.ok
        ? `no usable ${providerId} credentials (${(creds.missing || []).join(', ') || 'unconfigured'})`
        : 'no hosted mediaUrl — the provider APIs fetch a URL, they do not accept raw text',
      instructions: manualInstructions(job),
      at: now(),
    };
  }

  const send = poll
    ? await faxService.sendWithRetry({
        providerId, to: job.to.fax, from: fromFax, mediaUrl: job.mediaUrl, credentials, maxChecks,
      })
    : await faxService.submitFax({
        providerId, to: job.to.fax, from: fromFax, mediaUrl: job.mediaUrl, credentials,
      });

  return {
    mode: 'sent', ok: !!(send && send.ok), jobId: job.id,
    to: job.to.name, fax: formatFax(job.to.fax),
    pages: job.pages, providerId, provider: send,
    receipt: faxService.receipt(send, { to: job.to.name, subject: job.subject, sentBy: job.from.name }),
    at: now(),
  };
}

function manualInstructions(job) {
  return [
    `1. Print the packet below — ${job.pages} page(s) including the cover sheet.`,
    `2. Fax it to ${formatFax(job.to.fax)} (${job.to.name}).`,
    '3. KEEP THE TRANSMISSION REPORT. For a records request the timestamped report is the proof of '
      + 'the date the statutory clock started; an email has no equivalent.',
    job.to.note ? `4. Note for this recipient: ${job.to.note}` : '',
    `${job.to.note ? '5' : '4'}. Record the send with queue.record() so the deadline is tracked.`,
  ].filter(Boolean);
}

// ---------------------------------------------------------------------------
// 5. THE QUEUE
//
// Plain serialisable state. The caller owns persistence -- toJSON/fromJSON so it can live in a
// file, a KV, or nothing at all during a test.
// ---------------------------------------------------------------------------

export function createQueue(initial = []) {
  const items = Array.isArray(initial) ? initial.map(normalizeEntry).filter(Boolean) : [];

  const api = {
    get size() { return items.length; },
    all: () => items.slice(),
    find: (id) => items.find((i) => i.id === str(id)) || null,

    enqueue(job) {
      if (!job || !job.ok) return null;
      const entry = normalizeEntry({
        id: job.id, to: job.to.name, fax: job.to.fax, subject: job.subject,
        pages: job.pages, state: 'queued', attempts: 0, createdAt: job.createdAt, history: [],
        tz: (job.to && job.to.tz) || DEFAULT_HOURS.tz,
      });
      items.push(entry);
      return entry;
    },

    // Record an outcome -- an API dispatch OR a human who walked it to a machine. Both are sends.
    record(id, result = {}) {
      const e = api.find(id);
      if (!e) return null;
      const mode = str(result.mode);
      if (mode !== 'held') e.attempts += 1;   // a hold never touched the line
      e.lastAt = now();
      if (mode === 'sent' && result.ok) e.state = 'sent';
      else if (mode === 'held') { e.state = 'held-until-business-hours'; e.resendAt = str(result.resendAt); }
      else if (mode === 'manual') e.state = str(result.confirmed) ? 'sent' : 'awaiting-manual-send';
      else if (mode === 'blocked') e.state = 'blocked';
      else e.state = 'failed';
      e.history.push({ at: e.lastAt, mode: mode || 'unknown', ok: !!result.ok, note: str(result.reason) });
      if (result.receipt) e.receipt = result.receipt;
      return e;
    },

    // Confirm a manual send after the fact, with the transmission-report time if there is one.
    confirmManual(id, { atISO = '', note = '' } = {}) {
      const e = api.find(id);
      if (!e) return null;
      e.state = 'sent';
      e.sentAt = str(atISO) || now();
      e.history.push({ at: now(), mode: 'manual-confirmed', ok: true, note: str(note) });
      return e;
    },

    pending: () => items.filter((i) => i.state === 'queued' || i.state === 'awaiting-manual-send'
      || i.state === 'held-until-business-hours'),
    held: () => items.filter((i) => i.state === 'held-until-business-hours'),
    /** What is ready to go out right now, given each recipient's own clock. */
    dueNow: (nowISO = now()) => items.filter((i) =>
      (i.state === 'queued' || i.state === 'held-until-business-hours')
      && isOpen(nowISO, { tz: i.tz || DEFAULT_HOURS.tz })),
    sent: () => items.filter((i) => i.state === 'sent'),
    failed: () => items.filter((i) => i.state === 'failed' || i.state === 'blocked'),
    toJSON: () => items.slice(),
  };
  return api;
}

function normalizeEntry(raw) {
  if (!raw || !str(raw.id)) return null;
  return {
    id: str(raw.id), to: str(raw.to), fax: str(raw.fax), subject: str(raw.subject),
    pages: Number(raw.pages) || 1, state: str(raw.state) || 'queued',
    attempts: Number(raw.attempts) || 0, createdAt: str(raw.createdAt) || now(),
    lastAt: str(raw.lastAt), sentAt: str(raw.sentAt), resendAt: str(raw.resendAt),
    tz: str(raw.tz) || DEFAULT_HOURS.tz,
    receipt: raw.receipt || null,
    history: Array.isArray(raw.history) ? raw.history.slice() : [],
  };
}

// ---------------------------------------------------------------------------
// 6. HTTP
// ---------------------------------------------------------------------------

export function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj, null, 2));
  };

  if (url.pathname.endsWith('/recipients')) {
    return send(200, { ok: true, recipients: recipients() });
  }

  if (url.pathname.endsWith('/cover')) {
    const to = recipient(url.searchParams.get('to') || '');
    if (!to) return send(400, { ok: false, error: 'unknown recipient' });
    return send(200, {
      ok: true,
      cover: coverSheet({
        to,
        from: { name: url.searchParams.get('from') || '' },
        subject: url.searchParams.get('subject') || '',
        pages: Number(url.searchParams.get('pages')) || 1,
        statute: url.searchParams.get('statute') || '',
      }),
    });
  }

  return send(200, {
    ok: true,
    service: 'fax-system',
    routes: ['/recipients', '/cover?to=&from=&subject=&pages=&statute='],
    note: 'Dispatch is not exposed over HTTP — sending costs money and needs credentials. '
        + 'Use the CLI or import dispatch() directly.',
  });
}

// ---------------------------------------------------------------------------
// CLI:  node integrations/soapbox/fax-system.mjs --to tx-dallas-sheriff --file req.md \
//         --from "Ryan Alexander Gallagher" --subject "PIA request" --statute "Tex. Gov't Code ch. 552"
// With no credentials this prints the packet to send by hand, which is the point.
// ---------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('fax-system.mjs')) {
  const argv = process.argv.slice(2);
  const arg = (name, dflt = '') => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };

  if (argv.includes('--list') || argv.length === 0) {
    console.log('\nFax recipients on file:\n');
    for (const r of recipients()) {
      console.log(`  ${r.id.padEnd(22)} ${formatFax(r.fax).padEnd(16)} ${r.name}`);
      if (r.note) console.log(`  ${' '.repeat(22)} ${r.note.slice(0, 96)}`);
    }
    console.log('\nUsage: --to <id> --file <path> --from "Name" [--subject S] [--statute S]\n');
  } else {
    const file = arg('file');
    const body = file ? (await import('node:fs')).readFileSync(file, 'utf8') : arg('body');
    const job = buildJob({
      to: arg('to'), from: { name: arg('from'), email: arg('email'), phone: arg('phone') },
      subject: arg('subject'), statute: arg('statute'), body,
    });
    if (!job.ok) {
      console.error('Cannot build the job:');
      for (const p of job.problems) console.error(`  - ${p}`);
      process.exitCode = 1;
    } else {
      const out = await dispatch(job, { providerId: arg('provider', 'telnyx') });
      if (out.mode === 'manual') {
        console.log(`\nMANUAL SEND — ${out.reason}\n`);
        for (const line of out.instructions) console.log(line);
        console.log(`\n${'='.repeat(72)}\n`);
        console.log(out.packet);
      } else {
        console.log(JSON.stringify(out, null, 2));
      }
    }
  }
}
