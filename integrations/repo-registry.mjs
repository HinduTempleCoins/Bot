// integrations/repo-registry.mjs — the MELEK-ecosystem repo catalog behind the admin Features
// "repo toggle".
//
// The Features page (site/admin/server.mjs) defaults to the Bot repo's module catalog
// (feature-registry.mjs). This module lets the operator switch the toggle to ANY ecosystem repo —
// Bot, PRANA, melek-chain, melek-condenser, MELEK, KULASwap — and see that repo's identity at a
// glance: name, description, language, file count, a derived build status, a GitHub link, and the
// repo's top-level file tree.
//
// It reads a pre-generated manifest (site/admin/data/repo-manifest.json) produced out-of-band. It
// NEVER hits the network and NEVER throws: a missing/unreadable/garbage manifest soft-fails to a
// small built-in default so the toggle always has something to render. No secrets — only public repo
// metadata (slug, url, description, file tree) ever passes through here.
//
//   import { listRepos, getRepo } from './repo-registry.mjs'
//   const repos = listRepos();              // [{ slug, name, url, description, language, fileCount, topLevel, status }]
//   const chain = getRepo('melek-chain');   // one repo, or null
//   listRepos({ manifestPath })             // injectable path for tests
//   node integrations/repo-registry.mjs     # print the catalog + derived status

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST_PATH = join(HERE, '..', 'site', 'admin', 'repo-manifest.json');

// Built-in fallback — used only when the manifest is missing/unreadable/garbage. Kept minimal but
// honest: the six ecosystem repos with enough to render a panel. Status is derived the same way.
const DEFAULT_REPOS = [
  { slug: 'Bot', name: 'Bot', url: 'https://github.com/HinduTempleCoins/Bot', description: 'MELEK AI Witness operator software', language: 'JavaScript', fileCount: 7265, topLevel: [] },
  { slug: 'PRANA', name: 'PRANA', url: 'https://github.com/HinduTempleCoins/PRANA', description: 'MELEK Ecosystem ETH Chain Clone', language: '—', fileCount: 1, topLevel: ['README.md'] },
  { slug: 'melek-chain', name: 'melek-chain', url: 'https://github.com/HinduTempleCoins/melek-chain', description: 'MELEK blockchain node — forked from BLURT (Graphene family)', language: 'C++', fileCount: 2875, topLevel: [] },
  { slug: 'melek-condenser', name: 'melek-condenser', url: 'https://github.com/HinduTempleCoins/melek-condenser', description: "Blurt blockchain's Condenser", language: 'JavaScript', fileCount: 54640, topLevel: [] },
  { slug: 'MELEK', name: 'MELEK', url: 'https://github.com/HinduTempleCoins/MELEK', description: 'Social Media Blockchain', language: '—', fileCount: 5, topLevel: [] },
  { slug: 'KULASwap', name: 'KULASwap', url: 'https://github.com/HinduTempleCoins/KULASwap', description: 'A SunSwap Fork', language: 'Solidity', fileCount: 34, topLevel: [] },
];

// ── status derivation ────────────────────────────────────────────────────────
// A repo's build status from its file count alone (the manifest doesn't carry an explicit one):
//   > 500   → 'live-codebase'   (a real, fleshed-out tree)
//   <= 5    → 'scaffold/empty'  (PRANA = README only; MELEK = a few notes)
//   else    → 'in-progress'
export function statusFor(fileCount) {
  const n = Number(fileCount) || 0;
  if (n > 500) return 'live-codebase';
  if (n <= 5) return 'scaffold/empty';
  return 'in-progress';
}

// normalise one raw manifest entry into the public shape (defensive: tolerate missing fields).
function normalizeRepo(r) {
  if (!r || typeof r !== 'object') return null;
  const slug = String(r.slug || r.name || '').trim();
  if (!slug) return null;
  const fileCount = Number(r.fileCount) || 0;
  const topLevel = Array.isArray(r.topLevel) ? r.topLevel.map((s) => String(s)) : [];
  return {
    slug,
    name: String(r.name || slug),
    url: String(r.url || ''),
    description: String(r.description || ''),
    language: String(r.language || '—'),
    fileCount,
    topLevel,
    status: statusFor(fileCount),
  };
}

// Load + parse the manifest. Soft-fail to DEFAULT_REPOS on any error; never throws.
function loadManifest(manifestPath) {
  const path = manifestPath || DEFAULT_MANIFEST_PATH;
  try {
    const txt = readFileSync(path, 'utf8');
    const data = JSON.parse(txt);
    const repos = Array.isArray(data) ? data : (data && Array.isArray(data.repos) ? data.repos : null);
    if (!repos) return DEFAULT_REPOS;
    const out = repos.map(normalizeRepo).filter(Boolean);
    return out.length ? out : DEFAULT_REPOS;
  } catch {
    return DEFAULT_REPOS;
  }
}

// ── public API ───────────────────────────────────────────────────────────────
export function listRepos({ manifestPath } = {}) {
  // normalize uniformly so manifest entries and the built-in defaults share one public shape.
  return loadManifest(manifestPath).map(normalizeRepo).filter(Boolean);
}

export function getRepo(slug, { manifestPath } = {}) {
  const want = String(slug || '').trim().toLowerCase();
  if (!want) return null;
  return listRepos({ manifestPath }).find((r) => r.slug.toLowerCase() === want) || null;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('repo-registry.mjs')) {
  const repos = listRepos();
  console.log(`Ecosystem repos: ${repos.length}`);
  for (const r of repos) {
    console.log(`  [${r.status}] ${r.name} · ${r.language} · ${r.fileCount} files · ${r.url}`);
  }
}
