// inbox-triage.mjs — email triage + signature/draft helper for VKFRI (Van Kush Family Research
// Institute, the operator's org). Task #136 (the VKFRI inbox-triage half).
//
// SCOPE — READ + DRAFT ONLY. This module categorizes incoming mail, prioritizes it, and produces
// reply DRAFTS the operator reviews. It NEVER sends, pushes, or mutates anything. By construction
// there is no send function here: every draft is flagged needs_human_review:true and carries
// status:'DRAFT'. The operator sends from his own client. (Same boundary as assistant-connectors.mjs.)
//
// PURE + injectable: no live network in this module.
//   • __setMailSource(fn)  — inject an async fn returning raw messages (IMAP/JMAP) for triageInbox's
//                            optional fetch path. Default: none (callers pass emails directly).
//   • __setClassifier(fn)  — inject a classifier/LLM (email) -> { category, priority, reasons[] }.
//                            Default: a deterministic, network-free keyword rule classifier.
//
//   import { classifyEmail, triageInbox, draftReply, vkfriSignature } from './integrations/inbox-triage.mjs';
//   const { items, summary } = triageInbox(messages);   // classified, prioritized, drafts for actionable
//   const eml = draftReply(email, { signature: vkfriSignature({ name, title }) }); // status:'DRAFT'

export const ORG_NAME = 'Van Kush Family Research Institute';
export const ORG_SHORT = 'VKFRI';

// Triage buckets. Order is informational; priority drives sorting.
export const CATEGORIES = ['urgent', 'inquiry', 'collaboration', 'invoice', 'newsletter', 'spam', 'personal', 'other'];

// Categories for which we generate a suggested reply draft. Spam/newsletter/invoice/other/personal
// are surfaced but not auto-drafted (operator handles those by hand).
export const ACTIONABLE = new Set(['urgent', 'inquiry', 'collaboration']);

// ── injectable mail source (no live network here) ─────────────────────────────────────────────────
let _mailSource = null;
export function __setMailSource(fn) { _mailSource = typeof fn === 'function' ? fn : null; }

// ── injectable classifier (default: deterministic rules) ──────────────────────────────────────────
let _classifier = null;
export function __setClassifier(fn) { _classifier = typeof fn === 'function' ? fn : null; }

const esc = (s) => String(s == null ? '' : s);
const lc = (s) => esc(s).toLowerCase();

/** Pull a single searchable text blob from an email-shaped object (from/subject/body/snippet). */
function emailText(email = {}) {
  const parts = [email.subject, email.body, email.bodyText, email.snippet, email.preview];
  return lc(parts.filter(Boolean).join(' \n '));
}

/** Normalize the "from" field to a display string (handles JMAP [{name,email}] shape). */
export function fromAddress(email = {}) {
  if (Array.isArray(email.from) && email.from.length) {
    return email.from.map((f) => (f && f.name ? `${f.name} <${f.email}>` : (f && f.email) || '')).filter(Boolean).join(', ');
  }
  return esc(email.from || email.sender || '');
}

// Keyword rule table. First matching rule (by precedence order below) wins for the primary category;
// every matching rule's reason is recorded. Priority: 3=urgent, 2=actionable, 1=normal, 0=low/noise.
const RULES = [
  // spam first so obvious junk never gets a draft, even if it also says "urgent"
  { category: 'spam', priority: 0, kws: ['viagra', 'lottery', 'you have won', 'nigerian prince', 'wire transfer fee', 'bitcoin doubler', 'click here to claim', 'act now limited', 'congratulations you', 'crypto giveaway'] },
  { category: 'newsletter', priority: 0, kws: ['unsubscribe', 'view in browser', 'manage preferences', 'newsletter', 'weekly digest', 'no-reply', 'noreply', 'view this email in your browser', 'you are receiving this'] },
  { category: 'urgent', priority: 3, kws: ['urgent', 'asap', 'deadline', 'immediately', 'time-sensitive', 'time sensitive', 'critical', 'emergency', 'overdue', 'final notice', 'expires today'] },
  { category: 'invoice', priority: 1, kws: ['invoice', 'payment due', 'payment', 'remittance', 'receipt', 'amount due', 'billing', 'past due', 'purchase order', 'wire instructions', 'net 30'] },
  { category: 'collaboration', priority: 2, kws: ['collaborat', 'partnership', 'partner with', 'joint', 'co-author', 'coauthor', 'work together', 'research proposal', 'grant', 'co-write', 'cooperation', 'mou', 'memorandum of understanding'] },
  { category: 'inquiry', priority: 2, kws: ['question', 'inquiry', 'enquiry', 'could you', 'can you', 'would you', 'how do i', 'how can i', 'requesting', 'please advise', 'wondering if', 'interested in', 'more information', 'looking for'] },
  { category: 'personal', priority: 1, kws: ['family', 'happy birthday', 'congrats', 'thank you for dinner', 'see you', 'love,', 'miss you', 'how are you'] },
];

/**
 * Deterministic, network-free classifier. Pure given an email.
 * Returns { category, priority:0..3, reasons[] }.
 */
export function ruleClassify(email = {}) {
  const text = emailText(email);
  const reasons = [];
  let chosen = null;

  for (const rule of RULES) {
    const hit = rule.kws.find((k) => text.includes(k));
    if (hit) {
      reasons.push(`matched "${hit}" → ${rule.category}`);
      if (!chosen) chosen = rule; // first rule in precedence order wins the primary category
    }
  }

  if (!chosen) {
    return { category: 'other', priority: 0, reasons: ['no rule matched; defaulted to other'] };
  }
  return { category: chosen.category, priority: chosen.priority, reasons };
}

/**
 * Classify an email. Uses the injected classifier if set, else the deterministic rule classifier.
 * Always returns a normalized { category, priority:0..3, reasons[] }. Pure given a classifier.
 */
export function classifyEmail(email = {}) {
  const fn = _classifier || ruleClassify;
  let r;
  try {
    r = fn(email);
  } catch (e) {
    // soft-fail: a misbehaving injected classifier must not crash triage
    return { category: 'other', priority: 0, reasons: [`classifier error: ${esc(e && e.message)}`] };
  }
  r = r || {};
  let category = CATEGORIES.includes(r.category) ? r.category : 'other';
  let priority = Number.isInteger(r.priority) ? Math.max(0, Math.min(3, r.priority)) : 0;
  const reasons = Array.isArray(r.reasons) ? r.reasons.map(esc) : [];
  return { category, priority, reasons };
}

/**
 * A clean professional VKFRI email signature block (plain text). Appended to DRAFTS only.
 * { name, title } — name/title of the human the draft is sent on behalf of.
 */
export function vkfriSignature({ name = '', title = '' } = {}) {
  const lines = [];
  lines.push('—');
  if (name) lines.push(esc(name));
  if (title) lines.push(esc(title));
  lines.push(ORG_NAME);            // org always present
  lines.push(`(${ORG_SHORT})`);
  lines.push('');
  lines.push('[Draft signature — appended to drafts only; reviewed before sending.]');
  return lines.join('\n');
}

// Per-category reply body templates. {sender} is filled from the email.
function replyBody(category, email, tone) {
  const opener = tone === 'warm' ? 'Hello,' : tone === 'brief' ? 'Hi,' : 'Hello,';
  const sender = esc(email.fromName || email.from || '').trim();
  const greeting = sender && typeof sender === 'string' && !sender.includes('<') ? `Hello ${sender},` : opener;

  switch (category) {
    case 'urgent':
      return `${greeting}\n\nThank you for flagging this — I see it is time-sensitive and I am giving it priority. I will follow up shortly with a substantive response.\n`;
    case 'inquiry':
      return `${greeting}\n\nThank you for reaching out to the ${ORG_SHORT}. I would be glad to help with your question. Could you share any additional detail so I can point you to the right resource?\n`;
    case 'collaboration':
      return `${greeting}\n\nThank you for thinking of the ${ORG_NAME} for this. The proposal is of interest; I would welcome a short call to explore scope, timeline, and fit before we proceed.\n`;
    default:
      return `${greeting}\n\nThank you for your message — I have received it and will respond in due course.\n`;
  }
}

/**
 * Draft a reply. NEVER sends. Returns { to, subject:'Re: ...', body, status:'DRAFT', needs_human_review:true }.
 * The signature, if provided, is appended to the body. status is HARD-CODED to 'DRAFT'.
 */
export function draftReply(email = {}, { tone = 'professional', signature = '', category = null } = {}) {
  const cat = category || classifyEmail(email).category;
  const to = fromAddress(email);
  const rawSubject = esc(email.subject).trim();
  const subject = /^re:/i.test(rawSubject) ? rawSubject : `Re: ${rawSubject}`;
  let body = replyBody(cat, email, tone);
  if (signature) body += `\n${esc(signature)}\n`;
  return {
    to,
    subject,
    body,
    tone,
    category: cat,
    status: 'DRAFT',            // never 'sent' — this module cannot send
    needs_human_review: true,   // every draft is held for operator review
  };
}

/** Safe-to-log summary of an email for audit: from / subject / category only — NOT the body. */
export function redactEmail(email = {}) {
  const { category } = classifyEmail(email);
  return {
    from: fromAddress(email),
    subject: esc(email.subject),
    date: esc(email.date || email.receivedAt || ''),
    category,
    // body deliberately omitted — never logged
  };
}

/** A short, body-free summary row for triage output. */
function emailSummary(email, classification) {
  return {
    from: fromAddress(email),
    subject: esc(email.subject),
    date: esc(email.date || email.receivedAt || ''),
    category: classification.category,
    priority: classification.priority,
    reasons: classification.reasons,
  };
}

/**
 * Triage a list of emails: classify, sort by priority (desc), and attach a suggested DRAFT for
 * actionable categories only (inquiry / collaboration / urgent — never spam/newsletter/etc).
 * Returns { items:[{ ...summary, suggestedDraft? }], summary:{ byCategory } }.
 * Pure given the (default or injected) classifier; no network.
 */
export function triageInbox(emails = [], opts = {}) {
  const list = Array.isArray(emails) ? emails : [];
  const items = list.map((email) => {
    const classification = classifyEmail(email);
    const row = emailSummary(email, classification);
    if (ACTIONABLE.has(classification.category)) {
      row.suggestedDraft = draftReply(email, { ...opts, category: classification.category });
    }
    return row;
  });

  // stable sort by priority desc
  items.sort((a, b) => b.priority - a.priority);

  const byCategory = {};
  for (const c of CATEGORIES) byCategory[c] = 0;
  for (const it of items) byCategory[it.category] = (byCategory[it.category] || 0) + 1;

  return { items, summary: { byCategory, total: items.length } };
}

/**
 * Optional convenience: fetch raw messages via an injected mail source, normalize lightly, then triage.
 * Soft-fails to an empty triage if no source is set or the source throws. Read-only.
 */
export async function triageFromSource(args = {}, opts = {}) {
  if (!_mailSource) return triageInbox([], opts);
  let raw;
  try {
    raw = await _mailSource(args);
  } catch {
    return triageInbox([], opts);
  }
  const emails = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.list) ? raw.list : []);
  return triageInbox(emails, opts);
}

// NOTE: there is deliberately NO send/push/sync function in this module. Read + triage + draft only.
// Every draft is status:'DRAFT', needs_human_review:true. The operator sends.

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('inbox-triage.mjs')) {
  const demo = [
    { from: 'Vendor Co <billing@vendor.example>', subject: 'Invoice #4471 — payment due', body: 'Your invoice amount due is $1,200, net 30.' },
    { from: 'Dr. A. Patel <patel@uni.example>', subject: 'URGENT: data needed before deadline', body: 'We need the figures ASAP, the submission deadline is tomorrow.' },
    { from: 'Conf Org <chair@conf.example>', subject: 'Partnership / co-author opportunity', body: 'We would love to collaborate on a joint research proposal.' },
    { from: 'News <no-reply@list.example>', subject: 'Weekly digest', body: 'To unsubscribe, click here. View in browser.' },
    { from: 'Stranger <win@spam.example>', subject: 'Congratulations you have won the lottery', body: 'Claim your bitcoin doubler prize, act now limited.' },
  ];
  const sig = vkfriSignature({ name: 'R. Van Kush', title: 'Director' });
  const { items, summary } = triageInbox(demo, { signature: sig });
  console.log('inbox-triage — READ + DRAFT only (operator sends). No send function exists.\n');
  console.log('byCategory:', JSON.stringify(summary.byCategory));
  for (const it of items) {
    console.log(`\n[p${it.priority}] ${it.category.toUpperCase().padEnd(13)} ${it.subject}`);
    if (it.suggestedDraft) console.log(`   draft → status:${it.suggestedDraft.status} needs_human_review:${it.suggestedDraft.needs_human_review}`);
  }
  console.log('\n— signature block —\n' + sig);
}
