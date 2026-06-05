// custody.mjs — the honest-custody confirmation logic for a freshly generated wallet.
//
// Pure, framework-free logic so the "did the user actually save their seed?" gate is unit
// tested independently of any DOM. The Phase-B page wires these into inputs/buttons.
//
// Flow:
//   1. Show the seed ONCE (the page calls this with the generated mnemonic).
//   2. Ask the user to type back 3 specific words (by position) to prove they wrote it down.
//   3. Only when checkConfirmation() passes does the page let them proceed / start mining.
//
// Nothing here is sent anywhere; this is all on-device.

// Pick `count` distinct 1-based word positions to quiz, using an injected RNG (0..1).
// Deterministic when a fixed RNG is passed (tests); cryptographic randomness in the browser.
export function pickConfirmationPositions(wordCount, count = 3, rng = Math.random) {
  if (wordCount < count) throw new Error('not enough words to quiz');
  const positions = new Set();
  // Avoid quizzing the 25th (checksum) word — confirm only the 24 entropy words.
  const max = wordCount === 25 ? 24 : wordCount;
  while (positions.size < count) {
    positions.add(1 + Math.floor(rng() * max));
  }
  return [...positions].sort((a, b) => a - b);
}

// Normalize a typed word the way we compare it (trim + lowercase). Monero words are ASCII
// lowercase, so this is sufficient; we do NOT prefix-match here (the user must type it right).
const norm = (w) => String(w == null ? '' : w).trim().toLowerCase();

/**
 * checkConfirmation(mnemonic, positions, answers) -> { ok, wrong:[positions] }.
 * @param {string} mnemonic - the 25-word phrase shown to the user
 * @param {number[]} positions - 1-based positions being quizzed
 * @param {Object|Map} answers - position -> typed word
 */
export function checkConfirmation(mnemonic, positions, answers) {
  const words = String(mnemonic).trim().split(/\s+/);
  const get = (pos) => (answers instanceof Map ? answers.get(pos) : answers[pos]);
  const wrong = [];
  for (const pos of positions) {
    const expected = norm(words[pos - 1]);
    if (norm(get(pos)) !== expected) wrong.push(pos);
  }
  return { ok: wrong.length === 0, wrong };
}

// Build a plain-text export of the wallet for the "download" custody option. We export the
// recoverable secret + the public address, with a loud header. (The page may further offer
// a passphrase-encrypted variant; the unencrypted text is the floor.)
export function buildBackupText(wallet) {
  const lines = [
    '=== SoapBox Mining Pool — wallet backup ===',
    `Coin:        ${wallet.name} (${wallet.symbol})`,
    `Address:     ${wallet.address}`,
    '',
  ];
  if (wallet.mnemonic) {
    lines.push('Recovery phrase (25 words) — THIS is your backup. Keep it secret and offline:');
    lines.push(wallet.mnemonic);
  }
  if (wallet.privateKey) {
    lines.push('Private key — THIS is your backup. Keep it secret and offline:');
    lines.push(wallet.privateKey);
    lines.push('(This one key controls this address on every EVM chain.)');
  }
  lines.push(
    '',
    'WARNING: Anyone with this phrase/key can spend your funds. The pool never had it and',
    'cannot recover it. If you lose it, your funds are lost. Store it offline.',
    `Created: ${new Date().toISOString()}`,
  );
  return lines.join('\n') + '\n';
}

// The seed-custody warning copy, surfaced verbatim by the page before revealing the seed.
export const SEED_REVEAL_WARNING =
  'You are about to see your secret recovery phrase. Write it down on paper now. Do NOT ' +
  'screenshot it, do NOT paste it into a website, do NOT email it to yourself. This pool ' +
  'site never stores it and can never recover it. If anyone else gets it, they get your ' +
  'coins.';
