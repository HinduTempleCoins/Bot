// structure-recognition.mjs — Hathor SEES what players build: recognize a block figure (a bat symbol, an
// ankh, a cross, a face) from the blocks themselves.
//
// Operator (2026-06-20): "like image recognition, the Cheetah stuff — if someone made a bat symbol, we
// would want Hathor in the game to recognize what it is." Cheetah/visual-cortex read camera IMAGES; in the
// game the 'image' is the block pattern. This is the occipital lobe applied to structures: take a region of
// blocks → extract the figure → render it to a compact grid the model can read → recognize what it depicts,
// grounded in her corpus (she names symbols she knows). Then she can react/comment like she does to a person.
//
// Pure + injectable (the recognizer model + corpus retriever are passed in) → offline-testable, soft-fail.

const AIR = new Set(['air', 'cave_air', 'void_air', '']);

/**
 * Extract the FIGURE from a region of blocks: the occupied (non-air) cells, normalized to a 0-origin.
 * @param {Array<{x,y,z,block}>} region
 * @returns {{ cells:[{x,y,z,block}], w, h, d, plane:'wall'|'floor'|'solid' }}
 */
export function extractFigure(region = []) {
  const cells = region
    .filter((b) => b && !AIR.has(String(b.block || '').toLowerCase().replace(/^minecraft:/, '')))
    .map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), z: Math.round(b.z), block: String(b.block).replace(/^minecraft:/, '') }));
  if (!cells.length) return { cells: [], w: 0, h: 0, d: 0, plane: 'wall' };
  const min = (k) => Math.min(...cells.map((c) => c[k]));
  const mx = min('x'), my = min('y'), mz = min('z');
  const norm = cells.map((c) => ({ x: c.x - mx, y: c.y - my, z: c.z - mz, block: c.block }));
  const span = (k) => Math.max(...norm.map((c) => c[k])) + 1;
  const w = span('x'), h = span('y'), d = span('z');
  const plane = d === 1 ? 'wall' : h === 1 ? 'floor' : 'solid';
  return { cells: norm, w, h, d, plane };
}

/**
 * Render a (mostly-flat) figure to an ASCII grid so a model can 'see' the shape. Wall figures render x/y;
 * floor figures render x/z. '#' = block, ' ' = empty.
 */
export function renderGrid(figure) {
  if (!figure || !figure.cells.length) return '';
  const flat = figure.plane === 'floor';
  const cols = figure.w;
  const rows = flat ? figure.d : figure.h;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));
  for (const c of figure.cells) {
    const col = c.x;
    const row = flat ? c.z : (figure.h - 1 - c.y); // y up -> top row first
    if (grid[row] && col >= 0 && col < cols) grid[row][col] = '#';
  }
  return grid.map((r) => r.join('')).join('\n');
}

const RECOGNIZE_HINT = 'You are looking at a small Minecraft block figure rendered as a grid (# = block, space = empty). Say what it most likely DEPICTS in 1-3 words (e.g. "a bat symbol", "an ankh", "a cross", "a face", "a heart", "letters"). If it is just a wall or random, say "nothing recognizable". Reply ONLY as JSON: {"what":"...","confidence":0..1}.';

/**
 * Recognize what a figure depicts. `recognize` is the injected model (vision-or-text complete). Optionally
 * grounds in her corpus so she can add what she KNOWS of the symbol. Soft-fails to { what:'unclear' }.
 * @param {object} figure  from extractFigure
 * @param {object} deps { recognize: async(prompt)=>string, retrieve?, persona? }
 */
export async function recognize(figure, deps = {}) {
  if (!figure || !figure.cells.length) return { what: 'nothing there', confidence: 0, grid: '' };
  const grid = renderGrid(figure);
  if (typeof deps.recognize !== 'function') return { what: 'unclear', confidence: 0, grid };
  let parsed = { what: 'unclear', confidence: 0 };
  try {
    const raw = await deps.recognize(`${RECOGNIZE_HINT}\n\nThe figure (${figure.w}x${figure.h}):\n${grid}`);
    const m = String(raw).match(/\{[\s\S]*\}/);
    if (m) { const o = JSON.parse(m[0]); parsed = { what: String(o.what || 'unclear').slice(0, 60), confidence: clamp01(Number(o.confidence)) }; }
    else if (String(raw).trim()) parsed = { what: String(raw).trim().slice(0, 60), confidence: 0.5 };
  } catch { /* soft-fail */ }

  // ground: what does she KNOW of this symbol (corpus)?
  let recalls = [];
  if (parsed.what && parsed.confidence > 0.3 && typeof deps.retrieve === 'function') {
    try { recalls = (await deps.retrieve(parsed.what, { k: 2 })) || []; } catch { recalls = []; }
  }
  return { ...parsed, grid, recalls, knows: recalls.map((r) => r.source).filter(Boolean) };
}

// A spoken-ready line — she names what she sees and, if she knows it, says something about it.
export function describeRecognition(r) {
  if (!r || !r.what || /nothing|unclear/.test(r.what)) return 'I cannot make out what that is meant to be.';
  const base = `I see — ${r.what}.`;
  if (r.recalls && r.recalls.length) return `${base} ${String(r.recalls[0].text).slice(0, 140)}`;
  return base;
}

function clamp01(x) { return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; }

if (import.meta.url === `file://${process.argv[1]}`) {
  // a tiny "cross" built on a wall (z constant)
  const region = [
    { x: 1, y: 0, z: 5, block: 'black_concrete' }, { x: 1, y: 1, z: 5, block: 'black_concrete' },
    { x: 1, y: 2, z: 5, block: 'black_concrete' }, { x: 0, y: 1, z: 5, block: 'black_concrete' }, { x: 2, y: 1, z: 5, block: 'black_concrete' },
  ];
  const fig = extractFigure(region);
  console.log('plane:', fig.plane, '\n' + renderGrid(fig));
  recognize(fig, { recognize: async () => '{"what":"a cross","confidence":0.8}', retrieve: async () => [{ text: 'the cross — a sign of sacrifice and redemption.', source: 'knowledge/scripture' }] })
    .then((r) => console.log('->', describeRecognition(r)));
}
