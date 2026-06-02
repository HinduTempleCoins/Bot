// overrides.mjs — the page-factory's manual tweak layer (spec §5). The factory renders every token
// from the schema automatically; this lets the operator hand-adjust ANY page without touching the
// factory: a custom blurb, a featured placement, a layout variant. Burn-to-feature (projects burn
// ecosystem tokens for placement, spec §6) writes overrides.featured here instead of CMC's pay-in-USD.
//
// Backed by a plain JSON file so it's operator-editable and diff-able. No DB. Read-cached per process;
// call reload() after editing.
//
//   import { overrideFor, featuredIds } from './overrides.mjs'

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.SOAPBOX_OVERRIDES || path.join(__dir, 'data', 'overrides.json');

const DEFAULTS = { blurb: null, featured: false, featured_rank: null, layout_variant: null, badge: null };

let _map = null;
function load() {
  if (_map) return _map;
  try { _map = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { _map = {}; }
  return _map;
}
export function reload() { _map = null; return load(); }

/** The override record for a coin id, with defaults filled. Never throws. */
export function overrideFor(id) {
  const m = load();
  return { ...DEFAULTS, ...(m[id] || {}) };
}

/** Featured coin ids, ordered by featured_rank (asc), for the top-of-list "Featured" row. */
export function featuredIds() {
  const m = load();
  return Object.entries(m)
    .filter(([, v]) => v && v.featured)
    .sort((a, b) => (a[1].featured_rank ?? 999) - (b[1].featured_rank ?? 999))
    .map(([id]) => id);
}

if (process.argv[1] && process.argv[1].endsWith('overrides.mjs')) {
  console.log('overrides file:', FILE);
  console.log('featured:', featuredIds());
}
