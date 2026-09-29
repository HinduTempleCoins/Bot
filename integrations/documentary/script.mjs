// script.mjs — prompt variants for documentary narration, the tagged-script format, parsing and automatic scoring.
//
// Tagged script format (what the LLM must return): one sentence per line. A sentence that makes a factual claim ends
// with a tag «R: source» (historical record), «T: source» (tradition/scripture) or «I: source» (Institute
// interpretation), where source is copied from the fact sheet. Untagged lines are connective narration.
// Parsing strips the tags for the voice-over and keeps them for the on-screen sources and the scorer.

export const VARIANTS = {
  narrator: {
    name: 'Plain documentary narrator',
    system: 'You write narration for an educational history documentary. Calm, clear, factual, third person. Short sentences that are easy to hear.',
  },
  hathor: {
    name: 'Hathor, first-person teacher',
    system: 'You are Hathor, an AI teacher and the witness of the MELEK chain, narrating a documentary in the first person ("I will show you…"). Warm, confident, precise; short sentences that are easy to hear. You never overstate: you say plainly when something is scripture, tradition or the Institute\'s reading rather than the historical record.',
  },
  question: {
    name: 'Question-led',
    system: 'You write narration for an educational documentary that moves by asking the viewer questions and then answering them from the evidence. Clear, short sentences that are easy to hear.',
  },
  story: {
    name: 'Story-led',
    system: 'You write narration for a documentary that tells history as a story: people, places and moments, told vividly but never inventing facts. Short sentences that are easy to hear.',
  },
};

export function chapterPrompt({ topic, chapter, facts, words, variant = 'hathor', chapterIndex = 0, chapterCount = 1 }) {
  const factLines = facts.map((f) => `- [${f.tag === 'record' ? 'R' : f.tag === 'tradition' ? 'T' : 'I'}: ${f.source}] ${f.text}`).join('\n');
  return {
    system: `${VARIANTS[variant].system} This is the alpha phase of Hathor's documentaries: accuracy matters more than drama.`,
    prompt: `Documentary: "${topic.title}". Chapter ${chapterIndex + 1} of ${chapterCount}: "${chapter.title}".
Learning goal: ${chapter.goal}

Use ONLY these facts (do not add dates, names or numbers that are not here):
${factLines}

Write about ${words} words of spoken narration for this chapter.
Rules:
- One sentence per line. No headings, no bullet points, no stage directions, no quotation marks around the whole text.
- Every sentence that states a fact ends with its tag copied exactly from the list, in this form: «R: source» for historical record, «T: source» for scripture or tradition, «I: source» for the Institute's interpretation.
- Say plainly in the words themselves when something is scripture or tradition ("Genesis says…", "tradition holds…") or the Institute's reading ("the Institute reads this as…"), and when something is the historical record ("archaeologists have found…").
- ${chapterIndex === 0 ? 'Open the whole documentary with one line that tells the viewer what they will learn.' : 'Do not re-introduce the documentary; continue from the previous chapter.'}
- ${chapterIndex === chapterCount - 1 ? 'End the documentary with a short closing line.' : 'End with one line that leads into the next chapter.'}`,
  };
}

const TAG_ANY = /«\s*([RTI])\s*:\s*([^»]+)»/g;
const KIND = { R: 'record', T: 'tradition', I: 'interpretation' };
const sentencesOf = (t) => String(t).replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+(?=[A-Z"“‘(])/).map((x) => x.trim()).filter(Boolean);
/** → [{ text, tag: 'record'|'tradition'|'interpretation'|null, source }]. A tag belongs to the sentence right before
 *  it; lines may hold several sentences and several tags (models do that), so parsing is by sentence, not by line. */
export function parseScript(raw) {
  const out = [];
  for (let line of String(raw || '').split('\n')) {
    line = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
    if (!line || /^#|^chapter\b/i.test(line)) continue;
    let last = 0; let m;
    TAG_ANY.lastIndex = 0;
    const push = (chunk, tag) => {
      const ss = sentencesOf(chunk);
      ss.forEach((t, i) => { const text = t.replace(/\s+([.,;:!?])/g, '$1').trim(); if (text && /[A-Za-z]/.test(text)) out.push({ text, tag: i === ss.length - 1 && tag ? KIND[tag[0]] : null, source: i === ss.length - 1 && tag ? tag[1].trim() : '' }); });
    };
    while ((m = TAG_ANY.exec(line))) { push(line.slice(last, m.index), [m[1], m[2]]); last = TAG_ANY.lastIndex; }
    push(line.slice(last), null);
  }
  return out;
}

const words = (s) => (String(s).match(/[A-Za-zÀ-ÿ0-9'’-]+/g) || []);
const syllables = (w) => { const s = w.toLowerCase().replace(/[^a-z]/g, ''); if (s.length <= 3) return 1; return Math.max(1, (s.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g) || []).length); };

/** Flesch reading ease (higher = easier; 60–70 is plain English). */
export function fleschReadingEase(lines) {
  const ws = lines.flatMap((l) => words(l.text));
  if (!ws.length) return 0;
  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  return +(206.835 - 1.015 * (ws.length / lines.length) - 84.6 * (syl / ws.length)).toFixed(1);
}

/** A sentence "makes a claim" if it names something (a capitalised word past the first) or has a number. */
export const isClaim = (text) => /\d/.test(text) || /\s[A-Z][a-zà-ÿ]+/.test(text.replace(/^\S+\s*/, ' '));

export function score(lines, { targetWords, allowedSources = [] }) {
  const allWords = lines.flatMap((l) => words(l.text));
  const claims = lines.filter((l) => isClaim(l.text));
  const tagged = claims.filter((l) => l.tag);
  const tags = lines.filter((l) => l.tag);
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const allowed = allowedSources.map(norm);
  const valid = tags.filter((l) => allowed.some((a) => a && (norm(l.source).includes(a) || a.includes(norm(l.source)))));
  const tri = []; for (let i = 0; i + 2 < allWords.length; i++) tri.push(allWords.slice(i, i + 3).join(' ').toLowerCase());
  const repeated = tri.length ? 1 - new Set(tri).size / tri.length : 0;
  const fre = fleschReadingEase(lines);
  const lengthFit = targetWords ? Math.max(0, 1 - Math.abs(allWords.length - targetWords) / targetWords) : 1;
  const m = {
    words: allWords.length, sentences: lines.length,
    tagCoverage: claims.length ? +(tagged.length / claims.length).toFixed(2) : 1,
    citationValidity: tags.length ? +(valid.length / tags.length).toFixed(2) : 0,
    readingEase: fre,
    readingFit: +(Math.max(0, 1 - Math.abs(fre - 65) / 45)).toFixed(2),
    repetition: +repeated.toFixed(3),
    lengthFit: +lengthFit.toFixed(2),
  };
  m.total = +(0.30 * m.tagCoverage + 0.25 * m.citationValidity + 0.15 * m.readingFit + 0.15 * (1 - Math.min(1, m.repetition * 5)) + 0.15 * m.lengthFit).toFixed(3);
  return m;
}
