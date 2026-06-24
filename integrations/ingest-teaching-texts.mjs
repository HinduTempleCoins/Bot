// ingest-teaching-texts.mjs — scrape the PRIMARY TEXTS of Hathor's teaching sources into her corpus.
//
// Operator (2026-06-24): use the Resource Center to scrape — but "just get the Texts and information," NOT
// "other people's opinions and things." So this targets PRIMARY-SOURCE sites only (sacred-texts, wikisource,
// gutenberg, archive.org, lucistrust) — the actual texts of the Sebayt of Ptahhotep, the Emerald Tablet(s),
// Alice Bailey's Labours of Hercules, and the threshold-riddles (the Sphinx + the Yaksha Prashna) — and
// writes each as clean markdown into knowledge/teaching/, where the library index makes it retrievable so
// Hathor (the one brain) can actually TEACH from them. No commentary domains; the source URL is recorded.
//
// Uses integrations/web-search.mjs (search → pick a primary-source result → fetchUrl → Firecrawl markdown).
// Soft-fails per source; needs FIRECRAWL/TAVILY keys (on the box). House style: ESM, injectable, CLI-guarded.

import { promises as fsp } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Primary-source hosts ONLY — texts, not opinions/forums/blogs. A scraped result outside this set is skipped.
const PRIMARY_HOSTS = ['sacred-texts.com', 'en.wikisource.org', 'wikisource.org', 'gutenberg.org', 'archive.org', 'lucistrust.org', 'sacred-texts.org'];

// The teaching sources + how to find each primary text. `prefer` biases the search result selection.
export const SOURCES = [
  { slug: 'ptahhotep-sebayt', title: 'The Instruction (Sebayt) of Ptahhotep', query: 'Instruction of Ptahhotep full text translation', prefer: ['sacred-texts.com', 'wikisource.org'] },
  { slug: 'emerald-tablet-hermes', title: 'The Emerald Tablet of Hermes Trismegistus', query: 'Emerald Tablet of Hermes Trismegistus text translation', prefer: ['sacred-texts.com', 'wikisource.org'] },
  { slug: 'emerald-tablets-thoth', title: 'The Emerald Tablets of Thoth the Atlantean', query: 'Emerald Tablets of Thoth the Atlantean Doreal full text', prefer: ['archive.org', 'sacred-texts.com'] },
  { slug: 'labours-of-hercules', title: 'The Labours of Hercules (Alice Bailey)', query: 'Alice Bailey The Labours of Hercules full text', prefer: ['lucistrust.org', 'archive.org'] },
  { slug: 'yaksha-prashna', title: 'The Yaksha Prashna (Mahabharata, Vana Parva)', query: 'Yaksha Prashna Mahabharata Vana Parva text Ganguli', prefer: ['sacred-texts.com', 'wikisource.org'] },
];

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const isPrimary = (u) => PRIMARY_HOSTS.includes(hostOf(u));

/**
 * Ingest one source: search → choose a PRIMARY-SOURCE result (prefer the named hosts) → Firecrawl it → save.
 * @param {object} src one of SOURCES
 * @param {object} deps { search, fetchUrl, outDir }  (search/fetchUrl from web-search.mjs; injectable for tests)
 */
export async function ingestOne(src, { search, fetchUrl, outDir }) {
  let res; try { res = await search(src.query, { limit: 8 }); } catch { res = null; }
  const hits = (res && (res.results || res.hits || res)) || [];
  const urls = (Array.isArray(hits) ? hits : []).map((h) => h.url || h.link || h).filter((u) => typeof u === 'string' && isPrimary(u));
  // prefer the source's named hosts, else any primary host
  urls.sort((a, b) => (src.prefer.includes(hostOf(b)) ? 1 : 0) - (src.prefer.includes(hostOf(a)) ? 1 : 0));
  const url = urls[0];
  if (!url) return { slug: src.slug, ok: false, reason: 'no-primary-source-found' };

  let page; try { page = await fetchUrl(url); } catch { page = null; }
  if (!page || !page.ok || !page.markdown || page.markdown.length < 400) return { slug: src.slug, ok: false, reason: 'scrape-empty', url };

  const header = `# ${src.title}\n\n> Primary text ingested for Hathor's teaching corpus. Source: ${url}\n> Text only — no commentary.\n\n`;
  const body = String(page.markdown).slice(0, 200_000);
  const file = join(outDir, `${src.slug}.md`);
  await fsp.mkdir(dirname(file), { recursive: true });
  await fsp.writeFile(file, header + body, 'utf8');
  return { slug: src.slug, ok: true, url, host: hostOf(url), chars: body.length, file };
}

/** Ingest all teaching sources. Returns a per-source summary. */
export async function ingestAll({ search, fetchUrl, outDir, sources = SOURCES } = {}) {
  const out = [];
  for (const s of sources) { out.push(await ingestOne(s, { search, fetchUrl, outDir })); }
  return out;
}

// ── CLI (run on the box, where the scrape keys live) ──────────────────────────────────────────────
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const { search, fetchUrl, providersConfigured } = await import('./web-search.mjs');
  const outDir = process.env.TEACHING_DIR || join(dirname(fileURLToPath(import.meta.url)), '../knowledge/teaching');
  console.log('providers:', JSON.stringify(providersConfigured()));
  const summary = await ingestAll({ search, fetchUrl, outDir });
  for (const r of summary) console.log(r.ok ? `  ✓ ${r.slug} ← ${r.host} (${r.chars} chars)` : `  ✗ ${r.slug}: ${r.reason}`);
  const ok = summary.filter((r) => r.ok).length;
  console.log(`\n${ok}/${summary.length} primary texts ingested → ${outDir}`);
  process.exit(ok > 0 ? 0 : 2);
}
