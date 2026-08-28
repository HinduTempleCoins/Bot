// credentials-issuer.mjs — the MELEK Academy credential ISSUER + verifiable REGISTRY.
//
// This is the hub the operator asked for: the system every MELEK credential goes into. It ISSUES
// legitimate NON-ACCREDITED credentials (the aggregator at site/credentials/ points OUTWARD to other
// people's credentials; THIS issues OUR OWN) and makes them verifiable in the Open Badges 3.0 shape,
// with an on-chain-anchor seam for MELEK/PRANA.
//
// Legitimacy basis (why these are real without accreditation):
//   • Religious/ministerial credentials — we are an IRS-recognized church (The Shaivite Temple + the
//     Van Kush Syncretic Temple of Angels, § 508(c)(1)(A)); churches ordain and issue religious
//     credentials under the First Amendment.
//   • Press credentials — MELEK is a publisher; news organizations issue press passes under freedom of
//     the press (not the government). A pass credentials the bearer as MELEK press; venue honor is the
//     venue's call — stated honestly on the credential.
//   • Course-completion / certification / skill-badge — the Udemy/Edovo/Credly model: legitimate proof
//     of completion or competence; NOT accredited, NOT college credit, NOT a CEU — and we SAY SO.
// Accreditation (IACET/CHEA) is a LATER stamp layered on top, never claimed here.
//
// PURE + offline: no network, no keys. Verification is a deterministic sha256 over the credential's
// core fields (anyone can recompute); the private-key signature / on-chain anchor is a documented seam
// (verification.anchor) filled later via MELEK-Signer — this module never holds a key (zero-WIF).

import { createHash } from 'node:crypto';

// ── issuing authorities ─────────────────────────────────────────────────────────────────────────
export const ISSUERS = Object.freeze({
  temple: { id: 'temple', name: 'The Shaivite Temple / Van Kush Syncretic Temple of Angels', kind: 'church', basis: 'IRS church § 508(c)(1)(A); First Amendment free exercise' },
  press: { id: 'press', name: 'MELEK Press', kind: 'publisher', basis: 'First Amendment freedom of the press; credentials issued by the news organization' },
  academy: { id: 'academy', name: 'MELEK Academy', kind: 'education', basis: 'Non-accredited certificate of completion / certification (Udemy/Edovo model)' },
});

// ── credential types ────────────────────────────────────────────────────────────────────────────
export const CREDENTIAL_TYPES = Object.freeze({
  ministerial: { code: 'MIN', label: 'Ministerial / Religious', issuer: 'temple' },
  press: { code: 'PRESS', label: 'Press Credential', issuer: 'press' },
  completion: { code: 'CERT', label: 'Certificate of Completion', issuer: 'academy' },
  certification: { code: 'CTFN', label: 'Certification', issuer: 'academy' },
  badge: { code: 'BADGE', label: 'Skill Badge', issuer: 'academy' },
});

// ── the programs we offer (the catalog) ───────────────────────────────────────────────────────────
export const PROGRAMS = Object.freeze([
  { id: 'melek-press-pass', type: 'press', track: 'press', name: 'MELEK Press Pass',
    description: 'Credentials the bearer as a contributor to MELEK Press, our publishing arm, so they can report and publish as part of MELEK.',
    criteria: 'Agree to the MELEK Press contributor standards and publish at least one piece under the MELEK masthead.',
    note: 'A press credential issued by a news organization under the First Amendment. It identifies you as MELEK press; whether a given venue grants access on it is that venue’s decision.' },
  { id: 'ordination-minister', type: 'ministerial', track: 'ministry', name: 'Ordination — Minister of the Van Kush Syncretic Temple of Angels',
    description: 'Ordains the recipient as a minister of the Temple, empowered to perform the rites the Temple recognizes.',
    criteria: 'Affirm the Temple’s tenets and complete the ministerial orientation.',
    note: 'An ecclesiastical credential issued by an IRS-recognized church under the First Amendment. It is a religious credential, not a state license.' },
  { id: 'religious-education', type: 'ministerial', track: 'ministry', name: 'Religious Education Certificate',
    description: 'Recognizes completion of a course of religious study within the Temple’s syncretic-Angelic tradition.',
    criteria: 'Complete the assigned readings and reflections and pass the review.',
    note: 'A church-issued religious-education credential. Non-accredited; not college credit.' },
  { id: 'angelic-ai-foundations', type: 'completion', track: 'ai', name: 'Angelic AI — Foundations',
    description: 'Our own method: building and working with AI the Angelic way — the practice behind Hathor and the MELEK AI stack.',
    criteria: 'Complete the Angelic AI Foundations course and the hands-on build exercise.',
    note: 'Certificate of completion of a MELEK Academy course. Non-accredited; proof of completion, not a degree or CEU.' },
  { id: 'crypto-blockchain-literacy', type: 'completion', track: 'crypto', name: 'Crypto & Blockchain Literacy',
    description: 'Wallets, keys, chains, DeFi, and witnessing — built on the Witness School and the MELEK tutorials.',
    criteria: 'Complete the crypto-literacy track and demonstrate a wallet, a transaction, and a witness lookup.',
    note: 'Certificate of completion. Non-accredited; educational — not financial advice and no returns promised.' },
  { id: 'first-amendment-press-religion', type: 'completion', track: 'civics', name: 'The First Amendment for Press & Religion',
    description: 'How the press and religion clauses actually work — the ground under MELEK’s press passes and the Temple’s credentials.',
    criteria: 'Complete the course and the short assessment.',
    note: 'Certificate of completion. Educational, not legal advice.' },
  { id: 'plant-medicine-harm-reduction', type: 'completion', track: 'library', name: 'Plant-Medicine Harm-Reduction & History',
    description: 'History, ethnobotany, pharmacology, and harm-reduction — the Library-of-Ashurbanipal reference tradition.',
    criteria: 'Complete the harm-reduction curriculum and the safety assessment.',
    note: 'Educational and harm-reduction only. NOT a manufacturing, cultivation, or clinical credential, and not medical advice.' },
  { id: 'ancient-mysteries', type: 'completion', track: 'esoteric', name: 'Ancient Mysteries — Foundations',
    description: 'A survey of the ancient mystery traditions in the Temple’s syncretic frame.',
    criteria: 'Complete the readings and the reflective assessment.',
    note: 'Certificate of completion. Non-accredited; a course in the study of these traditions.' },
]);

const PROGRAM_BY_ID = new Map(PROGRAMS.map((p) => [p.id, p]));
export function getProgram(id) { return PROGRAM_BY_ID.get(String(id || '')) || null; }
export function programsInTrack(track) { return PROGRAMS.filter((p) => p.track === track); }

// ── pure helpers ──────────────────────────────────────────────────────────────────────────────────
const nn = (v) => (v == null ? '' : String(v));
export function slugify(s) {
  return nn(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}
function sha256hex(s) { return createHash('sha256').update(nn(s), 'utf8').digest('hex'); }

/** The canonical, order-fixed string of a credential's CORE (immutable) fields. Verification hashes this. */
export function canonicalCredential(core) {
  const c = core || {};
  return [
    'melek-credential:v1',
    `program=${nn(c.programId)}`,
    `type=${nn(c.type)}`,
    `issuer=${nn(c.issuer)}`,
    `recipientName=${nn(c.recipientName)}`,
    `recipientId=${nn(c.recipientId)}`,
    `issuedAt=${nn(c.issuedAt)}`,
    `expiresAt=${nn(c.expiresAt)}`,
    `evidence=${nn(c.evidence)}`,
  ].join('\n');
}
export function hashCredential(core) { return sha256hex(canonicalCredential(core)); }

/** Human-facing verifiable id: MELEK-<TYPECODE>-<12 hex>. Derived from the hash so it is deterministic. */
export function credentialId(core) {
  const t = CREDENTIAL_TYPES[nn(core && core.type)] || { code: 'CRED' };
  return `MELEK-${t.code}-${hashCredential(core).slice(0, 12).toUpperCase()}`;
}

// ── issue ───────────────────────────────────────────────────────────────────────────────────────
/**
 * Issue a credential for a program + recipient. Pure: returns the credential object (no I/O, no keys).
 * Soft-fails to { ok:false, reason } on a bad program. `now` is injectable (ISO string or Date).
 */
export function issueCredential({ programId, recipientName, recipientId = '', evidence = '', now = new Date(), expiresInDays = 0 } = {}) {
  const program = getProgram(programId);
  if (!program) return { ok: false, reason: `unknown-program:${nn(programId)}` };
  if (!nn(recipientName).trim()) return { ok: false, reason: 'recipient-name-required' };
  const issuedAt = (now instanceof Date ? now : new Date(now)).toISOString().slice(0, 10);
  const expiresAt = expiresInDays > 0
    ? new Date((now instanceof Date ? now : new Date(now)).getTime() + expiresInDays * 864e5).toISOString().slice(0, 10)
    : '';
  const type = program.type;
  const issuerId = CREDENTIAL_TYPES[type].issuer;
  const core = { programId: program.id, type, issuer: issuerId, recipientName: nn(recipientName).trim(), recipientId: nn(recipientId).trim(), issuedAt, expiresAt, evidence: nn(evidence) };
  const id = credentialId(core);
  const hash = hashCredential(core);
  return {
    ok: true,
    credential: {
      id,
      type,
      typeLabel: CREDENTIAL_TYPES[type].label,
      program: { id: program.id, name: program.name, track: program.track },
      issuer: ISSUERS[issuerId],
      recipient: { name: core.recipientName, id: core.recipientId || null },
      criteria: program.criteria,
      note: program.note,
      issuedAt,
      expiresAt: expiresAt || null,
      evidence: core.evidence || null,
      accreditation: 'non-accredited',
      disclaimer: 'A verifiable MELEK credential. Non-accredited: it is not college credit, a CEU, or a government license. Its authority is the issuer named above.',
      verification: { method: 'sha256', hash, anchor: null }, // anchor: filled later via MELEK-Signer (on-chain)
    },
  };
}

// ── verify ──────────────────────────────────────────────────────────────────────────────────────
/** Recompute the hash from a credential's core fields and compare. Also checks expiry. Soft-fails. */
export function verifyCredential(cred, { now = new Date() } = {}) {
  if (!cred || typeof cred !== 'object' || !cred.verification) return { valid: false, reason: 'not-a-credential' };
  const core = {
    programId: cred.program && cred.program.id, type: cred.type,
    issuer: cred.issuer && cred.issuer.id, recipientName: cred.recipient && cred.recipient.name,
    recipientId: (cred.recipient && cred.recipient.id) || '', issuedAt: cred.issuedAt,
    expiresAt: cred.expiresAt || '', evidence: cred.evidence || '',
  };
  const expect = hashCredential(core);
  if (expect !== cred.verification.hash) return { valid: false, reason: 'hash-mismatch (altered or forged)' };
  if (credentialId(core) !== cred.id) return { valid: false, reason: 'id-mismatch' };
  if (cred.expiresAt) {
    const today = (now instanceof Date ? now : new Date(now)).toISOString().slice(0, 10);
    if (today > cred.expiresAt) return { valid: false, reason: 'expired', expiredOn: cred.expiresAt };
  }
  return { valid: true, reason: cred.verification.anchor ? 'verified (anchored on-chain)' : 'verified (issuer hash)' };
}

// ── Open Badges 3.0 export ────────────────────────────────────────────────────────────────────────
/** Shape a credential as an Open Badges 3.0 / W3C Verifiable Credential (JSON-LD). Portable + verifiable. */
export function toOpenBadge(cred, { baseUrl = 'https://academy.melek.salon' } = {}) {
  if (!cred || !cred.id) return null;
  const base = nn(baseUrl).replace(/\/$/, '');
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json'],
    id: `${base}/credential/${encodeURIComponent(cred.id)}`,
    type: ['VerifiableCredential', 'OpenBadgeCredential'],
    issuer: { id: `${base}/issuer/${cred.issuer.id}`, type: ['Profile'], name: cred.issuer.name },
    validFrom: `${cred.issuedAt}T00:00:00Z`,
    ...(cred.expiresAt ? { validUntil: `${cred.expiresAt}T00:00:00Z` } : {}),
    credentialSubject: {
      type: ['AchievementSubject'],
      ...(cred.recipient.id ? { identifier: cred.recipient.id } : {}),
      name: cred.recipient.name,
      achievement: {
        id: `${base}/achievement/${cred.program.id}`,
        type: ['Achievement'],
        name: cred.program.name,
        description: cred.note,
        criteria: { narrative: cred.criteria },
      },
    },
    // MELEK verification block (self-contained hash; on-chain anchor when present).
    credentialStatus: { type: 'MelekHashVerification', method: cred.verification.method, hash: cred.verification.hash, anchor: cred.verification.anchor },
  };
}

// ── registry (injectable persistence; default in-memory) ───────────────────────────────────────────
/**
 * A registry over an injectable store. `store` may be a Map, or any { get(id), set(id,val), values() }.
 * Pure/offline by default (Map). A real deploy injects a durable store (and later anchors verification
 * hashes on MELEK/PRANA via the Signer). Never holds a key.
 */
export function createRegistry(store = new Map()) {
  const get = (id) => (typeof store.get === 'function' ? store.get(id) : undefined);
  const set = (id, v) => (typeof store.set === 'function' ? store.set(id, v) : undefined);
  const values = () => (typeof store.values === 'function' ? Array.from(store.values()) : []);
  return {
    issue(args) {
      const r = issueCredential(args);
      if (!r.ok) return r;
      set(r.credential.id, r.credential);
      return r;
    },
    get(id) { return get(nn(id)) || null; },
    verify(id) { const c = get(nn(id)); return c ? verifyCredential(c) : { valid: false, reason: 'not-found' }; },
    list({ type = '', track = '' } = {}) {
      return values().filter((c) => (!type || c.type === type) && (!track || (c.program && c.program.track === track)));
    },
    count() { return values().length; },
  };
}

// ── CLI demo (guarded) ────────────────────────────────────────────────────────────────────────────
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('credentials-issuer.mjs')) {
  const reg = createRegistry();
  const a = reg.issue({ programId: 'melek-press-pass', recipientName: 'Jane Reporter', recipientId: 'jane', now: new Date('2026-08-28') });
  console.log('issued:', a.credential.id, '=', a.credential.program.name);
  console.log('verify:', reg.verify(a.credential.id));
  const tampered = JSON.parse(JSON.stringify(a.credential)); tampered.recipient.name = 'Someone Else';
  console.log('tampered verify:', verifyCredential(tampered));
  console.log('open badge:', JSON.stringify(toOpenBadge(a.credential)).slice(0, 120), '…');
  console.log('programs:', PROGRAMS.length, '| registry count:', reg.count());
}
