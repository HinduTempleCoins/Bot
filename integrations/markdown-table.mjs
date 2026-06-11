// markdown-table.mjs — Backlog 107a7e5365: a PURE GitHub-flavored Markdown table renderer.
//
// Many modules in this repo print ad-hoc fixed-width columns (market-universe, holders,
// timeline), and the weekly-report itinerary items (#107, #108) need clean tables. There is
// no shared GFM table renderer — this is it. PURE: no network, no IO, no injectable seams
// needed. Soft-fail-never-throw: bad input degrades to an empty cell rather than throwing.
//
//   import { mdTable, mdTableFromMatrix, esc } from './markdown-table.mjs'
//
//   mdTable(
//     [{ sym: 'MELEK', px: 1.23 }, { sym: 'MBD', px: 0.99 }],
//     { columns: [
//       { key: 'sym', header: 'Symbol' },
//       { key: 'px',  header: 'Price', align: 'r', format: v => `$${v}` },
//     ] }
//   )
//   // | Symbol | Price |
//   // | --- | ---: |
//   // | MELEK | $1.23 |
//   // | MBD | $0.99 |
//
//   mdTableFromMatrix(['A', 'B'], [[1, 2], [3, 4]], { align: ['l', 'r'] })

// ── cell escaping (house esc() style) ──────────────────────────────────────────────────
// GFM table cells cannot contain a raw '|' (column delimiter) or a newline (row delimiter).
// Pipes are backslash-escaped; CR/LF collapse to a single space; tabs normalize to a space.
export function esc(cell) {
  let s;
  try {
    s = cell == null ? '' : (typeof cell === 'string' ? cell : String(cell));
  } catch {
    s = '';
  }
  return s
    .replace(/\\/g, '\\\\')      // escape existing backslashes first
    .replace(/\|/g, '\\|')       // escape pipes (column delimiter)
    .replace(/[\r\n]+/g, ' ')    // collapse newlines (row delimiter)
    .replace(/\t/g, ' ')         // tabs → space
    .trim();
}

// ── alignment → GFM separator token ─────────────────────────────────────────────────────
// l/left → ':---', r/right → '---:', c/center → ':---:', anything else → '---'.
function sepToken(align) {
  switch (String(align == null ? '' : align).toLowerCase()) {
    case 'l':
    case 'left':   return ':---';
    case 'r':
    case 'right':  return '---:';
    case 'c':
    case 'center': return ':---:';
    default:       return '---';
  }
}

function row(cells) {
  return `| ${cells.join(' | ')} |`;
}

// ── mdTable(rows, { columns, align }) ───────────────────────────────────────────────────
// rows: array of objects. columns: [{ key, header, align?, format? }].
// `align` (top-level) is an optional fallback array/string applied positionally when a column
// has no own align. Missing keys → empty cell. format(value, rowObj) may transform a cell;
// if it throws, the cell falls back to the raw value. Empty rows → header-only table.
export function mdTable(rows, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  let columns = Array.isArray(o.columns) ? o.columns : [];
  // Defensive: drop non-object column specs.
  columns = columns.filter((c) => c && typeof c === 'object');

  const fallbackAlign = o.align;
  const alignAt = (i, ownAlign) => {
    if (ownAlign != null && ownAlign !== '') return ownAlign;
    if (Array.isArray(fallbackAlign)) return fallbackAlign[i];
    if (typeof fallbackAlign === 'string') return fallbackAlign;
    return undefined;
  };

  if (columns.length === 0) return '';

  const headerCells = columns.map((c) => esc(c.header != null ? c.header : c.key));
  const sepCells = columns.map((c, i) => sepToken(alignAt(i, c.align)));

  const lines = [row(headerCells), row(sepCells)];

  const safeRows = Array.isArray(rows) ? rows : [];
  for (const r of safeRows) {
    const obj = r && typeof r === 'object' ? r : {};
    const cells = columns.map((c) => {
      let v = obj[c.key];
      if (typeof c.format === 'function') {
        try {
          v = c.format(v, obj);
        } catch {
          /* keep raw v on format failure — soft-fail */
        }
      }
      return esc(v);
    });
    lines.push(row(cells));
  }

  return lines.join('\n');
}

// ── mdTableFromMatrix(headers, matrix, { align }) ───────────────────────────────────────
// Convenience for already-tabular data: headers is a string[] (or any[] coerced), matrix is
// an array of row arrays. Ragged rows are padded with empty cells / truncated to header count.
export function mdTableFromMatrix(headers, matrix, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const hdrs = Array.isArray(headers) ? headers : [];
  if (hdrs.length === 0) return '';

  const columns = hdrs.map((h, i) => ({ key: i, header: h }));
  const rows = (Array.isArray(matrix) ? matrix : []).map((mr) => {
    const arr = Array.isArray(mr) ? mr : [];
    const obj = {};
    for (let i = 0; i < hdrs.length; i++) obj[i] = arr[i];
    return obj;
  });

  return mdTable(rows, { columns, align: o.align });
}

// ── CLI demo (guarded) ──────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const out = mdTable(
    [
      { sym: 'MELEK', px: 1.23, note: 'pipe | here' },
      { sym: 'MBD', px: 0.99, note: 'multi\nline' },
    ],
    {
      columns: [
        { key: 'sym', header: 'Symbol', align: 'l' },
        { key: 'px', header: 'Price', align: 'r', format: (v) => `$${v}` },
        { key: 'note', header: 'Note' },
      ],
    }
  );
  console.log(out);
  console.log('\n--- from matrix ---\n');
  console.log(mdTableFromMatrix(['A', 'B'], [[1, 2], [3]], { align: ['l', 'c'] }));
}
