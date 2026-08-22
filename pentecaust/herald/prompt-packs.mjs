// pentecaust/herald/prompt-packs.mjs — Pentecaust HERALD: the plug-and-play PROMPT-PACK library.
//
// Inspired by the "100 AI Prompts That Drive Real Traffic" product: curated, reusable prompt packs for
// content, links & keywords, social, and SEO — aimed at driving real traffic — that run through OUR OWN
// AI (Hathor / the Herald router), not a third-party service. Each pack is a small set of battle-shaped
// prompt templates with {{var}} placeholders; the operator (or Hathor) fills the vars and runs the prompt.
//
// This module is a READ-ONLY curated library + a filler. It holds NO secrets, touches the network ONLY via
// an injectable _fetch (currently unused by the library itself — reserved for a future "run this pack
// through Hathor" path), soft-fails on every input, never throws.
//
//   import { PACKS, CATEGORIES, listPacks, getPack, fillPrompt, search,
//            handler, __setFetch } from './prompt-packs.mjs'
//
//   GET /api/packs            → JSON list of packs (optionally ?category= / ?q=)
//   GET /api/pack/:id         → JSON one pack, or 404
//   GET /health              → { ok:true }
//
//   PORT=8168 node pentecaust/herald/prompt-packs.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Injectable fetch — default to global fetch. Reserved for a future "run pack through Hathor" path; the
// library functions below never call it, so all tests stay fully offline.
let _fetch = (typeof globalThis !== 'undefined' && globalThis.fetch) ? globalThis.fetch.bind(globalThis) : null;
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : _fetch; }

// The five buckets a pack can live in. Mirrors the product's spine: content / links / keywords / social / seo.
export const CATEGORIES = ['content', 'links', 'keywords', 'social', 'seo'];

// ── the curated library ─────────────────────────────────────────────────────────────────────────────────
// Each pack = { id, title, category, goal, prompts:[{ title, template, vars:[], notes }] }.
// Templates use {{var}} placeholders; the vars array lists exactly the placeholders in the template.
export const PACKS = [
  {
    id: 'keyword-cluster-expander',
    title: 'Keyword cluster expander',
    category: 'keywords',
    goal: 'Turn one seed keyword into a full topical cluster of search-intent-grouped terms to plan a content hub.',
    prompts: [
      {
        title: 'Expand a seed into clusters',
        template: 'You are an SEO strategist. Take the seed keyword "{{seed}}" for the topic {{topic}}. Produce 5 keyword clusters, each with a short intent label (informational / commercial / navigational / transactional) and 6-10 long-tail keywords. Prioritise terms a {{audience}} would actually search. Output as a markdown table grouped by cluster.',
        vars: ['seed', 'topic', 'audience'],
        notes: 'Feed the winning cluster straight into the Content brief generator pack.',
      },
      {
        title: 'Find question keywords',
        template: 'List 20 real questions people ask about "{{seed}}", grouped by funnel stage (awareness / consideration / decision). Prefer questions with clear search demand and phrase them exactly as a user would type them.',
        vars: ['seed'],
        notes: 'Great source of H2s and FAQ-schema entries.',
      },
    ],
  },
  {
    id: 'content-brief-generator',
    title: 'Content brief generator',
    category: 'content',
    goal: 'Produce a writer-ready SEO content brief so a draft hits search intent and outranks the current page-one set.',
    prompts: [
      {
        title: 'Full SEO brief',
        template: 'Write an SEO content brief for the target keyword "{{keyword}}" (secondary: {{secondary}}). Include: search intent, target word count, a suggested title, meta description, an H2/H3 outline, entities/terms to include, 3 internal-link ideas toward {{site}}, and 3 questions to answer. Match the depth of the current top-ranking pages for {{keyword}}.',
        vars: ['keyword', 'secondary', 'site'],
        notes: 'Pair with a SERP scan; the outline is the writer contract.',
      },
      {
        title: 'Content-gap angle',
        template: 'Given the top results for "{{keyword}}", identify 3 angles or subtopics they all MISS. For each, explain why {{audience}} cares and how covering it wins the click.',
        vars: ['keyword', 'audience'],
        notes: 'The differentiation half of the brief — where you actually earn the ranking.',
      },
    ],
  },
  {
    id: 'guest-post-pitch-writer',
    title: 'Guest-post pitch writer',
    category: 'links',
    goal: 'Draft a personalised guest-post pitch that lands a placement and a contextual backlink.',
    prompts: [
      {
        title: 'Cold guest-post pitch',
        template: 'Write a short, personalised guest-post pitch email to {{editor}} at {{publication}}. Reference their recent piece on {{recent_topic}}. Propose 3 specific article titles relevant to their audience, tied to my expertise in {{expertise}}. Keep it under 150 words, warm and specific, no fluff. Sign as {{sender}}.',
        vars: ['editor', 'publication', 'recent_topic', 'expertise', 'sender'],
        notes: 'One real reference beats any template opener; fill recent_topic honestly.',
      },
      {
        title: 'Three-title angle set',
        template: 'Suggest 3 guest-post titles for {{publication}} that fit their audience of {{audience}} and let me naturally link to {{target_url}}. For each title give a one-line hook and the angle no one there has covered.',
        vars: ['publication', 'audience', 'target_url'],
        notes: 'Titles are the pitch — lead with the reader value, not the link.',
      },
    ],
  },
  {
    id: 'backlink-outreach-opener',
    title: 'Backlink outreach opener',
    category: 'links',
    goal: 'Open a backlink conversation (broken-link, resource-page, or unlinked-mention) that earns a reply.',
    prompts: [
      {
        title: 'Broken-link outreach',
        template: 'Write a brief, friendly outreach email to {{contact}} at {{site}} noting a broken link on their page {{page_url}} (the dead resource was about {{dead_topic}}). Suggest my resource {{replacement_url}} as a replacement, explaining in one line why it fits. Under 120 words, helpful not salesy. Sign as {{sender}}.',
        vars: ['contact', 'site', 'page_url', 'dead_topic', 'replacement_url', 'sender'],
        notes: 'Lead with the favour (their broken link), the link ask comes second.',
      },
      {
        title: 'Unlinked-mention nudge',
        template: 'Draft a 2-sentence note to {{site}} thanking them for mentioning {{brand}} in {{page_url}} and politely asking if they would link the mention to {{target_url}}. Keep it low-pressure and gracious.',
        vars: ['site', 'brand', 'page_url', 'target_url'],
        notes: 'Highest-conversion link ask there is — they already like you.',
      },
    ],
  },
  {
    id: 'viral-hook-variations',
    title: 'Viral hook variations',
    category: 'social',
    goal: 'Generate scroll-stopping hook variations for a post so you can A/B the opener that drives clicks.',
    prompts: [
      {
        title: 'Ten hook variants',
        template: 'Write 10 distinct opening hooks for a {{platform}} post about {{topic}} aimed at {{audience}}. Vary the pattern: curiosity gap, bold claim, contrarian take, stat shock, story open, question, how-to promise. Each hook is one line, no hashtags.',
        vars: ['platform', 'topic', 'audience'],
        notes: 'Ship the top 2-3 as an A/B; the hook decides the click.',
      },
      {
        title: 'Thread from a hook',
        template: 'Take this winning hook: "{{hook}}". Expand it into a {{platform}} thread of {{count}} posts that pays off the promise, each post tight and skimmable, ending with a soft CTA to {{cta_url}}.',
        vars: ['hook', 'platform', 'count', 'cta_url'],
        notes: 'Only expand a hook that already tested well.',
      },
    ],
  },
  {
    id: 'seo-title-meta-optimizer',
    title: 'SEO title/meta optimizer',
    category: 'seo',
    goal: 'Rewrite title tags and meta descriptions to lift click-through from the SERP without keyword stuffing.',
    prompts: [
      {
        title: 'Title + meta rewrite',
        template: 'Rewrite the SEO title tag and meta description for a page targeting "{{keyword}}". Give 3 title options (each under 60 characters, keyword near the front, compelling) and 3 meta descriptions (each under 155 characters, with a clear benefit and a call to action). Current title: "{{current_title}}".',
        vars: ['keyword', 'current_title'],
        notes: 'Match intent; a truthful benefit beats a clever line for CTR.',
      },
      {
        title: 'CTR power words',
        template: 'For a page about {{topic}} targeting {{audience}}, suggest 15 power words or emotional triggers proven to lift SERP click-through, grouped by tone (urgency / curiosity / trust / value). Note which suit a {{brand_voice}} brand voice.',
        vars: ['topic', 'audience', 'brand_voice'],
        notes: 'Use sparingly — one power word per title, kept honest.',
      },
    ],
  },
];

// ── library API — every function soft-fails to an empty/shaped value, never throws ──────────────────────

// Return packs, optionally filtered by category. Unknown/missing category → all packs.
export function listPacks({ category } = {}) {
  try {
    const cat = category == null ? '' : String(category).toLowerCase().trim();
    const list = cat && CATEGORIES.includes(cat) ? PACKS.filter((p) => p.category === cat) : PACKS;
    // Return shallow clones so callers can't mutate the library.
    return list.map((p) => ({ ...p, prompts: p.prompts.map((q) => ({ ...q, vars: q.vars.slice() })) }));
  } catch { return []; }
}

// One pack by id, or null.
export function getPack(id) {
  try {
    const want = String(id == null ? '' : id).trim();
    const p = PACKS.find((x) => x.id === want);
    if (!p) return null;
    return { ...p, prompts: p.prompts.map((q) => ({ ...q, vars: q.vars.slice() })) };
  } catch { return null; }
}

// Substitute {{vars}} in one prompt's template. Unknown/missing vars are LEFT VISIBLE as {{var}} so the
// operator can see what still needs filling. Returns a shaped result; never throws.
export function fillPrompt(packId, promptIndex, vars = {}) {
  try {
    const pack = getPack(packId);
    if (!pack) return { ok: false, reason: 'no such pack', text: '' };
    const i = Number(promptIndex);
    const prompt = Number.isInteger(i) && i >= 0 ? pack.prompts[i] : undefined;
    if (!prompt) return { ok: false, reason: 'no such prompt', text: '' };
    const v = vars && typeof vars === 'object' ? vars : {};
    const missing = [];
    const text = String(prompt.template).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name) => {
      if (Object.prototype.hasOwnProperty.call(v, name) && v[name] != null && String(v[name]) !== '') {
        return String(v[name]);
      }
      missing.push(name);
      return whole; // leave the {{placeholder}} visible
    });
    return { ok: true, packId: pack.id, promptIndex: i, title: prompt.title, text, missing };
  } catch { return { ok: false, reason: 'error', text: '' }; }
}

// Full-text-ish search over title / goal / category (and prompt titles). Empty query → all packs.
export function search(query) {
  try {
    const q = String(query == null ? '' : query).toLowerCase().trim();
    if (!q) return listPacks();
    return listPacks().filter((p) => {
      const hay = [p.title, p.goal, p.category, ...(p.prompts || []).map((x) => x.title)]
        .join(' ').toLowerCase();
      return hay.includes(q);
    });
  } catch { return []; }
}

// ── HTTP surface (read-only JSON) ───────────────────────────────────────────────────────────────────────
const sendJson = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  // esc() the id we echo back so no request value reflects unescaped.
  res.end(JSON.stringify(obj));
};

export async function handler(req, res, opts = {}) {
  try {
    const method = (req.method || 'GET').toUpperCase();
    const raw = String(req.url || '');
    const [pathRaw, queryRaw = ''] = raw.split('?');
    const path = pathRaw.replace(/\/+$/, '') || '/';
    const params = new URLSearchParams(queryRaw);

    if (method !== 'GET') return sendJson(res, 405, { ok: false, reason: 'method-not-allowed' });

    if (path === '/health') return sendJson(res, 200, { ok: true });

    if (path === '/api/packs') {
      const category = params.get('category') || undefined;
      const q = params.get('q');
      let packs = q ? search(q) : listPacks({ category });
      if (q && category && CATEGORIES.includes(String(category).toLowerCase().trim())) {
        packs = packs.filter((p) => p.category === String(category).toLowerCase().trim());
      }
      return sendJson(res, 200, { ok: true, count: packs.length, categories: CATEGORIES, packs });
    }

    if (path.startsWith('/api/pack/')) {
      const id = decodeURIComponent(path.slice('/api/pack/'.length));
      const pack = getPack(id);
      // esc() defends any downstream HTML use of the echoed id; JSON.stringify already neutralises it here.
      if (!pack) return sendJson(res, 404, { ok: false, reason: 'not-found', id: esc(id) });
      return sendJson(res, 200, { ok: true, pack });
    }

    return sendJson(res, 404, { ok: false, reason: 'not-found' });
  } catch {
    try { return sendJson(res, 500, { ok: false, reason: 'error' }); } catch { return undefined; }
  }
}

// ── CLI (guarded) ───────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const PORT = +(env('PORT', '8168'));
  const HOST = env('HOST', '127.0.0.1');
  createServer((req, res) => handler(req, res)).listen(PORT, HOST, () => {
    console.log(`herald prompt-packs on http://${HOST}:${PORT}/api/packs`);
  });
}
