// tutorial-ui.mjs — browser controller for the alpha tutorial UI.
// Client-side only. Renders the 19-stage map from the embedded catalog (stages-data.mjs),
// keeps the newcomer's self-marked progress in localStorage, and shows a per-stage detail
// view. No network, no secrets — pure rendering over esc()'d strings.

import { STAGE_DATA } from './stages-data.mjs';
import {
  esc, readProgress, writeProgress, toggleStage, stageStatus,
  progressSummary, nextOpenStage, stageById,
} from './tutorial-logic.mjs';

const STAGES = STAGE_DATA.stages;

const STATUS_LABEL = {
  done: '✓ Done',
  open: 'Open',
  gated: 'Coming soon',
  phase3: 'With the Witness',
};

const TIER_NOTE = {
  A: 'You can do this on the testnet right now.',
  B: 'Unlocks when the matching feature ships on MELEK.',
  C: 'Opens in the conversational Phase 3 with Hathor.',
};

// Stage 0 — create the account — lives on the signup page, not in the stage catalog.
function signupCardHtml(completed) {
  const done = completed.has('_account');
  return [
    `<li class="stage ${done ? 'is-done' : 'is-open'}" data-stage="0">`,
    `<div class="srow">`,
    `<span class="snum">0</span>`,
    `<div class="sbody"><div class="slabel">Create your account</div>`,
    `<div class="sdesc">Generate your keys in your browser and claim a name on the testnet.</div></div>`,
    `<a class="sgo" href="/account/signup.html">Create account →</a>`,
    `</div></li>`,
  ].join('');
}

function stageRowHtml(stage, completed) {
  const status = stageStatus(stage, completed);
  return [
    `<li class="stage is-${esc(status)}" data-stage="${stage.id}">`,
    `<div class="srow">`,
    `<span class="snum">${stage.id}</span>`,
    `<div class="sbody">`,
    `<div class="slabel">${esc(stage.label)}</div>`,
    `<div class="sdesc">${esc(stage.description)}</div>`,
    `</div>`,
    `<span class="sbadge b-${esc(status)}">${esc(STATUS_LABEL[status])}</span>`,
    `</div></li>`,
  ].join('');
}

export function renderProgressBar(stages, completed) {
  const s = progressSummary(stages, completed);
  const next = nextOpenStage(stages, completed);
  const nextLine = next
    ? `Next up: <b>${esc(next.label)}</b>`
    : `You've completed every stage the Witness can detect on-chain. The conversation continues.`;
  return [
    `<div class="pbar"><div class="pfill" style="width:${s.corePct}%"></div></div>`,
    `<div class="pmeta"><span>${s.coreDone}/${s.core} core stages</span>`,
    `<span class="muted">${nextLine}</span></div>`,
  ].join('');
}

export function renderList(stages, completed) {
  return [
    `<ol class="stages">`,
    signupCardHtml(completed),
    ...stages.map((st) => stageRowHtml(st, completed)),
    `</ol>`,
  ].join('\n');
}

export function renderDetail(stage, completed) {
  if (!stage) return '';
  const status = stageStatus(stage, completed);
  const isDone = completed.has(stage.key);
  const gated = stage.infra_gated;
  const checkbox = gated
    ? `<p class="muted">This stage is on the roadmap — it can't be marked complete yet.</p>`
    : `<label class="markrow"><input type="checkbox" id="mark" ${isDone ? 'checked' : ''}>`
      + ` I've done this on the testnet.</label>`;
  return [
    `<div class="detail">`,
    `<button type="button" id="back" class="linkbtn">← All stages</button>`,
    `<div class="dtier t-${esc(stage.tier)}">Stage ${stage.id} · Tier ${esc(stage.tier)}`,
    ` <span class="sbadge b-${esc(status)}">${esc(STATUS_LABEL[status])}</span></div>`,
    `<h2>${esc(stage.label)}</h2>`,
    `<p>${esc(stage.description)}</p>`,
    `<p class="muted small">${esc(TIER_NOTE[stage.tier] || '')}</p>`,
    stage.id === 1
      ? `<p><a class="wiz-btn" href="/account/signup.html">Need an account first? Create one →</a></p>`
      : '',
    checkbox,
    `</div>`,
  ].join('\n');
}

// ── browser wiring (guarded so importing the module has no side effects) ──────
export function mount(doc, storage) {
  const d = doc || document;
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const listEl = d.getElementById('list');
  const barEl = d.getElementById('bar');
  const detailEl = d.getElementById('detail');
  let completed = readProgress(store);

  function paintList() {
    barEl.innerHTML = renderProgressBar(STAGES, completed);
    listEl.innerHTML = renderList(STAGES, completed);
    listEl.hidden = false;
    barEl.hidden = false;
    detailEl.hidden = true;
    for (const li of listEl.querySelectorAll('.stage[data-stage]')) {
      const id = li.getAttribute('data-stage');
      if (id === '0') continue; // stage 0 is a plain link
      li.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        openDetail(id);
      });
    }
  }

  function openDetail(id) {
    const stage = stageById(STAGES, id);
    if (!stage) return;
    detailEl.innerHTML = renderDetail(stage, completed);
    detailEl.hidden = false;
    listEl.hidden = true;
    barEl.hidden = true;
    d.getElementById('back').addEventListener('click', paintList);
    const mark = d.getElementById('mark');
    if (mark) {
      mark.addEventListener('change', (e) => {
        completed = toggleStage(completed, stage.key, e.target.checked);
        writeProgress(store, completed);
      });
    }
  }

  paintList();
}
