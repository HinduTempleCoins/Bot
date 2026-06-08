// genai-comfyui-templates.test.mjs — offline tests for the ComfyUI workflow-template library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMFY_TEMPLATES, COMFY_KINDS, listComfy, getComfy, comfyByKind, comfyNodeCount,
  workflowJson, validateComfyTemplates,
} from './genai-comfyui-templates.mjs';

test('library has several templates and is valid', () => {
  assert.ok(COMFY_TEMPLATES.length >= 6, `expected >=6, got ${COMFY_TEMPLATES.length}`);
  const v = validateComfyTemplates();
  assert.equal(v.ok, true, 'integrity errors: ' + v.errors.join('; '));
});

test('every workflow is a node graph whose wires reference existing nodes + has a Save node', () => {
  for (const t of COMFY_TEMPLATES) {
    const wf = t.workflow;
    const ids = new Set(Object.keys(wf));
    let hasSave = false;
    for (const node of Object.values(wf)) {
      assert.ok(node.class_type, `${t.id}: node missing class_type`);
      if (/save/i.test(node.class_type)) hasSave = true;
      for (const v of Object.values(node.inputs || {})) {
        if (Array.isArray(v) && v.length === 2 && typeof v[1] === 'number') {
          assert.ok(ids.has(String(v[0])), `${t.id}: wire to missing node ${v[0]}`);
        }
      }
    }
    assert.ok(hasSave, `${t.id}: no Save node`);
    assert.ok(COMFY_KINDS.includes(t.kind), `${t.id}: bad kind`);
  }
});

test('workflowJson returns valid, round-trippable JSON', () => {
  for (const t of COMFY_TEMPLATES) {
    const json = workflowJson(t.id);
    assert.ok(json.length > 20, `${t.id}: json too short`);
    const parsed = JSON.parse(json);
    assert.equal(Object.keys(parsed).length, comfyNodeCount(t.id));
  }
});

test('comfyNodeCount matches the workflow node count', () => {
  const t = getComfy('sd15-txt2img-basic');
  assert.equal(comfyNodeCount('sd15-txt2img-basic'), Object.keys(t.workflow).length);
});

test('comfyByKind partitions by kind', () => {
  let total = 0;
  for (const k of COMFY_KINDS) total += comfyByKind(k).length;
  assert.equal(total, COMFY_TEMPLATES.length);
  assert.ok(comfyByKind('txt2img').length >= 1);
});

test('unknown id soft-fails', () => {
  assert.equal(getComfy('nope'), null);
  assert.equal(workflowJson('nope'), '');
  assert.equal(comfyNodeCount('nope'), 0);
});

test('listComfy returns the full library', () => {
  assert.equal(listComfy().length, COMFY_TEMPLATES.length);
});

test('ids are unique', () => {
  const ids = COMFY_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('covers the core kinds the operator asked for (txt2img, upscale, inpaint, video)', () => {
  for (const k of ['txt2img', 'upscale', 'inpaint', 'video']) {
    assert.ok(comfyByKind(k).length >= 1, `missing a ${k} template`);
  }
});
