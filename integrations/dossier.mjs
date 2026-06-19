// dossier.mjs — load + render the watchdog accountability dossiers.
//
// A dossier is a JSON file under knowledge/accountability/<slug>.json holding a person node, an
// array of fromRecords()-shaped sourced records (FACTS only), labelled disputes (allegations),
// and a right-of-reply slot. This module is the bridge from those public, committed datasets to
// the accountability-graph renderer. It reads files from disk only — NEVER the network.
//
// THE DISCIPLINE (inherited from accountability-graph.mjs, enforced structurally):
//   FACTS + CONNECTIONS + SOURCES, never verdicts. Allegations live in disputes[] and are
//   labelled as such. Every record carries { source: { name, url }, asOf }. Public capacity only.
//
//   import { listDossiers, loadDossier, buildProfile, renderDossierPage } from './dossier.mjs'
//   node integrations/dossier.mjs ken-paxton

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createGraph, fromRecords, powerMap, renderProfile, esc } from './accountability-graph.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let DIR = join(HERE, '..', 'knowledge', 'accountability');

/** Point the loader at a different dossier directory (tests). */
export function __setDir(d) { DIR = d || DIR; }

const slugRe = /^[a-z0-9-]+$/;

/** List every dossier on disk: [{ slug, name, office, party, verified }]. Soft-fails to []. */
export async function listDossiers() {
  let files = [];
  try { files = await readdir(DIR); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const slug = f.replace(/\.json$/, '');
    const d = await loadDossier(slug);
    if (d && d.person) out.push({ slug, name: d.person.name || slug, office: d.person.office || '', party: d.person.party || '', verified: !!d.verified });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Load one dossier by slug. Returns the parsed object or null (bad slug / missing / unparsable). */
export async function loadDossier(slug) {
  const s = String(slug == null ? '' : slug).trim();
  if (!slugRe.test(s)) return null;           // path-traversal guard
  try {
    const raw = await readFile(join(DIR, `${s}.json`), 'utf8');
    const d = JSON.parse(raw);
    return d && typeof d === 'object' ? d : null;
  } catch { return null; }
}

/**
 * Build the sourced power-map + rendered HTML for one dossier. Returns
 * { slug, person, map, html, verified, verifyNote } or null. Never throws.
 */
export async function buildProfile(slug) {
  const d = await loadDossier(slug);
  if (!d || !d.person || !d.person.id) return null;
  const g = createGraph();
  g.addNode(d.person);
  fromRecords(Array.isArray(d.records) ? d.records : [], g);
  for (const dp of Array.isArray(d.disputes) ? d.disputes : []) g.addDispute(d.person.id, dp);
  if (d.reply) g.setReply(d.person.id, d.reply);
  const map = powerMap(d.person.id, g);
  return {
    slug: d.slug || slug, person: map.person, map,
    html: renderProfile(map),
    verified: !!d.verified, verifyNote: String(d.verifyNote || ''),
  };
}

/** A full standalone HTML fragment for a dossier (banner + verify note + profile). */
export async function renderDossierPage(slug) {
  const p = await buildProfile(slug);
  if (!p) return `<div class="card"><p>No dossier on file for that name yet.</p></div>`;
  const note = p.verified
    ? `<p class="verify ok">Sources confirmed against primary records.</p>`
    : `<p class="verify pending">Draft — pending Resource Center source confirmation. ${esc(p.verifyNote)}</p>`;
  return `<div class="card dossier">${note}${p.html}</div>`;
}

const isMain = (() => { try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; } })();
if (isMain) {
  const slug = process.argv[2] || 'ken-paxton';
  const out = slug === '--list'
    ? JSON.stringify(await listDossiers(), null, 2)
    : await renderDossierPage(slug);
  process.stdout.write(out + '\n');
}
