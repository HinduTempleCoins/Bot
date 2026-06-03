// Offline tests for the OpenXR-first VR build-path layer (task #120).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEADSETS, EXPORT_TARGETS, OPENXR_FEATURES, ENGINE, FORM_FACTORS,
  buildManifest, coverageFor, validateManifest, renderPlan,
} from './openxr-manifest.mjs';

test('HEADSETS includes Quest + PCVR + WebXR with correct form factors', () => {
  const byId = Object.fromEntries(HEADSETS.map((h) => [h.id, h]));
  assert.equal(byId.quest3.formFactor, 'standalone');
  assert.equal(byId.quest2.formFactor, 'standalone');
  assert.equal(byId.pcvr.formFactor, 'pcvr');
  assert.equal(byId.webxr.formFactor, 'web');
  // every headset declares a valid form factor + an OpenXR runtime
  for (const h of HEADSETS) {
    assert.ok(FORM_FACTORS.includes(h.formFactor), `${h.id} form factor`);
    assert.ok(h.runtime && h.runtime.length, `${h.id} runtime`);
  }
});

test('EXPORT_TARGETS has one OpenXR-enabled preset per form factor', () => {
  for (const ff of FORM_FACTORS) {
    const t = EXPORT_TARGETS[ff];
    assert.ok(t, `target for ${ff}`);
    assert.equal(t.openxr.enabled, true);
  }
  assert.equal(EXPORT_TARGETS.standalone.platform, 'Android');
  assert.equal(EXPORT_TARGETS.pcvr.platform, 'PC');
  assert.equal(EXPORT_TARGETS.web.platform, 'Web');
});

test('coverageFor([quest3, pcvr, webxr]) yields 3 distinct targets, none uncovered', () => {
  const { targets, uncovered } = coverageFor(['quest3', 'pcvr', 'webxr']);
  assert.equal(targets.length, 3);
  const ids = targets.map((t) => t.id).sort();
  assert.deepEqual(ids, ['pcvr', 'standalone', 'web']);
  assert.deepEqual(uncovered, []);
});

test('coverageFor dedupes many headsets of same form factor into one target', () => {
  // four standalone headsets collapse to one Android target
  const { targets } = coverageFor(['quest2', 'quest3', 'questpro', 'pico']);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].id, 'standalone');
});

test('coverageFor reports unknown headsets as uncovered', () => {
  const { targets, uncovered } = coverageFor(['quest3', 'visionpro']);
  assert.equal(targets.length, 1);
  assert.deepEqual(uncovered, ['visionpro']);
});

test('buildManifest produces a manifest that validates OK with the OpenXR feature set', () => {
  const m = buildManifest({ appName: 'MELEK VR Temple', version: '0.1.0', headsets: ['quest3', 'pcvr', 'webxr'] });
  const v = validateManifest(m);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(m.openxrFirst, true);
  assert.deepEqual(m.features, OPENXR_FEATURES);
  assert.equal(m.features.handTracking, true);
  assert.equal(m.features.passthrough, true);
  assert.equal(m.features.controllers, true);
  assert.equal(m.engine.name, ENGINE.name);
  assert.equal(m.targets.length, 3);
  // each target lists which headsets it covers
  const standalone = m.targets.find((t) => t.id === 'standalone');
  assert.deepEqual(standalone.coversHeadsets, ['quest3']);
});

test('buildManifest with no headsets defaults to covering all form factors', () => {
  const m = buildManifest({ appName: 'X', version: '1.0' });
  const ids = m.targets.map((t) => t.id).sort();
  assert.deepEqual(ids, ['pcvr', 'standalone', 'web']);
  assert.equal(validateManifest(m).ok, true);
});

test('validateManifest catches a manifest missing appName / version', () => {
  const m = buildManifest({ headsets: ['quest3'] }); // no appName, no version
  const v = validateManifest(m);
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes('missing appName'));
  assert.ok(v.errors.includes('missing version'));
});

test('validateManifest soft-fails on non-object input', () => {
  assert.equal(validateManifest(null).ok, false);
  assert.equal(validateManifest(undefined).ok, false);
  assert.equal(validateManifest(42).ok, false);
});

test('renderPlan returns markdown naming Godot + OpenXR', () => {
  const m = buildManifest({ appName: 'MELEK VR Temple', version: '0.1.0', headsets: ['quest3', 'pcvr', 'webxr'] });
  const md = renderPlan(m);
  assert.match(md, /^# VR Build & Deploy Plan/m);
  assert.match(md, /Godot/);
  assert.match(md, /OpenXR/);
  assert.match(md, /OpenXR-first/);
  assert.match(md, /Android APK/);
  assert.match(md, /Web \/ WASM/);
  assert.match(md, /MELEK VR Temple/);
});
