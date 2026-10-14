// brain-head-emoji.mjs — Hathor's EMOJI net head. A small CPU neural classifier (DeepMoji / emoji-
// prediction style) that maps text -> the emoji that fit it, so she can READ affect/meaning from emoji
// and WRITE them. A general capability any modern brain needs (not Hathor-specific). Same native lane as
// MiniLM and the grammar head: a transformers.js text-classification pipeline, weights cached on the box,
// ZERO external API. The net GENERALIZES — it suggests emoji for text it never saw.
//
// Injectable + soft-fail: tests inject a fake pipe; if the real model can't load, suggestEmoji() soft-
// falls to a small deterministic keyword map so the capability never hard-fails. Importing does NO work.
//
//   import { createEmojiHead } from './brain-head-emoji.mjs';
//   const e = createEmojiHead();
//   await e.suggestEmoji('thank you so much, truly blessed'); // -> [{emoji:'🙏',score},{emoji:'😇',...}]
//
// Model id env-overridable so the box can pin the ONNX emoji head it pulls:
//   MELEK_EMOJI_MODEL=Xenova/twitter-roberta-base-emoji

const DEFAULT_MODEL = process.env.MELEK_EMOJI_MODEL || 'Xenova/twitter-roberta-base-emoji';

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
      _pipe = await pipeline('text-classification', model, { topk: 5 });
      return _pipe;
    } catch { _pipe = null; return null; }
  })();
  return _loading;
}

// ── compact deterministic fallback: keyword -> emoji (NOT a full lexicon; just the floor) ────────────
const KW = [
  [/\b(thank|thanks|grateful|bless|pray|please)\b/i, '🙏'],
  [/\b(love|adore|heart|affection)\b/i, '❤️'],
  [/\b(happy|glad|joy|great|awesome|yay)\b/i, '😄'],
  [/\b(sad|cry|sorry|grief|miss you)\b/i, '😢'],
  [/\b(angel|holy|blessed|halo|divine|sacred)\b/i, '😇'],
  [/\b(fire|lit|hot|amazing)\b/i, '🔥'],
  [/\b(money|cash|revenue|profit|rich|pay)\b/i, '💰'],
  [/\b(up|growth|gains|bull|rising)\b/i, '📈'],
  [/\b(down|loss|bear|falling)\b/i, '📉'],
  [/\b(idea|smart|think|brain|genius)\b/i, '🧠'],
  [/\b(ok|yes|agree|correct|done|good)\b/i, '👍'],
  [/\b(no|wrong|disagree|bad)\b/i, '👎'],
  [/\b(news|press|announce|release)\b/i, '📰'],
  [/\b(key|secret|access|password|unlock)\b/i, '🔑'],
  [/\b(law|justice|court|legal|fair)\b/i, '⚖️'],
  [/\b(warn|danger|caution|alert)\b/i, '⚠️'],
  [/\b(star|excellent|favorite)\b/i, '⭐'],
  [/\b(rocket|launch|moon|ship)\b/i, '🚀'],
  [/\b(plant|herb|medicine|leaf|grow)\b/i, '🌿'],
  [/\b(temple|worship|church|sacred)\b/i, '🏛️'],
];
export function heuristicEmoji(text) {
  const t = String(text || '');
  const hits = [];
  for (const [re, em] of KW) if (re.test(t)) hits.push({ emoji: em, score: 0.6, backend: 'heuristic' });
  if (!hits.length) hits.push({ emoji: '✨', score: 0.3, backend: 'heuristic' });
  // de-dup, keep order
  const seen = new Set();
  return hits.filter((h) => (seen.has(h.emoji) ? false : (seen.add(h.emoji), true))).slice(0, 5);
}

function normalize(out) {
  const arr = Array.isArray(out) ? out : [out];
  const res = arr
    .filter((r) => r && typeof r.score === 'number')
    .map((r) => ({ emoji: String(r.label || '').trim(), score: r.score, backend: 'net' }))
    .filter((r) => r.emoji);
  return res.length ? res : null;
}

export function createEmojiHead({ model = DEFAULT_MODEL } = {}) {
  return {
    model,
    /** Suggest the emoji that fit a piece of text. Soft-falls to the keyword floor. */
    async suggestEmoji(text, k = 3) {
      const t = String(text || '');
      try {
        const pipe = await loadPipe(model);
        if (pipe) { const n = normalize(await pipe(t)); if (n) return n.slice(0, k); }
      } catch { /* fall through */ }
      return heuristicEmoji(t).slice(0, k);
    },
    /** Top single emoji for text (convenience). */
    async topEmoji(text) { return (await this.suggestEmoji(text, 1))[0] || null; },
  };
}
