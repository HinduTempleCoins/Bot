import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSymbols, getSymbol, symbolsForFigure, symbolsIndexBody, symbolPageBody, serveSymbolAsset, __resetSymbols } from './symbols.mjs';

const dir = mkdtempSync(join(tmpdir(), 'sym-'));
writeFileSync(join(dir, 'catalog.json'), JSON.stringify({ symbols: [
  { id: 'ankh', name: 'Ankh', tradition: ['egyptian'], group: 'Egyptian', status: 'attested', meaning: 'life', figures: ['isis', 'nobody'],
    sources: [{ title: 'Ankh', url: 'https://en.wikipedia.org/wiki/Ankh' }], image: { file: 'ankh.png', licence: 'Public domain', author: 'A', source: 'https://commons.wikimedia.org/wiki/File:Ankh.svg' } },
  { id: 'vegvisir', name: 'Vegvísir', tradition: ['norse'], group: 'Norse & Germanic', status: 'modern', note: 'Huld manuscript, 1860', figures: [], sources: [], image: { file: 'vegvisir.png', licence: 'CC0' } },
  { id: 'awen', name: 'Awen', tradition: ['celtic'], group: 'Celtic', status: 'modern', figures: [], sources: [], image: null },
] }));
writeFileSync(join(dir, 'ankh.png'), 'png');
process.env.SYMBOLS_DIR = dir; __resetSymbols();

test('catalog loads; lookups by id and by Hierophant figure', () => {
  assert.equal(loadSymbols().length, 3);
  assert.equal(getSymbol('ankh').name, 'Ankh');
  assert.equal(getSymbol('nope'), null);
  assert.deepEqual(symbolsForFigure('isis').map((s) => s.id), ['ankh']);
});

test('index groups imaged symbols, flags modern ones, hides the image-less', () => {
  const h = symbolsIndexBody();
  assert.match(h, /href="\/symbols\/ankh"/);
  assert.match(h, /Vegvísir<span class=sbadge[^>]*>modern/);
  assert.doesNotMatch(h, /\/symbols\/awen/);
});

test('symbol page: meaning, history flag, figure links only to real Hierophant entities, credit, reference-studio handoff', () => {
  const h = symbolPageBody(getSymbol('ankh'));
  assert.match(h, /\/gods\/isis/); assert.doesNotMatch(h, /\/gods\/nobody/);
  assert.match(h, /Public domain · A/);
  assert.match(h, /\/compose\?ref=%2Fsymbols%2Fimg%2Fankh\.png&role=object/);
  assert.match(symbolPageBody(getSymbol('vegvisir')), /Modern history:<\/b> Huld manuscript, 1860/);
});

test('assets: only symbol pngs inside the dir', () => {
  const res = () => ({ code: 0, writeHead(c) { this.code = c; }, end() { return this; } });
  assert.equal(serveSymbolAsset(res(), 'ankh.png').code, 200);
  assert.equal(serveSymbolAsset(res(), '../catalog.json').code, 404);
  assert.equal(serveSymbolAsset(res(), 'missing.png').code, 404);
});
