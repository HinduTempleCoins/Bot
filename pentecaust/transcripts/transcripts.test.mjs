// transcripts.test.mjs — Pentecaust transcripts phase 1. Offline: temp dirs, injected fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSrt, parseSbv, parseVtt, toVtt, cleanCues, wrap, fmt } from './vtt.mjs';
import { addTrack, getMeta, bestTrack, readTrack, appendEdit, listEdits, listItems, validKey } from './store.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tx-'));
const SRT = '1\n00:00:01,000 --> 00:00:03,500\n<i>Hello</i> there\n\n2\n00:00:04,000 --> 00:00:06,000\nGeneral Kenobi\n';

test('formats: SRT / SBV / VTT parse to the same cues; toVtt round-trips', () => {
  const a = parseSrt(SRT);
  assert.deepEqual(a, [{ start: 1, end: 3.5, text: 'Hello there' }, { start: 4, end: 6, text: 'General Kenobi' }]);
  assert.deepEqual(parseSbv('0:00:01.000,0:00:03.500\nHello there\n\n0:00:04.000,0:00:06.000\nGeneral Kenobi'), a);
  const v = toVtt(a, { note: 'from --> test' });
  assert.match(v, /^WEBVTT\n\nNOTE from → test/);
  assert.deepEqual(parseVtt(v), a);
  assert.equal(fmt(3723.5), '01:02:03.500');
});

test('clean pass: repeats collapse, tiny cues merge, lines wrap to 42', () => {
  const cues = [
    { start: 0, end: 2, text: 'Thank you.' }, { start: 2, end: 4, text: 'Thank you.' }, { start: 4, end: 6, text: 'Thank you.' },
    { start: 7, end: 9, text: 'The night is dark and full of terrors, and the dead walk the earth again tonight' },
    { start: 9.1, end: 9.4, text: 'oh' },
    { start: 12, end: 14, text: 'go go go go go now' },
    { start: 15, end: 15, text: 'bad cue' },
  ];
  const { cues: out, changes } = cleanCues(cues);
  assert.equal(out[0].text, 'Thank you.');
  assert.equal(out[0].end, 6);
  assert.match(out[1].text, /again tonight oh$/);
  assert.ok(out[1].text.split('\n').every((l) => l.length <= 42));
  assert.equal(out[2].text, 'go now');
  assert.deepEqual(changes, { dropped: 1, repeats: 3, merged: 1, wrapped: 1 });
  assert.equal(wrap('short'), 'short');
});

test('store: tracks with provenance; a human track beats an AI one; edits queue; unsafe keys refused', () => {
  const dir = tmp();
  const ai = addTrack('ia', 'Film_1', { title: 'Film', body: toVtt(parseSrt(SRT)), lang: 'en', provenance: 'ai-whisper', model: 'fw' }, dir);
  assert.equal(ai.file, 'en.ai-whisper.vtt');
  assert.equal(bestTrack(getMeta('ia', 'Film_1', dir)).provenance, 'ai-whisper');
  addTrack('ia', 'Film_1', { body: toVtt(parseSrt(SRT)), provenance: 'human-found', source: 'https://archive.org/x.srt' }, dir);
  assert.equal(bestTrack(getMeta('ia', 'Film_1', dir)).provenance, 'human-found');
  assert.match(readTrack('ia', 'Film_1', bestTrack(getMeta('ia', 'Film_1', dir)), dir), /General Kenobi/);
  assert.equal(addTrack('ia', 'Film_1', { body: 'x', provenance: 'made-up' }, dir), null);
  assert.ok(appendEdit('ia', 'Film_1', { cue: 2, text: 'General Kenobi!' }, dir));
  assert.equal(listEdits('ia', 'Film_1', dir).length, 1);
  assert.equal(listItems(dir).length, 1);
  for (const bad of [['ia', '../etc'], ['IA', 'x'], ['ia', ''], ['ia', 'a/b']]) assert.equal(validKey(...bad), false, bad.join('/'));
  assert.equal(addTrack('ia', '../x', { body: 'x', provenance: 'official' }, dir), null);
});

test('seek: human subtitles from the IA item are preferred (IA machine ASR skipped); ingest adds ai-whisper + ai-edited', async () => {
  const dir = tmp();
  const seek = await import('./seek.mjs');
  const files = [{ name: 'film.mp4', format: 'h.264', length: '95.5' }, { name: 'film.asr.srt' }, { name: 'film.fr.srt' }, { name: 'Film.1953.720p.BluRay.-[group].eng.srt' }, { name: 'film.en.srt' }];
  seek.__setFetch(async (u) => {
    if (/\/metadata\//.test(u)) return { ok: true, json: async () => ({ metadata: { identifier: 'Film_2' }, files }) };
    if (/film\.en\.srt$/.test(u)) return { ok: true, text: async () => [1, 2, 3, 4, 5, 6].map((i) => `${i}\n00:00:0${i},000 --> 00:00:0${i},900\nLine ${i}\n`).join('\n') };
    return { ok: false };
  });
  assert.deepEqual(seek.subtitleFiles(files).map((f) => f.name), ['film.en.srt']);
  const r = await seek.seekOne({ id: 'Film_2', title: 'Film Two' }, dir);
  assert.equal(r.found.length, 1);
  assert.equal(r.found[0].provenance, 'human-found');
  assert.equal(r.seconds, 95.5);
  assert.match(r.mp4, /download\/Film_2\/film\.mp4$/);
  seek.__setFetch(async () => { throw new Error('offline'); });
  assert.deepEqual((await seek.seekOne({ id: 'Film_3' }, dir)).found, []); // soft-fail
  // ingest a worker result
  const work = tmp();
  fs.mkdirSync(path.join(work, 'ia', 'Film_4'), { recursive: true });
  fs.writeFileSync(path.join(work, 'ia', 'Film_4', 'en.ai-whisper.vtt'), toVtt([{ start: 0, end: 2, text: 'Hi.' }, { start: 2, end: 4, text: 'Hi.' }, { start: 5, end: 7, text: 'Welcome to the house on the hill.' }]));
  fs.writeFileSync(path.join(work, 'ia', 'Film_4', 'job.json'), JSON.stringify({ title: 'Four', model: 'faster-whisper small int8', lang: 'en' }));
  const g = seek.ingestOne('ia', 'Film_4', work, dir);
  assert.equal(g.a.provenance, 'ai-whisper');
  assert.equal(g.b.provenance, 'ai-edited');
  assert.equal(g.b.parent, 'en.ai-whisper.vtt');
  assert.equal(g.changes.repeats, 1);
  assert.equal(bestTrack(getMeta('ia', 'Film_4', dir)).provenance, 'ai-edited');
  seek.__setFetch(null);
});
