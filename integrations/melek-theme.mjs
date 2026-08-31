// melek-theme.mjs — Hathor's / the metaverse vaporwave-core design tokens (context-expandable).
//
// SCOPE (operator, 2026-08-31): this is HATHOR's visual identity + the metaverse/VR world palette — it is
// the CANONICAL theme for the in-domain surfaces (the metaverse world, Hathor's avatar/chat, hathor.live,
// generated-art chrome) and an OPT-IN ACCENT theme any ecosystem site MAY import. It is NOT a mandate: the
// DEX/condenser/content sites keep their own clean/converting palettes (see .local/DESIGN_UX_PLAYBOOK.md) —
// do NOT rewrite site palettes to vaporwave. This module gives the aesthetic one reusable home rather than
// re-hardcoding it per Hathor surface.
//
// ART DIRECTION (see .local/METAVERSE_ART_DIRECTION.md + memory melek-metaverse-aesthetic-direction):
//   • VAPORWAVE IS THE IDENTITY / throughline everywhere — hot pink/magenta, cyan/teal, purple/lavender,
//     the pink→blue sunset gradient, on a deep-plum (never pure-black) ground.
//   • ANCIENT-GOLD, NEON, COLOR-BLOCK (beige/cyan/black) are CONTEXTUAL EXPANSIONS layered on top of the
//     vaporwave base "sometimes, in context" — a temple/library leans gold; a DEX leans neon. Pick a
//     context; the vaporwave core is always present underneath.
//   • FUNCTIONAL green/red are RESERVED for gain/loss/confirm/destructive ONLY (never decoration).
//   • READABILITY (the one psycho-guide constraint that survives): the full saturated palette is for
//     brand/chrome/backgrounds/art; BODY TEXT + dense UI stay readable — off-white/lavender-white on
//     plum, never fine hot-pink text on saturated cyan. Adjacent regions differ by luminance, not just hue.
//
// HOUSE STYLE: ESM, esc() all interpolation, no network, no keys, CLI guarded, handler-free (pure).
// themeCSS() returns a <style> block of CSS custom properties for :root — drop it in any page <head>.

export function esc(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── the tokens (the single source of truth) ─────────────────────────────────────────────────────────
// Vaporwave CORE — the identity, present on every surface.
export const CORE = {
  magenta:  '#ff2d95', // hot pink / magenta — signature accent, headings-at-large, glow
  pink:     '#ff5ea8', // softer sunset pink
  cyan:     '#00e5ff', // neon cyan/teal — links, focus, secondary accent
  teal:     '#28c7c7',
  violet:   '#7b2ff7', // purple
  lavender: '#b98cff', // lavender — muted purple, hover states
  // the pink→blue sunset gradient stops (top→bottom), from the ad-maker vaporwave style
  sunsetTop: '#2b0a45', // deep plum-violet sky
  sunsetMid: '#7b2ff7', // violet
  sunsetLow: '#ff5ea8', // pink horizon
  // grounds — deep plum, NEVER pure #000 (halation/astigmatism per psycho-guide §D)
  bg:       '#140a24', // page ground (deep plum)
  surface:  '#1e1030', // card / panel
  surface2: '#271640', // raised
  border:   '#4a2f6e', // low-contrast plum border (not a vibrating line)
  // readable text — off-white & lavender-white, tuned for luminance contrast on plum
  text:     '#f4ecff', // body (off-white, slight lavender)
  textMut:  '#b6a6d6', // muted / secondary
};

// Ancient / temple EXPANSION — lean in on temple, library, scripture, credential surfaces.
export const ANCIENT = {
  gold:     '#e8b923', // Hathor sun-disk gold (value/premium accent)
  goldDeep: '#b8862b',
  goldSoft: '#f7c53a',
  beige:    '#f2ecd8', // color-block beige (light-context panels, papyrus)
  ink:      '#0b0f0b', // near-black color-block
};

// Neon / VR EXPANSION — lean in on DEX/KulaSwap, pool, game/arcade, live surfaces.
export const NEON = {
  glowCyan:   '#00e5ff',
  glowMagenta:'#ff2d95',
  grid:       '#00e5ff', // the vaporwave perspective grid — use LARGE & calm, never fine behind text
};

// FUNCTIONAL — reserved for meaning, conventional & learned (psycho-guide §4). Green=gain, red=loss.
// (Up/down is reversible for East-Asian users at the app layer; always back color with +/- or arrow.)
export const FUNCTIONAL = {
  gain:    '#3fb950',
  loss:    '#f85149',
  warn:    '#e8b923', // amber (reuses gold)
  info:    '#00e5ff',
};

export const CONTEXTS = ['default', 'temple', 'neon'];

// ── CSS custom-property emitter ─────────────────────────────────────────────────────────────────────
// themeCSS({ context }) → a <style> with :root vars. `context` shifts the ACCENT emphasis while the
// vaporwave core stays constant:
//   default → magenta primary + cyan secondary (balanced vaporwave)
//   temple  → gold primary + magenta secondary (ancient-gold lean; scripture/library/credentials)
//   neon    → cyan primary + magenta secondary (DEX/pool/arcade; glow-forward)
function accentsFor(context) {
  if (context === 'temple') return { primary: ANCIENT.gold, secondary: CORE.magenta, onPrimary: ANCIENT.ink };
  if (context === 'neon')   return { primary: CORE.cyan,   secondary: CORE.magenta, onPrimary: CORE.bg };
  return { primary: CORE.magenta, secondary: CORE.cyan, onPrimary: '#ffffff' }; // default
}

export function themeVars(context = 'default') {
  const ctx = CONTEXTS.includes(context) ? context : 'default';
  const a = accentsFor(ctx);
  return {
    '--mk-bg': CORE.bg,
    '--mk-surface': CORE.surface,
    '--mk-surface-2': CORE.surface2,
    '--mk-border': CORE.border,
    '--mk-text': CORE.text,
    '--mk-text-muted': CORE.textMut,
    '--mk-primary': a.primary,
    '--mk-on-primary': a.onPrimary,
    '--mk-secondary': a.secondary,
    '--mk-magenta': CORE.magenta,
    '--mk-cyan': CORE.cyan,
    '--mk-violet': CORE.violet,
    '--mk-lavender': CORE.lavender,
    '--mk-gold': ANCIENT.gold,
    '--mk-beige': ANCIENT.beige,
    '--mk-gain': FUNCTIONAL.gain,
    '--mk-loss': FUNCTIONAL.loss,
    '--mk-warn': FUNCTIONAL.warn,
    // the signature vaporwave sunset gradient (top→bottom)
    '--mk-sunset': `linear-gradient(180deg, ${CORE.sunsetTop} 0%, ${CORE.sunsetMid} 55%, ${CORE.sunsetLow} 100%)`,
  };
}

/**
 * themeCSS({ context, selector }) — PURE. Returns a <style> block declaring the tokens on `selector`
 * (default :root), plus a tiny readable-by-default base (body text = off-white on plum, links = cyan)
 * and the standard Alpha badge. Includes the ONE guardrail comment so nobody sets fine pink-on-cyan text.
 */
export function themeCSS({ context = 'default', selector = ':root' } = {}) {
  const vars = themeVars(context);
  const sel = esc(selector);
  const decls = Object.entries(vars).map(([k, v]) => `    ${k}: ${v};`).join('\n');
  return `<style>
  ${sel}{
${decls}
  }
  /* Readability guardrail: brand palette is for chrome/backgrounds/art. Body copy uses --mk-text on
     --mk-bg; never set fine hot-pink text on saturated cyan (opponent-color eyestrain). */
  body{background:var(--mk-bg);color:var(--mk-text);
    font:15px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
  a{color:var(--mk-cyan);text-decoration:none}
  a:hover{color:var(--mk-lavender)}
  .mk-card{background:var(--mk-surface);border:1px solid var(--mk-border);border-radius:14px}
  .mk-btn{background:var(--mk-primary);color:var(--mk-on-primary);border:0;border-radius:12px;
    padding:10px 18px;font-weight:700;cursor:pointer}
  .mk-btn:hover{filter:brightness(1.08)}
  .mk-sunset{background:var(--mk-sunset)}
  .mk-gain{color:var(--mk-gain)} .mk-loss{color:var(--mk-loss)}
  .mk-alpha{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;
    padding:2px 7px;border-radius:8px;background:var(--mk-magenta);color:#fff;vertical-align:middle}
</style>`;
}

// ── CLI (guarded — no side effects on import) ─────────────────────────────────────────────────────────
if (typeof process !== 'undefined' && process.argv && process.argv[1] &&
    import.meta.url === `file://${process.argv[1]}`) {
  const ctx = process.argv[2] || 'default';
  console.log(themeCSS({ context: ctx }));
}
