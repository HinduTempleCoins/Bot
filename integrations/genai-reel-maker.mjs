// genai-reel-maker.mjs — the CapCut-style "video / reel template maker" for the GenAI page.
//
// THE IDEA (operator's spec, GenAI phase 2): a simple, HONEST template maker. Pick a reel template
// (intro / captions / music-cue structure), fill a few labelled fields, and it produces a downloadable
// STORYBOARD SPEC (JSON + a human-readable shotlist) the user takes into CapCut or any editor. It does
// NOT render video — it's a starting template, not a finished reel. No heavy deps, no GPU, no network.
//
// Pure data + pure functions — fully testable offline.
//
//   listReelTemplates()                 -> all templates
//   getReelTemplate(id)                 -> one or null
//   buildReelSpec(id, fields, opts)     -> { ok, spec } | { ok:false, error }   (the downloadable JSON)
//   shotlist(spec)                      -> a plain-text shotlist string for humans
//   validateReelTemplates()             -> integrity check for /health + tests
//
// A template is a sequence of scenes; each scene has a role (intro/body/caption/cta/outro), a duration
// hint, and a `text` pattern with {{field}} placeholders. Fields are filled exactly like the image
// templates: a missing field falls back to its example so a half-filled form still produces a good spec.
//
// Aspects: 9:16 (reel/short) | 1:1 (square) | 16:9 (wide)

export const REEL_ASPECTS = ['9:16', '1:1', '16:9'];

export const REEL_TEMPLATES = [
  {
    id: 'hook-explainer',
    title: 'Hook → Explainer → CTA',
    aspect: '9:16',
    music: 'upbeat, builds at the hook, settles under the explainer',
    fields: [
      { key: 'topic', label: 'Topic', placeholder: 'e.g. how MELEK block production works', example: 'how MELEK block production works' },
      { key: 'hook', label: 'Opening hook', placeholder: 'e.g. Most people get this completely wrong', example: 'Most people get this completely wrong' },
      { key: 'point1', label: 'Point 1', placeholder: 'e.g. Witnesses take turns making blocks', example: 'Witnesses take turns making blocks' },
      { key: 'point2', label: 'Point 2', placeholder: 'e.g. Your stake votes them in', example: 'Your stake votes them in' },
      { key: 'cta', label: 'Call to action', placeholder: 'e.g. Follow for more chain basics', example: 'Follow for more chain basics' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: '{{hook}}' },
      { role: 'body', seconds: 5, text: 'Here\'s {{topic}}.' },
      { role: 'body', seconds: 5, text: '1. {{point1}}' },
      { role: 'body', seconds: 5, text: '2. {{point2}}' },
      { role: 'cta', seconds: 3, text: '{{cta}}' },
    ],
  },
  {
    id: 'listicle-5',
    title: '5 Quick Tips (listicle)',
    aspect: '9:16',
    music: 'punchy loop, a beat-drop per tip',
    fields: [
      { key: 'subject', label: 'Subject', placeholder: 'e.g. growing tulsi', example: 'growing tulsi' },
      { key: 'tip1', label: 'Tip 1', placeholder: 'e.g. Full sun', example: 'Full sun' },
      { key: 'tip2', label: 'Tip 2', placeholder: 'e.g. Water in the morning', example: 'Water in the morning' },
      { key: 'tip3', label: 'Tip 3', placeholder: 'e.g. Pinch the flowers', example: 'Pinch the flowers' },
      { key: 'tip4', label: 'Tip 4', placeholder: 'e.g. Well-drained soil', example: 'Well-drained soil' },
      { key: 'tip5', label: 'Tip 5', placeholder: 'e.g. Harvest often', example: 'Harvest often' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: '5 tips for {{subject}}' },
      { role: 'body', seconds: 3, text: '① {{tip1}}' },
      { role: 'body', seconds: 3, text: '② {{tip2}}' },
      { role: 'body', seconds: 3, text: '③ {{tip3}}' },
      { role: 'body', seconds: 3, text: '④ {{tip4}}' },
      { role: 'body', seconds: 3, text: '⑤ {{tip5}}' },
      { role: 'outro', seconds: 2, text: 'Save this for later 🔖' },
    ],
  },
  {
    id: 'before-after',
    title: 'Before → After (transformation)',
    aspect: '9:16',
    music: 'tension then release on the reveal',
    fields: [
      { key: 'subject', label: 'Subject', placeholder: 'e.g. my old logo', example: 'my old logo' },
      { key: 'before', label: 'The "before"', placeholder: 'e.g. plain and forgettable', example: 'plain and forgettable' },
      { key: 'after', label: 'The "after"', placeholder: 'e.g. a clean gold ankh mark', example: 'a clean gold ankh mark' },
      { key: 'how', label: 'How', placeholder: 'e.g. made free on the GenAI page', example: 'made free on the GenAI page' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: '{{subject}} — before' },
      { role: 'body', seconds: 3, text: '{{before}}' },
      { role: 'body', seconds: 1, text: '…wait for it…' },
      { role: 'body', seconds: 3, text: 'After: {{after}}' },
      { role: 'cta', seconds: 3, text: '{{how}}' },
    ],
  },
  {
    id: 'quote-card',
    title: 'Quote / Scripture card',
    aspect: '1:1',
    music: 'calm, ambient pad',
    fields: [
      { key: 'quote', label: 'Quote', placeholder: 'e.g. The light shines in the darkness', example: 'The light shines in the darkness' },
      { key: 'attribution', label: 'Attribution', placeholder: 'e.g. John 1:5', example: 'John 1:5' },
      { key: 'handle', label: 'Your handle', placeholder: 'e.g. @hathor', example: '@hathor' },
    ],
    scenes: [
      { role: 'intro', seconds: 1, text: '“' },
      { role: 'body', seconds: 5, text: '{{quote}}' },
      { role: 'caption', seconds: 2, text: '— {{attribution}}' },
      { role: 'outro', seconds: 2, text: '{{handle}}' },
    ],
  },
  {
    id: 'product-promo',
    title: 'Product / Project promo',
    aspect: '9:16',
    music: 'confident, modern',
    fields: [
      { key: 'name', label: 'Name', placeholder: 'e.g. SoapBox', example: 'SoapBox' },
      { key: 'tagline', label: 'Tagline', placeholder: 'e.g. every coin, one clear view', example: 'every coin, one clear view' },
      { key: 'benefit1', label: 'Benefit 1', placeholder: 'e.g. free and open', example: 'free and open' },
      { key: 'benefit2', label: 'Benefit 2', placeholder: 'e.g. no lock-in', example: 'no lock-in' },
      { key: 'cta', label: 'Call to action', placeholder: 'e.g. Try it today', example: 'Try it today' },
    ],
    scenes: [
      { role: 'intro', seconds: 2, text: 'Meet {{name}}' },
      { role: 'body', seconds: 3, text: '{{tagline}}' },
      { role: 'body', seconds: 3, text: '✓ {{benefit1}}' },
      { role: 'body', seconds: 3, text: '✓ {{benefit2}}' },
      { role: 'cta', seconds: 3, text: '{{cta}}' },
    ],
  },
];

const BY_ID = new Map(REEL_TEMPLATES.map((t) => [t.id, t]));
export function listReelTemplates() { return REEL_TEMPLATES; }
export function getReelTemplate(id) { return BY_ID.get(String(id || '')) || null; }

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
function fillText(pattern, vals) {
  return String(pattern || '').replace(PLACEHOLDER_RE, (_, k) => (vals[k] != null ? vals[k] : '')).replace(/\s+/g, ' ').trim();
}

// buildReelSpec — pure. Turns a template id + filled fields into a downloadable storyboard spec.
// Missing fields fall back to their example. Unknown id → { ok:false }. Bad/empty fields are soft —
// the spec still builds from examples. `opts.aspect` overrides the template default if valid.
export function buildReelSpec(id, fields = {}, opts = {}) {
  const t = getReelTemplate(id);
  if (!t) return { ok: false, error: `unknown reel template: ${String(id || '')}` };

  const vals = {};
  for (const f of t.fields) {
    const raw = fields && fields[f.key] != null ? String(fields[f.key]).trim() : '';
    vals[f.key] = raw || f.example || '';
  }

  const aspect = REEL_ASPECTS.includes(opts.aspect) ? opts.aspect : t.aspect;
  let t0 = 0;
  const scenes = t.scenes.map((s, i) => {
    const start = t0;
    const seconds = Math.max(1, +s.seconds || 1);
    t0 += seconds;
    return { n: i + 1, role: s.role, start, seconds, caption: fillText(s.text, vals) };
  });

  const spec = {
    kind: 'reel-storyboard',
    version: 1,
    template: t.id,
    title: t.title,
    aspect,
    musicCue: t.music,
    totalSeconds: t0,
    sceneCount: scenes.length,
    scenes,
    note: 'A starting template — import into CapCut or any editor. This is a storyboard/shotlist, not a rendered video.',
  };
  return { ok: true, spec };
}

// shotlist — a plain-text rendering of a spec for humans (and a second downloadable format).
export function shotlist(spec) {
  if (!spec || !Array.isArray(spec.scenes)) return '';
  const lines = [];
  lines.push(`${spec.title || 'Reel'} — ${spec.aspect || ''} — ${spec.totalSeconds || 0}s, ${spec.sceneCount || 0} scenes`);
  if (spec.musicCue) lines.push(`Music: ${spec.musicCue}`);
  lines.push('');
  for (const s of spec.scenes) {
    const end = (s.start || 0) + (s.seconds || 0);
    lines.push(`${s.n}. [${s.start}s–${end}s] (${s.role}) ${s.caption}`);
  }
  lines.push('');
  lines.push(spec.note || '');
  return lines.join('\n').trim();
}

// integrity check for /health + tests
export function validateReelTemplates() {
  const errors = [];
  const seen = new Set();
  for (const t of REEL_TEMPLATES) {
    if (!t.id) { errors.push('reel template with no id'); continue; }
    if (seen.has(t.id)) errors.push(`duplicate id: ${t.id}`);
    seen.add(t.id);
    if (!t.title) errors.push(`${t.id}: no title`);
    if (!REEL_ASPECTS.includes(t.aspect)) errors.push(`${t.id}: bad aspect ${t.aspect}`);
    if (!t.music) errors.push(`${t.id}: no music cue`);
    if (!Array.isArray(t.fields) || !t.fields.length) errors.push(`${t.id}: no fields`);
    if (!Array.isArray(t.scenes) || !t.scenes.length) errors.push(`${t.id}: no scenes`);
    const declared = new Set((t.fields || []).map((f) => f.key));
    const used = new Set();
    for (const s of (t.scenes || [])) {
      if (!s.role) errors.push(`${t.id}: scene with no role`);
      if (!(+s.seconds > 0)) errors.push(`${t.id}: scene "${s.text}" has no positive duration`);
      let m; PLACEHOLDER_RE.lastIndex = 0;
      while ((m = PLACEHOLDER_RE.exec(s.text || ''))) used.add(m[1]);
    }
    for (const u of used) if (!declared.has(u)) errors.push(`${t.id}: scene uses undeclared field {{${u}}}`);
    for (const f of (t.fields || [])) {
      if (!f.key) errors.push(`${t.id}: field with no key`);
      if (!f.label) errors.push(`${t.id}: field ${f.key} has no label`);
      if (!used.has(f.key)) errors.push(`${t.id}: declared field ${f.key} never used in a scene`);
    }
    // the builder must produce a serializable spec from examples
    const built = buildReelSpec(t.id, {});
    if (!built.ok) errors.push(`${t.id}: buildReelSpec failed`);
    else { try { JSON.parse(JSON.stringify(built.spec)); } catch { errors.push(`${t.id}: spec does not serialize`); } }
  }
  return { ok: errors.length === 0, errors, count: REEL_TEMPLATES.length };
}

if (process.argv[1] && process.argv[1].endsWith('genai-reel-maker.mjs')) {
  const v = validateReelTemplates();
  console.log(`${REEL_TEMPLATES.length} reel templates · ${v.ok ? '✓ valid' : '✗ ' + v.errors.join('; ')}`);
  for (const t of REEL_TEMPLATES) {
    const { spec } = buildReelSpec(t.id, {});
    console.log(`  [${spec.aspect}] ${t.id} — ${spec.totalSeconds}s, ${spec.sceneCount} scenes`);
  }
}
