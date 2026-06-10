// signup/providers.mjs — the MELEK signup VENDOR-PICKER registry (the Ecency/LEO-on-Hive pattern).
//
// Per the condenser CLAUDE.md "Signup architecture": the wallet has NO signup backend of its own and
// never will. Clicking "Sign up" opens a vendor-picker — a list of providers that each offer account
// creation; the user picks one and that vendor's flow takes over. Security comes from inheriting
// audited third-party flows, not from rolling our own. THIS module is the registry behind that picker,
// and the seam that lets "other people create signup options" (operator 2026-06-10): a third party adds
// an entry (a PR against this list, or a `community` entry) and their onboarding shows up in the picker.
//
// Every entry is just data — a link out to a flow. This module holds NO keys and creates NO accounts;
// it only describes where the flows live. Pure + offline-testable.
//
//   import { listProviders, getProvider, validateProvider, PROVIDER_SCHEMA } from './providers.mjs'
//   listProviders()                      -> active providers (default)
//   listProviders({ status: 'all' })     -> everything incl. planned/community
//   listProviders({ chain: 'MELEK' })    -> filter by chain

// status: 'active' = live now | 'planned' = on the roadmap | 'community' = run by a third party
// badge: short human label shown on the card.
const PROVIDERS = [
  {
    id: 'melek-email',
    name: 'MELEK Email Signup',
    chain: 'MELEK',
    url: 'https://signup.melek.salon/',
    status: 'active',
    badge: 'Official',
    maintainer: 'MELEK / Van Kush Family',
    summary: 'The official account creator — pick a name, get your keys in your browser, optional email backup, voucher support.',
    custody: 'Your keys are generated in your browser. The creator account only broadcasts your account with your PUBLIC keys; your password/private keys are never sent anywhere. Email is used only for an optional encrypted backup.',
  },
  {
    id: 'hathor-guided',
    name: 'Hathor — Guided Chat',
    chain: 'MELEK',
    url: 'https://alpha.melek.salon/account/chat.html',
    status: 'active',
    badge: 'Beginner-friendly',
    maintainer: 'MELEK',
    summary: 'New and not sure where to start? Chat with Hathor — she explains it and points you to the signup page. You make the account yourself.',
    custody: 'Hathor NEVER asks for, sees, or stores a key or password. She only guides; the account is created on the signup page in your browser.',
  },
  {
    id: 'melek-browser',
    name: 'In-Browser Account Creator',
    chain: 'MELEK',
    url: 'https://alpha.melek.salon/account/signup.html',
    status: 'active',
    badge: 'No email needed',
    maintainer: 'MELEK',
    summary: 'Make a name, generate keys in your browser, save them, and create the account — no email required. Best if you just want to get going.',
    custody: 'Keys are generated locally; the server only ever receives your name and your PUBLIC keys. You must save your keys and re-type your master password before the account is created.',
  },
  {
    id: 'blurt-email',
    name: 'BLURT Account Creation',
    chain: 'BLURT',
    url: '',
    status: 'planned',
    badge: 'Other chain',
    maintainer: 'MELEK (same code, BLURT chain config)',
    summary: 'Onboard to the original BLURT chain through the same flow, pointed at BLURT instead of MELEK.',
    custody: 'Same browser-side key generation as the MELEK flows; only the target chain differs.',
  },
  {
    id: 'steem-email',
    name: 'STEEM Account Creation',
    chain: 'STEEM',
    url: '',
    status: 'planned',
    badge: 'Other chain',
    maintainer: 'MELEK (same code, STEEM chain config)',
    summary: 'Onboard to STEEM through the same flow, pointed at STEEM — part of the long-term multi-chain wallet.',
    custody: 'Same browser-side key generation; only the target chain differs.',
  },
];

// The shape a third party must provide to add their own signup option to the picker. Keep this in sync
// with validateProvider below — it is the public contract for "other people create signup options".
export const PROVIDER_SCHEMA = {
  id: 'string  — short kebab-case unique id (e.g. "acme-onboard")',
  name: 'string — display name shown on the card',
  chain: 'string — target chain symbol (e.g. MELEK, BLURT, STEEM)',
  url: 'string — https:// link to the provider\'s own account-creation flow',
  status: 'string — "active" | "planned" | "community" (third parties use "community")',
  badge: 'string (optional) — short label (e.g. "Community")',
  maintainer: 'string — who runs it (so users know who they are trusting)',
  summary: 'string — one or two sentences on what it does',
  custody: 'string — plain-language statement of how keys/passwords are handled (REQUIRED: must say keys are made in the user\'s browser and never sent in plaintext)',
};

const VALID_STATUS = new Set(['active', 'planned', 'community']);
const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

/**
 * Validate a provider entry (used when a third party submits one). Returns { ok, errors }.
 * Does NOT vet the custody CLAIM is true — it only checks the entry is well-formed and that a custody
 * statement is present. A human reviews community submissions before they go live (see signup/server).
 * @param {object} p
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateProvider(p) {
  const errors = [];
  if (!p || typeof p !== 'object') return { ok: false, errors: ['not an object'] };
  if (typeof p.id !== 'string' || !ID_RE.test(p.id)) errors.push('id must be kebab-case, 2-40 chars, letter-led');
  if (typeof p.name !== 'string' || !p.name.trim()) errors.push('name is required');
  if (typeof p.chain !== 'string' || !p.chain.trim()) errors.push('chain is required');
  if (typeof p.maintainer !== 'string' || !p.maintainer.trim()) errors.push('maintainer is required');
  if (typeof p.summary !== 'string' || !p.summary.trim()) errors.push('summary is required');
  if (typeof p.custody !== 'string' || !p.custody.trim()) errors.push('custody statement is required');
  if (!VALID_STATUS.has(p.status)) errors.push(`status must be one of ${[...VALID_STATUS].join(', ')}`);
  // A live ('active'/'community') provider must have an https URL; 'planned' may omit it.
  if (p.status !== 'planned') {
    if (typeof p.url !== 'string' || !/^https:\/\//i.test(p.url)) errors.push('url must be an https:// link for active/community providers');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * List providers. Defaults to the live ('active') ones; pass status:'all' for everything, or a specific
 * status. Optionally filter by chain. Returns copies (callers can't mutate the registry).
 * @param {object} [opts]
 * @param {'active'|'planned'|'community'|'all'} [opts.status='active']
 * @param {string} [opts.chain]   e.g. 'MELEK'
 * @returns {Array<object>}
 */
export function listProviders({ status = 'active', chain } = {}) {
  return PROVIDERS
    .filter((p) => (status === 'all' ? true : p.status === status))
    .filter((p) => (chain ? p.chain.toUpperCase() === String(chain).toUpperCase() : true))
    .map((p) => ({ ...p }));
}

/** Get one provider by id, or null. */
export function getProvider(id) {
  const p = PROVIDERS.find((x) => x.id === id);
  return p ? { ...p } : null;
}

if (process.argv[1] && /providers\.mjs$/.test(process.argv[1])) {
  const all = listProviders({ status: 'all' });
  console.log(`MELEK signup vendor-picker — ${all.length} providers`);
  for (const p of all) console.log(`  [${p.status}] ${p.name} (${p.chain}) — ${p.url || '(no url yet)'}`);
}
