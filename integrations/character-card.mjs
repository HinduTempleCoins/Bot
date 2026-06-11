// character-card.mjs — PURE character lore-card builder/validator. Backlog a02e0f7f19.
// No network, no chain calls, no keys, no I/O, no LLM, no image gen. Pure data shaping.
//
// PURPOSE (read before changing):
//   A generic, reusable schema for an AI character "lore card" — name, voice, role, traits,
//   backstory, taboos, and a greeting *disposition* (not a fixed greeting string; per BRIEF.md §3
//   the greeting is a disposition, not a script). Phase 3 conversational characters need a way
//   to declare who they are as structured config that can be normalized, validated, merged
//   (base + overlay), and rendered to a human-readable Markdown profile.
//
//   This is DELIBERATELY GENERIC. It does NOT edit, embed, or hard-code CHARACTER.md (Hathor's
//   identity). It is a card *schema*: Hathor's card, an Angel character's card, or any future
//   sibling bot's card can all be expressed with it. Maps queue ids 278 (backstory/lore) and
//   281 (post as "her" — captured via greetingDisposition + voice, never a fixed greeting).
//
// SOFT-FAIL, NEVER THROW: bad / missing / wrong-type inputs collapse to safe defaults. A
//   non-object passed to validateCard returns {ok:false, missing:REQUIRED_FIELDS, warnings:[]}.
//
//   import { buildCharacterCard, validateCard, renderCardMarkdown, mergeCards }
//     from './integrations/character-card.mjs';
//
// CLI:  node integrations/character-card.mjs        # print a worked example

// ── HTML escape: used by renderCardMarkdown for any interpolated value ──────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Fields a usable card must declare.
export const REQUIRED_FIELDS = Object.freeze(['name', 'role', 'voice']);

// ── coercion helpers (soft-fail) ────────────────────────────────────────────────────────────────
function str(x) {
  if (x == null) return '';
  if (typeof x === 'string') return x.trim();
  if (typeof x === 'number' || typeof x === 'boolean') return String(x).trim();
  return ''; // objects/arrays/functions → empty
}

// Normalize to an array of trimmed, non-empty, de-duplicated strings.
function strArray(x) {
  let arr;
  if (Array.isArray(x)) arr = x;
  else if (typeof x === 'string') arr = x.split(',');
  else return [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const s = str(item);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ── buildCharacterCard: raw input → normalized card with defaults ───────────────────────────────
export function buildCharacterCard(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    name: str(src.name),
    aliases: strArray(src.aliases),
    role: str(src.role),
    voice: str(src.voice),
    traits: strArray(src.traits),
    backstory: str(src.backstory),
    taboos: strArray(src.taboos),
    greetingDisposition: str(src.greetingDisposition),
  };
}

// ── validateCard: structural + soft-quality check ───────────────────────────────────────────────
export function validateCard(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    return { ok: false, missing: [...REQUIRED_FIELDS], warnings: [] };
  }
  const missing = [];
  for (const f of REQUIRED_FIELDS) {
    if (!str(card[f])) missing.push(f);
  }
  const warnings = [];
  if (!str(card.backstory)) warnings.push('backstory is empty');
  const traitCount = strArray(card.traits).length;
  if (traitCount < 3) warnings.push(`only ${traitCount} trait(s); recommend at least 3`);
  return { ok: missing.length === 0, missing, warnings };
}

// ── renderCardMarkdown: human-readable, esc()'d profile ─────────────────────────────────────────
export function renderCardMarkdown(card) {
  const c = buildCharacterCard(card); // normalize so render is stable on partial input
  const lines = [];
  lines.push(`# ${esc(c.name || '(unnamed)')}`);
  if (c.aliases.length) lines.push(`*aka ${c.aliases.map(esc).join(', ')}*`);
  lines.push('');
  lines.push(`- **Role:** ${esc(c.role || '—')}`);
  lines.push(`- **Voice:** ${esc(c.voice || '—')}`);
  if (c.greetingDisposition) {
    lines.push(`- **Greeting disposition:** ${esc(c.greetingDisposition)}`);
  }
  lines.push('');
  lines.push('## Traits');
  if (c.traits.length) {
    for (const t of c.traits) lines.push(`- ${esc(t)}`);
  } else {
    lines.push('- (none declared)');
  }
  lines.push('');
  lines.push('## Backstory');
  lines.push(c.backstory ? esc(c.backstory) : '(none)');
  if (c.taboos.length) {
    lines.push('');
    lines.push('## Taboos');
    for (const t of c.taboos) lines.push(`- ${esc(t)}`);
  }
  return lines.join('\n');
}

// ── mergeCards: overlay wins on scalars, arrays unioned + de-duped ──────────────────────────────
export function mergeCards(base, overlay) {
  const b = buildCharacterCard(base);
  const o = buildCharacterCard(overlay);
  const scalar = (key) => (o[key] ? o[key] : b[key]); // overlay wins if non-empty
  const union = (key) => strArray([...b[key], ...o[key]]);
  return {
    name: scalar('name'),
    aliases: union('aliases'),
    role: scalar('role'),
    voice: scalar('voice'),
    traits: union('traits'),
    backstory: scalar('backstory'),
    taboos: union('taboos'),
    greetingDisposition: scalar('greetingDisposition'),
  };
}

// ── CLI: worked example ─────────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const card = buildCharacterCard({
    name: 'Seraphine',
    aliases: ['the Watcher', 'the Watcher'],
    role: 'guardian librarian',
    voice: 'warm, formal, unhurried',
    traits: ['patient', 'precise', 'protective'],
    backstory: 'A sentinel of the archive, keeping the record true.',
    taboos: ['never reveals private keys', 'never gives medical advice'],
    greetingDisposition: 'greets as a host welcoming a traveler — never a fixed script',
  });
  console.log(renderCardMarkdown(card));
  console.log('\nvalidate:', JSON.stringify(validateCard(card)));
}
