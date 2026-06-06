// cheetah/alpha-report.mjs — Cheetah test runs that SHOW UP on alpha.melek.salon.
//
// Operator 2026-06-05: "Do Tests also with Cheetah that show up on the Alpha.Melek.Salon Pages."
// This is the first piece of Cheetah running against the LIVE MELEK testnet: it pulls recent
// posts over the condenser RPC, runs the same deterministic detection + discovery engines the
// bot uses (shingle + Jaccard — no LLM verdicts), and writes a static HTML report + JSON that
// the alpha.melek.salon static server serves at /cheetah/. Read-only: it never broadcasts,
// never writes to the cheetah store — it is the visible test pass, not the bot.
//
//   MELEK_RPC_URL=http://127.0.0.1:8090 node cheetah/alpha-report.mjs --out /var/www/alpha-melek-salon/cheetah
//
// Soft-fail: if the RPC is down the report SAYS so (and keeps the page) instead of throwing.

import { writeFile, mkdir } from 'node:fs/promises';
import { detectText } from './text-detection.js';
import { discover } from './discovery.js';
import { composeCreditingNote, composeDiscoveryNote } from './compose.js';
import { SIMILARITY_THRESHOLD } from './config.js';

const RPC_URL = process.env.MELEK_RPC_URL || 'http://127.0.0.1:8090';
const POST_LIMIT = parseInt(process.env.CHEETAH_ALPHA_LIMIT || '20', 10);

let _fetch = globalThis.fetch;
export function __setFetch(f) { _fetch = f || globalThis.fetch; }

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- pull recent posts from the live testnet (condenser RPC) ---------------

async function rpc(method, params) {
  const res = await _fetch(RPC_URL, {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  if (!res.ok) throw new Error(`rpc ${method} HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`rpc ${method}: ${j.error.message || JSON.stringify(j.error)}`);
  return j.result;
}

/** Recent root posts, normalized to {author, permlink, title, body, created}. Soft-fails to []. */
export async function fetchRecentPosts({ limit = POST_LIMIT } = {}) {
  try {
    const raw = await rpc('condenser_api.get_discussions_by_created', [{ tag: '', limit }]);
    return (raw || []).map((p) => ({
      author: p.author,
      permlink: p.permlink,
      title: p.title || p.permlink,
      body: p.body || '',
      created: p.created,
    })).filter((p) => p.author && p.body);
  } catch (e) {
    return Object.assign([], { error: e.message });
  }
}

async function chainHead() {
  try {
    const p = await rpc('condenser_api.get_dynamic_global_properties', []);
    return { headBlock: p.head_block_number, witness: p.current_witness, time: p.time };
  } catch { return null; }
}

// ---- run the Cheetah engines over the post set ------------------------------

/**
 * Each post is scanned against the OTHER posts as corpus — exactly the on-chain
 * cross-reference the bot performs. Returns one result row per post:
 *   { author, permlink, title, verdict: 'match'|'related'|'clear', confidence,
 *     top (best match if any), note (the comment Cheetah WOULD post, never posted) }
 */
export async function runCheetahOnPosts(posts) {
  const results = [];
  for (const post of posts) {
    const corpus = posts.filter((p) => !(p.author === post.author && p.permlink === post.permlink));
    try {
      const detection = await detectText(post.body, { corpus });
      if (detection.match && detection.source) {
        const note = composeCreditingNote(
          { match: true, source: detection.source, confidence: detection.confidence },
          `${post.author}-${post.permlink}`);
        results.push({ ...rowOf(post), verdict: 'match', confidence: detection.confidence, top: detection.source, note });
        continue;
      }
      const { related } = discover(post, { corpus });
      if (related.length) {
        const withUrls = related.map((r) => ({ ...r, url: `@${r.author}/${r.permlink}` }));
        const note = composeDiscoveryNote({ related: withUrls }, `${post.author}-${post.permlink}-disc`);
        results.push({ ...rowOf(post), verdict: 'related', confidence: related[0].score, top: related[0], note });
        continue;
      }
      results.push({ ...rowOf(post), verdict: 'clear', confidence: detection.confidence || 0, top: null, note: '' });
    } catch (e) {
      results.push({ ...rowOf(post), verdict: 'error', confidence: 0, top: null, note: e.message });
    }
  }
  return results;
}

function rowOf(p) { return { author: p.author, permlink: p.permlink, title: p.title, created: p.created }; }

// ---- the report page ---------------------------------------------------------

const VERDICT_BADGE = {
  match: ['MATCH', '#f85149'],
  related: ['SEE ALSO', '#d29922'],
  clear: ['ORIGINAL', '#3fb950'],
  error: ['ERROR', '#8b949e'],
};

export function reportHtml({ results, head, generatedAt, rpcError }) {
  const rows = results.map((r) => {
    const [label, color] = VERDICT_BADGE[r.verdict] || VERDICT_BADGE.error;
    return `<tr>
      <td><a href="/trending">@${esc(r.author)}/${esc(r.permlink)}</a><div class=mut>${esc(r.title)}</div></td>
      <td><span class=badge style="background:${color}22;color:${color}">${label}</span></td>
      <td>${(r.confidence * 100).toFixed(0)}%</td>
      <td class=note>${r.note ? `<details><summary>what Cheetah would say</summary><pre>${esc(r.note)}</pre></details>` : '<span class=mut>—</span>'}</td>
    </tr>`;
  }).join('\n');

  const summary = ['match', 'related', 'clear', 'error']
    .map((v) => `${results.filter((r) => r.verdict === v).length} ${v}`).join(' · ');

  return `<!doctype html>
<html lang=en><head>
<meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Cheetah test runs — MELEK Testnet</title>
<meta name=robots content="noindex,follow">
<style>
  :root{--bg:#0b0d10;--card:#14181d;--ink:#e8edf2;--mut:#8b97a6;--acc:#d9a441;--line:#222a33}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  header{border-bottom:1px solid var(--line);padding:14px 20px;display:flex;gap:18px;align-items:center}
  header .brand{font-weight:700;color:var(--acc)} header a{color:var(--mut);text-decoration:none;font-size:14px}
  .wrap{max-width:980px;margin:0 auto;padding:34px 20px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin:14px 0}
  h1{font-size:22px;margin:0 0 6px} .mut{color:var(--mut);font-size:13px}
  table{width:100%;border-collapse:collapse;margin-top:8px} td,th{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
  th{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.4px}
  .badge{font-size:11px;font-weight:700;border-radius:8px;padding:2px 9px;white-space:nowrap}
  a{color:var(--acc)} pre{white-space:pre-wrap;background:#11151a;border:1px solid var(--line);border-radius:6px;padding:10px;font-size:12px}
  details summary{cursor:pointer;color:var(--acc);font-size:13px} .note{max-width:380px}
</style></head><body>
<header><span class=brand>MELEK</span><a href="/trending">Trending</a><a href="/cheetah/">Cheetah</a><a href="/">Disclaimer</a></header>
<div class=wrap>
  <div class=card>
    <h1>🐆 Cheetah — live test runs on the testnet</h1>
    <p class=mut>Cheetah is the chain's <b>attribution &amp; discovery librarian</b> — it states where
      content also appears (credit-first, never accusing) and points at related prior work. This page is
      a <b>read-only test pass</b> over the ${results.length} most recent testnet posts: the same
      deterministic engines the bot runs (text-shingle + Jaccard, threshold ${SIMILARITY_THRESHOLD}),
      nothing is posted to the chain from here.</p>
    <p class=mut>${head
      ? `chain head <code>#${esc(String(head.headBlock))}</code> · witness <code>@${esc(head.witness)}</code> · ${esc(head.time)} UTC`
      : `<b>testnet RPC unreachable</b>${rpcError ? ` — ${esc(rpcError)}` : ''} (the node may be restarting; this page keeps the last good run)`}
      · report generated ${esc(generatedAt)}</p>
  </div>
  <div class=card>
    <p class=mut><b>${results.length} posts scanned</b> — ${summary}</p>
    <table>
      <tr><th>post</th><th>verdict</th><th>similarity</th><th>Cheetah's note (dry-run)</th></tr>
      ${rows || '<tr><td colspan=4 class=mut>No posts on the testnet yet — the scan re-runs automatically.</td></tr>'}
    </table>
  </div>
  <p class=mut>Verdicts: <b style="color:#3fb950">ORIGINAL</b> = no meaningful overlap with other posts ·
    <b style="color:#d29922">SEE ALSO</b> = shares ground with prior work (librarian note) ·
    <b style="color:#f85149">MATCH</b> = text also appears elsewhere (crediting note, resolution via Hathor).
    Raw data: <a href="report.json">report.json</a></p>
</div>
</body></html>`;
}

// ---- CLI ----------------------------------------------------------------------

export async function buildReport() {
  const posts = await fetchRecentPosts();
  const head = await chainHead();
  const results = await runCheetahOnPosts(posts);
  return {
    generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
    head,
    rpcError: posts.error || null,
    results,
  };
}

if (process.argv[1] && process.argv[1].endsWith('alpha-report.mjs')) {
  const outIdx = process.argv.indexOf('--out');
  const outDir = outIdx > -1 ? process.argv[outIdx + 1] : '/tmp/cheetah-alpha';
  const report = await buildReport();
  await mkdir(outDir, { recursive: true });
  await writeFile(`${outDir}/index.html`, reportHtml(report));
  await writeFile(`${outDir}/report.json`, JSON.stringify(report, null, 2));
  console.log(`[cheetah-alpha] ${report.results.length} posts scanned → ${outDir}/index.html` +
    (report.rpcError ? ` (RPC error: ${report.rpcError})` : ''));
}
