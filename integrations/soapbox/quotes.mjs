// quotes.mjs — SoapBox QUOTE search engine + quote pages (BrainyQuote / AZQuotes-style SEO vertical).
//
// Three surfaces off one dataset:
//   • SEARCH — full-text over text/author/topic, ranked.
//   • PERSON pages — "Quotes by <author>" (the long-tail money pages).
//   • TOPIC pages — "Quotes about <topic>".
// Each renders schema.org Quotation JSON-LD so it ranks.
//
// DISCIPLINE: every quote is ATTRIBUTED, and sourced where we can. Short, attributed quotations are the
//   whole point; we do NOT reproduce long copyrighted passages. Seed data favors public-domain /
//   historical voices. Facts + attribution, never a fabricated quote — an unattributed or unverifiable
//   line is marked as such, never dressed up as confirmed. esc() everywhere. Soft-fail, no network.
//
//   import { QUOTES, addQuotes, normalizeQuote, searchQuotes, byAuthor, byTopic, authors, topics,
//            quoteSeo, renderSearch, renderAuthorPage, renderTopicPage, dataNote } from './quotes.mjs'

const str = (v) => (v == null ? '' : String(v));
export function esc(s) {
  return str(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const jsonLdSafe = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const slug = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const norm = (s) => str(s).toLowerCase();

/** Normalize a quote record. verified:false + no source ⇒ shown with an "attribution unverified" flag. */
export function normalizeQuote(raw = {}) {
  const text = str(raw.text).trim();
  return {
    id: str(raw.id) || slug(`${str(raw.author)}-${text.slice(0, 40)}`),
    text,
    author: str(raw.author).trim() || 'Unknown',
    topics: Array.isArray(raw.topics) ? raw.topics.map((t) => str(t).trim()).filter(Boolean) : [],
    year: str(raw.year),
    source: raw.source && raw.source.name ? { name: str(raw.source.name), url: str(raw.source.url) } : null,
    verified: !!raw.verified,
  };
}

// ── seed corpus: public-domain / historical voices, attributed. Extend freely. ──────────────────────
export const QUOTES = [
  { text: 'The unexamined life is not worth living.', author: 'Socrates', topics: ['wisdom', 'philosophy', 'life'], source: { name: 'Plato, Apology', url: 'https://www.gutenberg.org/ebooks/1656' }, verified: true },
  { text: 'I have not failed. I have just found ten thousand ways that will not work.', author: 'Thomas Edison', topics: ['perseverance', 'failure', 'success'], source: { name: 'attributed', url: '' }, verified: false },
  { text: 'That which does not kill us makes us stronger.', author: 'Friedrich Nietzsche', topics: ['strength', 'adversity'], source: { name: 'Twilight of the Idols', url: 'https://www.gutenberg.org/ebooks/52263' }, verified: true },
  { text: 'Injustice anywhere is a threat to justice everywhere.', author: 'Martin Luther King Jr.', topics: ['justice', 'freedom'], source: { name: 'Letter from Birmingham Jail (1963)', url: '' }, verified: true },
  { text: 'The only thing we have to fear is fear itself.', author: 'Franklin D. Roosevelt', topics: ['courage', 'fear', 'leadership'], source: { name: 'First Inaugural Address (1933)', url: '' }, verified: true },
  { text: 'Be the change that you wish to see in the world.', author: 'Mahatma Gandhi', topics: ['change', 'action'], source: { name: 'attributed', url: '' }, verified: false },
  { text: 'Knowledge is power.', author: 'Francis Bacon', topics: ['knowledge', 'power'], source: { name: 'Meditationes Sacrae (1597)', url: '' }, verified: true },
].map(normalizeQuote);

/** Append more normalized quotes to the in-memory corpus (dedup by id). Returns the corpus. */
export function addQuotes(list = [], corpus = QUOTES) {
  const have = new Set(corpus.map((q) => q.id));
  for (const raw of Array.isArray(list) ? list : []) {
    const q = normalizeQuote(raw);
    if (q.text && !have.has(q.id)) { corpus.push(q); have.add(q.id); }
  }
  return corpus;
}

// ── search + facets ─────────────────────────────────────────────────────────────────────────────────
/** searchQuotes(query, {by, corpus, limit}) → ranked matches. by: 'all'|'text'|'author'|'topic'. */
export function searchQuotes(query, { by = 'all', corpus = QUOTES, limit = 50 } = {}) {
  const qn = norm(query).trim();
  if (!qn) return [];
  const terms = qn.split(/\s+/);
  const scored = [];
  for (const q of corpus) {
    const hayText = norm(q.text), hayAuthor = norm(q.author), hayTopics = norm(q.topics.join(' '));
    let score = 0;
    for (const t of terms) {
      if ((by === 'all' || by === 'author') && hayAuthor.includes(t)) score += 3;
      if ((by === 'all' || by === 'topic') && hayTopics.includes(t)) score += 2;
      if ((by === 'all' || by === 'text') && hayText.includes(t)) score += 1;
    }
    if (score > 0) scored.push({ ...q, _score: score });
  }
  return scored.sort((a, b) => b._score - a._score).slice(0, limit).map(({ _score, ...q }) => q);
}

export function byAuthor(author, corpus = QUOTES) {
  const a = norm(author);
  return corpus.filter((q) => norm(q.author) === a);
}
export function byTopic(topic, corpus = QUOTES) {
  const t = norm(topic);
  return corpus.filter((q) => q.topics.some((x) => norm(x) === t));
}
export function authors(corpus = QUOTES) {
  return [...new Set(corpus.map((q) => q.author))].sort();
}
export function topics(corpus = QUOTES) {
  return [...new Set(corpus.flatMap((q) => q.topics))].sort();
}

export function dataNote() {
  return 'Every quote is attributed, and sourced where a primary text exists. Lines we could not verify '
    + 'are marked “attribution unverified” — we never present a doubtful quote as confirmed, and we do '
    + 'not reproduce long copyrighted passages, only short attributed quotations.';
}

// ── SEO + render ────────────────────────────────────────────────────────────────────────────────────
export function quoteSeo(kind, name, list, { baseUrl = '' } = {}) {
  const base = str(baseUrl).replace(/\/$/, '');
  const path = kind === 'author' ? `/quotes/author/${slug(name)}` : kind === 'topic' ? `/quotes/topic/${slug(name)}` : '/quotes/search';
  const title = kind === 'author' ? `Quotes by ${name}` : kind === 'topic' ? `Quotes about ${name}` : `Quote search: ${name}`;
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, url: `${base}${path}`,
    hasPart: (list || []).map((qq) => ({
      '@type': 'Quotation', text: qq.text,
      spokenByCharacter: undefined, creator: { '@type': 'Person', name: qq.author },
    })),
  };
  return { title, path, canonical: `${base}${path}`, jsonLd };
}

function quoteLi(q, { linkAuthor = true } = {}) {
  const flag = q.verified ? '' : ' <span class="unverified" title="attribution unverified">⚑ attribution unverified</span>';
  const src = q.source && q.source.name
    ? (q.source.url ? ` — <a class="src" href="${esc(q.source.url)}" rel="nofollow noopener">${esc(q.source.name)}</a>` : ` — <span class="src">${esc(q.source.name)}</span>`)
    : '';
  const auth = linkAuthor ? `<a href="/quotes/author/${esc(slug(q.author))}">${esc(q.author)}</a>` : esc(q.author);
  const tags = q.topics.length ? ` <span class="tags">${q.topics.map((t) => `<a href="/quotes/topic/${esc(slug(t))}">#${esc(t)}</a>`).join(' ')}</span>` : '';
  return `<li class="q"><blockquote>${esc(q.text)}</blockquote><cite>— ${auth}${q.year ? `, ${esc(q.year)}` : ''}</cite>${flag}${src}${tags}</li>`;
}

function page(title, list, seo) {
  return `<section class="quotes">
  <h1>${esc(title)}</h1>
  <ul class="quote-list">${(list || []).map((q) => quoteLi(q)).join('') || '<li class="empty">No quotes yet.</li>'}</ul>
  <p class="note">${esc(dataNote())}</p>
  <script type="application/ld+json">${jsonLdSafe(seo.jsonLd)}</script>
</section>`;
}

export function renderSearch(query, opts = {}) {
  const list = searchQuotes(query, opts);
  const seo = quoteSeo('search', str(query), list, opts);
  return page(`Quote search: ${str(query)}`, list, seo);
}
export function renderAuthorPage(author, opts = {}) {
  const list = byAuthor(author, opts.corpus);
  const seo = quoteSeo('author', str(author), list, opts);
  return page(`Quotes by ${str(author)}`, list, seo);
}
export function renderTopicPage(topic, opts = {}) {
  const list = byTopic(topic, opts.corpus);
  const seo = quoteSeo('topic', str(topic), list, opts);
  return page(`Quotes about ${str(topic)}`, list, seo);
}

// ── CLI (guarded) ───────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('quotes.mjs')) {
  const [cmd = 'search', ...rest] = process.argv.slice(2);
  const arg = rest.join(' ');
  if (cmd === 'author') console.log(renderAuthorPage(arg, { baseUrl: 'https://quotes.soapbox.community' }));
  else if (cmd === 'topic') console.log(renderTopicPage(arg, { baseUrl: 'https://quotes.soapbox.community' }));
  else if (cmd === 'authors') console.log(authors().join('\n'));
  else if (cmd === 'topics') console.log(topics().join('\n'));
  else console.log(renderSearch(arg || 'justice', { baseUrl: 'https://quotes.soapbox.community' }));
  console.log(`\n${dataNote()}`);
}
