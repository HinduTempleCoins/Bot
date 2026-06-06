// library-rag.mjs — "Ask the Library": grounded Q&A over the Library of Ashurbanipal wiki
// (wiki.soapbox.community), task #83.
//
// One job: answer a question using ONLY what the wiki actually says. It retrieves the most relevant
// articles via the wiki search API, pulls their text (snippet + page body), then asks an LLM to
// answer strictly from those passages and cite the article titles. If no LLM key is present it
// degrades to returning the retrieved passages with a templated answer. It NEVER invents facts —
// every claim is sourced from a fetched article — and it NEVER throws (best-effort, returns empties).
//
//   import { askLibrary, retrieve } from './integrations/library-rag.mjs';
//   const { answer, sources, grounded } = await askLibrary('What is the Convergence?');
//
// Callers (Hathor / Telegram / Discord / system-query) hand the user's question straight to
// askLibrary() and render { answer } + a "Sources:" list from { sources }. `grounded` is true when
// the answer is backed by retrieved passages (false → "the Library doesn't cover that").
//
// CLI:  node integrations/library-rag.mjs "what is the Zar Thread System?"
//
// SECURITY: read-only over public HTTP. No keys handled here (the LLM key lives inside llm-router,
// which never logs/returns it). User questions are sent to the configured LLM provider as context.

import { complete, availableProviders } from './llm-router.mjs';
import { cached, TTL } from './soapbox/cache.mjs';

const WIKI_SITE = (process.env.WIKI_SITE || 'https://wiki.soapbox.community').replace(/\/+$/, '');
const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

// Retrieval knobs (overridable via env, sane defaults).
const TOP_K = Number(process.env.LIBRARY_RAG_TOPK || 3);          // articles to ground on
const FETCH_TIMEOUT = Number(process.env.LIBRARY_RAG_TIMEOUT || 8000);
// Per-article body cap fed to the LLM. The whole article is fetched, then bounded so the grounding
// prompt stays within budget — but 1200 chars chopped most multi-section articles mid-thought, so the
// answer was grounded on a fraction of what we fetched. Raised to keep substantially more of the body;
// still env-overridable (LIBRARY_RAG_PASSAGE_CHARS) for tighter token budgets.
const PASSAGE_CHARS = Number(process.env.LIBRARY_RAG_PASSAGE_CHARS || 4000); // per-article body cap

// ── HTTP plumbing (best-effort; null on any failure) ─────────────────────────────────────────
async function getText(url, timeout = FETCH_TIMEOUT) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/json' }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── Wiki search API ──────────────────────────────────────────────────────────────────────────
// GET {WIKI_SITE}/api/search?q= → { results: [{ title, url, snippet, slug, score }] }
async function searchWiki(query) {
  const url = `${WIKI_SITE}/api/search?q=${encodeURIComponent(query)}`;
  const body = await cached(`librarySearch:${query.toLowerCase()}`, TTL.metadata, () => getText(url));
  if (!body) return [];
  try {
    const j = JSON.parse(body);
    const results = Array.isArray(j?.results) ? j.results : [];
    return results
      .filter((r) => r && r.title)
      .map((r) => ({
        title: String(r.title).trim(),
        slug: r.slug || null,
        url: r.url || (r.slug ? `${WIKI_SITE}/wiki/${r.slug}` : null),
        snippet: typeof r.snippet === 'string' ? r.snippet.trim() : '',
        score: Number(r.score) || 0,
      }));
  } catch {
    return [];
  }
}

// ── Article body extraction ──────────────────────────────────────────────────────────────────
// Pages are server-rendered HTML; the article lives in <main class=wrap>. We strip tags and refs
// to plain prose — no wikitext/JSON endpoint exists, so this is the cleanest available text.
function extractArticleText(html) {
  if (!html) return '';
  // Isolate the main content region if present (keeps nav/footer chrome out of the passage).
  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  let region = mainMatch ? mainMatch[1] : html;
  return region
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')   // drop the "← Library" breadcrumb nav
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<sup\b[^>]*class=["']?ref[^>]*>[\s\S]*?<\/sup>/gi, ' ') // drop [1]-style ref markers
    .replace(/<[^>]+>/g, ' ')                                          // strip remaining tags
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchArticleBody(slugOrUrl, slug) {
  const url = slugOrUrl?.startsWith('http') ? slugOrUrl : `${WIKI_SITE}/wiki/${slug || slugOrUrl}`;
  const html = await cached(`libraryPage:${url}`, TTL.metadata, () => getText(url));
  const text = extractArticleText(html);
  return text ? text.slice(0, PASSAGE_CHARS) : '';
}

/**
 * Retrieve the top relevant Library passages for a question (best-effort, cached, never throws).
 * Each passage carries its source {title, url} so the caller can cite it.
 *
 * @param {string} question
 * @param {{ topK?: number }} [opts]
 * @returns {Promise<Array<{ title, url, slug, snippet, text }>>}
 */
export async function retrieve(question, { topK = TOP_K } = {}) {
  const q = (question || '').trim();
  if (!q) return [];

  let hits = await searchWiki(q);
  // If the full question is too specific to match, retry with just the salient keywords.
  if (hits.length === 0) {
    const keywords = q
      .replace(/[?.!,]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w.toLowerCase()))
      .slice(0, 5)
      .join(' ');
    if (keywords && keywords.toLowerCase() !== q.toLowerCase()) hits = await searchWiki(keywords);
  }

  const top = hits.sort((a, b) => b.score - a.score).slice(0, topK);

  // Fetch each article body in parallel; fall back to the search snippet if the page won't load.
  const passages = await Promise.all(
    top.map(async (h) => {
      const text = (await fetchArticleBody(h.url, h.slug)) || h.snippet || '';
      return { title: h.title, url: h.url, slug: h.slug, snippet: h.snippet, text };
    }),
  );
  return passages.filter((p) => p.text);
}

const STOPWORDS = new Set([
  'what', 'whats', 'when', 'where', 'which', 'whom', 'whose', 'does', 'do', 'is', 'are',
  'the', 'a', 'an', 'of', 'in', 'on', 'to', 'and', 'or', 'for', 'about', 'with', 'tell',
  'me', 'explain', 'how', 'why', 'can', 'you', 'this', 'that', 'there', 'their', 'they',
]);

// ── Prompt assembly ────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT =
  'You are the Library of Ashurbanipal reference desk. Answer the question using ONLY the ' +
  'Library passages provided below. Do not use outside knowledge. Cite the article title(s) you ' +
  'drew from inline, e.g. (per "The Convergence"). If the passages do not contain the answer, ' +
  'reply exactly: "The Library doesn\'t cover that." Be concise and factual.';

function buildContext(passages) {
  return passages
    .map((p, i) => `[${i + 1}] Article: "${p.title}"\nURL: ${p.url}\n${p.text}`)
    .join('\n\n---\n\n');
}

function dedupeSources(passages) {
  const seen = new Set();
  const out = [];
  for (const p of passages) {
    const key = p.url || p.title;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: p.title, url: p.url });
  }
  return out;
}

const NOT_COVERED = "The Library doesn't cover that.";

/**
 * Ask the Library a question, grounded strictly in retrieved wiki passages. Never throws.
 *
 * @param {string} question
 * @param {object} [opts]              passthrough to retrieve/llm-router (task, prefer, topK, log)
 * @returns {Promise<{ answer:string, sources:Array<{title,url}>, grounded:boolean, passages?:Array }>}
 */
export async function askLibrary(question, opts = {}) {
  const q = (question || '').trim();
  if (!q) return { answer: 'Ask the Library a question.', sources: [], grounded: false };

  const passages = await retrieve(q, opts);
  if (passages.length === 0) {
    return { answer: NOT_COVERED, sources: [], grounded: false, passages: [] };
  }

  const sources = dedupeSources(passages);

  // No LLM key → degrade gracefully to the retrieved passages with a templated answer.
  const haveLLM = Object.values(availableProviders()).some(Boolean);
  if (!haveLLM) {
    const lead = passages
      .map((p) => `From "${p.title}": ${(p.text || p.snippet).slice(0, 320)}`)
      .join('\n\n');
    return {
      answer: `Here is what the Library has on that:\n\n${lead}`,
      sources,
      grounded: true,
      passages,
    };
  }

  const prompt = `Library passages:\n\n${buildContext(passages)}\n\n---\n\nQuestion: ${q}\n\nAnswer (grounded only in the passages above, citing article titles):`;
  const res = await complete(prompt, {
    system: SYSTEM_PROMPT,
    task: opts.task || 'quality',
    prefer: opts.prefer,
    temperature: 0.1,
    maxTokens: 800,
    log: opts.log,
  });

  // LLM unavailable/failed → fall back to passages rather than going silent.
  if (!res.text || !res.text.trim()) {
    const lead = passages
      .map((p) => `From "${p.title}": ${(p.text || p.snippet).slice(0, 320)}`)
      .join('\n\n');
    return {
      answer: `Here is what the Library has on that:\n\n${lead}`,
      sources,
      grounded: true,
      passages,
    };
  }

  const answer = res.text.trim();
  const grounded = !new RegExp(NOT_COVERED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(answer);
  return {
    answer,
    sources: grounded ? sources : [],
    grounded,
    passages,
    provider: res.provider,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('library-rag.mjs');

if (isMain) {
  const question = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim();
  if (!question) {
    console.error('usage: node integrations/library-rag.mjs "what is the Convergence?"');
    process.exit(1);
  }
  console.error(`[library-rag] wiki: ${WIKI_SITE}`);
  console.error('[library-rag] LLM providers present:', JSON.stringify(availableProviders()));
  const res = await askLibrary(question, { log: (m) => console.error(m) });
  console.log(`\n${res.answer}\n`);
  if (res.sources.length) {
    console.log('Sources:');
    for (const s of res.sources) console.log(`  - ${s.title} — ${s.url}`);
  }
  console.error(`\n[library-rag] grounded=${res.grounded}${res.provider ? ` provider=${res.provider}` : ' (templated, no LLM key)'}`);
}
