#!/usr/bin/env node
// run.mjs — Hathor's documentary pipeline CLI (script side; the worker renders).
//   node integrations/documentary/run.mjs prompt-test --out DIR            # variants × test topics → scores + side-by-side
//   node integrations/documentary/run.mjs script --topic havilah-kush --variant hathor --out script.json
//   node integrations/documentary/run.mjs outline --queued table-of-nations --out outline.json   # draft for approval
//   node integrations/documentary/run.mjs plan --script script.json --index index.json --out storyboard.json [--renders N]
// LLM calls go through integrations/llm-router.mjs (free-first ladder); keys come from the host's env.

import fs from 'node:fs';
import path from 'node:path';
import { TOPICS, QUEUED, factsFor, WORDS_PER_MINUTE } from './topics.mjs';
import { VARIANTS, chapterPrompt, parseScript, score } from './script.mjs';
import { planShots, sourcesOf, matchImage, renderPrompt, ALPHA_LINE, keywords } from './shots.mjs';
import { STYLES, planPrompt, parsePlan, scorePlan, factPlan } from './plan.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
let _complete = null;
async function llm(prompt, opts) {
  if (!_complete) _complete = (await import('../llm-router.mjs')).complete;
  for (let attempt = 0; attempt < 4; attempt++) { // free tiers rate-limit bursts: back off and retry
    const r = await _complete(prompt, { maxTokens: 3000, temperature: 0.4, ...opts });
    if (r && r.text) return r;
    await new Promise((res) => setTimeout(res, 8000 * (attempt + 1)));
  }
  return { text: '' };
}

export async function writeChapter({ topic, chapter, ci, variant, llmFn = llm }) {
  const facts = factsFor(topic, chapter.facts);
  const words = Math.round(chapter.minutes * WORDS_PER_MINUTE);
  const { system, prompt } = chapterPrompt({ topic, chapter, facts, words, variant, chapterIndex: ci, chapterCount: topic.outline.length });
  let r = await llmFn(prompt, { system });
  let lines = parseScript(r.text);
  const have = lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
  if (have < words * 0.75) { // too short: ask once for the rest
    const more = await llmFn(`${prompt}\n\nYou wrote this so far:\n${r.text}\n\nContinue the SAME chapter with about ${words - have} more words, same rules, no repetition.`, { system });
    lines = lines.concat(parseScript(more.text));
  }
  return { title: chapter.title, goal: chapter.goal, lines, provider: r.provider || '', model: r.model || '', score: score(lines, { targetWords: words, allowedSources: facts.map((f) => f.source) }) };
}

async function promptTest(out) {
  fs.mkdirSync(out, { recursive: true });
  const cases = [{ topic: TOPICS['havilah-kush'], ci: 0 }, { topic: TOPICS['nile-short'], ci: 0 }];
  const results = [];
  for (const [vid, v] of Object.entries(VARIANTS)) {
    for (const c of cases) {
      const ch = await writeChapter({ topic: c.topic, chapter: c.topic.outline[c.ci], ci: c.ci, variant: vid });
      results.push({ variant: vid, variantName: v.name, topic: c.topic.title, chapter: ch.title, provider: ch.provider, model: ch.model, score: ch.score, lines: ch.lines });
      console.log(`${vid.padEnd(9)} ${c.topic.title.slice(0, 30).padEnd(31)} total=${ch.score.total} words=${ch.score.words} tagCov=${ch.score.tagCoverage} cite=${ch.score.citationValidity} ease=${ch.score.readingEase} rep=${ch.score.repetition} (${ch.provider})`);
    }
  }
  const avg = {};
  for (const r of results) (avg[r.variant] ||= []).push(r.score.total);
  const ranked = Object.entries(avg).map(([v, xs]) => ({ variant: v, mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) })).sort((a, b) => b.mean - a.mean);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ at: new Date().toISOString(), ranked, results }, null, 1));
  const md = [`# Documentary prompt tests (${new Date().toISOString().slice(0, 10)})`, '', `Default chosen by score: **${ranked[0].variant}** (${VARIANTS[ranked[0].variant].name})`, '', '| variant | mean score |', '|---|---|', ...ranked.map((r) => `| ${VARIANTS[r.variant].name} | ${r.mean} |`), ''];
  for (const r of results) {
    md.push(`## ${r.variantName} — ${r.topic}`, '', `score ${r.score.total} · ${r.score.words} words · tag coverage ${r.score.tagCoverage} · valid citations ${r.score.citationValidity} · reading ease ${r.score.readingEase} · repetition ${r.score.repetition} · ${r.provider}/${r.model}`, '');
    for (const l of r.lines) md.push(`- ${l.text}${l.tag ? ` _[${l.tag}: ${l.source}]_` : ''}`);
    md.push('');
  }
  fs.writeFileSync(path.join(out, 'side-by-side.md'), md.join('\n'));
  console.log(`default: ${ranked[0].variant}`);
}

async function fullScript(topicId, variant, out) {
  const topic = TOPICS[topicId];
  const chapters = [];
  for (let ci = 0; ci < topic.outline.length; ci++) {
    const ch = await writeChapter({ topic, chapter: topic.outline[ci], ci, variant });
    chapters.push(ch);
    console.log(`chapter ${ci + 1}: ${ch.title} — ${ch.score.words} words, score ${ch.score.total} (${ch.provider})`);
  }
  fs.writeFileSync(out, JSON.stringify({ topic: topicId, title: topic.title, summary: topic.summary, variant, chapters, sources: sourcesOf(chapters) }, null, 1));
}

async function draftOutline(id, out) {
  const q = QUEUED[id];
  const chapters = Math.round(q.minutes / 5);
  const r = await llm(`Draft an outline for a ${q.minutes}-minute educational documentary titled "${q.title}" with ${chapters} chapters of about 5 minutes each.
Seed facts (tags: record / tradition):\n${q.seed.map((f) => `- [${f.tag}: ${f.source}] ${f.text}`).join('\n')}
For each chapter give: title, learning goal, and 3–6 facts to research, each tagged record / tradition / interpretation with a named source (primary text, inscription, excavation or classical author). Return JSON: {"chapters":[{"title","goal","facts":[{"tag","source","text"}]}]}. Only JSON.`, { system: 'You are a careful historian planning an educational documentary. Never invent sources.', maxTokens: 4000 });
  const m = /\{[\s\S]*\}/.exec(r.text || '');
  let parsed = null; try { parsed = JSON.parse(m ? m[0] : ''); } catch {}
  fs.writeFileSync(out, JSON.stringify({ id, title: q.title, minutes: q.minutes, status: 'DRAFT — for operator approval before any rendering', words: q.minutes * WORDS_PER_MINUTE, seed: q.seed, outline: parsed, raw: parsed ? undefined : r.text, provider: r.provider }, null, 1));
  console.log(`${id}: ${parsed && parsed.chapters ? parsed.chapters.length : 0} chapters drafted`);
}

function plan(scriptFile, indexFile, out, renderBudget) {
  const s = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
  const topic = TOPICS[s.topic];
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const { shots, renders } = planShots({ topic, chapters: s.chapters, index, people: topic.peoples, renderBudget });
  fs.writeFileSync(out, JSON.stringify({ topic: s.topic, title: s.title, summary: s.summary, sources: s.sources, chapters: s.chapters.map((c) => c.title), shots, renders }, null, 1));
  const reused = shots.filter((x) => x.image).length;
  console.log(`${shots.length} shots: ${reused} reused images, ${renders.length} new renders, ${shots.filter((x) => x.card).length} cards`);
}

// ── wordless shot plans ───────────────────────────────────────────────────────────────────────────
async function shotPlan(topic, style, minutes) {
  const facts = topic.facts;
  const { system, prompt } = planPrompt({ topic, facts, minutes, style });
  const r = await llm(prompt, { system, maxTokens: 8000, temperature: 0.5 });
  const scenes = parsePlan(r.text);
  return { scenes, provider: r.provider || '', model: r.model || '', score: scorePlan(scenes, { minutes, allowedSources: facts.map((f) => f.source) }) };
}

async function planTest(out) {
  fs.mkdirSync(out, { recursive: true });
  const results = [];
  for (const [sid, st] of Object.entries(STYLES)) {
    for (const tid of ['kush-nile', 'havilah-kush']) {
      const p = await shotPlan(TOPICS[tid], sid, 3); // 3-minute test plans keep the calls small
      results.push({ style: sid, styleName: st.name, topic: TOPICS[tid].title, ...p });
      console.log(`${sid.padEnd(9)} ${TOPICS[tid].title.slice(0, 26).padEnd(27)} total=${p.score.total} scenes=${p.score.scenes} secs=${p.score.seconds} cards=${p.score.cards} sourced=${p.score.cardSourcing} mythHedged=${p.score.mythHedged} sparsity=${p.score.sparsity} variety=${p.score.variety} q=${p.score.questions} (${p.provider})`);
    }
  }
  const avg = {};
  for (const r of results) (avg[r.style] ||= []).push(r.score.total);
  const ranked = Object.entries(avg).map(([v, xs]) => ({ style: v, mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) })).sort((a, b) => b.mean - a.mean);
  fs.writeFileSync(path.join(out, 'plan-results.json'), JSON.stringify({ at: new Date().toISOString(), ranked, results }, null, 1));
  const md = [`# Wordless shot-plan prompt tests (${new Date().toISOString().slice(0, 10)})`, '', `Default chosen by score: **${ranked[0].style}** (${STYLES[ranked[0].style].name})`, '', '| style | mean score |', '|---|---|', ...ranked.map((r) => `| ${STYLES[r.style].name} | ${r.mean} |`), ''];
  for (const r of results) {
    md.push(`## ${r.styleName} — ${r.topic}`, '', '```', JSON.stringify(r.score), '```', '');
    for (const sc of r.scenes) md.push(`- [${sc.sequence}] (${sc.camera}, ${sc.seconds}s) ${sc.visual}${sc.card ? ` — **card:** "${sc.card}"${sc.kind !== 'none' ? ` _[${sc.kind}: ${sc.source}]_` : ''}` : ''}`);
    md.push('');
  }
  fs.writeFileSync(path.join(out, 'plan-side-by-side.md'), md.join('\n'));
  console.log(`default style: ${ranked[0].style}`);
}

async function fullPlan(topicId, style, minutes, out) {
  const topic = TOPICS[topicId];
  // per sequence, so long films stay within model output limits
  const scenes = [];
  for (let i = 0; i < topic.outline.length; i++) {
    const seq = topic.outline[i];
    const sub = { ...topic, title: `${topic.title} — sequence ${i + 1}: ${seq.title}`, outline: [seq] };
    const facts = topic.facts.filter((f) => seq.facts.includes(f.id));
    const { system, prompt } = planPrompt({ topic: sub, facts, minutes: seq.minutes * (minutes / topic.outline.reduce((n, c) => n + c.minutes, 0)), style });
    const r = await llm(prompt, { system, maxTokens: 6000, temperature: 0.5 });
    let got = parsePlan(r.text).map((x) => ({ ...x, sequence: i + 1 }));
    const byId = new Map(topic.facts.map((f) => [f.id, f]));
    if (got.length < 4) got = factPlan({ ...topic, outline: [seq] }, byId).map((x) => ({ ...x, sequence: i + 1 })); // LLM failed → grounded fallback
    got.unshift({ sequence: i + 1, visual: facts[0] ? (facts[0].visual || facts[0].text) : seq.title, camera: 'pull_out', seconds: 7, card: seq.card || seq.title, kind: 'none', source: '', place: true });
    scenes.push(...got);
    console.log(`sequence ${i + 1} ${seq.title}: ${got.length} scenes (${r.provider || 'fallback'})`);
  }
  const score = scorePlan(scenes, { minutes, allowedSources: topic.facts.map((f) => f.source) });
  fs.writeFileSync(out, JSON.stringify({ topic: topicId, title: topic.title, summary: topic.summary, style, minutes, sequences: topic.outline.map((c) => c.title), scenes, score, alpha: ALPHA_LINE }, null, 1));
  console.log(`plan: ${scenes.length} scenes, ${score.seconds}s, score ${score.total}`);
}

/** plan + assets index → board for the wordless renderer. First wave is REUSE-ONLY (renderBudget 0): every scene is
 *  built from parts we already have; scenes nothing fits go to the film's MISSING list (the next render queue). */
export function buildBoard(p, index, { renderBudget = 0 } = {}) {
  const topic = TOPICS[p.topic] || { peoples: '' };
  const recent = []; const renders = []; const shots = []; const missing = []; const credits = new Set();
  const byPath = new Map(index.map((x) => [x.path, x]));
  // open on an animated map when one covers the topic (fork L's clips; CC BY credit travels with it)
  const maps = index.filter((x) => x.type === 'map');
  const opener = maps.length ? matchImage(`${p.title} ${(p.sequences || []).join(' ')}`, maps, {}) : null;
  if (opener) { shots.push({ sequence: 1, visual: opener.text, camera: 'still', seconds: Math.min(14, opener.seconds || 10), card: '', kind: 'none', source: '', image: opener.path, asset: opener.id }); credits.add(opener.credit || 'Cliopatria (CC BY 4.0)'); }
  const facts = (topic.facts || []);
  const sceneKey = (x) => String(x.id || '').split(':').slice(0, 2).join(':');
  const recentKeys = []; const useCount = new Map();
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const sc0 of p.scenes) {
    const sc = { ...sc0 };
    // a factual card's KIND comes from the fact sheet, never from the model: if the source matches a fact whose tag
    // differs, correct the kind and use the fact's own card wording
    if (sc.card && sc.source) {
      const f = facts.find((x) => norm(x.source) && (norm(sc.source).includes(norm(x.source)) || norm(x.source).includes(norm(sc.source))));
      if (f && sc.kind !== f.tag) { sc.kind = f.tag; if (f.card) sc.card = f.card; sc.corrected = true; }
      if (f) sc.source = f.source; // the fact sheet's source name, never the model's paraphrase
      if (!f) { sc.kind = 'none'; sc.source = ''; } // unsourced claim: keep the words only if they carry no claim label
    }
    const topicWords = keywords(`${p.title} ${(p.sequences || [])[sc.sequence - 1] || ''}`);
    const q = `${sc.visual} ${sc.card || ''}`;
    // variety: no scene (in any look/people) again within the last 12 shots, and no scene more than 4 times per film
    const pool = index.filter((x) => { const k = sceneKey(x); return !recentKeys.includes(k) && (useCount.get(k) || 0) < 4; });
    let im = matchImage(q, pool, { people: topic.peoples, recent, chapterWords: topicWords });
    let render = null;
    if (!im) {
      if (renders.length < renderBudget) { renders.push({ prompt: renderPrompt(sc.visual, { people: topic.peoples }) }); render = renders.length - 1; }
      else {
        missing.push({ sequence: sc.sequence, visual: sc.visual });
        im = matchImage(`${(p.sequences || [])[sc.sequence - 1] || ''} ${sc.visual}`, pool, { people: topic.peoples, recent: recent.slice(-3), chapterWords: topicWords })
          || matchImage(p.title, pool, { people: topic.peoples, recent: recent.slice(-3) });
      }
    }
    if (im) {
      recent.push(im.path); if (recent.length > 10) recent.shift();
      const k = sceneKey(im); recentKeys.push(k); if (recentKeys.length > 12) recentKeys.shift(); useCount.set(k, (useCount.get(k) || 0) + 1);
      if (im.credit && (im.type === 'map')) credits.add(im.credit);
    }
    shots.push({ ...sc, image: im ? im.path : '', asset: im ? im.id : '', render, assetType: im ? im.type : '' });
  }
  const sources = { record: new Set(), tradition: new Set(), interpretation: new Set() };
  for (const sc of shots) if (sc.kind !== 'none' && sc.source && sources[sc.kind]) sources[sc.kind].add(sc.source);
  return { ...p, id: p.topic, shots, renders, missing, credits: [...credits], sources: { record: [...sources.record], tradition: [...sources.tradition], interpretation: [...sources.interpretation] }, byPathUnused: undefined };
}

function board(planFile, indexFile, out, renderBudget) {
  const p = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const b = buildBoard(p, index, { renderBudget });
  fs.writeFileSync(out, JSON.stringify(b, null, 1));
  const types = {}; for (const s of b.shots) types[s.assetType || 'none'] = (types[s.assetType || 'none'] || 0) + 1;
  console.log(`${b.shots.length} shots ${JSON.stringify(types)}; ${b.renders.length} renders; ${b.missing.length} missing`);
}

if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  const cmd = process.argv[2];
  if (cmd === 'prompt-test') await promptTest(arg('--out', '.local/documentary/prompt-tests'));
  else if (cmd === 'script') await fullScript(arg('--topic', 'havilah-kush'), arg('--variant', 'hathor'), arg('--out', 'script.json'));
  else if (cmd === 'outline') await draftOutline(arg('--queued', 'table-of-nations'), arg('--out', 'outline.json'));
  else if (cmd === 'plan-test') await planTest(arg('--out', '.local/documentary/prompt-tests'));
  else if (cmd === 'shotplan') await fullPlan(arg('--topic', 'kush-nile'), arg('--style', 'wonder'), +arg('--minutes', '10'), arg('--out', 'plan.json'));
  else if (cmd === 'board') board(arg('--plan'), arg('--index'), arg('--out', 'board.json'), +arg('--renders', '0'));
  else if (cmd === 'plan') plan(arg('--script'), arg('--index'), arg('--out', 'storyboard.json'), +arg('--renders', '8'));
  else { console.error('usage: run.mjs prompt-test|script|outline|plan …'); process.exit(2); }
}
