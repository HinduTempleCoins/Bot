/**
 * Incremental wiki updater (#85)
 *
 * Instead of regenerating every article on every run, this detects which knowledge-base source
 * documents are NEW or CHANGED since the last run and regenerates ONLY the articles those docs
 * feed. State lives in a small JSON hash manifest (content SHA-256 per KB file); a doc whose hash
 * differs from the manifest — or that is absent from it — is "changed". An article is "affected"
 * when one of its source domains contains a changed doc AND one of the article's search terms
 * appears in that doc (the same relevance test the generator itself uses).
 *
 * It REUSES the existing WikiGenerator (init + generateArticle) and does NOT modify it. The only
 * thing duplicated here is the minimal "write the .wiki file" step, kept deliberately small.
 *
 *   node src/incrementalUpdate.js              # regenerate affected articles, update manifest
 *   node src/incrementalUpdate.js --dry-run    # report what WOULD regenerate, write nothing, no LLM
 *   node src/incrementalUpdate.js --all        # force-regenerate everything, refresh manifest
 *   node src/incrementalUpdate.js --limit=3    # cap how many affected articles are regenerated
 *
 * Env:
 *   WIKI_MANIFEST_PATH   override manifest location (default data/kb-manifest.json)
 *   LLM_MAX_CALLS_PER_RUN  cost guard inherited from geminiClient (#88)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import WikiGenerator from './wikiGenerator.js';
import { ALL_ARTICLES } from './wikiGenerator.js';
import { LLMBudgetExceededError } from './utils/geminiClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Build a { docId: sha256(content) } map from a loaded KnowledgeLoader. */
export function buildManifest(knowledgeLoader) {
  const files = {};
  for (const [docId, doc] of knowledgeLoader.documents) {
    files[docId] = sha256(doc.content || '');
  }
  return { version: 1, generatedAt: new Date().toISOString(), files };
}

/** Load a previously-persisted manifest, or an empty one if none exists / is unreadable. */
export function loadManifest(manifestPath) {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (m && typeof m.files === 'object') return m;
  } catch { /* first run, or corrupt — treat as empty */ }
  return { version: 1, generatedAt: null, files: {} };
}

/** docIds whose content hash changed or that are new vs the previous manifest. */
export function changedDocs(prev, current) {
  const out = [];
  for (const [docId, hash] of Object.entries(current.files)) {
    if (prev.files[docId] !== hash) out.push(docId);
  }
  return out;
}

/**
 * Map changed docIds → the article definitions they feed. An article is affected when a changed
 * doc lives in one of its (primary or cross-reference) domains AND one of the article's search
 * terms appears in that doc's text — the same relevance gate WikiGenerator.generateArticle uses,
 * so we never regenerate an article a changed doc would not actually have contributed to.
 */
export function affectedArticles(changedDocIds, knowledgeLoader, articles = ALL_ARTICLES) {
  const changedSet = new Set(changedDocIds);
  const affected = [];
  for (const def of articles) {
    const domains = [...(def.primaryDomains || []), ...(def.crossReferenceDomains || [])];
    let hit = false;
    for (const domain of domains) {
      const docIds = knowledgeLoader.domainDocuments.get(domain) || [];
      for (const docId of docIds) {
        if (!changedSet.has(docId)) continue;
        const doc = knowledgeLoader.documents.get(docId);
        if (!doc) continue;
        const text = (doc.content || '').toLowerCase();
        const relevant = (def.searchTerms || []).some((t) => text.includes(String(t).toLowerCase()));
        if (relevant) { hit = true; break; }
      }
      if (hit) break;
    }
    if (hit) affected.push(def);
  }
  return affected;
}

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const all = argv.includes('--all');
  const limArg = argv.find((a) => a.startsWith('--limit='));
  const limit = limArg ? Math.max(0, parseInt(limArg.split('=')[1], 10) || 0) : 0;
  return { dryRun, all, limit };
}

export async function run({ dryRun = false, all = false, limit = 0 } = {}) {
  const manifestPath = process.env.WIKI_MANIFEST_PATH ||
    path.join(__dirname, '..', 'data', 'kb-manifest.json');

  const gen = new WikiGenerator();
  await gen.init(); // loads the knowledge base (and logs into the wiki only if creds present)

  const current = buildManifest(gen.knowledgeLoader);
  const prev = loadManifest(manifestPath);
  const changed = all ? Object.keys(current.files) : changedDocs(prev, current);

  console.log(`[incremental] KB docs: ${Object.keys(current.files).length}, changed since last run: ${changed.length}${all ? ' (forced --all)' : ''}`);

  let todo = all ? [...ALL_ARTICLES] : affectedArticles(changed, gen.knowledgeLoader);
  if (limit > 0) todo = todo.slice(0, limit);

  if (!todo.length) {
    console.log('[incremental] No affected articles — nothing to regenerate.');
    if (!dryRun) persistManifest(manifestPath, current); // still record the (unchanged) state
    return { changed, regenerated: [], dryRun };
  }

  console.log(`[incremental] Articles to regenerate (${todo.length}):`);
  for (const d of todo) console.log(`  - ${d.title}`);

  if (dryRun) {
    console.log('[incremental] --dry-run: no LLM calls, manifest not updated.');
    return { changed, regenerated: todo.map((d) => d.title), dryRun: true };
  }

  const regenerated = [];
  let budgetHit = false;
  for (const def of todo) {
    try {
      const article = await gen.generateArticle(def);
      if (!article || !article.content || !article.content.trim()) {
        console.error(`[incremental] empty content for "${def.title}" — skipped (file left intact)`);
        continue;
      }
      const filepath = articlePath(gen, def.title);
      fs.writeFileSync(filepath, article.content);
      console.log(`[incremental] wrote ${filepath}`);
      regenerated.push(def.title);
    } catch (e) {
      if (e instanceof LLMBudgetExceededError) {
        console.error(`[incremental] ${e.message} — stopping cleanly. Manifest NOT advanced so remaining docs are retried next run.`);
        budgetHit = true;
        break;
      }
      console.error(`[incremental] ERROR regenerating "${def.title}": ${e.message}`);
    }
  }

  // Only advance the manifest when the run completed without tripping the cost guard — otherwise
  // the still-unprocessed changed docs would be marked "seen" and never get regenerated.
  if (!budgetHit) persistManifest(manifestPath, current);
  else console.log('[incremental] manifest left unchanged due to budget stop.');

  console.log(`[incremental] done: regenerated ${regenerated.length}/${todo.length} article(s).`);
  return { changed, regenerated, dryRun: false, budgetHit };
}

// The output path WikiGenerator uses: slug = title with non-alphanumerics → '_', under outputDir.
function articlePath(gen, title) {
  const slug = title.replace(/[^a-zA-Z0-9]/g, '_');
  return path.join(gen.outputDir, slug + '.wiki');
}

function persistManifest(manifestPath, manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[incremental] manifest updated: ${manifestPath} (${Object.keys(manifest.files).length} docs)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(parseArgs(process.argv.slice(2)))
    .then((r) => { if (r && r.budgetHit) process.exitCode = 3; })
    .catch((e) => { console.error('[incremental] fatal:', e); process.exitCode = 1; });
}
