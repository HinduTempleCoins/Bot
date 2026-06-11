// moderation-report.mjs — operator digest from the flag-pipe moderation spine.
//
// WHY THIS EXISTS
//   integrations/flag-pipe.mjs is the ONE append-only store every harm (plagiarism, spam, scam,
//   harassment, impersonation, misinformation, doxxing, csam, sybil) lands in. Its summary() gives
//   raw counts and reviewQueue() gives ranked pending flags — but the operator wants ONE readable
//   digest, not two JSON blobs. moderation-report renders that: a plain-markdown operator report of
//   counts by kind/status, the top-severity pending flags, and a SEPARATE call-out of the gated-CSAM
//   pending count (those never auto-handle — counsel/NCMEC own them off-pipe, cheetah/policing.md).
//
//   This module does NO detection and NO storage. It READS flag-pipe's summary()+reviewQueue() output
//   and formats it. The CLI injects flag-pipe (read-only); it never files or resolves a flag, never
//   touches keys/chain/network. Soft-fail-never-throw: bad input renders a degraded-but-valid report.
//
//   import { report } from './moderation-report.mjs';
//   report({ summary: summaryObj, queue: queueArray });   // -> markdown string
//
//   node tools/moderation-report.mjs            // reads the live flag-pipe jsonl store, prints digest

// ── esc(): neutralize anything that could break markdown/HTML when rendered. We strip the markdown
//    control chars that would let a crafted reason/target hijack the layout, plus HTML-escape. ──
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    .replace(/[\r\n]+/g, ' ')      // collapse newlines so one flag can't span/break rows (kills heading injection)
    .replace(/[|`*_~]/g, '');      // drop markdown control chars (NOT '#': newline-collapse already
                                   // defuses headings, and '#' lives inside escaped entities like &#39;)
}

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

// Render an object-of-counts ({plagiarism:2, spam:5}) as sorted "- kind: n" lines, biggest first.
function countLines(obj) {
  const entries = Object.entries(obj && typeof obj === 'object' ? obj : {})
    .map(([k, v]) => [k, num(v)])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  if (!entries.length) return ['- (none)'];
  return entries.map(([k, v]) => `- ${esc(k)}: ${v}`);
}

/**
 * Render an operator moderation digest from flag-pipe's summary() + reviewQueue() output.
 *   summary : { byKind, byStatus, total, gatedPending }   (flag-pipe summary() shape)
 *   queue   : Array<flag>  — pending flags ranked most-severe-first (reviewQueue() output)
 *   topN    : how many top-severity pending flags to list (default 10).
 * Soft-fail: any missing/garbage field degrades gracefully; always returns a markdown string.
 * @returns {string}
 */
export function report({ summary = {}, queue = [], topN = 10 } = {}) {
  try {
    const s = summary && typeof summary === 'object' ? summary : {};
    const q = Array.isArray(queue) ? queue.filter((f) => f && typeof f === 'object') : [];
    const total = num(s.total);
    const n = Number.isFinite(Number(topN)) && Number(topN) > 0 ? Math.floor(Number(topN)) : 10;

    // gatedPending: prefer the summary's own count; fall back to counting gated pending in the queue.
    const gatedPending = Number.isFinite(Number(s.gatedPending))
      ? num(s.gatedPending)
      : q.filter((f) => f.gated && f.status === 'pending').length;

    const pending = num((s.byStatus || {}).pending);

    const lines = [];
    lines.push('# Moderation report');
    lines.push('');
    lines.push(`Total flags: ${total} · pending: ${pending}`);
    lines.push('');

    // ── GATED CSAM — called out FIRST and SEPARATELY. Never auto-handled; counsel/NCMEC own it. ──
    lines.push('## Gated (CSAM) — human/counsel only');
    if (gatedPending > 0) {
      lines.push(`- ${gatedPending} pending gated flag(s). Flag-only markers; NO imagery stored. Escalate off-pipe (PhotoDNA/NCMEC CyberTipline, cheetah/policing.md). Do NOT auto-action.`);
    } else {
      lines.push('- 0 pending gated flags.');
    }
    lines.push('');

    lines.push('## By kind');
    lines.push(...countLines(s.byKind));
    lines.push('');

    lines.push('## By status');
    lines.push(...countLines(s.byStatus));
    lines.push('');

    // ── Top-severity pending flags. The queue arrives pre-ranked (most-severe, then oldest); we
    //    re-sort defensively so a mis-ordered injected array still renders correctly. ──
    const top = q
      .slice()
      .sort((a, b) => (num(b.severity) - num(a.severity)) ||
        String(a.filedAt || '').localeCompare(String(b.filedAt || '')))
      .slice(0, n);
    lines.push(`## Top pending flags (most severe first, max ${n})`);
    if (!top.length) {
      lines.push('- (none pending)');
    } else {
      for (const f of top) {
        const sev = num(f.severity);
        const kind = esc(f.kind || '?');
        const target = esc(f.target || '?');
        const reason = f.reason ? ` — ${esc(f.reason)}` : '';
        const gtag = f.gated ? ' [GATED]' : '';
        lines.push(`- [sev ${sev}] ${kind}${gtag}: ${target}${reason}`);
      }
    }
    lines.push('');

    return lines.join('\n');
  } catch {
    // soft-fail-never-throw: a structurally-valid minimal report rather than a crash.
    return '# Moderation report\n\n(report unavailable)\n';
  }
}

// ── CLI: read the live flag-pipe store (read-only) and print the digest. Injects flag-pipe; never
//    files or resolves anything, never touches keys/chain/network. ──
if (process.argv[1] && process.argv[1].endsWith('moderation-report.mjs')) {
  (async () => {
    try {
      const fp = await import('../integrations/flag-pipe.mjs');
      fp.__setStore(fp.jsonlStore());                 // read the persisted queue, not empty memory
      const out = report({ summary: fp.summary(), queue: fp.reviewQueue({ status: 'pending' }) });
      console.log(out);
    } catch (e) {
      console.log('# Moderation report\n\n(could not read flag-pipe store)\n');
    }
  })();
}
