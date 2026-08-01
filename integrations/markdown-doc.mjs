// markdown-doc.mjs — the ONE small markdown→HTML renderer the public sites use to serve committed
// documents (the roadmap, the whitepaper) straight from their .md files, so a page and its file can
// never drift. Extracted from site/home/server.mjs when a second site (Witness School) needed to
// serve the same whitepaper — two copies of a security-relevant renderer is exactly the thing that
// rots out of sync.
//
// ┌─ THE SAFETY PROPERTY (do not weaken) ──────────────────────────────────────────────────────┐
// │ ESCAPE-FIRST. The ENTIRE source is esc()'d BEFORE any markup is applied. Consequently the    │
// │ renderer can only ever emit the small fixed tag set below, and no byte of the source file    │
// │ can become a tag. A table cell can no more inject HTML than a paragraph can. If you add a    │
// │ construct, add it as a pattern over ALREADY-ESCAPED text — never by un-escaping.             │
// └─────────────────────────────────────────────────────────────────────────────────────────────┘
//
// Supported: h1-h4, ul/li, blockquote, p, hr, pipe tables, inline `code`, **bold**, *ital*, _ital_.
// Deliberately NOT supported: raw HTML, links, images, scripts, styles. These documents are prose.
//
// Pure + offline: no fetch, no fs, no clock. Reading the file is the caller's job (see docPage()).

import { promises as fsp } from 'node:fs';

export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function renderMarkdown(md) {
  const lines = esc(md).split(/\r?\n/);
  const out = [];
  let inList = false;
  let table = null; // { head: [...], rows: [[...]] } while consuming a pipe table
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  const inline = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*_])\*([^*]+)\*/g, '$1<i>$2</i>')
    .replace(/(^|[^*_])_([^_]+)_/g, '$1<i>$2</i>');
  const cells = (line) => line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const closeTable = () => {
    if (!table) return;
    const head = `<thead><tr>${table.head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`;
    const body = table.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
    // Wide tables must scroll inside their own box, never widen the page on a phone.
    out.push(`<div class=tw><table>${head}<tbody>${body}</tbody></table></div>`);
    table = null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    // A pipe table runs until the first line that isn't a pipe row.
    if (table) {
      if (/^\|.*\|$/.test(line)) {
        if (!/^\|[\s:|-]+\|$/.test(line)) table.rows.push(cells(line)); // skip the |---|---| separator
        continue;
      }
      closeTable();
    }

    if (!line) { closeList(); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { closeList(); out.push('<hr>'); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { closeList(); const n = h[1].length; out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    if (/^\|.*\|$/.test(line)) { closeList(); table = { head: cells(line), rows: [] }; continue; }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    const bq = /^&gt;\s*(.*)$/.exec(line); // '>' is already escaped
    if (bq) { closeList(); out.push(`<blockquote>${inline(bq[1])}</blockquote>`); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  closeTable();
  return out.join('\n');
}

// Read a committed markdown file and render it. Soft-fails to a placeholder — an unreadable file
// must never take a public page down (house rule: soft-fail, never throw).
export async function readDoc(file, { title = 'Document', missing = 'This document is being updated. Check back shortly.' } = {}) {
  let md = '';
  try { md = await fsp.readFile(file, 'utf8'); } catch { md = ''; }
  return md
    ? renderMarkdown(md)
    : `<h1>${esc(title)}</h1><p>${esc(missing)}</p>`;
}

// The shared stylesheet for a rendered document. Both sites use the same CSS variables
// (--panel/--line/--gold/--mut), so one block styles the docs identically on either host.
export const DOC_STYLE = `
  .doc{max-width:760px;margin:0 auto;padding:8px 4px 40px}
  .doc h1{font-size:1.9rem;margin:.2em 0 .5em} .doc h2{font-size:1.3rem;color:var(--gold,#d4a23c);margin:1.6em 0 .4em;border-bottom:1px solid var(--line,#222a3a);padding-bottom:.25em}
  .doc h3{font-size:1.05rem;margin:1.3em 0 .3em} .doc li{margin:.3em 0}
  .doc blockquote{margin:1.4em 0;padding:.6em 1em;border-left:3px solid var(--gold,#d4a23c);background:var(--panel,#131826);color:var(--mut,#9aa4b2)}
  .doc hr{border:0;border-top:1px solid var(--line,#222a3a);margin:2em 0}
  .doc code{background:var(--panel,#131826);border:1px solid var(--line,#222a3a);border-radius:4px;padding:.05em .35em;font-size:.9em;word-break:break-all}
  .doc .tw{overflow-x:auto;margin:1.2em 0} .doc table{border-collapse:collapse;width:100%;font-size:.93rem}
  .doc th,.doc td{border:1px solid var(--line,#222a3a);padding:.45em .7em;text-align:left;vertical-align:top}
  .doc th{background:var(--panel,#131826);color:var(--gold,#d4a23c);font-weight:700}`;
