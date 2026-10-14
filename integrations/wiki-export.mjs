// wiki-export.mjs — "Download the whole Library": turn the wiki's .wiki articles into shareable,
// trainable artifacts so we can SEND the wiki to anyone — people, other sites, and above all people
// building their own AI (the wiki's stated purpose: "use these libraries to make other AI"). It does NOT
// edit the wiki (that stays Gemini's) — it reads the same article dirs the server serves and emits:
//   • library.jsonl       — one record per article {title, slug, url, categories, text, chars} — the
//                            format people fine-tune/RAG on, and what feeds Hathor's own brain.
//   • library-corpus.txt  — all article plaintext concatenated (quick embedding / training).
//   • manifest.json       — counts, generated date, license/attribution line.
//
// Pure + injectable (pass dirs; tests use a fixture) + soft-fail. No network, no keys.
//
//   import { buildRecords, writeExport, wikiToPlain } from './wiki-export.mjs';
//   node integrations/wiki-export.mjs --out site/wiki/download   # write the artifacts

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DEFAULT_DIRS = [
  path.join(ROOT, 'library-of-ashurbanipal-bot', 'generated-articles'),
  path.join(ROOT, 'site', 'wiki', 'articles'),
  path.join(ROOT, 'site', 'wiki', 'seed-articles'),
  path.join(ROOT, 'library-of-ashurbanipal-bot', 'seed-drafts'),
];
const PRIVATE = /(scripture|operator|private|\.local)/i;
const titleize = (slug) => String(slug).replace(/\.wiki$/, '').replace(/_/g, ' ');
const slugify = (f) => String(f).replace(/\.wiki$/, '').replace(/[\s]+/g, '_');

/** Strip MediaWiki markup to readable plaintext. Conservative; never throws. */
export function wikiToPlain(markup) {
  let t = String(markup || '');
  t = t.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/<ref[^>]*\/>/gi, '');   // citations
  t = t.replace(/<!--[\s\S]*?-->/g, '');                                            // comments
  t = t.replace(/\{\{[\s\S]*?\}\}/g, '');                                           // templates
  t = t.replace(/\{\|[\s\S]*?\|\}/g, (tbl) =>                                       // tables -> cell text
    tbl.replace(/\{\||\|\}/g, '').replace(/^[!|].*?[!|]-?\s*/gm, '')
       .replace(/\s*\|\|\s*/g, ' — ').replace(/\s*!!\s*/g, ' — ').replace(/^[|!]\s*/gm, ''));
  t = t.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1');                            // [[a|b]] -> b
  t = t.replace(/\[(?:https?:\/\/\S+)\s+([^\]]+)\]/g, '$1').replace(/\[https?:\/\/\S+\]/g, ''); // [url text]
  t = t.replace(/'''''([^']+)'''''/g, '$1').replace(/'''([^']+)'''/g, '$1').replace(/''([^']+)''/g, '$1'); // bold/italic
  t = t.replace(/^={2,6}\s*(.+?)\s*={2,6}\s*$/gm, '\n$1\n');                         // headings
  t = t.replace(/^[*#:;]+\s*/gm, '');                                               // list/indent markers
  t = t.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '');                             // leftover files
  t = t.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n');
  return t.trim();
}

/** Collect public articles across the dirs, first-match-wins per slug (as the server does). */
export function collectArticles(dirs = DEFAULT_DIRS) {
  const seen = new Set(); const out = [];
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.wiki') && !PRIVATE.test(f)).sort(); } catch { continue; }
    for (const f of files) {
      const slug = slugify(f);
      if (seen.has(slug)) continue; seen.add(slug);
      let markup = '';
      try { markup = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
      out.push({ slug, title: titleize(f), file: path.join(dir, f), markup });
    }
  }
  return out;
}

/** Build the dataset records. categoriesFor is injectable (tests pass a stub); default loads categories.mjs. */
export async function buildRecords({ dirs = DEFAULT_DIRS, baseUrl = 'https://wiki.soapbox.community', categoriesFor = null } = {}) {
  let catFn = categoriesFor;
  if (!catFn) { try { ({ categoriesFor: catFn } = await import('../site/wiki/categories.mjs')); } catch { catFn = () => []; } }
  return collectArticles(dirs).map((a) => {
    const text = wikiToPlain(a.markup);
    let categories = [];
    try { categories = (catFn(a.title) || []).filter((c) => c && c !== 'other'); } catch { categories = []; }
    return { title: a.title, slug: a.slug, url: `${baseUrl.replace(/\/$/, '')}/${a.slug}`, categories, text, chars: text.length };
  });
}

/** Write library.jsonl + library-corpus.txt + manifest.json into outDir. Returns the manifest. */
export async function writeExport(outDir, opts = {}) {
  const records = await buildRecords(opts);
  fs.mkdirSync(outDir, { recursive: true });
  const jsonl = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'library.jsonl'), jsonl);
  const corpus = records.map((r) => `# ${r.title}\n\n${r.text}`).join('\n\n\n');
  fs.writeFileSync(path.join(outDir, 'library-corpus.txt'), corpus);
  const manifest = {
    name: 'The Library of Ashurbanipal — Van Kush Family Research Institute',
    generated: new Date().toISOString(),
    articles: records.length,
    totalChars: records.reduce((n, r) => n + r.chars, 0),
    files: ['library.jsonl', 'library-corpus.txt'],
    license: 'Open for reading, research, and training other AI. Attribution: Van Kush Family Research Institute / The Library of Ashurbanipal.',
    note: 'Education and reference. Exported from the live wiki; article content authored in the wiki, not edited here.',
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outArg = process.argv.indexOf('--out');
  const outDir = outArg >= 0 ? process.argv[outArg + 1] : path.join(ROOT, 'site', 'wiki', 'download');
  writeExport(outDir).then((m) => console.log('wrote export:', JSON.stringify(m.articles + ' articles, ' + m.totalChars + ' chars -> ' + outDir)));
}
