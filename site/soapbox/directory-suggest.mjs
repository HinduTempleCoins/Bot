// directory-suggest.mjs — the scraper bot proposes new Directory candidates (operator 2026-06-02).
// For each category it searches the web, drops anything already listed (dedup by domain), and writes
// a SUGGESTIONS file for human review. It NEVER edits the live directory — curation stays a person's
// call (anti-scam). Promote a good suggestion by hand-adding it to directory.mjs.
//
//   node site/soapbox/directory-suggest.mjs            # all categories → data/directory-suggestions.json
//   node site/soapbox/directory-suggest.mjs "Wallets"  # one category

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIRECTORY } from './directory.mjs';
import { search } from '../../integrations/scraper.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.DIR_SUGGEST_OUT || path.join(__dir, 'data', 'directory-suggestions.json');

// per-category search queries (what to look for).
const QUERIES = {
  'Data & Index Sites': 'best crypto market data aggregator sites',
  'Forums & Communities': 'active cryptocurrency forums communities',
  'Wallets': 'best non-custodial crypto wallets',
  'Browser Extensions': 'best crypto security browser extensions wallet',
  'Block Explorers': 'blockchain explorers multi-chain',
  'Portfolio & Tools': 'best crypto portfolio tracker on-chain tools',
  'Security & Anti-Scam': 'crypto scam checker revoke approvals security tools',
  'Testnet Faucets': 'ethereum sepolia testnet faucet developer',
  'Learn': 'best crypto education learn resources',
};

const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
// news/blog/listicle domains to skip — we want the actual resources, not "10 Best X" articles about them.
const LISTICLE = /(cryptonews|cryptopotato|geekflare|analyticsinsight|tradersunion|medium\.com|forbes|investopedia|coindesk|cointelegraph|benzinga|techradar|nerdwallet|businessinsider|reddit\.com|youtube|quora|\.blog$|news|blog|review|guide|top-?\d|best-)/i;

export async function suggest(onlyCat) {
  const out = {};
  for (const group of DIRECTORY) {
    if (onlyCat && group.cat !== onlyCat) continue;
    const q = QUERIES[group.cat]; if (!q) continue;
    const have = new Set(group.items.map((i) => domain(i.url)));
    const hits = await search(q, { limit: 12 }).catch(() => []);
    const seen = new Set();
    const cands = [];
    for (const h of hits) {
      const d = domain(h.url);
      // skip ones already listed, dupes, and obvious "listicle" aggregators (we want the resources, not blog posts about them)
      if (!d || have.has(d) || seen.has(d) || LISTICLE.test(d) || LISTICLE.test(h.url)) continue;
      seen.add(d);
      cands.push({ name: h.title.slice(0, 60), url: `https://${d}`, source_title: h.title, snippet: (h.snippet || '').slice(0, 120) });
      if (cands.length >= 6) break;
    }
    out[group.cat] = cands;
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('directory-suggest.mjs')) {
  const onlyCat = process.argv[2];
  const s = await suggest(onlyCat);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(s, null, 2));
  let n = 0;
  for (const [cat, cands] of Object.entries(s)) {
    if (!cands.length) continue;
    console.log(`\n## ${cat}`);
    for (const c of cands) { console.log(`  • ${c.name} — ${c.url}`); n++; }
  }
  console.log(`\n${n} new candidate(s) → ${OUT}. Review + hand-add good ones to directory.mjs (never auto-published).`);
}
