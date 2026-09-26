/**
 * tutorial/site-map.mjs — "She needs to understand the Website some": a concise, generated SITE MAP for
 * Hathor's corpus, built from the sources of truth rather than written by hand:
 *
 *   • integrations/genai-tools.mjs  — every Studio tool: what it is + how to use it (the same registry that
 *                                     drives the /tools hub and the how-to pages)
 *   • the Studio top nav            — the links a reader actually sees at the top of the Studio
 *   • site/_dispatch/routes.json    — every public host → what that site is (from each site's own header
 *                                     comment; hostnames only — no addresses, no server paths)
 *   • site/wiki/articles/*.wiki     — every wiki article's title + opening sentence
 *
 * Output: knowledge/ecosystem/hathor-site-map.md — inside the `chain` domain of integrations/library-index.mjs,
 * so the corpus index and catalog pick it up, and read directly by tutorial/lesson-brain.mjs siteMapExcerpt()
 * for lesson answers. One entry per line ("- ...") so it retrieves line-by-line.
 *
 * Pure builders + a guarded CLI that writes the file. Offline, deterministic, never throws.
 *
 *   node tutorial/site-map.mjs            # writes knowledge/ecosystem/hathor-site-map.md
 *   node tutorial/site-map.mjs --stdout   # print instead
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
export const STUDIO_HOST = 'hathor.soapbox.community';
export const OUT_PATH = path.join(REPO, 'knowledge', 'ecosystem', 'hathor-site-map.md');

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const clip = (s, n = 220) => { const t = oneLine(s); return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t; };

// Anything that looks like an address or a server path never enters the public corpus.
const PRIVATE_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b|\/(?:opt|var|etc|root|home)\/\S*|\bmelek-[0-9a-z]\b|\bvmi\d+/gi;
const scrub = (s) => String(s || '').replace(PRIVATE_RE, '').replace(/\s{2,}/g, ' ').trim();

// ---- Studio tools ---------------------------------------------------------------------------------

export function toolEntries(tools = []) {
  return tools.map((t) => {
    const url = `https://${STUDIO_HOST}${t.url && t.url !== '/' ? t.url : '/'}`;
    const how = Array.isArray(t.howto) && t.howto.length ? ` How: ${t.howto.map((h) => oneLine(h).replace(/\.$/, '')).join('; ')}.` : '';
    return `- Studio tool **${oneLine(t.title)}** (${oneLine(t.cat || 'Studio')}) — ${url} — ${oneLine(t.what)}${how}`;
  });
}

// ---- Studio nav -----------------------------------------------------------------------------------

/** The links in the Studio's top bar (`<div class=topbar-r>…</div>` in site/hathor/server.mjs). */
export function studioNav(serverSrc = '') {
  const m = String(serverSrc).match(/class=topbar-r>([\s\S]*?)<\/div>/);
  if (!m) return [];
  const out = [];
  const seen = new Set();
  for (const a of m[1].matchAll(/<a href="(\/[^"]*)">([^<]+)<\/a>/g)) {
    if (seen.has(a[1])) continue;
    seen.add(a[1]);
    out.push({ path: a[1], label: oneLine(a[2]) });
  }
  return out;
}

// ---- hosts ----------------------------------------------------------------------------------------

/** A site's own one-line description, from the header comment of its server (or its README / <title>). */
export function describeSite(dir, { repo = REPO } = {}) {
  const base = path.join(repo, 'site', dir);
  for (const f of ['server.mjs', 'index.mjs', 'server.js']) {
    const src = read(path.join(base, f));
    if (!src) continue;
    const lines = [];
    for (const l of src.split('\n')) {
      if (!l.startsWith('//')) break;
      const t = l.replace(/^\/\/\s?/, '');
      if (!t.trim()) { if (lines.length) break; continue; }
      lines.push(t);
    }
    let text = lines.join(' ')
      .replace(/^(site\/[\w/-]+\/)?(server|index)\.m?js\s*[—–-]\s*/i, '')
      .replace(/Operator\s+\d{4}-\d{2}-\d{2}.*$/i, '');
    if (text && !/RECOVERED STATIC SNAPSHOT/i.test(text)) return clip(scrub(text));
  }
  const readme = read(path.join(base, 'README.md'));
  const para = readme.split('\n').find((l) => l.trim() && !l.startsWith('#'));
  if (para) return clip(scrub(para));
  for (const f of ['index.html', 'public/index.html', 'www/index.html']) {
    const t = (read(path.join(base, f)).match(/<title>([^<]+)<\/title>/) || [])[1];
    if (t) return clip(scrub(t));
  }
  return '';
}

export function hostEntries(routes = {}, { repo = REPO, describe = describeSite } = {}) {
  const byDir = new Map();
  for (const [host, dir] of Object.entries(routes)) {
    if (PRIVATE_RE.test(host)) { PRIVATE_RE.lastIndex = 0; continue; }
    PRIVATE_RE.lastIndex = 0;
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(host);
  }
  const out = [];
  for (const [dir, hosts] of [...byDir.entries()].sort((a, b) => a[1][0].localeCompare(b[1][0]))) {
    const what = describe(dir, { repo }) || `the ${dir} site`;
    out.push(`- **${hosts.sort().join(', ')}** — ${what}`);
  }
  return out;
}

// ---- wiki -----------------------------------------------------------------------------------------

/** First sentence of a MediaWiki article, markup stripped. */
export function wikiLead(src = '') {
  const body = String(src).split('\n').find((l) => l.trim() && !/^[={|!]|^\[\[(File|Category)/i.test(l.trim())) || '';
  const plain = body
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{[^}]*\}\}/g, '');
  const first = plain.match(/^(.{20,}?[.!?])(\s|$)/);
  return clip(first ? first[1] : plain);
}

export function wikiEntries(dir = path.join(REPO, 'site', 'wiki', 'articles')) {
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.wiki')).sort(); } catch { return []; }
  return names.map((n) => {
    const title = n.replace(/\.wiki$/, '').replace(/_/g, ' ');
    return `- Wiki: **${title}** — ${wikiLead(read(path.join(dir, n)))}`;
  });
}

// ---- the document ---------------------------------------------------------------------------------

export function buildSiteMap({ tools = [], nav = [], routes = {}, wiki = [], repo = REPO, describe } = {}) {
  const lines = [
    '# Hathor\'s map of the MELEK and SoapBox websites',
    '',
    'Generated by tutorial/site-map.mjs from the tool registry, the Studio nav, the public host routes and the wiki. Regenerate; do not hand-edit.',
    '',
    `## The Studio (https://${STUDIO_HOST}) — top navigation`,
    '',
    ...nav.map((n) => `- Studio nav **${n.label}** — https://${STUDIO_HOST}${n.path}`),
    '',
    '## Studio tools — what each does and how to use it',
    '',
    ...toolEntries(tools),
    '',
    '## Public sites — each host and what it is',
    '',
    ...hostEntries(routes, { repo, describe }),
    '',
    '## Wiki articles',
    '',
    ...wiki,
    '',
  ];
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { TOOLS } = await import('../integrations/genai-tools.mjs');
  const routes = JSON.parse(read(path.join(REPO, 'site', '_dispatch', 'routes.json')) || '{}');
  const nav = studioNav(read(path.join(REPO, 'site', 'hathor', 'server.mjs')));
  const doc = buildSiteMap({ tools: TOOLS, nav, routes, wiki: wikiEntries() });
  if (process.argv.includes('--stdout')) process.stdout.write(doc);
  else {
    writeFileSync(OUT_PATH, doc);
    process.stdout.write(`wrote ${path.relative(REPO, OUT_PATH)} (${doc.split('\n').filter((l) => l.startsWith('- ')).length} entries)\n`);
  }
  void existsSync;
}
