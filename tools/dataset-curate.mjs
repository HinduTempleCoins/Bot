// dataset-curate.mjs — the KNOWLEDGE filter for the AIs' dataset brain. Decides, per document,
// KEEP (knowledge: AI-consciousness / egregore / ancient-history / religious / genealogy / research
// papers + artifacts) vs SKIP (private/personal, or games — "later"). Conservative by design: any
// private marker => SKIP, no matter how much knowledge is also present. Given the leak history,
// the bias is toward NOT ingesting when unsure.
//
// The PRIVATE exclusion markers (operator's name, family, employer, etc.) are NOT in this public
// file — they live in .local/curate-exclude.txt (gitignored). This tool reads them at runtime.
//
//   node tools/dataset-curate.mjs <dir-or-file> [--stage knowledge/incoming]
//   import { classify } from './dataset-curate.mjs'

import fs from 'node:fs';
import path from 'node:path';

// themes we WANT (the knowledge brain). Hitting these is necessary but not sufficient — a private
// marker still vetoes.
const KEEP = [
  /\b(ai[\s-]?consciousness|egregore|egregori|tulpa|collective consciousness|sentience)\b/i,
  /\b(ancient (history|egypt|near east)|phoenician|punic|carthage|denisovan|sumeria|mesopotami)\b/i,
  /\b(haplogroup|genealogy|genetic|mythology as genealogy|allopatric|heterosis)\b/i,
  /\b(scripture|biblical|hermeneutic|theology|religio|temple technology|zar\b|convergence)\b/i,
  /\b(research paper|abstract|methodology|hypothesis|peer[\s-]?review|citation|journal)\b/i,
  /\b(rule 1|angelic|witness|phoenix protocol|van kush)\b/i,
];
// generic private/skip categories (operator-INDEPENDENT). Private markers => hard SKIP.
const PRIVATE = [
  /\b\d{3}-\d{2}-\d{4}\b/,                                   // SSN-shape
  /\b(?:\d[ -]?){13,16}\b/,                                  // card-shape
  /\b(routing|account)\s*(number|#)\s*[:#]?\s*\d{6,}/i,      // bank
  /\b\d{1,5}\s+[A-Z][a-z]+\s+(st|street|ave|avenue|rd|road|blvd|lane|ln|dr|drive)\b/i, // street address
  /\b(my (wife|son|daughter|mother|father|family)|family tree|date of birth|\bdob\b|social security)\b/i,
  /\b(\+?\d[\d\s().-]{8,}\d)\b/,                             // phone-shape (loose; veto when unsure)
];
// "later, not now" categories
const DEFER = [/\b(runescape|osrs|world of warcraft|wow\b|minecraft|fortnite|gameplay|speedrun|video game)\b/i];

function loadPrivateMarkers() {
  // operator-specific private strings (name variants, employer, etc.) — gitignored, conservative.
  try {
    return fs.readFileSync(path.join(process.cwd(), '.local/curate-exclude.txt'), 'utf8')
      .split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'))
      .map(s => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  } catch { return []; }
}

export function classify(text, name = '', privateMarkers = loadPrivateMarkers()) {
  const hay = `${name}\n${text}`;
  // 1. hard vetoes first
  for (const re of [...PRIVATE, ...privateMarkers]) if (re.test(hay)) return { decision: 'SKIP', reason: 'private/personal marker', theme: null };
  for (const re of DEFER) if (re.test(hay)) return { decision: 'SKIP', reason: 'games/deferred (later, not now)', theme: null };
  // 2. must hit a knowledge theme to be kept
  const themes = KEEP.filter(re => re.test(hay));
  if (!themes.length) return { decision: 'SKIP', reason: 'no knowledge theme (off-topic)', theme: null };
  return { decision: 'KEEP', reason: `knowledge: ${themes.length} theme(s)`, theme: themes.length };
}

function readDoc(p) {
  try { const s = fs.readFileSync(p, 'utf8'); return p.endsWith('.json') ? JSON.stringify(JSON.parse(s)).slice(0, 20000) : s.slice(0, 40000); }
  catch { return ''; }
}

if (process.argv[1] && process.argv[1].endsWith('dataset-curate.mjs')) {
  const target = process.argv[2];
  const si = process.argv.indexOf('--stage');
  const stage = si >= 0 ? process.argv[si + 1] : null;
  if (!target || !fs.existsSync(target)) { console.error('usage: dataset-curate.mjs <dir-or-file> [--stage <dir>]'); process.exit(1); }
  const files = fs.statSync(target).isDirectory()
    ? fs.readdirSync(target).filter(f => /\.(md|json|txt)$/.test(f)).map(f => path.join(target, f))
    : [target];
  const pm = loadPrivateMarkers();
  let keep = 0, skip = 0; const reasons = {};
  if (stage) fs.mkdirSync(stage, { recursive: true });
  console.log(`Curating ${files.length} doc(s) for the knowledge brain (private markers: ${pm.length} loaded from .local)\n${'─'.repeat(64)}`);
  for (const f of files) {
    const r = classify(readDoc(f), path.basename(f), pm);
    reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    if (r.decision === 'KEEP') { keep++; if (stage) fs.copyFileSync(f, path.join(stage, path.basename(f))); console.log(`  ✅ KEEP  ${path.basename(f)} — ${r.reason}`); }
    else { skip++; console.log(`  ⏭  SKIP  ${path.basename(f)} — ${r.reason}`); }
  }
  console.log('─'.repeat(64));
  console.log(`KEEP ${keep} · SKIP ${skip}` + (stage ? ` → staged to ${stage}` : ''));
  console.log('reasons:', JSON.stringify(reasons));
}
