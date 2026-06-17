// brain-corpus.mjs — the manifest of EVERYTHING Hathor's brain draws on (operator 2026-06-17:
// "Hathor gets the Datasets and all the Files at the Top of the Repo for Her Brain").
//
// Until now Hathor's brain routed only the 7 scripture docs (system_prompts/corpus-index.md +
// knowledge/search.js). This widens her corpus to the WHOLE repo's knowledge, in four tiers:
//   1. PERSONA  — the top-level identity/founding docs that define who she is (BRIEF, CHARACTER, RULE_1,
//                 LINEAGE, MELEK, the orientation). Loaded into context — this is her self.
//   2. SCRIPTURE — knowledge/scripture/* (the canonical operator corpus; searchScripture routes these).
//   3. KNOWLEDGE — the rest of knowledge/ (Crypt-ology corpus, brujeria/Zar/ancient-mystery material).
//   4. DATASETS  — datasets/* (chain-libs, crypto-books, ml-courses, security-corpus, …): reference +
//                  training data — too large to hold in context, indexed for retrieval / future embedding.
//
// PURE + soft-fail + injectable root (tests pass a fixture dir). No network. Read-only (never writes the
// corpus; never holds a key). This is the INDEX; retrieval/embedding/system-prompt assembly build on it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

// The top-level docs that ARE Hathor's identity — small, load into context (operator: "all the Files at
// the Top of the Repo"). Ordered by load-bearing-ness (read-order from CLAUDE.md).
export const PERSONA_DOCS = [
  'BRIEF.md', 'CHARACTER.md', 'RULE_1.md', 'LINEAGE.md', 'MELEK.md',
  'SECURITY.md', 'OPERATOR.md', 'POLICY.md',
];

// Other top-level docs worth indexing (design/infra/policy) — referenced, not necessarily in-context.
const TOPLEVEL_INDEX_GLOBS = /\.md$/i;

const safeList = (dir, filter) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => (d.isFile() ? (filter ? filter(d.name) : true) : false) || (!filter && d.isDirectory()))
      .map((d) => ({ name: d.name, dir: d.isDirectory() }));
  } catch { return []; }
};

/** All top-level .md docs present (the full "files at the top of the repo"). */
export function topLevelDocs(root = REPO_ROOT) {
  return safeList(root).filter((e) => !e.dir && TOPLEVEL_INDEX_GLOBS.test(e.name)).map((e) => e.name).sort();
}

/** The persona docs that actually exist on disk (load into context). */
export function personaDocs(root = REPO_ROOT) {
  return PERSONA_DOCS.filter((f) => { try { return fs.statSync(path.join(root, f)).isFile(); } catch { return false; } });
}

/** Scripture filenames present in knowledge/scripture/. */
export function scriptureDocs(root = REPO_ROOT) {
  return safeList(path.join(root, 'knowledge', 'scripture'), (n) => /\.md$/i.test(n)).map((e) => e.name).sort();
}

/** Top-level entries under datasets/ (dirs = corpora, files = jsonl/md). */
export function datasetCorpora(root = REPO_ROOT) {
  return safeList(path.join(root, 'datasets')).map((e) => ({ name: e.name, kind: e.dir ? 'corpus' : 'file' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Other knowledge/ entries (excluding scripture, which is tiered separately). */
export function knowledgeCorpora(root = REPO_ROOT) {
  return safeList(path.join(root, 'knowledge'))
    .filter((e) => e.name !== 'scripture')
    .map((e) => ({ name: e.name, kind: e.dir ? 'corpus' : 'file' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The full four-tier corpus manifest for Hathor's brain. Soft-fails to empty tiers; never throws.
 * `counts` gives a quick size sense; `persona` is the in-context self; the rest are retrieval tiers.
 */
export function corpusManifest(root = REPO_ROOT) {
  const persona = personaDocs(root);
  const scripture = scriptureDocs(root);
  const knowledge = knowledgeCorpora(root);
  const datasets = datasetCorpora(root);
  const topLevel = topLevelDocs(root);
  return {
    persona,                 // tier 1 — load into context (her self)
    scripture,               // tier 2 — canonical, routed by corpus-index.md
    knowledge,               // tier 3 — corpus (incl. Crypt-ology material)
    datasets,                // tier 4 — reference/training, retrieval-indexed
    topLevel,                // every top-level .md (the "files at the top of the repo")
    counts: {
      persona: persona.length, scripture: scripture.length,
      knowledge: knowledge.length, datasets: datasets.length, topLevel: topLevel.length,
    },
  };
}

/** Read the persona docs' text (small, in-context). Returns [{name, text}], soft-failing per file. */
export function loadPersona(root = REPO_ROOT, maxBytes = 200_000) {
  return personaDocs(root).map((name) => {
    try { return { name, text: fs.readFileSync(path.join(root, name), 'utf8').slice(0, maxBytes) }; }
    catch { return { name, text: '' }; }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const m = corpusManifest();
  console.log('Hathor brain corpus:', JSON.stringify(m.counts, null, 0));
  console.log('persona:', m.persona.join(', '));
  console.log('datasets:', m.datasets.map((d) => d.name).join(', '));
}
