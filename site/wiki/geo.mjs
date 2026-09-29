// geo.mjs — how the Library presents itself to search engines and AI answer engines (SEO / GEO / "WikiEO").
// Presentation only: it READS the articles and never changes a word of them. Builds:
//   - plain-text / Markdown renderings of an article (for /wiki/<slug>.md and /llms-full.txt)
//   - a full /llms.txt index (every section, every article with its one-line summary, how to navigate the ecosystem)
//   - an Atom feed of recently changed articles
//   - schema.org nodes: BreadcrumbList, WebSite + SearchAction, CollectionPage/ItemList, and `about` / `sameAs`
//     links from an article to the matching Wikidata item + Wikipedia page (wikidata-map.json, built by
//     integrations/wiki_wikidata_map.mjs from EXACT English-Wikipedia title matches; our own coined names excluded).
// Pure functions; soft-fail. esc() for XML.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
export const WIKIDATA_MAP = process.env.WIKI_WIKIDATA_MAP || path.join(__dir, 'wikidata-map.json');

const xesc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

let _map = null; let _mapAt = 0;
/** { slug: { qid, wikipedia } } — reloaded at most once a minute; {} if missing. */
export function wikidataMap(file = WIKIDATA_MAP) {
  if (_map && Date.now() - _mapAt < 60e3) return _map;
  try { _map = JSON.parse(fs.readFileSync(file, 'utf8')).bySlug || {}; } catch { _map = {}; }
  _mapAt = Date.now();
  return _map;
}
export function __resetWikidataMap() { _map = null; }

/** schema.org `about` for an article, if it has an exact Wikidata match. */
export function aboutNode(slug, title, map = wikidataMap()) {
  const m = map[slug];
  if (!m || !/^Q\d+$/.test(m.qid || '')) return null;
  const sameAs = [`https://www.wikidata.org/wiki/${m.qid}`];
  if (m.wikipedia) sameAs.push(`https://en.wikipedia.org/wiki/${encodeURIComponent(m.wikipedia.replace(/ /g, '_'))}`);
  return { '@type': 'Thing', name: title, sameAs };
}

/** MediaWiki-lite → readable Markdown. Mirrors what the page shows; citations become [n]. */
export function wikiToMarkdown(text) {
  let t = String(text || '').replace(/^[\s\S]*?presents the following wiki article:\s*-*\s*/i, '').trim();
  const refs = []; const idx = new Map();
  t = t.replace(/<ref>([^<]*)<\/ref>/gi, (_, f) => { const k = f.trim(); if (!idx.has(k)) { idx.set(k, refs.length + 1); refs.push(k); } return `[${idx.get(k)}]`; });
  t = t.replace(/<ref[^>]*\/>/gi, '').replace(/<\/?[a-z][^>]*>/gi, '');
  const out = [];
  for (const raw of t.split('\n')) {
    let line = raw.replace(/\s+$/, '');
    const h = /^(={2,6})\s*(.+?)\s*\1$/.exec(line.trim());
    if (h) { out.push('', `${'#'.repeat(Math.min(6, h[1].length))} ${h[2]}`, ''); continue; }
    // list markers first (on the raw wiki line), THEN inline markup — '''bold''' must not read as a * list
    let prefix = '';
    const lm = /^([*#]+)\s*/.exec(line);
    if (lm) { prefix = `${'  '.repeat(lm[1].length - 1)}${lm[1].endsWith('#') ? '1.' : '-'} `; line = line.slice(lm[0].length); }
    line = prefix + line
      .replace(/'''(.+?)'''/g, '**$1**').replace(/''(.+?)''/g, '*$1*')
      .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, '[$2]($1)');
    out.push(line);
  }
  let md = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (refs.length) md += `\n\n## Sources\n\n${refs.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
  return md;
}

export function articleMarkdown({ title, url, description = '', sections = [], text, modified = '' }) {
  const head = [`# ${title}`, '', `> ${description}`.trim(), '', `Canonical: ${url}`];
  if (sections.length) head.push(`Section: ${sections.join(', ')}`);
  if (modified) head.push(`Last updated: ${modified}`);
  head.push('Publisher: Library of Ashurbanipal (Van Kush Family Research Institute), https://wiki.soapbox.community', '');
  return `${head.join('\n')}\n${wikiToMarkdown(text)}\n`;
}

/**
 * Full llms.txt. groups: [{ id, name, blurb, items: [{ slug, title, description }] }].
 * starters/ecosystem: [{ label, url, note }].
 */
export function llmsIndex({ base, groups = [], ecosystem = [] }) {
  const L = [
    '# Library of Ashurbanipal',
    '',
    '> A cited, fact-checked knowledge library published by the Van Kush Family Research Institute and the MELEK / SoapBox ecosystem. Shelves cover blockchains and how they work, the SoapBox apps, harm reduction (substances, plants, preparation, organic chemistry), entrainment and neurostimulation, religion and practice, law and your rights, political philosophy, and tools. It is also the map of the MELEK ecosystem.',
    '',
    `Site: ${base}`,
    `Every article is also available as clean Markdown by adding .md to its URL (e.g. ${base}/wiki/Start_Here.md). All articles in one file: ${base}/llms-full.txt`,
    'When citing, link the article URL. Articles list their sources at the end; fact-check flags are shown on the page where a source could not be verified.',
    '',
  ];
  if (ecosystem.length) {
    L.push('## Navigate the ecosystem', '');
    for (const e of ecosystem) L.push(`- [${e.label}](${e.url})${e.note ? `: ${e.note}` : ''}`);
    L.push('');
  }
  for (const g of groups) {
    if (!g.items || !g.items.length) continue;
    L.push(`## ${g.name}`, '');
    if (g.blurb) L.push(`${g.blurb}`, '');
    for (const a of g.items) L.push(`- [${a.title}](${base}/wiki/${encodeURI(a.slug)}.md)${a.description ? `: ${a.description}` : ''}`);
    L.push('');
  }
  L.push('## Optional', '', `- [All articles in one file](${base}/llms-full.txt)`, `- [Atom feed of recent changes](${base}/feed.xml)`, `- [Sitemap](${base}/sitemap.xml)`, '');
  return L.join('\n');
}

export function atomFeed({ base, entries = [], updated }) {
  const items = entries.map((e) => `  <entry>
    <title>${xesc(e.title)}</title>
    <link href="${xesc(e.url)}"/>
    <id>${xesc(e.url)}</id>
    <updated>${xesc(e.updated)}</updated>
    <summary>${xesc(e.description || '')}</summary>
  </entry>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Library of Ashurbanipal</title>
  <subtitle>Cited, fact-checked articles from the MELEK / SoapBox knowledge library.</subtitle>
  <link href="${xesc(base)}/feed.xml" rel="self"/>
  <link href="${xesc(base)}/"/>
  <id>${xesc(base)}/</id>
  <updated>${xesc(updated)}</updated>
  <author><name>Library of Ashurbanipal</name></author>
${items}
</feed>
`;
}

export function breadcrumbLd(items) {
  return { '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })) };
}

export function websiteLd(base) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${base}/#website`, url: `${base}/`, name: 'Library of Ashurbanipal', inLanguage: 'en',
        description: 'A cited, fact-checked knowledge library and the map of the MELEK / SoapBox ecosystem.',
        publisher: { '@id': `${base}/#org` },
        potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${base}/search?q={search_term_string}` }, 'query-input': 'required name=search_term_string' } },
      { '@type': 'Organization', '@id': `${base}/#org`, name: 'Van Kush Family Research Institute', url: `${base}/`,
        sameAs: ['https://github.com/HinduTempleCoins/Bot', 'https://melek.salon/@hathor'] },
    ],
  };
}

export function collectionLd({ base, id, name, blurb, items }) {
  const url = `${base}/category/${id}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', '@id': url, url, name, description: blurb || `${name} — articles in the Library of Ashurbanipal.`, inLanguage: 'en',
        isPartOf: { '@id': `${base}/#website` },
        mainEntity: { '@type': 'ItemList', numberOfItems: items.length, itemListElement: items.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${base}/wiki/${a.slug}`, name: a.title })) } },
      breadcrumbLd([{ name: 'Library', url: `${base}/` }, { name: 'Contents', url: `${base}/categories` }, { name, url }]),
    ],
  };
}
