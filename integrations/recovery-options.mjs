// recovery-options.mjs — the full menu of account-recovery factors a user can choose from, IF they opt into
// recovery. One source of truth that drives the chooser UI, the key-wrapping engine, and validation. Opt-in:
// no recovery by default (pure zero-knowledge, unrecoverable, clearly warned). When a user opts in, they see
// ALL of these and assemble a K-of-N path; recovery reconstructs the wrapped data key via Shamir shares.
// Pure data + validators, no network. Each factor: where the secret lives (online/offline), its strength,
// and whether it may stand as a full path alone.
//
//   import { RECOVERY_FACTORS, byCategory, validatePath, STRONG } from './recovery-options.mjs'

export const CATEGORIES = {
  know: 'Something you know',
  have: 'Something you have',
  are: 'Something you are',
  crypto: 'Crypto / MELEK',
  social: 'Social / delegated',
  identity: 'Identity',
  time: 'Time / anti-theft',
};

// strength: 'strong' factors can anchor a recovery path; 'medium'/'weak' must be combined with a strong one.
export const RECOVERY_FACTORS = [
  // — know —
  { id: 'passphrase', label: 'Passphrase / PIN', cat: 'know', strength: 'medium', standalone: false, online: true, offline: false, what: 'A secret you type, stretched into a key.', howto: 'Choose a strong passphrase; we never store it, only a salt.' },
  { id: 'security-questions', label: 'Security questions (your own)', cat: 'know', strength: 'weak', standalone: false, online: true, offline: false, what: 'Questions you write yourself — childhood pet, first teacher, etc.', howto: 'Write 3+ Q&A only you know; answers are hashed, never stored in clear.' },
  { id: 'mnemonic', label: 'Recovery phrase (12/24 words)', cat: 'know', strength: 'strong', standalone: true, online: false, offline: true, what: 'A BIP39-style word list you write down and keep.', howto: 'Write the words on paper and store them safely; anyone with them can recover.' },
  { id: 'image-password', label: 'Image / graphical password', cat: 'know', strength: 'medium', standalone: false, online: true, offline: false, what: 'Click-points on an image you pick.', howto: 'Pick an image and a sequence of points; the pattern becomes part of the key.' },
  // — have —
  { id: 'decoder-key', label: 'Decoder key / keyfile', cat: 'have', strength: 'strong', standalone: true, online: false, offline: true, what: 'A random key file you download and keep (USB, cloud, etc.).', howto: 'Download the keyfile and keep it safe; it is required to open the data.' },
  { id: 'recovery-codes', label: 'Printed recovery codes / QR', cat: 'have', strength: 'strong', standalone: true, online: false, offline: true, what: 'One-time codes / a QR "decoder ring" you print on paper.', howto: 'Print and store the codes offline; each opens recovery once.' },
  { id: 'image-keyfile', label: 'An image you keep (image-as-key)', cat: 'have', strength: 'strong', standalone: true, online: false, offline: true, what: 'An image whose exact bytes become part of the key.', howto: 'Keep the exact original file — do not re-save or re-compress it.' },
  { id: 'passkey', label: 'Passkey (Face/Touch ID or security key)', cat: 'have', strength: 'strong', standalone: true, online: true, offline: false, what: 'WebAuthn passkey — biometric or device-bound.', howto: 'Register a passkey; the private key never leaves your device.' },
  { id: 'hardware-key', label: 'Hardware security key (YubiKey/FIDO2)', cat: 'have', strength: 'strong', standalone: true, online: true, offline: false, what: 'A physical FIDO2 key.', howto: 'Register your security key; tap it to recover.' },
  { id: 'totp', label: 'Authenticator app (TOTP)', cat: 'have', strength: 'medium', standalone: false, online: true, offline: false, what: 'Time-based 6-digit codes (Google Authenticator/Authy).', howto: 'Scan the QR into your authenticator app.' },
  { id: 'email', label: 'Email magic link / code', cat: 'have', strength: 'medium', standalone: false, online: true, offline: false, what: 'A link or code sent to your email.', howto: 'Confirm the email you control; convenient but weaker for high-value data.' },
  { id: 'sms', label: 'Phone / SMS code', cat: 'have', strength: 'weak', standalone: false, online: true, offline: false, what: 'A code by text.', howto: 'Convenient, but vulnerable to SIM-swap — best only as an extra factor.' },
  // — are —
  { id: 'biometric', label: 'Device biometrics (via passkey)', cat: 'are', strength: 'strong', standalone: true, online: true, offline: false, what: 'Fingerprint/face through a passkey — biometric never leaves the device.', howto: 'Use your device biometric when prompted; we never see the biometric itself.' },
  // — crypto / MELEK —
  { id: 'melek-signer', label: 'MELEK-Signer (your MELEK account)', cat: 'crypto', strength: 'strong', standalone: true, online: true, offline: false, what: 'Prove control of your MELEK account by signing a challenge.', howto: 'Sign the recovery challenge with your MELEK account to release your share.' },
  { id: 'wallet-signature', label: 'Any wallet signature', cat: 'crypto', strength: 'strong', standalone: true, online: true, offline: false, what: 'Sign a message with a wallet you control.', howto: 'Connect a wallet and sign; the signature releases a share.' },
  { id: 'second-account', label: 'A second MELEK account you own', cat: 'crypto', strength: 'strong', standalone: true, online: true, offline: false, what: 'A backup account you also control.', howto: 'Name a second account; control of it can recover the first.' },
  // — social / delegated —
  { id: 'social-guardians', label: 'Social recovery (trusted guardians)', cat: 'social', strength: 'strong', standalone: true, online: true, offline: false, what: 'Trusted contacts each hold a share; K-of-N of them approve.', howto: 'Pick guardians and a threshold (e.g. 3 of 5); they approve your recovery.' },
  { id: 'delegate', label: 'Delegate to a Pentecaust user / team admin', cat: 'social', strength: 'medium', standalone: false, online: true, offline: false, what: 'Another user or an admin can approve recovery.', howto: 'Name a delegate who can help you recover.' },
  // — identity —
  { id: 'identity-check', label: 'Identity / credit verification', cat: 'identity', strength: 'strong', standalone: true, online: true, offline: false, what: 'A KYC/credit provider confirms you; we get only pass/fail — your PII stays with them.', howto: 'Complete a one-time identity check with the provider; we never store the documents.' },
  // — time / anti-theft —
  { id: 'time-delay', label: 'Time-delayed recovery', cat: 'time', strength: 'medium', standalone: false, online: true, offline: false, what: 'Recovery unlocks after a waiting period unless you cancel — stops a thief using a stolen factor.', howto: 'Set a delay (e.g. 3 days); you get alerts and can cancel a rogue attempt.' },
];

export const STRONG = new Set(RECOVERY_FACTORS.filter((f) => f.strength === 'strong').map((f) => f.id));
export function factor(id) { return RECOVERY_FACTORS.find((f) => f.id === id) || null; }
export function byCategory() {
  const m = {};
  for (const key of Object.keys(CATEGORIES)) m[key] = { label: CATEGORIES[key], factors: RECOVERY_FACTORS.filter((f) => f.cat === key) };
  return m;
}

// Validate a user's chosen recovery path. `selected` = factor ids; `threshold` = K required (K-of-N).
// Rule: at least one STRONG factor must be present, since weak/medium factors alone are guessable/phishable.
export function validatePath(selected = [], { threshold = 0 } = {}) {
  const ids = [...new Set((selected || []).filter((x) => factor(x)))];
  const errors = []; const warnings = [];
  if (ids.length < 1) errors.push('Choose at least one recovery factor.');
  const k = threshold || ids.length; // default: all required
  if (k < 1) errors.push('Threshold must be at least 1.');
  if (k > ids.length) errors.push('Threshold cannot exceed the number of factors chosen.');
  const hasStrong = ids.some((id) => STRONG.has(id));
  if (ids.length && !hasStrong) errors.push('A recovery path must include at least one strong factor (passkey, MELEK-Signer, hardware key, keyfile, guardians, or identity check).');
  if (ids.includes('sms') && k <= 1) warnings.push('SMS alone is weak (SIM-swap) — combine it with another factor.');
  if (ids.includes('email') && ids.length === 1) warnings.push('Email-only recovery is convenient but weaker for high-value data.');
  return { valid: errors.length === 0, errors, warnings, threshold: k, count: ids.length, hasStrong };
}

if (process.argv[1] && process.argv[1].endsWith('recovery-options.mjs')) {
  console.log(`${RECOVERY_FACTORS.length} recovery factors across ${Object.keys(CATEGORIES).length} categories`);
  console.log('example path [melek-signer, security-questions] 2-of-2:', JSON.stringify(validatePath(['melek-signer', 'security-questions'], { threshold: 2 })));
}
