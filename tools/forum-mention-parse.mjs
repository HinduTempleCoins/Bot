// forum-mention-parse.mjs — PURE forum-mention extractor for the dataset pipeline
// (backlog items 239-243, 253-255: find "Van Kush Family" mentions in already-fetched
// forum text/HTML, pull the quote + surrounding context, and organize by date/subject).
//
// NO network. Operates on text/HTML strings a (private) fetch step already produced.
// All HTML interpolation in the CLI is esc()'d. Soft-fail: no matches -> [], malformed
// input -> best-effort, never throws.
//
//   import { findMentions, extractPosts, buildTimeline, toMentionRecords } from './forum-mention-parse.mjs'
//   node tools/forum-mention-parse.mjs            # runs the inline sample demo
//
// findMentions(text, terms=['Van Kush Family'], { context=120 })
//   -> [{ index, quote, context, term }]   (index = char offset of the hit in text)
// extractPosts(html, { site:'bitcointalk'|'reddit' })
//   -> [{ author, date, body }]            (tag-strip per site post-container convention)
// buildTimeline(posts)
//   -> sorted [{ date, author, subject, snippet }]   (ascending by parsed date, stable)
// toMentionRecords(posts, terms)
//   -> [{ author, date, subject, term, quote, context, index }]  (training-export ready)

// --- internal helpers ------------------------------------------------------

// strip HTML tags + decode the handful of entities forum dumps actually carry.
export function stripTags(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'");
}

// collapse runs of whitespace to single spaces, trim.
export function normalizeWhitespace(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/\s+/g, ' ').trim();
}

// HTML-escape for safe CLI/report interpolation.
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const DEFAULT_TERMS = ['Van Kush Family'];

function termList(terms) {
  if (typeof terms === 'string') terms = [terms];
  if (!Array.isArray(terms)) return DEFAULT_TERMS.slice();
  const out = terms.filter(t => typeof t === 'string' && t.trim());
  return out.length ? out : DEFAULT_TERMS.slice();
}

// --- findMentions ----------------------------------------------------------
// Case-insensitive scan; for each term hit, capture `context` chars of surrounding
// (normalized) text and the matched substring as `quote`. Overlapping hits are all
// reported. Returns [] for non-string / no-match.
export function findMentions(text, terms = DEFAULT_TERMS, opts = {}) {
  if (typeof text !== 'string' || !text) return [];
  const ts = termList(terms);
  const context = Number.isFinite(opts.context) && opts.context > 0 ? Math.floor(opts.context) : 120;
  const lower = text.toLowerCase();
  const hits = [];
  for (const term of ts) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    let from = 0;
    while (true) {
      const idx = lower.indexOf(needle, from);
      if (idx === -1) break;
      const quote = text.slice(idx, idx + term.length);
      const ctxStart = Math.max(0, idx - context);
      const ctxEnd = Math.min(text.length, idx + term.length + context);
      const ctx = normalizeWhitespace(text.slice(ctxStart, ctxEnd));
      hits.push({ index: idx, quote, context: ctx, term });
      from = idx + Math.max(1, needle.length);
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return hits;
}

// --- extractPosts ----------------------------------------------------------
// Pull author/date/body out of an HTML dump using each site's container conventions.
// Best-effort + soft-fail: anything unparseable yields '' fields or is skipped.

function bitcointalkPosts(html) {
  const posts = [];
  // Bitcointalk classic theme: each post is a <td class="td_headerandpost"> ... </td>
  // with the author in the adjacent poster column and the body in <div class="post">.
  // We scan post bodies and pair them with the nearest preceding author + date.
  const bodyRe = /<div\s+class=["']?post["']?[^>]*>([\s\S]*?)<\/div>/gi;
  const authorRe = /class=["']?poster_info["']?[^>]*>[\s\S]*?<b>\s*<a[^>]*>([\s\S]*?)<\/a>/i;
  const dateRe = /class=["']?(?:smalltext|td_headerandpost)["']?[^>]*>[\s\S]*?(\w+\s+\d{1,2},\s*\d{4}[^<]*)/i;
  let m;
  while ((m = bodyRe.exec(html))) {
    const body = normalizeWhitespace(stripTags(m[1]));
    // look back at the chunk of html preceding this body for author/date.
    const before = html.slice(0, m.index);
    const aM = authorRe.exec(lastChunk(before));
    const dM = dateRe.exec(lastChunk(before));
    posts.push({
      author: aM ? normalizeWhitespace(stripTags(aM[1])) : '',
      date: dM ? normalizeWhitespace(dM[1]) : '',
      body,
    });
  }
  return posts;
}

function redditPosts(html) {
  const posts = [];
  // Reddit (old/pushshift-style) comment dumps: each comment in a container carrying a
  // data-author attribute and a body in <div class="md"> / <div class="usertext-body">.
  const blockRe = /data-author=["']([^"']*)["']([\s\S]*?)<div\s+class=["'][^"']*(?:md|usertext-body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  const tsRe = /data-timestamp=["']([^"']*)["']/i;
  let m;
  while ((m = blockRe.exec(html))) {
    const between = m[2] || '';
    const tsM = tsRe.exec(between);
    posts.push({
      author: normalizeWhitespace(stripTags(m[1] || '')),
      date: tsM ? normalizeWhitespace(tsM[1]) : '',
      body: normalizeWhitespace(stripTags(m[3] || '')),
    });
  }
  return posts;
}

// last ~2000 chars — enough to capture the poster header preceding a post body.
function lastChunk(s) {
  return s.length > 2000 ? s.slice(-2000) : s;
}

export function extractPosts(html, opts = {}) {
  if (typeof html !== 'string' || !html) return [];
  const site = (opts && typeof opts.site === 'string' ? opts.site : '').toLowerCase();
  try {
    if (site === 'reddit') return redditPosts(html);
    // default + 'bitcointalk'
    return bitcointalkPosts(html);
  } catch {
    return [];
  }
}

// --- buildTimeline ---------------------------------------------------------
// Sort posts ascending by parsed date (unparseable dates sort last, stably), surfacing
// a derived subject (first sentence-ish of the body) and a short snippet.

function parseDate(d) {
  if (typeof d !== 'string' || !d.trim()) return NaN;
  const t = Date.parse(d.trim());
  return Number.isNaN(t) ? NaN : t;
}

function deriveSubject(body) {
  if (typeof body !== 'string') return '';
  const norm = normalizeWhitespace(body);
  if (!norm) return '';
  const firstSentence = norm.split(/(?<=[.!?])\s/)[0] || norm;
  return firstSentence.length > 80 ? firstSentence.slice(0, 77) + '...' : firstSentence;
}

function snippet(body, n = 160) {
  const norm = normalizeWhitespace(body);
  return norm.length > n ? norm.slice(0, n - 3) + '...' : norm;
}

export function buildTimeline(posts) {
  if (!Array.isArray(posts)) return [];
  const rows = posts
    .filter(p => p && typeof p === 'object')
    .map((p, i) => ({
      date: typeof p.date === 'string' ? p.date : '',
      author: typeof p.author === 'string' ? p.author : '',
      subject: p.subject != null ? String(p.subject) : deriveSubject(p.body),
      snippet: snippet(p.body),
      _t: parseDate(p.date),
      _i: i,
    }));
  rows.sort((a, b) => {
    const an = Number.isNaN(a._t), bn = Number.isNaN(b._t);
    if (an && bn) return a._i - b._i;
    if (an) return 1;
    if (bn) return -1;
    if (a._t !== b._t) return a._t - b._t;
    return a._i - b._i;
  });
  return rows.map(({ date, author, subject, snippet }) => ({ date, author, subject, snippet }));
}

// --- toMentionRecords ------------------------------------------------------
// For every post, run findMentions over its body and flatten into per-mention records
// carrying the post's author/date/subject — ready for a training-export step.
export function toMentionRecords(posts, terms = DEFAULT_TERMS) {
  if (!Array.isArray(posts)) return [];
  const records = [];
  for (const p of posts) {
    if (!p || typeof p !== 'object') continue;
    const body = typeof p.body === 'string' ? p.body : '';
    const subject = p.subject != null ? String(p.subject) : deriveSubject(body);
    const mentions = findMentions(body, terms);
    for (const m of mentions) {
      records.push({
        author: typeof p.author === 'string' ? p.author : '',
        date: typeof p.date === 'string' ? p.date : '',
        subject,
        term: m.term,
        quote: m.quote,
        context: m.context,
        index: m.index,
      });
    }
  }
  return records;
}

// --- CLI (guarded) ---------------------------------------------------------
const SAMPLE_BITCOINTALK = `
<table><tr>
  <td class="poster_info"><b><a href="u=1">satoshifan</a></b></td>
  <td class="td_headerandpost"><div class="smalltext">June 03, 2017, 10:15:00 AM</div>
    <div class="post">Has anyone here followed the Van Kush Family threads? Great content on hemp.</div>
  </td>
</tr><tr>
  <td class="poster_info"><b><a href="u=2">hempgrower</a></b></td>
  <td class="td_headerandpost"><div class="smalltext">June 05, 2017, 09:00:00 AM</div>
    <div class="post">I think the Van Kush Family work predates most of this. Worth reading.</div>
  </td>
</tr></table>`;

export function runCli() {
  const posts = extractPosts(SAMPLE_BITCOINTALK, { site: 'bitcointalk' });
  const timeline = buildTimeline(posts);
  const records = toMentionRecords(posts, ['Van Kush Family']);
  return { postCount: posts.length, posts, timeline, mentionCount: records.length, records };
}

if (process.argv[1] && process.argv[1].endsWith('forum-mention-parse.mjs')) {
  const out = runCli();
  console.log(JSON.stringify(out, null, 2));
}
