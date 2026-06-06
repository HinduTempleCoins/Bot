// brief-brain.mjs — the brief/annal ROUTER, built ON decades-brain (PR #174).
//
// Operator 2026-06-06 (verbatim plan, .local/ML_FREE_REPOS_CATALOG_2026-06-06.md): classical-first on
// the 1-core brief box — "Bayes routes briefs, TF-IDF finds nearest prior brief, embeddings dedup
// annals — the Smol only WRITES, never sorts." This module composes the decades-brain layers into the
// brief pipeline's nervous system: it decides which topic/AI queue a new brief or annal request belongs
// to, whether we've written it before, and whether an annal is a duplicate. The Smol LLM is never asked
// to sort — the cheap decades do that on plain CPU.
//
// It COMPOSES decades-brain, it does NOT fork it: createBrain + naiveBayes + tfidfIndex are imported and
// wired with the brief domain (standing topic rotation). No layer logic is reimplemented here.
//
//   1990s Naive Bayes  → routeBrief()  : which topic queue a request belongs to (learned)
//   1960s pattern      → routeBrief()  : explicit "brief about X" phrasing (instant, beats Bayes)
//   2000s TF-IDF       → nearestPrior(): "have we written this before" (dedup + scorecard feed)
//   2010s embeddings   → dedupAnnal()  : MiniLM/Qdrant nearest-neighbour WHEN an embedder is injected
//   2000s TF-IDF       → dedupAnnal()  : classical fallback when no embedder (the 1-core box rule)
//
// House rules (match integrations/): ESM, soft-fail, every dependency injectable, `node --test` runs
// fully offline, no network/GPU required by default.
//
//   import { createBriefBrain, STANDING_TOPICS } from './brief-brain.mjs';
//   const bb = createBriefBrain();
//   bb.trainFromHistory([{ text: 'hathor witness block production', topic: 'hathor' }, ...]);
//   bb.routeBrief('please write a brief about the mining pool fees');  // → {topic:'pool', era, confidence}
//
//   node integrations/brief-brain.mjs route "some brief request"

import { createBrain, naiveBayes, tfidfIndex } from './decades-brain.mjs';

// ── the standing rotation — the topic/AI queues a brief or annal can be routed to ─────────────────
export const STANDING_TOPICS = ['hathor', 'cheetah', 'signup', 'infra', 'pool', 'engine', 'general'];

// Explicit-phrasing patterns (1960s layer): "brief about the pool", "annal on signup", "re: cheetah".
// These fire before the learned Bayes layer so an unambiguous request never gets mis-routed by stats.
function topicPatterns(topics) {
  return topics
    .filter((t) => t !== 'general')
    .map((t) => ({
      topic: t,
      // "...about/on/re/for <topic>" OR the bare topic word as a whole token.
      re: new RegExp(`\\b(?:about|on|re|regarding|for|topic[:=]?)\\s+${t}\\b|\\b${t}\\b`, 'i'),
    }));
}

const tokenize = (t) => String(t == null ? '' : t).toLowerCase().match(/[a-z0-9']{2,}/g) || [];

// Cosine over two dense vectors (for the injected-embedder dedup path).
function cosine(a, b) {
  let dot = 0, an = 0, bn = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; an += a[i] * a[i]; bn += b[i] * b[i]; }
  return dot / ((Math.sqrt(an) || 1) * (Math.sqrt(bn) || 1));
}

/**
 * Build the brief/annal router on a decades-brain.
 * @param {object} [opts]
 * @param {object} [opts.store]   - persisted snapshot from a prior brain (snapshot() output).
 * @param {Function} [opts.embedder] - async (text) => number[]; enables the 2010s dedup path.
 * @param {string[]} [opts.topics]  - override the standing rotation.
 */
export function createBriefBrain({ store, embedder, topics = STANDING_TOPICS } = {}) {
  const TOPICS = [...topics];
  // The composed decades-brain (carries learned weights + persisted Bayes via store).
  const brain = createBrain({ store, embedder });
  // A standalone Bayes head for routing (decades-brain's bayes is private; we keep our own that we
  // persist alongside it so routeBrief() has direct access to confidences + ranking).
  const bayes = naiveBayes(store && store.routeBayes);
  // Seed the explicit-phrasing patterns into both the brain (for completeness) and our own matcher.
  const patterns = topicPatterns(TOPICS);
  for (const p of patterns) brain.teachPattern(p.topic, p.re, p.topic);

  let trained = !!(store && store.routeBayes && store.routeBayes.total);

  function patternRoute(text) {
    for (const p of patterns) if (p.re.test(text)) return p.topic;
    return null;
  }

  return {
    topics: TOPICS,
    brain,

    /**
     * Which topic/AI queue does this brief/annal request belong to?
     * @returns {{topic:string, era:string, confidence:number}}
     */
    routeBrief(text) {
      const t = String(text == null ? '' : text);
      // 1960s — explicit phrasing wins outright.
      const hit = patternRoute(t);
      if (hit) return { topic: hit, era: '1960s', confidence: 0.95 };
      // 1990s — learned Bayes routing (only once we've actually trained).
      if (trained) {
        const c = bayes.classify(t);
        if (c.label) return { topic: c.label, era: '1990s', confidence: c.confidence };
      }
      // fall through — nothing matched and nothing learned.
      return { topic: 'general', era: 'none', confidence: 0 };
    },

    /**
     * Have we written this before? TF-IDF nearest prior brief.
     * @param {string} text
     * @param {Array<{id?:string, text:string}|string>} priorBriefs
     * @returns {{id:(string|number), score:number}|null}
     */
    nearestPrior(text, priorBriefs = []) {
      if (!priorBriefs.length) return null;
      const idx = tfidfIndex();
      priorBriefs.forEach((p, i) => {
        const ptext = typeof p === 'string' ? p : (p.text || '');
        const id = typeof p === 'string' ? i : (p.id ?? i);
        idx.add(id, ptext, id); // answer = id; we only want id+score back
      });
      const hit = idx.query(String(text == null ? '' : text), { minScore: 0.15 });
      return hit ? { id: hit.id, score: hit.score } : null;
    },

    /**
     * Train the router from the brief archive. Records are {text, topic} or raw strings (skipped for
     * routing — a string with no topic can't teach a label, but is accepted so callers can pass a mixed
     * archive without filtering). Persists via the brain's snapshot path.
     * @param {Array<{text:string, topic:string}|string>} records
     */
    trainFromHistory(records = []) {
      let taught = 0;
      for (const r of records) {
        if (r == null) continue;
        if (typeof r === 'string') continue; // raw string, no label → can't train routing
        const { text, topic } = r;
        if (!text || !topic) continue;
        bayes.train(text, topic);
        brain.teachExample(text, topic, topic); // keep the composed brain in sync
        taught += 1;
      }
      if (taught) trained = true;
      return { taught, trained };
    },

    /**
     * Is this annal a duplicate of one already written? Embeddings layer when an embedder is injected,
     * TF-IDF fallback otherwise (the 1-core box rule — classical-first).
     * @param {string} text
     * @param {Array<{id?:string, text:string}|string>} prior
     * @param {object} [opts]
     * @param {number} [opts.embedThreshold=0.9] cosine dup cutoff for the embedding path.
     * @param {number} [opts.tfidfThreshold=0.6] cosine-of-tfidf dup cutoff for the fallback.
     * @returns {Promise<boolean>}
     */
    async dedupAnnal(text, prior = [], { embedThreshold = 0.9, tfidfThreshold = 0.6 } = {}) {
      if (!prior.length) return false;
      const t = String(text == null ? '' : text);
      const texts = prior.map((p) => (typeof p === 'string' ? p : (p.text || '')));
      // 2010s — embeddings when available.
      if (typeof embedder === 'function') {
        try {
          const q = await embedder(t);
          if (Array.isArray(q) && q.length) {
            for (const pt of texts) {
              const v = await embedder(pt);
              if (Array.isArray(v) && v.length && cosine(q, v) >= embedThreshold) return true;
            }
            return false;
          }
        } catch { /* fall through to TF-IDF */ }
      }
      // 2000s — TF-IDF fallback (classical, no GPU).
      const hit = this.nearestPrior(t, prior.map((p, i) => ({
        id: typeof p === 'string' ? i : (p.id ?? i), text: texts[i],
      })));
      return !!(hit && hit.score >= tfidfThreshold);
    },

    /** Persistable snapshot — round-trips through createBriefBrain({store}). */
    snapshot() {
      return { ...brain.snapshot(), routeBayes: bayes.state, topics: [...TOPICS] };
    },
  };
}

/**
 * createBriefBrain with the local MiniLM embedder (integrations/minilm-embedder.mjs) wired as the
 * PREFERRED embedder for the annal-dedup path. dedupAnnal already soft-falls to TF-IDF when the embedder
 * returns null / throws — which is what MiniLM does if the model can't load — so this only UPGRADES dedup
 * when the model is available and never breaks the classical fallback. Production opt-in only: the offline
 * tests call createBriefBrain() (no embedder → TF-IDF) or inject their own fake, so they never download.
 * @param {object} [opts] same options as createBriefBrain (any caller-supplied embedder wins).
 */
export async function createBriefBrainWithMiniLM(opts = {}) {
  const { makeEmbedder } = await import('./minilm-embedder.mjs');
  return createBriefBrain({ embedder: makeEmbedder(), ...opts });
}

// ── CLI: show the brain working ────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('brief-brain.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const text = rest.join(' ');
  const bb = createBriefBrain();
  // A tiny seed so a fresh CLI run shows learned routing, not just patterns.
  bb.trainFromHistory([
    { text: 'hathor witness block production schedule feed publish', topic: 'hathor' },
    { text: 'cheetah librarian source match credit discovery whitelist', topic: 'cheetah' },
    { text: 'signup faucet account creation register onboarding email', topic: 'signup' },
    { text: 'server systemd timer caddy dns deploy host', topic: 'infra' },
    { text: 'mining pool randomx fees stratum hashrate payout', topic: 'pool' },
    { text: 'melek engine smt token nai pool diagnostics market', topic: 'engine' },
  ]);
  if (cmd === 'route') {
    console.log(JSON.stringify(bb.routeBrief(text || 'hello'), null, 2));
  } else {
    console.log('usage: node integrations/brief-brain.mjs route "some brief request"');
    console.log('topics:', STANDING_TOPICS.join(', '));
  }
}
