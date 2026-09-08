// site/hathor-live/reports.mjs — hathor.live/reports: the experience-report archive.
//
// THE MODEL. Erowid did one thing better than anyone: it took reports from people who were going to
// proceed regardless, and archived them without moralising. That is harm reduction — the information
// exists because withholding it from someone already committed is the harm. CLAUDE.md § Scope settles
// this for the whole corpus ("aiming past DMT-Nexus/Erowid", preparation and dose detail IN scope).
//
// WHAT IS NEW HERE. Nobody has built that archive for BIOHACKING. There is no Erowid for a tDCS
// montage, an entrainment session, a TENS placement, or a nootropic stack — so the same person who
// can find a hundred structured ayahuasca reports finds nothing at all for 2 mA over F3/F4. This
// archive covers both, under one standard, because they are one subject: things people do to their
// own nervous systems, reported honestly.
//
// DESIGN RULES (each is load-bearing, do not "simplify" one away):
//   1. NO PERSONAL INFORMATION. BRIEF.md §6 puts personal-info intake out of scope and §7 governs
//      custody. There is no name field, no email field, no account. A handle is optional and free-text.
//      validate() REJECTS a report whose text carries an email address or a phone number, rather than
//      storing it and hoping. See stripContact()/hasContact().
//   2. NULL AND NEGATIVE REPORTS ARE FIRST-CLASS. "I ran it for six weeks and nothing happened" is the
//      report the literature never gets and the one that actually moves an evidence grade. `outcome`
//      is a required field and "nothing" is a valid answer, ranked equal in the UI.
//   3. MODERATION BEFORE PUBLICATION. Reports land as `pending`. Nothing a stranger typed appears on
//      a public page until a human passes it. This is an Erowid practice and a safety practice.
//   4. NOT MEDICAL ADVICE, AND NOT A DARE. A report is what happened to one person once. The page
//      says so, and adverse-event reports are surfaced MORE prominently than good ones, not less.
//
// House style: pure + offline. This module holds no I/O of its own — the caller injects a store.
// handler wiring lives in server.mjs. esc() everything. Soft-fail, never throw.

import { esc } from '../../integrations/melek-theme.mjs';

export { esc };

// --- taxonomy ---------------------------------------------------------------

// One archive, two families. The split is presentational; the reporting standard is identical.
export const FAMILIES = Object.freeze({
  biohacking: 'Biohacking',
  plant: 'Plant medicine',
});

export const CATEGORIES = Object.freeze([
  // --- biohacking ---
  { id: 'entrainment', family: 'biohacking', label: 'Entrainment session',
    hint: 'A 40Hz / binaural / isochronic / flicker session. Say which delivery method and which device or page.' },
  { id: 'tdcs', family: 'biohacking', label: 'tDCS',
    hint: 'Montage (e.g. anode F3, cathode Fp2), current in mA, electrode area in cm², minutes, device.' },
  { id: 'tens', family: 'biohacking', label: 'TENS / PENS',
    hint: 'Placement, frequency, pulse width, intensity, minutes, device.' },
  { id: 'nootropic', family: 'biohacking', label: 'Nootropic / stack',
    hint: 'Every compound and dose, including the ones you think are inert. Stacks fail on the missing cofactor.' },
  { id: 'supplement', family: 'biohacking', label: 'Supplement / micronutrient',
    hint: 'Compound, FORM (this decides everything — folate and L-methylfolate are not the same molecule, nor are iron sulphate and iron chelate), dose, duration.' },
  { id: 'light', family: 'biohacking', label: 'Light / colour',
    hint: 'Wavelength or colour, lux if you know it, time of day, duration.' },
  { id: 'topical', family: 'biohacking', label: 'Topical / transdermal',
    hint: 'The "foliar feeding" lane — soap, lotion, salve, oil, beeswax, patch. Carrier, what was in it, how much, where on the body, contact time.' },
  { id: 'scent', family: 'biohacking', label: 'Scent / fumigation',
    hint: 'Material, delivery (diffused, burned, worn), and whether it was paired with anything.' },
  { id: 'sleep', family: 'biohacking', label: 'Sleep / dream work',
    hint: 'Dream stacks included. Every compound and dose, timing relative to sleep onset, and what you used to tell whether it worked.' },
  { id: 'device', family: 'biohacking', label: 'Other device',
    hint: 'Name the device and its actual settings, not its marketing mode names.' },
  // --- plant medicine ---
  { id: 'ayahuasca', family: 'plant', label: 'Ayahuasca',
    hint: 'Both halves: the MAOI-bearing plant and the DMT-bearing plant, each by name, with amounts and prep.' },
  { id: 'pharmahuasca', family: 'plant', label: 'Pharmahuasca / oilahuasca',
    hint: 'The inhibitor and the substrate, each by name and dose, and the interval between them.' },
  { id: 'herb', family: 'plant', label: 'Herb / dream herb',
    hint: 'Species (Latin name if you have it), preparation, amount, route.' },
  { id: 'plant_other', family: 'plant', label: 'Other plant medicine',
    hint: 'Material, preparation, amount, route, and anything taken alongside it.' },
]);

export const CATEGORY_IDS = Object.freeze(CATEGORIES.map((c) => c.id));

// The outcome axis. `nothing` sits in the middle deliberately — it is not a failure to report.
export const OUTCOMES = Object.freeze([
  { id: 'strong', label: 'Clear effect' },
  { id: 'mild', label: 'Mild or ambiguous effect' },
  { id: 'nothing', label: 'Nothing happened' },
  { id: 'worse', label: 'Made things worse' },
  { id: 'adverse', label: 'Adverse event' },
]);

export const OUTCOME_IDS = Object.freeze(OUTCOMES.map((o) => o.id));

// Reports we want MORE of, and say so on the page. These are the ones nobody posts.
export const UNDER_REPORTED = Object.freeze(['nothing', 'worse', 'adverse']);

export const STATUSES = Object.freeze(['pending', 'published', 'rejected']);

// --- limits -----------------------------------------------------------------

export const LIMITS = Object.freeze({
  handle: 40,
  protocol: 2000,
  outcomeText: 8000,
  timeline: 4000,
  adverse: 4000,
  notes: 2000,
  maxTotal: 20000,
});

// --- validation -------------------------------------------------------------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// Deliberately loose: it is better to bounce a report that merely looks like it carries a phone
// number and tell the person why, than to publish one that does.
const PHONE_RE = /(?:\+?\d[\d\s().-]{8,}\d)/;

export function hasContact(s) {
  const t = String(s == null ? '' : s);
  return EMAIL_RE.test(t) || PHONE_RE.test(t);
}

function clean(s, max) {
  // Normalise newlines, then strip control characters. Written as an explicit escaped range: an
  // earlier version carried a raw NUL byte in the source, which only matched NUL and is invisible
  // to anyone reading the file.
  return String(s == null ? '' : s)
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

/**
 * Validate and normalise a submitted report.
 * Returns { ok, errors: string[], report: object|null }. Never throws.
 *
 * Errors are written to be shown to the person who submitted, so they say what to do, not what
 * rule was violated.
 */
export function validateReport(input, { now = () => new Date() } = {}) {
  const errors = [];
  const src = (input && typeof input === 'object') ? input : {};

  const category = clean(src.category, 40);
  const cat = categoryById(category);
  if (!cat) errors.push('Choose what the report is about.');

  const outcome = clean(src.outcome, 20);
  if (!OUTCOME_IDS.includes(outcome)) errors.push('Choose what the outcome was — "Nothing happened" counts.');

  const protocol = clean(src.protocol, LIMITS.protocol);
  if (protocol.length < 20) {
    errors.push('Say what you actually did, with the numbers. A report without the dose or the settings cannot help anyone.');
  }

  const outcomeText = clean(src.outcomeText, LIMITS.outcomeText);
  if (outcomeText.length < 20) errors.push('Say what happened, including if the answer is nothing.');

  const handle = clean(src.handle, LIMITS.handle);
  const timeline = clean(src.timeline, LIMITS.timeline);
  const adverse = clean(src.adverse, LIMITS.adverse);
  const notes = clean(src.notes, LIMITS.notes);

  // Rule 1: no personal information reaches the store at all.
  for (const [field, value] of [['protocol', protocol], ['outcomeText', outcomeText],
    ['timeline', timeline], ['adverse', adverse], ['notes', notes], ['handle', handle]]) {
    if (hasContact(value)) {
      errors.push('Remove the email address or phone number — this archive never stores contact details, and a report carrying one cannot be accepted.');
      break;
    }
    void field;
  }

  const total = protocol.length + outcomeText.length + timeline.length + adverse.length + notes.length;
  if (total > LIMITS.maxTotal) errors.push('The report is too long. Trim it to the protocol and what happened.');

  // An adverse outcome without any description of it is the one combination worth blocking, because
  // the adverse detail is the entire reason that report is more valuable than the others.
  if ((outcome === 'adverse' || outcome === 'worse') && adverse.length < 10 && outcomeText.length < 100) {
    errors.push('Describe what went wrong. An adverse report is the most useful kind here and it needs the detail.');
  }

  if (errors.length) return { ok: false, errors, report: null };

  const ts = now();
  return {
    ok: true,
    errors: [],
    report: {
      id: reportId(ts),
      category,
      family: cat.family,
      outcome,
      handle: handle || 'anonymous',
      protocol,
      outcomeText,
      timeline,
      adverse,
      notes,
      status: 'pending',
      submitted: ts.toISOString(),
    },
  };
}

let _seq = 0;
export function reportId(d = new Date()) {
  const t = (d instanceof Date && !Number.isNaN(d.getTime())) ? d : new Date(0);
  _seq = (_seq + 1) % 1e6;
  return `r${t.toISOString().slice(0, 10).replace(/-/g, '')}-${t.getTime().toString(36)}-${_seq.toString(36)}`;
}

export function __resetSeq() { _seq = 0; }

// --- public projection ------------------------------------------------------

/** Only published reports, and only the fields safe to render. */
export function publicReports(all = []) {
  return (Array.isArray(all) ? all : [])
    .filter((r) => r && r.status === 'published')
    .map((r) => ({
      id: r.id, category: r.category, family: r.family, outcome: r.outcome,
      handle: r.handle || 'anonymous', protocol: r.protocol, outcomeText: r.outcomeText,
      timeline: r.timeline || '', adverse: r.adverse || '', notes: r.notes || '',
      submitted: r.submitted,
    }))
    .sort((a, b) => String(b.submitted).localeCompare(String(a.submitted)));
}

/** Counts per category and per outcome, for the archive header. */
export function reportStats(all = []) {
  const pub = publicReports(all);
  const byCategory = {}; const byOutcome = {};
  for (const id of CATEGORY_IDS) byCategory[id] = 0;
  for (const id of OUTCOME_IDS) byOutcome[id] = 0;
  for (const r of pub) {
    if (r.category in byCategory) byCategory[r.category] += 1;
    if (r.outcome in byOutcome) byOutcome[r.outcome] += 1;
  }
  return { total: pub.length, byCategory, byOutcome };
}

// --- page -------------------------------------------------------------------

const OUTCOME_CLASS = {
  strong: 'oc-strong', mild: 'oc-mild', nothing: 'oc-nothing',
  worse: 'oc-worse', adverse: 'oc-adverse',
};

function optionList(items, valueKey, labelKey) {
  return items.map((i) => `<option value="${esc(i[valueKey])}">${esc(i[labelKey])}</option>`).join('');
}

function renderOne(r) {
  const cat = categoryById(r.category);
  const outcome = OUTCOMES.find((o) => o.id === r.outcome);
  const flagged = UNDER_REPORTED.includes(r.outcome);
  return `<article class="rep ${esc(OUTCOME_CLASS[r.outcome] || '')}${flagged ? ' rep-flagged' : ''}">
  <header class="rep-h">
    <span class="rep-cat">${esc(cat ? cat.label : r.category)}</span>
    <span class="rep-out">${esc(outcome ? outcome.label : r.outcome)}</span>
    <span class="rep-by">${esc(r.handle)}</span>
    <time datetime="${esc(r.submitted)}">${esc(String(r.submitted).slice(0, 10))}</time>
  </header>
  <h4>What was done</h4><p>${esc(r.protocol)}</p>
  <h4>What happened</h4><p>${esc(r.outcomeText)}</p>
  ${r.timeline ? `<h4>Timeline</h4><p>${esc(r.timeline)}</p>` : ''}
  ${r.adverse ? `<h4 class="rep-adv">Adverse effects</h4><p>${esc(r.adverse)}</p>` : ''}
  ${r.notes ? `<h4>Notes</h4><p>${esc(r.notes)}</p>` : ''}
</article>`;
}

/**
 * The /reports page. Pure: give it the reports, get HTML.
 * `themeCSS` is injected so this module stays testable without the theme module's context enum.
 */
export function REPORTS_PAGE(reports = [], { baseUrl = 'https://hathor.live', themeCSS = '' } = {}) {
  const pub = publicReports(reports);
  const stats = reportStats(reports);
  const bio = CATEGORIES.filter((c) => c.family === 'biohacking');
  const plant = CATEGORIES.filter((c) => c.family === 'plant');

  const hints = CATEGORIES.map((c) => `${JSON.stringify(c.id)}:${JSON.stringify(c.hint)}`).join(',');

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Report — hathor.live</title>
<meta name="description" content="An experience-report archive for biohacking and plant medicine. Structured reports, null results welcome, nothing moralised.">
<style>${themeCSS}
*{box-sizing:border-box}body{margin:0;background:var(--bg,#0b0b0f);color:var(--fg,#e8e6e3);
font:16px/1.65 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:940px;margin:0 auto;padding:2rem 1.1rem 5rem}
h1{font-size:clamp(1.7rem,4.4vw,2.6rem);line-height:1.15;margin:.2em 0 .3em}
h2{font-size:1.35rem;margin:2.4rem 0 .7rem;border-bottom:1px solid var(--line,#2a2a33);padding-bottom:.35rem}
h4{font-size:.78rem;letter-spacing:.09em;text-transform:uppercase;opacity:.62;margin:1rem 0 .25rem}
a{color:var(--accent,#c9a227)}
.lede{font-size:1.08rem;opacity:.92}
.note{border-left:3px solid var(--accent,#c9a227);padding:.7rem 0 .7rem 1rem;margin:1.4rem 0;opacity:.93}
.warn{border-left-color:#c2554d}
form{margin:1.2rem 0 0}
label{display:block;margin:1.1rem 0 .3rem;font-weight:600;font-size:.95rem}
.sub{font-weight:400;opacity:.6;font-size:.85rem;display:block;margin-top:.15rem}
input,select,textarea{width:100%;padding:.6rem .7rem;background:var(--bg2,#15151c);color:inherit;
border:1px solid var(--line,#2a2a33);border-radius:6px;font:inherit}
textarea{min-height:7rem;resize:vertical}
button{margin-top:1.6rem;padding:.75rem 1.5rem;background:var(--accent,#c9a227);color:#0b0b0f;
border:0;border-radius:6px;font:600 1rem/1 inherit;cursor:pointer}
button:hover{filter:brightness(1.1)}
.stats{display:flex;flex-wrap:wrap;gap:.5rem;margin:1rem 0}
.chip{border:1px solid var(--line,#2a2a33);border-radius:999px;padding:.25rem .8rem;font-size:.85rem;opacity:.85}
.rep{border:1px solid var(--line,#2a2a33);border-radius:9px;padding:1rem 1.15rem;margin:1rem 0;background:var(--bg2,#15151c)}
.rep-flagged{border-color:#8a5f3d}
.rep-h{display:flex;flex-wrap:wrap;gap:.55rem;align-items:baseline;font-size:.85rem;opacity:.8;
border-bottom:1px solid var(--line,#2a2a33);padding-bottom:.5rem;margin-bottom:.3rem}
.rep-cat{font-weight:700;opacity:1}
.rep-out{border:1px solid currentColor;border-radius:999px;padding:.05rem .55rem;font-size:.78rem}
.oc-adverse .rep-out,.oc-worse .rep-out{color:#e0796f}
.oc-nothing .rep-out{color:#9aa0a6}
.oc-strong .rep-out{color:#7fc08a}
.rep-by{opacity:.6}.rep-h time{margin-left:auto;opacity:.55}
.rep-adv{color:#e0796f;opacity:1}
.rep p{margin:.15rem 0 .5rem;white-space:pre-wrap}
.empty{opacity:.65;font-style:italic;padding:1.4rem 0}
#msg{margin-top:1rem;padding:.8rem 1rem;border-radius:6px;display:none}
#msg.ok{display:block;background:#1d3324;border:1px solid #3c6b48}
#msg.err{display:block;background:#33201d;border:1px solid #6b3c3c}
#msg ul{margin:.4rem 0 0;padding-left:1.2rem}
footer{margin-top:3.5rem;padding-top:1.2rem;border-top:1px solid var(--line,#2a2a33);font-size:.9rem;opacity:.75}
</style></head><body><div class="wrap">

<p><a href="${esc(baseUrl)}/">&larr; hathor.live</a> &middot; <a href="${esc(baseUrl)}/40hz">the 40Hz library</a></p>

<h1>Report what actually happened</h1>

<p class="lede" style="font-size:15px"><a href="/exams">Temple Exams</a> sit next door: instruments for
your own perception, with the same posture as this archive — no name, no email, no account, and no
score that buys anything.</p>

<p class="lede">This is an experience-report archive for <strong>biohacking</strong> and <strong>plant medicine</strong>.
Erowid proved the model for one half of that subject: take reports from people who were going to proceed
anyway, structure them, archive them, and do not moralise. Nobody has built the same thing for the other
half. There are a hundred structured ayahuasca reports available to anyone who looks, and effectively
nothing for 2&nbsp;mA across F3/F4, a six-week methylfolate trial, or a 40&nbsp;Hz session run every day for a month.</p>

<p>So this archive takes both, under one standard. They are one subject — things people do to their own
nervous systems — and they deserve one honest record.</p>

<div class="note">
<strong>The reports we most need are the boring ones.</strong> "I ran it for six weeks and nothing happened"
is the report almost nobody posts and the one that actually moves an evidence grade. Null results, things
that made it worse, and adverse events are ranked here <em>equal to or above</em> the good outcomes, and
they are marked so they are easy to find. If you only publish what worked, you have built marketing.
</div>

<div class="note warn">
<strong>A report is what happened to one person once.</strong> It is not a protocol, not a recommendation
and not medical advice. Nothing here has been verified by us beyond checking that it is a real report.
Read the adverse ones first.
</div>

<h2>Submit a report</h2>

<p>No account, no name, no email. There is no contact field on this form and a report containing an email
address or a phone number will be refused rather than stored — that is a deliberate boundary, not an
oversight. Reports are reviewed by a person before they appear.</p>

<form id="f" autocomplete="off">
  <label>What is this about?
    <select name="category" id="cat" required>
      <option value="">Choose…</option>
      <optgroup label="Biohacking">${optionList(bio, 'id', 'label')}</optgroup>
      <optgroup label="Plant medicine">${optionList(plant, 'id', 'label')}</optgroup>
    </select>
  </label>

  <label>What did you actually do?
    <span class="sub" id="hint">The numbers matter more than the narrative. Dose, settings, duration, device.</span>
    <textarea name="protocol" required maxlength="${LIMITS.protocol}"></textarea>
  </label>

  <label>What was the outcome?
    <select name="outcome" required>
      <option value="">Choose…</option>
      ${optionList(OUTCOMES, 'id', 'label')}
    </select>
  </label>

  <label>What happened?
    <span class="sub">Including if the answer is nothing. Say how you could tell — what you compared it against.</span>
    <textarea name="outcomeText" required maxlength="${LIMITS.outcomeText}"></textarea>
  </label>

  <label>Timeline <span class="sub">Optional. When things started and stopped, relative to when you began.</span>
    <textarea name="timeline" maxlength="${LIMITS.timeline}"></textarea>
  </label>

  <label>Adverse effects <span class="sub">Optional, and the most valuable box on this page. Anything unpleasant, unexpected, or still ongoing.</span>
    <textarea name="adverse" maxlength="${LIMITS.adverse}"></textarea>
  </label>

  <label>Anything else <span class="sub">Optional. What you would do differently, what you think confounded it.</span>
    <textarea name="notes" maxlength="${LIMITS.notes}"></textarea>
  </label>

  <label>Handle <span class="sub">Optional. Anything you like. Leave it blank to be anonymous.</span>
    <input name="handle" maxlength="${LIMITS.handle}" placeholder="anonymous">
  </label>

  <button type="submit">Submit report</button>
  <div id="msg" role="status" aria-live="polite"></div>
</form>

<h2>The archive <span style="font-weight:400;opacity:.6;font-size:1rem">${stats.total} published</span></h2>

<div class="stats">${OUTCOMES.map((o) =>
  `<span class="chip">${esc(o.label)}: ${stats.byOutcome[o.id] || 0}</span>`).join('')}</div>

${pub.length
    ? pub.map(renderOne).join('\n')
    : `<p class="empty">No published reports yet. This archive starts empty and stays honest about it — the counter above is the real number, not a seeded one.</p>`}

<footer>
Van Kush Family Research Institute &middot; Church of Neuroscience &middot;
<a href="${esc(baseUrl)}/40hz">the entrainment library</a> &middot;
<a href="https://github.com/HinduTempleCoins">the source and the corpus</a>
</footer>
</div>
<script>
(function(){
  var HINTS = {${hints}};
  var cat = document.getElementById('cat'), hint = document.getElementById('hint');
  var base = hint.textContent;
  cat.addEventListener('change', function(){ hint.textContent = HINTS[cat.value] || base; });

  document.getElementById('f').addEventListener('submit', function(e){
    e.preventDefault();
    var msg = document.getElementById('msg');
    var data = {};
    new FormData(e.target).forEach(function(v,k){ data[k] = v; });
    msg.className = ''; msg.textContent = 'Sending…'; msg.className = 'ok';
    fetch('/api/reports', {
      method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(data)
    }).then(function(r){ return r.json().catch(function(){ return {ok:false,errors:['Server error.']}; }); })
      .then(function(d){
        if (d && d.ok) {
          msg.className = 'ok';
          msg.textContent = 'Received. It goes to a person for review before it appears in the archive. Thank you — especially if it was a null or adverse report.';
          e.target.reset();
          hint.textContent = base;
        } else {
          msg.className = 'err';
          var errs = (d && d.errors) || ['Something went wrong.'];
          msg.textContent = 'Not submitted:';
          var ul = document.createElement('ul');
          errs.forEach(function(x){ var li = document.createElement('li'); li.textContent = x; ul.appendChild(li); });
          msg.appendChild(ul);
        }
      }).catch(function(){
        msg.className = 'err';
        msg.textContent = 'Could not reach the server. Nothing was sent.';
      });
  });
})();
</script>
</body></html>`;
}
