// genai-colab-templates.test.mjs — offline tests for the Google-Colab notebook-template library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLAB_TEMPLATES, COLAB_KINDS, listColab, getColab, colabByKind, colabLaunchUrl, validateColabTemplates,
} from './genai-colab-templates.mjs';

test('library has several notebooks and is valid', () => {
  assert.ok(COLAB_TEMPLATES.length >= 6, `expected >=6, got ${COLAB_TEMPLATES.length}`);
  const v = validateColabTemplates();
  assert.equal(v.ok, true, 'integrity errors: ' + v.errors.join('; '));
});

test('every notebook yields a valid colab.research.google.com launch URL', () => {
  for (const t of COLAB_TEMPLATES) {
    const url = colabLaunchUrl(t.id);
    assert.ok(/^https:\/\/colab\.research\.google\.com\//.test(url), `${t.id}: bad launch url ${url}`);
    assert.ok(COLAB_KINDS.includes(t.kind), `${t.id}: bad kind`);
  }
});

test('a github notebook URL becomes a /github/ launch link', () => {
  const url = colabLaunchUrl('sdxl-diffusers');
  assert.ok(url.startsWith('https://colab.research.google.com/github/huggingface/notebooks/blob/'));
});

test('an explicit colabUrl is used as-is', () => {
  const url = colabLaunchUrl('realesrgan-upscale');
  assert.ok(url.startsWith('https://colab.research.google.com/drive/'));
});

test('colabByKind partitions by kind', () => {
  let total = 0;
  for (const k of COLAB_KINDS) total += colabByKind(k).length;
  assert.equal(total, COLAB_TEMPLATES.length);
});

test('unknown id soft-fails', () => {
  assert.equal(getColab('nope'), null);
  assert.equal(colabLaunchUrl('nope'), '');
});

test('listColab returns the full library', () => {
  assert.equal(listColab().length, COLAB_TEMPLATES.length);
});

test('ids are unique', () => {
  const ids = COLAB_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('covers the kinds the operator asked for (image, finetune, audio)', () => {
  for (const k of ['image', 'finetune', 'audio']) {
    assert.ok(colabByKind(k).length >= 1, `missing a ${k} notebook`);
  }
});
