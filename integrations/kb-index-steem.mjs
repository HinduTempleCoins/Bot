// kb-index-steem.mjs — index the operator's Steem/Hive tutorial posts into the knowledge base as
// searchable, citable chunk records. (Task #51)
//
// The operator wrote years of tutorials under several handles:
//   @marsresident  (Steem, 2017-era) — Revolution / Temple Coin / Cryptonote / ETH-clone tutorials
//   @punicwax      (Steem, 2020+)    — BLURT mining, SMTs, TRC10 TRON guides, Witness explainer
//   @vankush, @kalivankush (Hive)
// These are first-party corpus per BRIEF.md §2 (lineage = continuity). We pull each author's blog via
// the Graphene `condenser_api` (steemit.com itself 403s on a direct browser-style fetch, but the RPC
// is open), normalize to posts, strip the Markdown to clean text, chunk it, and emit flat citable
// records that the KB / Cheetah / library-rag can search and cite back with a real source URL.
//
// Read-only. No keys. Injectable fetch so tests run fully offline against canned RPC JSON.
//
//   import { indexAuthors, toRecords } from './kb-index-steem.mjs'
//   node integrations/kb-index-steem.mjs marsresident punicwax           # Steem
//   node integrations/kb-index-steem.mjs --node https://api.hive.blog vankush

const UA = 'MELEK-KB-Indexer/1.0 (+https://github.com/HinduTempleCoins/Bot; polite, read-only)';

// Public condenser RPC endpoints. Steem handles (@marsresident, @punicwax) live on the Steem node;
// Hive handles (@vankush, @kalivankush) on the Hive node. Default is Steem; pass { node } to switch.
export const STEEM_NODE = 'https://api.steemit.com';
export const HIVE_NODE = 'https://api.hive.blog';

// Which chain a node belongs to, so a record is tagged source:'steem' vs 'hive' correctly. A node URL
// that mentions "hive" is Hive; everything else (incl. the default) is Steem. Callers can also force
// the source by passing { source } to the indexers.
export function sourceForNode(node) {
  return /hive/i.test(String(node || '')) ? 'hive' : 'steem';
}

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// One polite JSON-RPC call to the condenser API. Soft: any network/HTTP/parse/RPC error → null, never
// throws (callers treat null as "nothing back" and fall through to []).
async function rpc(node, method, params, timeout = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await _fetch(node, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!r || !r.ok) return null;
    const j = await r.json();
    if (!j || j.error) return null;       // RPC-level error → soft-fail
    return j.result ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Parse the json_metadata tags array off a raw condenser row (best-effort; bad JSON → []).
function tagsFromRow(row) {
  try {
    const meta = typeof row.json_metadata === 'string' ? JSON.parse(row.json_metadata) : (row.json_metadata || {});
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    return tags.filter((x) => typeof x === 'string' && x).map((x) => x.toLowerCase());
  } catch {
    return [];
  }
}

// Build the canonical permalink for a post. Steem → steemit.com, Hive → hive.blog. The community/tag
// segment uses the first tag (or 'hive') the way the condensers route, but the author/permlink suffix
// is what actually resolves the post, so this is a stable citation URL either way.
function postUrl(source, author, permlink, tags) {
  const host = source === 'hive' ? 'https://hive.blog' : 'https://steemit.com';
  const cat = (tags && tags[0]) || (source === 'hive' ? 'hive' : 'steem');
  return `${host}/${cat}/@${author}/${permlink}`;
}

// Normalize a raw condenser_api row into our post shape. Defensive about missing fields.
function normalizeRow(row, source) {
  if (!row || typeof row !== 'object') return null;
  const author = String(row.author || '').replace(/^@/, '');
  const permlink = String(row.permlink || '');
  if (!author || !permlink) return null;
  const tags = tagsFromRow(row);
  return {
    author,
    permlink,
    title: String(row.title || '').trim(),
    body: String(row.body || ''),
    created: row.created || '',
    tags,
    url: postUrl(source, author, permlink, tags),
  };
}

/**
 * Fetch an author's blog posts via condenser_api.get_discussions_by_blog and normalize them.
 * Soft-fails to [] on any thrown fetch, non-ok HTTP, RPC error, or unexpected shape.
 *
 * @returns {Promise<Array<{author,permlink,title,body,created,tags,url}>>}
 */
export async function fetchAuthorPosts(author, { node = STEEM_NODE, limit = 20, source } = {}) {
  const tag = String(author || '').replace(/^@/, '').trim();
  if (!tag) return [];
  const src = source || sourceForNode(node);
  try {
    const result = await rpc(node, 'condenser_api.get_discussions_by_blog', [{ tag, limit: Math.min(100, Math.max(1, limit)) }]);
    if (!Array.isArray(result)) return [];
    // get_discussions_by_blog can include reblogs (author != tag); keep only the author's own posts.
    return result
      .map((row) => normalizeRow(row, src))
      .filter((p) => p && p.author === tag);
  } catch {
    return [];
  }
}

// --- Markdown → clean text -------------------------------------------------
// Pure, tested. Strips the common Markdown + inline HTML the Steem/Hive editors emit so chunk text is
// readable prose (good for lexical search + citation snippets), not markup soup.
export function markdownToText(md) {
  let s = String(md || '');
  // fenced + inline code → keep the inner text, drop the backticks/fences.
  s = s.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, '$1');
  s = s.replace(/`([^`]+)`/g, '$1');
  // images first (they contain a ![...](...) that the link rule would otherwise mangle) → alt text only.
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  // markdown links [text](url) → text.
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // raw HTML tags (Steem allows a subset) → drop the tags, keep content.
  s = s.replace(/<[^>]+>/g, ' ');
  // headings / blockquote / list markers at line start.
  s = s.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  s = s.replace(/^[ \t]*>[ \t]?/gm, '');
  s = s.replace(/^[ \t]*[-*+][ \t]+/gm, '');
  s = s.replace(/^[ \t]*\d+\.[ \t]+/gm, '');
  // horizontal rules.
  s = s.replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, '');
  // emphasis: bold/italic/strikethrough markers.
  s = s.replace(/(\*\*|__)(.*?)\1/g, '$2');
  s = s.replace(/(\*|_)(.*?)\1/g, '$2');
  s = s.replace(/~~(.*?)~~/g, '$1');
  // HTML entities that matter for readable prose.
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  // collapse whitespace.
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n');
  return s.trim();
}

// Split clean text into overlapping char-bounded chunks. Tries to break on a paragraph/sentence/space
// boundary near the limit instead of mid-word. Returns [] for empty input.
function chunkText(text, maxChars, overlap) {
  const t = String(text || '');
  if (!t) return [];
  if (t.length <= maxChars) return [t];
  const out = [];
  let i = 0;
  const step = Math.max(1, maxChars - overlap);
  while (i < t.length) {
    let end = Math.min(t.length, i + maxChars);
    if (end < t.length) {
      // prefer a clean break (paragraph > newline > sentence > space) within the back third of the window.
      const window = t.slice(i, end);
      const floor = Math.floor(maxChars * 0.6);
      const cut = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('\n'),
        window.lastIndexOf('. '),
        window.lastIndexOf(' '),
      );
      if (cut > floor) end = i + cut + 1;
    }
    const piece = t.slice(i, end).trim();
    if (piece) out.push(piece);
    if (end >= t.length) break;
    i += Math.max(step, end - i - overlap);
  }
  return out;
}

/**
 * Index a single normalized post into a KB document with ordered text chunks.
 * @returns {{id,source,author,title,url,created,tags,chunks:Array<{ord,text}>}}
 */
export function indexPost(post, { maxChars = 1200, overlap = 150, source } = {}) {
  const p = post || {};
  const src = source || (p.source) || (/hive/i.test(p.url || '') ? 'hive' : 'steem');
  const author = String(p.author || '').replace(/^@/, '');
  const permlink = String(p.permlink || '');
  const clean = markdownToText(p.body);
  const chunks = chunkText(clean, maxChars, overlap).map((text, ord) => ({ ord, text }));
  return {
    id: `${author}/${permlink}`,
    source: src,
    author,
    title: String(p.title || ''),
    url: p.url || postUrl(src, author, permlink, p.tags),
    created: p.created || '',
    tags: Array.isArray(p.tags) ? p.tags : [],
    chunks,
  };
}

/**
 * Fetch + index every author's posts. Soft-skips any author whose fetch fails (returns no records for
 * them) rather than aborting the whole run. `authors` may be strings or { author, node, source }.
 * @returns {Promise<Array<ReturnType<typeof indexPost>>>}
 */
export async function indexAuthors(authors, { node = STEEM_NODE, limit = 20, maxChars = 1200, overlap = 150, source } = {}) {
  const list = Array.isArray(authors) ? authors : [authors];
  const out = [];
  for (const entry of list) {
    const spec = typeof entry === 'string' ? { author: entry } : (entry || {});
    const aNode = spec.node || node;
    const aSrc = spec.source || source || sourceForNode(aNode);
    try {
      const posts = await fetchAuthorPosts(spec.author, { node: aNode, limit: spec.limit || limit, source: aSrc });
      for (const post of posts) {
        out.push(indexPost(post, { maxChars, overlap, source: aSrc }));
      }
    } catch {
      // soft-skip this author; keep going.
    }
  }
  return out;
}

/**
 * Flatten indexed documents into flat, citable chunk records. One record per chunk, each carrying the
 * source URL so the KB / Cheetah / library-rag can cite the exact post.
 * @returns {Array<{docId,ord,text,source,author,title,url,created,tags}>}
 */
export function toRecords(indexed) {
  const docs = Array.isArray(indexed) ? indexed : [indexed];
  const records = [];
  for (const doc of docs) {
    if (!doc || !Array.isArray(doc.chunks)) continue;
    for (const ch of doc.chunks) {
      records.push({
        docId: doc.id,
        ord: ch.ord,
        text: ch.text,
        source: doc.source,
        author: doc.author,
        title: doc.title,
        url: doc.url,
        created: doc.created || '',
        tags: doc.tags || [],
      });
    }
  }
  return records;
}

// --- CLI -------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('kb-index-steem.mjs')) {
  const argv = process.argv.slice(2);
  let node = STEEM_NODE;
  const authors = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--node') { node = argv[++i] || node; continue; }
    authors.push(argv[i]);
  }
  if (!authors.length) authors.push('marsresident', 'punicwax');
  const indexed = await indexAuthors(authors, { node });
  const records = toRecords(indexed);
  console.error(`indexed ${indexed.length} post(s) → ${records.length} chunk record(s) from ${node} (source=${sourceForNode(node)})`);
  console.log(JSON.stringify(records, null, 2));
}
