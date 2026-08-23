// integrations/journal.mjs — the VKFRI Academic Journal: the Van Kush Family Research Institute's
// own open-access, peer-reviewed journal. Open-access / PD-first: every article must carry an OPEN
// license (CC-BY / CC-BY-SA / CC0 / PD). This is a PUBLISHER of ORIGINAL + public-domain scholarship,
// NOT a rehost — closed / NonCommercial / NoDerivs licenses are rejected at submission.
//
// Models an OJS-style editorial workflow, minimal: submit → assign reviewers → collect reviews →
// editorial decision across a fixed pipeline → publish (into a volume/issue, with a deterministic
// DOI-style id). Pure off-chain logic — nothing here touches the network or the chain.
//
// House style: factory over an injectable in-memory `storage` (a Map-like) + an injectable clock
// `now` — NO bare Date.now()/Math.random() in the asserted logic (a live CLI supplies real ones).
// Soft-fail-never-throw: every method returns a shaped { ok, ... } / value, never throws. esc() ALL
// interpolation. Optional HTTP surface via handler(req,res) + a guarded CLI.
//
//   import { createJournal, PIPELINE, handler } from './journal.mjs'
//   const j = createJournal({ storage: new Map(), now: () => 1_700_000_000_000 });
//   j.submit({ title, authors, abstract, body, keywords, license });
//
//   GET  /api/articles          → { ok, articles }        (+ ?status=published)
//   GET  /api/article/:id       → { ok, article } | 404
//   POST /api/submit            → { ok, article } | 400
//   GET  /health                → { ok, stats }
//
//   PORT=8175 node integrations/journal.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

// ── shared helpers ───────────────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s) => String(s == null ? '' : s).trim();
const clone = (o) => { try { return JSON.parse(JSON.stringify(o)); } catch { return o; } };

// The editorial pipeline (left→right happy path; 'rejected' is an unhappy terminal).
export const PIPELINE = ['submitted', 'in-review', 'revisions', 'accepted', 'published', 'rejected'];

// Allowed status transitions via decide(). publish() is the ONLY path into 'published' (it sets the
// DOI + timestamp), so 'published' never appears as a decide() target.
const TRANSITIONS = {
  submitted: ['in-review', 'rejected'],
  'in-review': ['revisions', 'accepted', 'rejected'],
  revisions: ['in-review', 'accepted', 'rejected'],
  accepted: ['rejected'],
  published: [],
  rejected: [],
};

// Peer-review recommendations.
export const RECOMMENDATIONS = ['accept', 'revise', 'reject'];

// Open-access license whitelist (canonical forms). PD-first publisher: anything else is refused.
export const OPEN_LICENSES = ['CC-BY', 'CC-BY-SA', 'CC0', 'PD'];

// Normalize a license string to a canonical form: uppercase, spaces→hyphens, strip a trailing
// version (e.g. "-4.0"), map common synonyms. Returns '' for empty input.
export function normalizeLicense(raw) {
  let s = clean(raw).toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-');
  s = s.replace(/-(?:V)?\d+(?:\.\d+)?$/, ''); // drop trailing version: CC-BY-4.0 → CC-BY
  if (s === 'PUBLIC-DOMAIN' || s === 'PUBLICDOMAIN' || s === 'CC-PD') s = 'PD';
  if (s === 'CC-ZERO') s = 'CC0';
  return s;
}

// Is this an OPEN license we accept? NonCommercial (NC) / NoDerivs (ND) and anything off the
// whitelist (closed / all-rights-reserved) are rejected.
export function isOpenLicense(raw) {
  const s = normalizeLicense(raw);
  if (!s) return false;
  if (/(?:^|-)N[CD](?:-|$)/.test(s)) return false; // -NC- / -ND-
  return OPEN_LICENSES.includes(s);
}

// authors: an array, or a comma/semicolon-separated string → a trimmed non-empty array.
function normAuthors(a) {
  const list = Array.isArray(a) ? a : clean(a).split(/[;,]/);
  return list.map((x) => clean(x)).filter(Boolean);
}
function normKeywords(k) {
  const list = Array.isArray(k) ? k : clean(k).split(/[;,]/);
  return list.map((x) => clean(x)).filter(Boolean);
}

function yearOf(ts) { const n = Number(ts); if (!Number.isFinite(n)) return ''; const y = new Date(n).getUTCFullYear(); return Number.isFinite(y) ? y : ''; }

// ── the factory ──────────────────────────────────────────────────────────────────────────────────
// storage: any Map-like ({ get, set, has, delete, keys }). Defaults to a fresh in-memory Map.
// now: a clock returning ms. Defaults to Date.now (used only outside tests / by the live CLI).
export function createJournal({ storage = new Map(), now = () => Date.now() } = {}) {
  const clk = typeof now === 'function' ? now : () => Date.now();

  const key = (id) => `art:${id}`;
  const raw = (id) => storage.get(key(String(id == null ? '' : id))) || null;
  const put = (art) => { storage.set(key(art.id), art); return art; };
  const all = () => {
    const out = [];
    for (const k of storage.keys()) { if (typeof k === 'string' && k.startsWith('art:')) { const v = storage.get(k); if (v) out.push(v); } }
    return out.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  };
  const nextId = () => { const seq = (Number(storage.get('__seq')) || 0) + 1; storage.set('__seq', seq); return String(seq); };

  // ── submission ──────────────────────────────────────────────────────────────────────────────
  function submit({ title, authors, abstract, body, keywords, license } = {}) {
    const t = clean(title);
    const ab = clean(abstract);
    const auth = normAuthors(authors);
    if (!t) return { ok: false, error: 'title required' };
    if (!auth.length) return { ok: false, error: 'authors required' };
    if (!ab) return { ok: false, error: 'abstract required' };
    if (!isOpenLicense(license)) {
      return { ok: false, error: 'license must be open access (CC-BY, CC-BY-SA, CC0, or PD); closed / NC / ND licenses are not accepted' };
    }
    const id = nextId();
    const art = {
      id,
      title: t,
      authors: auth,
      abstract: ab,
      body: clean(body),
      keywords: normKeywords(keywords),
      license: normalizeLicense(license),
      status: 'submitted',
      doi: null,
      reviewers: [],
      reviews: [],
      decisions: [],
      volume: null,
      issue: null,
      at: clk(),
      published_at: null,
    };
    put(art);
    return { ok: true, article: clone(art) };
  }

  // ── peer review ─────────────────────────────────────────────────────────────────────────────
  function assignReviewer(id, reviewer) {
    const art = raw(id);
    if (!art) return { ok: false, error: 'no such article' };
    const r = clean(reviewer);
    if (!r) return { ok: false, error: 'reviewer required' };
    if (art.status !== 'submitted' && art.status !== 'in-review' && art.status !== 'revisions') {
      return { ok: false, error: `cannot assign a reviewer to a ${art.status} article` };
    }
    if (!art.reviewers.includes(r)) art.reviewers.push(r);
    if (art.status === 'submitted') art.status = 'in-review'; // first reviewer opens review
    put(art);
    return { ok: true, article: clone(art) };
  }

  function addReview(id, { reviewer, recommendation, notes } = {}) {
    const art = raw(id);
    if (!art) return { ok: false, error: 'no such article' };
    const rec = clean(recommendation).toLowerCase();
    if (!RECOMMENDATIONS.includes(rec)) return { ok: false, error: 'recommendation must be accept|revise|reject' };
    art.reviews.push({ reviewer: clean(reviewer), recommendation: rec, notes: clean(notes), at: clk() });
    put(art);
    return { ok: true, article: clone(art) };
  }

  // ── editorial decision (pipeline transition) ────────────────────────────────────────────────
  function decide(id, decision) {
    const art = raw(id);
    if (!art) return { ok: false, error: 'no such article' };
    const to = clean(decision);
    if (!PIPELINE.includes(to)) return { ok: false, error: `unknown status '${to}'` };
    const allowed = TRANSITIONS[art.status] || [];
    if (!allowed.includes(to)) return { ok: false, error: `cannot move from '${art.status}' to '${to}'` };
    art.status = to;
    art.decisions.push({ to, at: clk() });
    put(art);
    return { ok: true, article: clone(art) };
  }

  // ── publication ─────────────────────────────────────────────────────────────────────────────
  // Only an 'accepted' article can be published. DOI is deterministic: 10.melek/vkfri.{volume}.{id}.
  function publish(id, { volume, issue } = {}) {
    const art = raw(id);
    if (!art) return { ok: false, error: 'no such article' };
    if (art.status !== 'accepted') return { ok: false, error: `can only publish an accepted article (is '${art.status}')` };
    const vol = clean(volume) || '1';
    const iss = clean(issue) || '1';
    art.volume = vol;
    art.issue = iss;
    art.status = 'published';
    art.doi = `10.melek/vkfri.${vol}.${art.id}`;
    art.published_at = clk();
    art.decisions.push({ to: 'published', at: art.published_at });
    put(art);
    return { ok: true, article: clone(art) };
  }

  // ── views ───────────────────────────────────────────────────────────────────────────────────
  function getArticle(id) { const a = raw(id); return a ? clone(a) : null; }

  function listArticles({ status } = {}) {
    let list = all();
    const s = clean(status);
    if (s) list = list.filter((a) => a.status === s);
    return list.map(clone);
  }

  function issue(volume, issueNo) {
    const vol = clean(volume);
    const iss = clean(issueNo);
    return all().filter((a) => a.status === 'published' && a.volume === vol && a.issue === iss).map(clone);
  }

  function stats() {
    const list = all();
    const byStatus = Object.fromEntries(PIPELINE.map((s) => [s, 0]));
    const byLicense = {};
    for (const a of list) {
      if (byStatus[a.status] != null) byStatus[a.status]++;
      const l = a.license || '(none)';
      byLicense[l] = (byLicense[l] || 0) + 1;
    }
    return { total: list.length, published: byStatus.published || 0, byStatus, byLicense };
  }

  return {
    submit, assignReviewer, addReview, decide, publish,
    getArticle, listArticles, issue, stats,
    citation,
    // low-level accessors (handy for a host surface)
    _all: () => all().map(clone),
  };
}

// ── citation formatting (esc-safe; APA-ish + BibTeX). Pure — takes an article object. ────────────
export function citation(article, style = 'apa') {
  const a = article || {};
  const authors = Array.isArray(a.authors) ? a.authors : normAuthors(a.authors);
  const year = yearOf(a.published_at != null ? a.published_at : a.at);
  const title = clean(a.title) || 'Untitled';
  const vol = clean(a.volume);
  const iss = clean(a.issue);
  const doi = clean(a.doi);
  const JOURNAL = 'Van Kush Family Research Institute Journal';
  const st = clean(style).toLowerCase();

  if (st === 'bibtex') {
    const cite = `vkfri${clean(a.id) || 'x'}`;
    const lines = [
      `@article{${esc(cite)},`,
      `  author = {${esc(authors.join(' and '))}},`,
      `  title = {${esc(title)}},`,
      `  journal = {${esc(JOURNAL)}},`,
    ];
    if (year) lines.push(`  year = {${esc(year)}},`);
    if (vol) lines.push(`  volume = {${esc(vol)}},`);
    if (iss) lines.push(`  number = {${esc(iss)}},`);
    if (doi) lines.push(`  doi = {${esc(doi)}},`);
    lines.push('}');
    return lines.join('\n');
  }

  // APA-ish default: Authors (Year). Title. Journal, Vol(Issue). https://doi.org/DOI
  const who = authors.length ? esc(authors.join(', ')) : 'VKFRI';
  const yr = year ? ` (${esc(year)})` : '';
  let volPart = '';
  if (vol) volPart = `, ${esc(vol)}${iss ? `(${esc(iss)})` : ''}`;
  const doiPart = doi ? ` https://doi.org/${esc(doi)}` : '';
  return `${who}${yr}. ${esc(title)}. ${esc(JOURNAL)}${volPart}.${doiPart}`.trim();
}

// ── HTTP surface (optional) ──────────────────────────────────────────────────────────────────────
const _defaultJournal = createJournal({});

const sendJson = (res, code, obj) => { try { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); } catch { /* ignore */ } };

function readJsonBody(req, max = 65536) {
  if (req && req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let d = ''; let over = false;
    try {
      req.on('data', (c) => { d += c; if (d.length > max) { over = true; try { req.destroy(); } catch {} } });
      req.on('end', () => { if (over) return resolve(null); try { resolve(d ? JSON.parse(d) : {}); } catch { resolve(null); } });
      req.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

export async function handler(req, res, opts = {}) {
  try {
    const journal = opts.journal || _defaultJournal;
    const method = (req.method || 'GET').toUpperCase();
    const path = String(req.url || '').split('?')[0].replace(/\/+$/, '') || '/';
    const query = (() => { try { return Object.fromEntries(new URL(req.url || '/', 'http://x').searchParams); } catch { return {}; } })();

    if (path === '/health' && method === 'GET') {
      return sendJson(res, 200, { ok: true, service: 'vkfri-journal', stats: journal.stats() });
    }
    if (path === '/api/articles' && method === 'GET') {
      return sendJson(res, 200, { ok: true, articles: journal.listArticles({ status: query.status }) });
    }
    if (path.startsWith('/api/article/') && method === 'GET') {
      const id = decodeURIComponent(path.slice('/api/article/'.length));
      const art = journal.getArticle(id);
      if (!art) return sendJson(res, 404, { ok: false, error: 'not-found' });
      return sendJson(res, 200, { ok: true, article: art });
    }
    if (path === '/api/submit' && method === 'POST') {
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, error: 'bad-body' });
      const r = journal.submit(body);
      return sendJson(res, r.ok ? 200 : 400, r);
    }
    return sendJson(res, 404, { ok: false, error: 'not-found' });
  } catch {
    return sendJson(res, 500, { ok: false, error: 'error' });
  }
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const PORT = +(process.env.PORT || 8175);
  const HOST = process.env.HOST || '127.0.0.1';
  createServer((req, res) => handler(req, res)).listen(PORT, HOST, () => {
    console.log(`VKFRI journal on http://${HOST}:${PORT}/health`);
  });
}
