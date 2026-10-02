// integrations/wiki-visual-prompts.mjs — TURN A WIKI ARTICLE INTO VISUAL WORK.
//
// The library is the source of truth, so the pictures and animations should come OUT of it rather than
// being invented alongside it. This module reads an article's own text and produces:
//   • GRAPHIC prompts   — one still image per visualisable claim, for the image pool / Studio;
//   • ANIMATION prompts — short wordless clips for the animation lab, with a shot plan;
//   • FIGURE candidates — things that should be DRAWN deterministically instead (site/wiki/figures.mjs),
//     because a chart, a cycle or a comparison must be accurate and an image model will not be.
//
// THE RULE THAT MATTERS: a prompt is only emitted for something the article actually says. Every prompt
// carries the sentence it came from, so a wrong picture can be traced back to the text that caused it.
// Nothing here calls a model; it produces the prompts and the provenance, and the render lanes consume them.
//
// House style (operator, standing): historical/scientific media is NOT Hathor — no character unless asked.
// Instructional content gets a drawn figure, not generated art.
//
//   import { promptsFor, graphicPrompts, animationPrompts, figureCandidates } from './wiki-visual-prompts.mjs'

const clean = (s) => String(s == null ? '' : s)
  .replace(/^[\s*#:;]+/gm, '')                       // list markers and indent colons
  .replace(/'''(.+?)'''/g, '$1')
  .replace(/''(.+?)''/g, '$1')
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
  .replace(/\[\[([^\]]+)\]\]/g, '$1')
  .replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, '$2')
  .replace(/<ref>.*?<\/ref>/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/&[a-z]+;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const SENT = /[^.!?]+[.!?]/g;

/** the article's section headings, in order, with their body text */
export function sections(text) {
  const out = [];
  let cur = { heading: '', level: 0, body: [] };
  for (const raw of String(text || '').split('\n')) {
    const m = raw.match(/^\s*(={2,6})\s*(.+?)\s*\1\s*$/);
    if (m) {
      if (cur.heading || cur.body.length) out.push({ ...cur, body: cur.body.join('\n') });
      cur = { heading: clean(m[2]), level: m[1].length, body: [] };
    } else cur.body.push(raw);
  }
  if (cur.heading || cur.body.length) out.push({ ...cur, body: cur.body.join('\n') });
  return out.filter((s) => s.heading || s.body.trim());
}

// Sections that describe a process, a comparison or a quantity should be DRAWN, not generated.
const FIGURE_WORDS = /\b(chart|cycle|pathway|scale|versus|vs\.?|compared|ratio|percent|per cent|threshold|orders of magnitude|diagram|table|sequence|steps?|order to|stages?)\b/i;
// Sections that describe a scene, an organism or an object can be photographed or painted.
const SCENE_WORDS = /\b(leaf|leaves|plant|flower|tree|insect|larva|beetle|wasp|mite|press|mill|still|field|greenhouse|cone|root|seed|bee|ant|aphid|garden|orchard|paddy|sky|cloud|storm)\b/i;

const LOOK = {
  botanical: 'botanical plate style, precise scientific illustration, muted natural colour, plain pale background, no text, no labels',
  macro: 'extreme macro photography, shallow depth of field, natural daylight, high detail, no text',
  process: 'clean documentary photography, neutral light, uncluttered background, no text, no people unless stated',
  landscape: 'wide natural-light photograph, documentary realism, no text, no people',
};

/** one sentence → a graphic prompt, or null if it is not visual */
function graphicFrom(sentence, { heading, title }) {   // eslint-disable-line no-unused-vars
  const s = clean(sentence);
  if (s.length < 40 || s.length > 300) return null;
  if (!SCENE_WORDS.test(s)) return null;
  if (/\b(see|sources?|according to|et al\.|journal|regulation|standard)\b/i.test(s)) return null;
  // skip sentences about the ARTICLE rather than about the world — leads, cross-references, scope notes
  if (/\b(this (page|article|section)|covers|is about|is the companion|not repeated here|Alpha\.)\b/i.test(s)) return null;
  // a short title would match almost any sentence, so only use it as a filter when it is distinctive
  const t = String(title || '');
  if (t.length >= 12 && s.toLowerCase().includes(t.toLowerCase().slice(0, 24))) return null;
  const look = /\b(macro|trichome|mite|larva|aphid|cuticle|gland)\b/i.test(s) ? LOOK.macro
    : /\b(press|mill|still|greenhouse|vessel|condenser|machine)\b/i.test(s) ? LOOK.process
      : /\b(field|orchard|paddy|sky|cloud|landscape|hedgerow)\b/i.test(s) ? LOOK.landscape
        : LOOK.botanical;
  return {
    kind: 'graphic',
    article: title,
    section: heading,
    source: s,
    prompt: `${s} — ${look}`,
    negative: 'text, watermark, logo, caption, letters, numbers, signature, people unless stated, cartoon, cgi look',
  };
}

/** a section → an animation prompt with a shot plan, or null */
function animationFrom(section, title) {
  const body = clean(section.body);
  if (body.length < 180) return null;
  if (!SCENE_WORDS.test(body)) return null;
  const beats = (body.match(SENT) || []).map(clean).filter((x) => x.length > 45 && SCENE_WORDS.test(x)).slice(0, 4);
  if (beats.length < 2) return null;
  return {
    kind: 'animation',
    article: title,
    section: section.heading,
    seconds: Math.min(12, 3 * beats.length),
    wordless: true,
    shots: beats.map((b, i) => ({
      n: i + 1,
      seconds: 3,
      source: b,
      prompt: `${b} — slow steady camera, documentary realism, natural light, no text on screen`,
      motion: i === 0 ? 'slow push in' : i === beats.length - 1 ? 'slow pull back' : 'slow pan',
    })),
    note: 'Wordless. Historical and scientific media carries no character unless the operator asks for one.',
  };
}

/** sections that should be a drawn figure rather than generated art */
export function figureCandidates(text, title = '') {
  return sections(text)
    .filter((s) => s.heading && FIGURE_WORDS.test(`${s.heading} ${s.body}`))
    .map((s) => ({
      kind: 'figure',
      article: title,
      section: s.heading,
      why: 'describes a process, comparison or quantity — must be accurate, so draw it rather than generate it',
      suggest: `add a generator to site/wiki/figures.mjs and map it in PAGE_FIGURES for "${title}"`,
    }));
}

export function graphicPrompts(text, title = '', { limit = 12 } = {}) {
  const out = [];
  for (const s of sections(text)) {
    for (const sentence of (clean(s.body).match(SENT) || [])) {
      const g = graphicFrom(sentence, { heading: s.heading, title });
      if (g) out.push(g);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function animationPrompts(text, title = '', { limit = 4 } = {}) {
  const out = [];
  for (const s of sections(text)) {
    const a = animationFrom(s, title);
    if (a) out.push(a);
    if (out.length >= limit) break;
  }
  return out;
}

/** everything for one article */
export function promptsFor(text, title = '', opts = {}) {
  return {
    article: title,
    graphics: graphicPrompts(text, title, opts),
    animations: animationPrompts(text, title, opts),
    figures: figureCandidates(text, title),
  };
}
