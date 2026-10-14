// brain-head-grammar.mjs — Hathor's GRAMMAR net head. A small CPU neural classifier (grammatical
// acceptability, CoLA-style) that gives the brain a *sense* of whether language is well-formed — a
// general capability any brain needs (not Hathor-specific). Same native lane as MiniLM: a transformers.js
// text-classification pipeline, model weights downloaded + cached on the box on first real use, ZERO
// external API. It seats beside MiniLM as a head the Language/Babel council seat calls.
//
// The net is defined by its architecture (layers x width) — e.g. a distilled BERT CoLA head — and it
// GENERALIZES: it scores sentences it was never shown, because the weights learned grammatical structure.
//
// Injectable + soft-fail (house style): tests inject a fake pipe (ZERO network/download); if the real
// model can't load, grammaticality() soft-falls to a deterministic heuristic so the capability never
// hard-fails. Importing this module does NO work and pulls NO model.
//
//   import { createGrammarHead } from './brain-head-grammar.mjs';
//   const g = createGrammarHead();                 // real net on the box
//   await g.grammaticality('he go to store');      // -> { label:'unacceptable', score, backend:'net'|'heuristic' }
//
// Model id is env-overridable so the box can pin whatever ONNX CoLA head is pulled:
//   MELEK_GRAMMAR_MODEL=Xenova/distilbert-base-uncased-CoLA

const DEFAULT_MODEL = process.env.MELEK_GRAMMAR_MODEL || 'Xenova/distilbert-base-uncased-CoLA';

// Injectable pipeline factory for tests: async (model) => (text) => [{ label, score }]. null = real loader.
let _factory = null;
export function __setPipelineFactory(fn) { _factory = typeof fn === 'function' ? fn : null; _pipe = null; }

let _pipe = null, _loading = null;
async function loadPipe(model) {
  if (_pipe) return _pipe;
  if (_factory) { _pipe = await _factory(model); return _pipe; }
  if (_loading) return _loading;
  _loading = (async () => {
    try {
      const { pipeline, env } = await import('@huggingface/transformers');
      try { env.allowRemoteModels = true; } catch { /* older builds */ }
      _pipe = await pipeline('text-classification', model);
      return _pipe;
    } catch { _pipe = null; return null; }   // soft-fail → heuristic
  })();
  return _loading;
}

// ── deterministic fallback (never throws; used in CI and if the net can't load) ─────────────────────
const SUBJECT = /\b(i|you|he|she|it|we|they|this|that|these|those|[a-z]+s?)\b/i;
export function heuristicGrammar(text) {
  const t = String(text || '').trim();
  if (!t) return { label: 'unacceptable', score: 0.5, backend: 'heuristic', reason: 'empty' };
  const words = t.split(/\s+/);
  let penalty = 0;
  if (words.length < 2) penalty += 0.3;                                   // fragments
  if (/\b(a|an|the)\s+(a|an|the)\b/i.test(t)) penalty += 0.3;             // double article
  if (/\b(is|are|was|were)\s+(is|are|was|were)\b/i.test(t)) penalty += 0.3; // double copula
  if (/\b(he|she|it)\s+(go|have|do|was|were\b)/i.test(t) && !/\b(goes|has|does)\b/i.test(t)) penalty += 0.55; // agreement
  if (!/[a-z]/i.test(t)) penalty += 0.3;
  if (!SUBJECT.test(t)) penalty += 0.2;
  const score = Math.max(0, Math.min(1, 1 - penalty));
  return { label: score >= 0.5 ? 'acceptable' : 'unacceptable', score, backend: 'heuristic' };
}

/** Normalize a transformers.js text-classification result to {label:'acceptable'|'unacceptable', score}. */
function normalize(out) {
  const r = Array.isArray(out) ? out[0] : out;
  if (!r || typeof r.score !== 'number') return null;
  const lab = String(r.label || '').toUpperCase();
  // CoLA heads label 1/LABEL_1/acceptable = grammatical; 0/LABEL_0/unacceptable = not.
  const acceptable = /1|ACCEPT|GRAMMAT|POS/.test(lab) && !/UNACCEPT|NOT/.test(lab);
  return { label: acceptable ? 'acceptable' : 'unacceptable', score: r.score, backend: 'net', raw: r.label };
}

export function createGrammarHead({ model = DEFAULT_MODEL } = {}) {
  return {
    model,
    /** Score grammatical acceptability. Soft-falls to the heuristic if the net can't load. */
    async grammaticality(text) {
      const t = String(text || '');
      try {
        const pipe = await loadPipe(model);
        if (pipe) { const n = normalize(await pipe(t)); if (n) return n; }
      } catch { /* fall through */ }
      return heuristicGrammar(t);
    },
    /** True/false convenience for a routing/gate decision. */
    async isWellFormed(text, threshold = 0.5) {
      const r = await this.grammaticality(text);
      return r.label === 'acceptable' && r.score >= threshold;
    },
  };
}
