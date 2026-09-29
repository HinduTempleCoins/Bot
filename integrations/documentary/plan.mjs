// plan.mjs — WORDLESS documentaries (operator 09-29): no narration. The "script" is a SHOT PLAN — slow, atmospheric
// recreated scenes (monuments being raised, daily life, tombs, and the mythic: gods and spirits at real sacred places,
// giants of the old stories) — plus sparse on-screen text: a title, place + era cards, short lines that pose a question,
// and source credits at the end. Every factual card keeps its kind: historical record / tradition / interpretation.
// Mythic scenes are shown as what the tradition, text or carving depicts — never asserted as fact.

export const STYLES = {
  wonder: { name: 'Slow wonder', system: 'You plan wordless, eerie, atmospheric history films in the "living among the ancients / how did they build this" style: slow camera, recreated scenes, very little text, the viewer left to wonder.' },
  question: { name: 'Question cards', system: 'You plan wordless history films that move by posing short questions on screen ("How were these raised?", "Who walked here?") over slow recreated scenes, answered only by what the images show and a few grounded cards.' },
  placeEra: { name: 'Place and era', system: 'You plan wordless history films anchored in real geography: each sequence opens on a place-and-era card ("Meroë, Kingdom of Kush, c. 300 BC") and shows daily life, work and ritual there in slow recreated scenes.' },
  mythic: { name: 'Mythic overlay', system: 'You plan wordless films where the spirit world and physical places overlap, as ancient peoples saw them: gods at their sacred mountains and rivers, spirits at temples, giants of the old stories — always shown as what the tradition depicts, alongside the real archaeology of the same place.' },
};

export const CAMERA = ['push_in', 'pull_out', 'pan_left', 'pan_right', 'still'];

export function planPrompt({ topic, facts, minutes, style = 'wonder' }) {
  const scenes = Math.round((minutes * 60) / 8.5);
  const factLines = facts.map((f) => `- [${f.tag}: ${f.source}] ${f.text}`).join('\n');
  return {
    system: `${STYLES[style].system} This is the ALPHA phase: accuracy over drama. No narration, no voice.`,
    prompt: `Plan a ${minutes}-minute wordless film: "${topic.title}". About ${scenes} scenes of 6–12 seconds each, in chronological/sequence order, grouped into ${topic.outline.length} sequences: ${topic.outline.map((c) => `"${c.title}"`).join(', ')}.

Ground it ONLY in these facts (do not invent names, dates or numbers):
${factLines}

Return ONLY JSON: {"scenes":[{"sequence":<1-based>,"visual":"<what the recreated image shows, concrete, 15-35 words, people/place/light/action>","camera":"push_in|pull_out|pan_left|pan_right|still","seconds":<6-12>,"card":"<optional on-screen text, max 12 words, or empty>","kind":"record|tradition|interpretation|none","source":"<copied exactly from the fact list when the card states a fact, else empty>"}]}
Rules: cards are rare (at most one scene in four), short, and either a place+era card, a question, or a grounded fact with its source; when a card shows scripture, myth or the Institute's reading, the words must say so ("Genesis says…", "Kushites believed…", "The Institute reads…"). Mythic scenes (gods at sacred mountains/rivers, spirits, giants) are depicted as belief, never stated as fact. Vary the camera.`,
  };
}

/** Extract {scenes:[…]} from an LLM reply; tolerant of code fences / prose. */
export function parsePlan(raw) {
  const s = String(raw || '');
  const m = s.indexOf('{'); const n = s.lastIndexOf('}');
  if (m < 0 || n <= m) return [];
  let j = null; try { j = JSON.parse(s.slice(m, n + 1)); } catch { return []; }
  return (j && Array.isArray(j.scenes) ? j.scenes : []).map((x) => ({
    sequence: Math.max(1, parseInt(x.sequence, 10) || 1),
    visual: String(x.visual || '').trim().slice(0, 400),
    camera: CAMERA.includes(x.camera) ? x.camera : 'push_in',
    seconds: Math.min(14, Math.max(4, +x.seconds || 8)),
    card: String(x.card || '').trim().slice(0, 120),
    kind: ['record', 'tradition', 'interpretation'].includes(x.kind) ? x.kind : 'none',
    source: String(x.source || '').trim(),
  })).filter((x) => x.visual);
}

const MYTHIC = /\b(god|gods|goddess|spirit|spirits|giant|giants|nephilim|titan|titans|divine|amun|apedemak|hapi|heaven|underworld|soul|ghost)\b/i;
const HEDGE = /\b(says|said|believed|believe|tradition|legend|myth|told|depict|depicts|depicted|reads|interpret|according|scripture|genesis|story|stories)\b/i;

export function scorePlan(scenes, { minutes, allowedSources = [] }) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const allowed = allowedSources.map(norm);
  const cards = scenes.filter((s) => s.card);
  const factCards = cards.filter((s) => s.kind !== 'none');
  const validFact = factCards.filter((s) => allowed.some((a) => a && norm(s.source) && (norm(s.source).includes(a) || a.includes(norm(s.source)))));
  const mythCards = cards.filter((s) => MYTHIC.test(s.card));
  const hedged = mythCards.filter((s) => HEDGE.test(s.card) || s.kind === 'tradition' || s.kind === 'interpretation');
  const secs = scenes.reduce((n, s) => n + s.seconds, 0);
  const cardWords = cards.reduce((n, s) => n + s.card.split(/\s+/).length, 0);
  const cams = new Set(scenes.map((s) => s.camera)).size;
  const firstWords = new Set(scenes.map((s) => s.visual.toLowerCase().split(/\s+/).slice(0, 3).join(' '))).size;
  const questions = cards.filter((s) => /\?\s*$/.test(s.card)).length;
  const m = {
    scenes: scenes.length, seconds: secs, cards: cards.length,
    durationFit: +Math.max(0, 1 - Math.abs(secs - minutes * 60) / (minutes * 60)).toFixed(2),
    cardSourcing: factCards.length ? +(validFact.length / factCards.length).toFixed(2) : 0,
    mythHedged: mythCards.length ? +(hedged.length / mythCards.length).toFixed(2) : 1,
    sparsity: +Math.max(0, 1 - Math.max(0, cardWords / Math.max(1, secs / 60) - 25) / 50).toFixed(2), // ≤25 on-screen words/min
    variety: +Math.min(1, (firstWords / Math.max(1, scenes.length)) * 0.7 + (cams / CAMERA.length) * 0.3).toFixed(2),
    questions,
  };
  m.total = +(0.20 * m.durationFit + 0.30 * m.cardSourcing + 0.15 * m.mythHedged + 0.15 * m.sparsity + 0.20 * m.variety).toFixed(3);
  return m;
}

/** Deterministic fallback plan from the fact sheet (used if every LLM fails): one place/era card per sequence,
 *  each fact as a sourced card over matched visuals. */
export function factPlan(topic, factsById) {
  const scenes = [];
  topic.outline.forEach((ch, i) => {
    scenes.push({ sequence: i + 1, visual: `${ch.title}: ${ch.goal}`, camera: 'pull_out', seconds: 8, card: ch.card || ch.title, kind: 'none', source: '' });
    for (const id of ch.facts) {
      const f = factsById.get(id); if (!f) continue;
      scenes.push({ sequence: i + 1, visual: f.visual || f.text, camera: CAMERA[scenes.length % 4], seconds: 9, card: '', kind: 'none', source: '' });
      scenes.push({ sequence: i + 1, visual: f.visual || f.text, camera: CAMERA[(scenes.length + 1) % 4], seconds: 9, card: f.card || '', kind: f.card ? f.tag : 'none', source: f.card ? f.source : '' });
    }
  });
  return scenes;
}
