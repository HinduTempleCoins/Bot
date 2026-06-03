// openxr-manifest.mjs — OpenXR-first VR build-path layer for the MELEK/SoapBox VR app (task #120).
//
// This is the PLANNING + MANIFEST layer, not a game engine. It describes how one OpenXR build of the
// app (engine: Godot 4.6, the open-source "own-it" pick — editor runs natively on Quest 3, full source)
// fans out across every headset family. The through-line, per the operator's VR-SDK spectrum note
// (.local/inbound-claude-chat-docs-2026-06-03.md §1): "build once on OpenXR, deploy across all headsets."
//
// OpenXR is the standard runtime ABI. The same app links one OpenXR loader; each headset ships its own
// OpenXR runtime (Meta, SteamVR, PICO, WiVRn/Monaco on Linux, browser WebXR). So coverage collapses to a
// small set of Godot EXPORT PRESETS keyed by form-factor: Android APK (standalone), native PC (PCVR),
// Web/WASM (WebXR). One preset per form-factor covers every headset that speaks that runtime.
//
// Pure / deterministic: no network, no clock, no secrets. Soft-fail on bad input (returns shaped objects
// with errors[] rather than throwing).

export const ENGINE = { name: 'Godot', version: '4.6', license: 'MIT (open source)', note: 'own-it pick; OpenXR-native, editor runs on Quest 3' };

// Form factors — the three deploy shapes. Coverage dedupes headsets down to these.
export const FORM_FACTORS = ['standalone', 'pcvr', 'web'];

// Target headsets, each reached via its OpenXR runtime. formFactor decides which export preset covers it.
// WebXR is the no-install browser fallback target (lowest friction).
export const HEADSETS = [
  { id: 'quest2',   label: 'Meta Quest 2',   runtime: 'Meta OpenXR',     formFactor: 'standalone', notes: 'Android/standalone; Snapdragon XR2; controllers + hand-tracking' },
  { id: 'quest3',   label: 'Meta Quest 3',   runtime: 'Meta OpenXR',     formFactor: 'standalone', notes: 'Android/standalone; color passthrough (MR); Godot editor runs natively' },
  { id: 'questpro', label: 'Meta Quest Pro', runtime: 'Meta OpenXR',     formFactor: 'standalone', notes: 'Android/standalone; eye + face tracking; passthrough' },
  { id: 'pico',     label: 'PICO 4 / Neo',   runtime: 'PICO OpenXR',     formFactor: 'standalone', notes: 'Android/standalone; ByteDance; OpenXR via PICO runtime' },
  { id: 'pcvr',     label: 'PCVR (SteamVR)', runtime: 'SteamVR OpenXR',  formFactor: 'pcvr',       notes: 'Tethered/streamed PC; covers any SteamVR-OpenXR headset' },
  { id: 'vive',     label: 'HTC Vive',       runtime: 'SteamVR OpenXR',  formFactor: 'pcvr',       notes: 'PCVR via SteamVR OpenXR runtime' },
  { id: 'index',    label: 'Valve Index',    runtime: 'SteamVR OpenXR',  formFactor: 'pcvr',       notes: 'PCVR; SteamVR OpenXR; finger-tracking controllers' },
  { id: 'varjo',    label: 'Varjo Aero/XR',  runtime: 'Varjo OpenXR',    formFactor: 'pcvr',       notes: 'High-end PCVR; Varjo OpenXR runtime; eye tracking' },
  { id: 'webxr',    label: 'WebXR (browser)',runtime: 'Browser WebXR',   formFactor: 'web',        notes: 'No-install browser VR fallback; lowest friction; Godot Web/WASM export' },
];

// Godot export presets per form-factor — what `buildManifest` emits as targets. openxr settings carry the
// plugin config each preset needs.
export const EXPORT_TARGETS = {
  standalone: {
    id: 'standalone', label: 'Android APK (standalone)', platform: 'Android', artifact: 'apk',
    godotPreset: 'Android', openxr: { enabled: true, plugin: 'godotopenxr', androidLoader: 'meta+pico+khronos', renderer: 'forward_mobile' },
    note: 'One APK; OpenXR loader resolves per-device (Meta/PICO/Khronos). Mobile renderer for the on-headset SoC.',
  },
  pcvr: {
    id: 'pcvr', label: 'Native PC (PCVR)', platform: 'PC', artifact: 'native-binary',
    godotPreset: 'Linux/Windows desktop', openxr: { enabled: true, plugin: 'builtin', desktopRuntime: 'SteamVR/Varjo OpenXR', renderer: 'forward_plus' },
    note: 'Native desktop binary; talks to whatever OpenXR runtime the PC has installed (SteamVR, Varjo). Desktop renderer.',
  },
  web: {
    id: 'web', label: 'Web / WASM (WebXR)', platform: 'Web', artifact: 'wasm',
    godotPreset: 'Web', openxr: { enabled: true, plugin: 'webxr', renderer: 'gl_compatibility' },
    note: 'WASM build; WebXR session in-browser. No install. GL-compat renderer for broad browser support.',
  },
};

// The OpenXR feature set the app requests (extensions/profiles). Deterministic; the same across one build.
export const OPENXR_FEATURES = {
  controllers: true,    // XR_*_controller_profile interaction profiles (Touch, Index, etc.)
  handTracking: true,   // XR_EXT_hand_tracking — falls back to controllers where unsupported
  passthrough: true,    // XR_FB_passthrough / equivalent — MR on Quest 3/Pro; ignored on opaque HMDs
};

const HEADSET_BY_ID = new Map(HEADSETS.map((h) => [h.id, h]));

/** Resolve a list of headset ids OR headset objects into headset objects. Unknown ids land in unknown[]. */
function resolveHeadsets(headsets) {
  const known = [];
  const unknown = [];
  for (const h of Array.isArray(headsets) ? headsets : []) {
    const id = typeof h === 'string' ? h : h && h.id;
    const hit = id && HEADSET_BY_ID.get(id);
    if (hit) known.push(hit);
    else unknown.push(id ?? h);
  }
  return { known, unknown };
}

/**
 * coverageFor(headsets) → which export targets are required to cover a given headset list.
 * Dedupes by form-factor (the OpenXR-first payoff: many headsets, few builds).
 * @returns {{ targets: object[], uncovered: any[] }}
 */
export function coverageFor(headsets) {
  const { known, unknown } = resolveHeadsets(headsets);
  const ffSeen = [];
  for (const h of known) if (!ffSeen.includes(h.formFactor)) ffSeen.push(h.formFactor);
  const targets = ffSeen.map((ff) => EXPORT_TARGETS[ff]).filter(Boolean);
  return { targets, uncovered: unknown };
}

/**
 * buildManifest({ appName, version, headsets }) → deployment manifest.
 * Deterministic. Maps the requested headsets to export targets, attaches the OpenXR feature set and
 * per-target build notes. Defaults to all HEADSETS when none specified.
 */
export function buildManifest({ appName, version, headsets } = {}) {
  const list = Array.isArray(headsets) && headsets.length ? headsets : HEADSETS.map((h) => h.id);
  const { known, unknown } = resolveHeadsets(list);
  const { targets, uncovered } = coverageFor(list);
  return {
    appName: appName ?? null,
    version: version ?? null,
    engine: { ...ENGINE },
    openxrFirst: true,
    features: { ...OPENXR_FEATURES },
    headsets: known.map((h) => ({ id: h.id, label: h.label, runtime: h.runtime, formFactor: h.formFactor })),
    targets: targets.map((t) => ({
      id: t.id, label: t.label, platform: t.platform, artifact: t.artifact,
      godotPreset: t.godotPreset, openxr: { ...t.openxr },
      coversHeadsets: known.filter((h) => h.formFactor === t.id).map((h) => h.id),
      note: t.note,
    })),
    uncovered,
  };
}

/**
 * validateManifest(m) → { ok, errors[] }. Soft-fail: never throws.
 */
export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') { return { ok: false, errors: ['manifest is not an object'] }; }
  if (!m.appName) errors.push('missing appName');
  if (!m.version) errors.push('missing version');
  if (!Array.isArray(m.targets) || m.targets.length === 0) errors.push('no export targets');
  if (!m.features || typeof m.features !== 'object') errors.push('missing OpenXR feature set');
  if (m.openxrFirst !== true) errors.push('manifest is not OpenXR-first');
  if (Array.isArray(m.targets)) {
    for (const t of m.targets) {
      if (!t || !t.openxr || t.openxr.enabled !== true) errors.push(`target ${t && t.id} does not enable OpenXR`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * renderPlan(manifest) → readable markdown build/deploy plan. Deterministic.
 */
export function renderPlan(manifest) {
  const m = manifest || {};
  const feats = m.features || {};
  const on = (b) => (b ? 'yes' : 'no');
  const lines = [];
  lines.push(`# VR Build & Deploy Plan — ${m.appName || '(unnamed app)'} v${m.version || '?'}`);
  lines.push('');
  lines.push(`**Engine:** ${ENGINE.name} ${ENGINE.version} (${ENGINE.license}) — ${ENGINE.note}`);
  lines.push(`**Strategy:** OpenXR-first — one OpenXR build per form-factor deploys across all headsets.`);
  lines.push('');
  lines.push('## OpenXR feature set');
  lines.push(`- Controllers: ${on(feats.controllers)}`);
  lines.push(`- Hand-tracking: ${on(feats.handTracking)} (XR_EXT_hand_tracking; falls back to controllers)`);
  lines.push(`- Passthrough / MR: ${on(feats.passthrough)} (Quest 3/Pro; ignored on opaque HMDs)`);
  lines.push('');
  lines.push('## Export targets');
  for (const t of m.targets || []) {
    const covers = (t.coversHeadsets || []).join(', ') || '(none)';
    lines.push(`### ${t.label}  \`[${t.id}]\``);
    lines.push(`- Godot preset: **${t.godotPreset}** → ${t.platform} (${t.artifact})`);
    lines.push(`- OpenXR plugin: ${t.openxr && t.openxr.plugin}`);
    lines.push(`- Covers headsets: ${covers}`);
    lines.push(`- ${t.note}`);
    lines.push('');
  }
  if (m.uncovered && m.uncovered.length) {
    lines.push(`## Uncovered / unknown`);
    lines.push(`- ${m.uncovered.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

// CLI: print a full-coverage plan for a sample app. Guarded so importing never runs it.
if (process.argv[1] && process.argv[1].endsWith('openxr-manifest.mjs')) {
  const manifest = buildManifest({ appName: 'MELEK VR Temple', version: '0.1.0' });
  const v = validateManifest(manifest);
  console.log(renderPlan(manifest));
  console.log(`\nvalidate: ${v.ok ? 'OK' : 'ERRORS — ' + v.errors.join('; ')}`);
}
