// kula-ring.mjs — the KULA RING gift-economy analogy mapper (backlog 99078c0bdf).
//
// The Kula Ring is the ceremonial exchange system of the Trobriand / Massim islanders of the
// western Pacific, documented by Bronisław Malinowski (Argonauts of the Western Pacific, 1922) and
// later by Marcel Mauss (The Gift, 1925). Two classes of valuables circulate the island ring in
// fixed, opposite directions: red shell necklaces (SOULAVA) move clockwise, white shell armbands
// (MWALI) move counter-clockwise. The valuables are never permanently kept; their value lies in
// their HISTORY and in the standing the act of giving confers. A man does not own his mwali — he
// holds it, is known by the famous pieces that passed through his hands, and is obligated to pass
// it onward. Status accrues to the generous giver, not the hoarder.
//
// This module maps that anthropology onto the MELEK karma / curation model — the analogy used in
// the dialogue tree (knowledge/index.js holds only the dialogue string; this file is the data +
// formatting behind it). An upvote is a gift that circulates standing; reputation is the durable
// trace of valuables that passed through you; the obligation to give onward is the curation duty.
//
// PURE / deterministic. No network, no LLM, no secrets, soft-fail everywhere (never throws). CLI
// guarded by process.argv[1]. Every render path HTML-escapes its interpolated fields.
//
//   import { KULA_RING, explainAnalogy, renderMarkdown } from './kula-ring.mjs'
//   node knowledge/kula-ring.mjs            # print the deterministic Markdown explainer
//   node knowledge/kula-ring.mjs soulava    # explain one term

// --- HTML escape (single local copy; identical behavior to the engine's esc) ----------------
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- static data: the ceremonial exchange + its crypto analogues ----------------------------
//
// `terms` is keyed by a lowercase lookup slug. Each entry carries the anthropology (what the thing
// is in the Trobriand system) and the cryptoMapping (what it stands for in the karma/curation
// model). `directions` records the two opposite circulation paths. Frozen so callers cannot mutate
// the shared corpus.
export const KULA_RING = Object.freeze({
  name: 'The Kula Ring',
  source: 'Malinowski, Argonauts of the Western Pacific (1922); Mauss, The Gift (1925)',
  region: 'Massim / Trobriand Islands, western Pacific',
  thesis:
    'Valuables circulate rather than accumulate; standing comes from giving onward, not from ' +
    'hoarding. Reputation is the durable trace of what passed through your hands.',
  directions: Object.freeze([
    Object.freeze({
      item: 'soulava',
      circulation: 'clockwise',
      description: 'red shell necklaces, passed in the clockwise direction around the island ring',
    }),
    Object.freeze({
      item: 'mwali',
      circulation: 'counter-clockwise',
      description: 'white shell armbands, passed in the counter-clockwise direction',
    }),
  ]),
  terms: Object.freeze({
    soulava: Object.freeze({
      term: 'soulava',
      anthropology:
        'Red shell-disc necklaces, one of the two Kula valuables. They travel clockwise around ' +
        'the ring and are exchanged against the counter-moving mwali armbands.',
      cryptoMapping:
        'An upvote-as-gift moving one direction: a token of esteem handed onward to a worthy ' +
        'author, not kept. Its weight is the standing of who has held and given it before.',
    }),
    mwali: Object.freeze({
      term: 'mwali',
      anthropology:
        'White shell armbands, the second Kula valuable. They travel counter-clockwise, opposite ' +
        'to the soulava, completing the circulating exchange.',
      cryptoMapping:
        'The reciprocal flow of recognition back toward curators and earlier givers — curation ' +
        'reward moving opposite the upvote, so both authors and curators are kept in standing.',
    }),
    gift: Object.freeze({
      term: 'gift',
      anthropology:
        'In Mauss’s reading the Kula gift is never free: it carries an obligation to give, to ' +
        'receive, and to reciprocate. The valuable is held in trust and must move onward.',
      cryptoMapping:
        'An upvote is a gift, not a payment. It costs the giver a share of their finite voting ' +
        'standing and obligates them to keep circulating recognition rather than hoard it.',
    }),
    standing: Object.freeze({
      term: 'standing',
      anthropology:
        'A man is known by the famous valuables that passed through his hands. Prestige attaches ' +
        'to the generous giver who keeps the ring moving, not to whoever holds the most.',
      cryptoMapping:
        'Reputation: the durable, on-chain trace of the karma that flowed through an account. ' +
        'Standing rewards the consistent curator/giver, not the silent accumulator.',
    }),
    circulation: Object.freeze({
      term: 'circulation',
      anthropology:
        'The defining law of the ring: valuables must keep moving in their fixed direction. To ' +
        'stop a valuable is to break the obligation and lose face.',
      cryptoMapping:
        'Curation as duty: unused voting power decays / is wasted, so the model pushes karma to ' +
        'keep flowing outward to good work rather than sitting idle.',
    }),
  }),
});

// --- explainAnalogy(term) -> { anthropology, cryptoMapping } --------------------------------
//
// Case-insensitive, trimmed lookup against KULA_RING.terms. Soft-fail: an unknown or malformed
// term returns a safe shape with found:false rather than throwing.
export function explainAnalogy(term) {
  const key = String(term ?? '').trim().toLowerCase();
  const hit = key ? KULA_RING.terms[key] : undefined;
  if (!hit) {
    return Object.freeze({
      term: key,
      found: false,
      anthropology: '',
      cryptoMapping: '',
    });
  }
  return Object.freeze({
    term: hit.term,
    found: true,
    anthropology: hit.anthropology,
    cryptoMapping: hit.cryptoMapping,
  });
}

// --- renderMarkdown() -> deterministic Markdown explainer -----------------------------------
//
// Stable output: terms are emitted in a fixed, sorted order so the render is byte-stable across
// runs. Every interpolated field is esc()'d. Markdown, not HTML — but esc() still guards against
// stray angle brackets / ampersands leaking into a page that later embeds this text.
export function renderMarkdown() {
  const lines = [];
  lines.push(`# ${esc(KULA_RING.name)}`);
  lines.push('');
  lines.push(`*${esc(KULA_RING.region)} — ${esc(KULA_RING.source)}*`);
  lines.push('');
  lines.push(esc(KULA_RING.thesis));
  lines.push('');
  lines.push('## Circulation');
  lines.push('');
  for (const d of KULA_RING.directions) {
    lines.push(`- **${esc(d.item)}** (${esc(d.circulation)}): ${esc(d.description)}`);
  }
  lines.push('');
  lines.push('## Analogy: Kula valuables → karma / curation');
  lines.push('');
  const keys = Object.keys(KULA_RING.terms).sort();
  for (const k of keys) {
    const t = KULA_RING.terms[k];
    lines.push(`### ${esc(t.term)}`);
    lines.push('');
    lines.push(`- **Anthropology:** ${esc(t.anthropology)}`);
    lines.push(`- **Crypto mapping:** ${esc(t.cryptoMapping)}`);
    lines.push('');
  }
  // Trim a single trailing blank line for a stable, newline-terminated document.
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

// --- CLI (guarded; pure stdout) -------------------------------------------------------------
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (arg) {
    const r = explainAnalogy(arg);
    if (!r.found) {
      const known = Object.keys(KULA_RING.terms).sort().join(', ');
      console.log(`unknown term: ${arg}\nknown terms: ${known}`);
    } else {
      console.log(`${r.term}\n\nAnthropology: ${r.anthropology}\n\nCrypto mapping: ${r.cryptoMapping}`);
    }
  } else {
    console.log(renderMarkdown());
  }
}
