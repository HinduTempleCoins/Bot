// decades-brain.mjs — LAYERS OF AI, 1960s → today, stacked UNDER the Smol LLMs.
//
// Operator 2026-06-06 (verbatim intent): "what we basically need is Layers of AI, from the 70s,
// 80s, 90s, 00s, 10s, and now use them to Power the Smol … they should all live under the Smols
// in like a kind of BRE Type Fashion, because these Other AI are less Computing Power, no GPU
// needed … all the Lower Grade AI Working together like a Brain for the Smol LLMs."
//
// This module IS that brain. Every question climbs the decades, CHEAPEST FIRST; the Smol LLM at
// the top only fires when every lower layer declines. Each layer is an era of AI history and runs
// on plain CPU — no GPU until (optionally) the very top:
//
//   1960s  pattern    ELIZA-style regex/keyword intent matching            (microseconds)
//   1970s  mycin      MYCIN certainty-factor evidence combination          (microseconds)
//   1980s  rules      production-rule BRE (integrations/rules-engine.mjs)  (microseconds)
//   1990s  bayes      trainable Naive Bayes text classifier (in-file)      (milliseconds)
//   2000s  tfidf      TF-IDF + cosine retrieval over a corpus (in-file)    (milliseconds)
//   2010s  embed      dense embeddings + nearest-neighbour (FAISS-style;   (CPU ONNX/WASM via
//                     injectable embedder — cheetah-embeddings / HF         transformers.js, or
//                     transformers.js MiniLM both fit the seam)             Qdrant server-side)
//   2020s  llm        the Smol LLM via integrations/llm-router (LAST resort)
//
// It LEARNS (the operator's "MYCIN thing that learns", generalized): feedback() adjusts a per-layer
// reliability weight, so a layer that keeps being right gets believed at lower raw confidence and
// one that keeps being wrong has to clear a higher bar — the same outcome-learning loop as
// mycin-router, applied to the whole stack. Weights persist via an injectable store (JSON file).
//
// House rules: ESM, soft-fail (a broken layer is skipped, never throws out of think()), every
// dependency injectable so `node --test` runs fully offline, no network/GPU required by default.
//
//   import { createBrain, naiveBayes, tfidfIndex, cfCombine } from './decades-brain.mjs';
//   const brain = createBrain();
//   brain.teachPattern('greet', /\b(hi|hello|hey)\b/i, 'Hello! Ask me about MELEK.');
//   const out = await brain.think('hey there');   // → answered by the 1960s layer, LLM never woke

// ── 1970s: MYCIN certainty-factor combination (Shortliffe & Buchanan) ─────────────────────────
/** Combine two certainty factors in [-1, 1] per the classic MYCIN rules. */
export function cfCombine(a, b) {
  if (a >= 0 && b >= 0) return a + b * (1 - a);
  if (a < 0 && b < 0) return a + b * (1 + a);
  return (a + b) / (1 - Math.min(Math.abs(a), Math.abs(b)));
}

/** Fold a list of {cf} evidence into one certainty factor. */
export function cfAll(evidence = []) {
  return evidence.reduce((acc, e) => cfCombine(acc, Math.max(-1, Math.min(1, +e.cf || 0))), 0);
}

// ── 1990s: trainable Naive Bayes text classifier (persistable as plain JSON) ──────────────────
const tokenize = (t) => String(t == null ? '' : t).toLowerCase().match(/[a-z0-9']{2,}/g) || [];

export function naiveBayes(state) {
  const m = state || { classes: {}, vocab: {}, total: 0 };
  return {
    state: m,
    train(text, label) {
      const c = (m.classes[label] ||= { count: 0, tokens: {}, tokenTotal: 0 });
      c.count += 1; m.total += 1;
      for (const w of tokenize(text)) {
        c.tokens[w] = (c.tokens[w] || 0) + 1; c.tokenTotal += 1; m.vocab[w] = 1;
      }
    },
    classify(text) {
      const labels = Object.keys(m.classes);
      if (!labels.length || !m.total) return { label: null, confidence: 0 };
      const V = Object.keys(m.vocab).length || 1;
      const toks = tokenize(text);
      const scores = labels.map((label) => {
        const c = m.classes[label];
        let lp = Math.log(c.count / m.total);
        for (const w of toks) lp += Math.log(((c.tokens[w] || 0) + 1) / (c.tokenTotal + V));
        return { label, lp };
      }).sort((x, y) => y.lp - x.lp);
      // softmax over log-probs → a usable confidence
      const mx = scores[0].lp;
      const exps = scores.map((s) => Math.exp(s.lp - mx));
      const sum = exps.reduce((a, b) => a + b, 0);
      return { label: scores[0].label, confidence: exps[0] / sum, ranked: scores.map((s) => s.label) };
    },
  };
}

// ── 2000s: TF-IDF + cosine retrieval (the search-era answer machine) ───────────────────────────
export function tfidfIndex() {
  const docs = []; // {id, answer, tf:Map, norm}
  const df = new Map();
  function vec(toks) {
    const tf = new Map();
    for (const w of toks) tf.set(w, (tf.get(w) || 0) + 1);
    return tf;
  }
  return {
    add(id, text, answer) {
      const tf = vec(tokenize(text));
      for (const w of tf.keys()) df.set(w, (df.get(w) || 0) + 1);
      docs.push({ id, answer, tf });
    },
    size: () => docs.length,
    query(text, { minScore = 0.15 } = {}) {
      if (!docs.length) return null;
      const N = docs.length;
      const idf = (w) => Math.log(1 + N / (df.get(w) || 1));
      const q = vec(tokenize(text));
      const qw = new Map([...q].map(([w, f]) => [w, f * idf(w)]));
      const qn = Math.sqrt([...qw.values()].reduce((a, v) => a + v * v, 0)) || 1;
      let best = null;
      for (const d of docs) {
        let dot = 0, dn = 0;
        for (const [w, f] of d.tf) {
          const wgt = f * idf(w); dn += wgt * wgt;
          if (qw.has(w)) dot += wgt * qw.get(w);
        }
        const score = dot / (qn * (Math.sqrt(dn) || 1));
        if (!best || score > best.score) best = { id: d.id, answer: d.answer, score };
      }
      return best && best.score >= minScore ? best : null;
    },
  };
}

// ── the brain: layers in era order, cheapest first, with outcome learning ─────────────────────
export const ERAS = ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];

export function createBrain({ store, llm, embedder, threshold = 0.55 } = {}) {
  // per-layer learned reliability weight (starts neutral at 1.0; bounded 0.5–1.5)
  const weights = Object.fromEntries(ERAS.map((e) => [e, 1.0]));
  if (store && store.weights) Object.assign(weights, store.weights);

  // 1960s
  const patterns = []; // {intent, re, answer}
  // 1970s
  const cfRules = []; // {intent, evidence: (input)=>[{cf}], answer}
  // 1980s — lazy BRE engine over injected rules
  let breEngine = null, breAnswers = {};
  // 1990s
  const bayes = naiveBayes(store && store.bayes);
  const bayesAnswers = (store && store.bayesAnswers) || {};
  // 2000s
  const tfidf = tfidfIndex();
  // 2010s — embedding memory (brute cosine; swap to Qdrant/FAISS server-side at scale)
  const embedMem = []; // {vec, answer, id}

  const trace = [];
  const note = (era, status, conf = 0) => trace.push({ era, status, confidence: conf });

  async function tryEra(era, fn) {
    try {
      const r = await fn();
      if (r && r.answer != null) {
        const eff = (r.confidence ?? 0) * weights[era];
        note(era, 'answered', eff);
        if (eff >= threshold) return { ...r, era, confidence: eff, trace: [...trace] };
        note(era, 'below-threshold', eff);
        return null;
      }
      note(era, 'declined');
      return null;
    } catch { note(era, 'error'); return null; }
  }

  return {
    weights, trace,

    // teaching surfaces — one per era
    teachPattern(intent, re, answer) { patterns.push({ intent, re, answer }); },
    teachCf(intent, evidenceFn, answer) { cfRules.push({ intent, evidenceFn, answer }); },
    async teachRules(rules, answers) {
      const { Engine } = await import('./rules-engine.mjs');
      breEngine = new Engine(rules); breAnswers = answers || {};
    },
    teachExample(text, label, answer) { bayes.train(text, label); if (answer) bayesAnswers[label] = answer; },
    teachDoc(id, text, answer) { tfidf.add(id, text, answer); },
    async remember(text, answer) {
      if (!embedder) return false;
      const vec = await embedder(text);
      if (Array.isArray(vec)) { embedMem.push({ vec, answer, id: embedMem.length }); return true; }
      return false;
    },

    /** Climb the decades. Returns {answer, era, confidence, trace} or the LLM's reply (era 2020s). */
    async think(input, { facts } = {}) {
      trace.length = 0;
      // 1960s — pattern match
      let r = await tryEra('1960s', () => {
        const hit = patterns.find((p) => p.re.test(input));
        return hit ? { answer: hit.answer, confidence: 0.9, intent: hit.intent } : null;
      });
      if (r) return r;
      // 1970s — MYCIN certainty factors
      r = await tryEra('1970s', () => {
        let best = null;
        for (const rule of cfRules) {
          const cf = cfAll(rule.evidenceFn(input, facts));
          if (cf > 0 && (!best || cf > best.confidence)) best = { answer: rule.answer, confidence: cf, intent: rule.intent };
        }
        return best;
      });
      if (r) return r;
      // 1980s — production rules (BRE)
      r = await tryEra('1980s', () => {
        if (!breEngine) return null;
        const { outcomes } = breEngine.run({ input, ...(facts || {}) });
        const key = outcomes && outcomes[0];
        return key != null && breAnswers[key]
          ? { answer: breAnswers[key], confidence: 0.8, intent: String(key) } : null;
      });
      if (r) return r;
      // 1990s — Naive Bayes
      r = await tryEra('1990s', () => {
        const c = bayes.classify(input);
        return c.label && bayesAnswers[c.label]
          ? { answer: bayesAnswers[c.label], confidence: c.confidence, intent: c.label } : null;
      });
      if (r) return r;
      // 2000s — TF-IDF retrieval
      r = await tryEra('2000s', () => {
        const hit = tfidf.query(input);
        return hit ? { answer: hit.answer, confidence: Math.min(0.95, hit.score + 0.4), intent: hit.id } : null;
      });
      if (r) return r;
      // 2010s — embedding nearest-neighbour
      r = await tryEra('2010s', async () => {
        if (!embedder || !embedMem.length) return null;
        const q = await embedder(input);
        if (!Array.isArray(q)) return null;
        let best = null;
        for (const m of embedMem) {
          let dot = 0, qn = 0, mn = 0;
          for (let i = 0; i < q.length; i++) { dot += q[i] * m.vec[i]; qn += q[i] * q[i]; mn += m.vec[i] * m.vec[i]; }
          const cos = dot / ((Math.sqrt(qn) || 1) * (Math.sqrt(mn) || 1));
          if (!best || cos > best.confidence) best = { answer: m.answer, confidence: cos, intent: `mem-${m.id}` };
        }
        return best;
      });
      if (r) return r;
      // 2020s — the Smol LLM, last resort, only if a completer was wired in
      r = await tryEra('2020s', async () => (llm ? { answer: await llm(input), confidence: 0.6, intent: 'llm' } : null));
      if (r) return r;
      note('none', 'no-answer');
      return { answer: null, era: null, confidence: 0, trace: [...trace] };
    },

    /** Outcome learning: tell the brain whether an era's answer was right. Weights stay in [0.5, 1.5]. */
    feedback(era, correct) {
      if (!(era in weights)) return weights;
      weights[era] = Math.max(0.5, Math.min(1.5, weights[era] + (correct ? 0.05 : -0.1)));
      return weights;
    },

    /** Persistable snapshot — hand to your store, reload via createBrain({store}). */
    snapshot() { return { weights: { ...weights }, bayes: bayes.state, bayesAnswers: { ...bayesAnswers } }; },
  };
}

if (process.argv[1] && process.argv[1].endsWith('decades-brain.mjs')) {
  const brain = createBrain();
  brain.teachPattern('greet', /\b(hi|hello|hey)\b/i, 'Hello — ask me about MELEK.');
  brain.teachExample('how do i make an account signup register', 'signup', 'Use !signup or the faucet at alpha.melek.salon.');
  brain.teachExample('price of tests value worth market', 'price', 'TESTS is a value-less test token.');
  brain.teachDoc('witness', 'what is a witness block producer dpos voting', 'A witness produces blocks; see witness.melek.salon.');
  const q = process.argv.slice(2).join(' ') || 'hello there';
  brain.think(q).then((r) => console.log(JSON.stringify(r, null, 2)));
}
