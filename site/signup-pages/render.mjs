// render.mjs — the MELEK account-registration page renderer. Pure functions (opts in → HTML out),
// staged here in the Bot repo for a later PR into the melek-condenser repo. Modeled on the Blurt
// signup flow (signup.blurtwallet.com, blurtplugin.online/account/register) but rebranded for MELEK
// and rewritten in PLAIN language — no Graphene/crypto jargon on the page.
//
// KEY CUSTODY (BRIEF.md §7, HARD RULE): the four keys shown on this page are GENERATED IN THE
// BROWSER and shown to the user for backup. They are never sent to any server. This renderer only
// lays out PLACEHOLDER strings — it neither generates nor receives real key material. Callers pass
// display strings (or leave them blank, in which case the page shows a "generating…" placeholder).
//
// House style: ESM, esc() every interpolation, soft-fail-never-throw (bad opts → safe defaults),
// CLI guarded by process.argv[1].
//
//   import { renderRegisterPage } from './render.mjs'
//   node site/signup-pages/render.mjs   # prints the page (placeholders only) to stdout

export const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The four keys a Graphene account has. Plain-language descriptions only — the page never says
// "Graphene", "WIF", or "posting authority". Order matters: owner first (most important to keep).
export const KEYS = Object.freeze([
  { id: 'owner', label: 'Master key', help: 'The big one. It can do everything, including recover your account. Keep it offline, never paste it into a website.' },
  { id: 'active', label: 'Wallet key', help: 'Used to move funds and change settings. Keep it safe; only enter it when you mean to send or update something.' },
  { id: 'posting', label: 'Posting key', help: 'Used for everyday things: posting, commenting, voting. The one you will use most.' },
  { id: 'memo', label: 'Message key', help: 'Used to read and write private messages attached to transfers.' },
]);

const DEFAULTS = Object.freeze({
  brand: 'MELEK',
  tagline: 'Create your account on the MELEK chain',
  username: '',
  // postUrl is where the form submits the username + the user's PUBLIC keys (never private keys).
  // Left as a relative placeholder so the condenser wires its real route at PR time.
  postUrl: '/account/register',
  // keys: { owner, active, posting, memo } display strings. Blank → "generating…" placeholder.
  keys: {},
  // referrer / token are opaque pass-through fields the condenser may need; rendered as hidden
  // inputs only when present. Never secrets — just routing.
  referrer: '',
  token: '',
});

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--warn:#f85149}
  *{box-sizing:border-box} body{font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.top{background:var(--panel);border-bottom:1px solid var(--line);padding:14px 22px;display:flex;gap:14px;align-items:center}
  .brand{font-weight:800;font-size:20px;letter-spacing:.5px} .brand span{color:var(--gold)}
  .wrap{max-width:620px;margin:0 auto;padding:30px 20px}
  h1{font-size:26px;margin:0 0 4px} .sub{color:var(--mut);margin:0 0 24px}
  label.fld{display:block;font-weight:600;margin:0 0 6px}
  input.text{width:100%;background:#0b0f14;border:1px solid var(--line);border-radius:8px;color:var(--fg);padding:11px 13px;font-size:16px}
  .hint{color:var(--mut);font-size:13px;margin:6px 0 20px}
  .keys{margin:8px 0 20px}
  .keyrow{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:13px 15px;margin:10px 0}
  .keyrow .kl{font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:10px}
  .keyrow .kh{color:var(--mut);font-size:13px;margin:4px 0 8px}
  .keyrow code{display:block;background:#0b0f14;border:1px solid var(--line);border-radius:6px;padding:9px 11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;word-break:break-all;color:var(--up)}
  .keyrow code.empty{color:var(--mut)}
  .warn{background:#f8514922;border:1px solid #f8514955;border-radius:8px;padding:14px 16px;margin:18px 0;font-size:14px}
  .warn b{color:var(--warn)}
  .btn{display:block;width:100%;background:var(--gold);color:#0d1117;font-weight:800;font-size:17px;border:0;border-radius:8px;padding:14px;cursor:pointer;margin-top:8px}
  .btn:hover{filter:brightness(1.08)}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 20px;border-top:1px solid var(--line);margin-top:30px}
</style>`;

// renderRegisterPage(opts) → full standalone HTML string. Pure. Never throws.
export function renderRegisterPage(opts = {}) {
  let o;
  try {
    o = { ...DEFAULTS, ...(opts && typeof opts === 'object' ? opts : {}) };
  } catch {
    o = { ...DEFAULTS };
  }
  const brand = esc(o.brand || DEFAULTS.brand);
  const tagline = esc(o.tagline || DEFAULTS.tagline);
  const username = esc(o.username || '');
  const postUrl = esc(o.postUrl || DEFAULTS.postUrl);
  const keys = o.keys && typeof o.keys === 'object' ? o.keys : {};

  const keyRows = KEYS.map((k) => {
    const val = keys[k.id];
    const has = val != null && String(val).trim() !== '';
    const display = has ? esc(val) : 'generating in your browser…';
    return `<div class=keyrow>
      <div class=kl><span>${esc(k.label)}</span><span class=hint style="margin:0">backup this</span></div>
      <div class=kh>${esc(k.help)}</div>
      <code class="${has ? '' : 'empty'}">${display}</code>
    </div>`;
  }).join('\n');

  const hidden = [
    o.referrer ? `<input type=hidden name=referrer value="${esc(o.referrer)}">` : '',
    o.token ? `<input type=hidden name=token value="${esc(o.token)}">` : '',
  ].join('');

  const body = `<h1>${tagline}</h1>
<p class=sub>Pick a name, save your keys, and you are in. It takes about a minute.</p>
<form method=post action="${postUrl}">
  <label class=fld for=username>Choose a username</label>
  <input class=text id=username name=username value="${username}" placeholder="yourname" autocomplete=off spellcheck=false>
  <div class=hint>Lowercase letters and numbers. This is how people will find you. It cannot be changed later.</div>

  <h2 style="font-size:18px;margin:18px 0 4px">Your keys</h2>
  <p class=hint style="margin-top:0">These are like passwords for your account. They were just made on your own device — we never see them. <b>Write them down or save them somewhere safe before you continue.</b> If you lose them, no one can get them back for you.</p>
  <div class=keys>${keyRows}</div>

  <div class=warn><b>Important:</b> never type these keys into any other website, and never share them. Anyone with your Master key controls your account.</div>
  ${hidden}
  <button class=btn type=submit>I saved my keys — create my account</button>
</form>`;

  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${tagline} — ${brand}</title>
<meta name=description content="${tagline}. Plain and simple account creation on ${brand}.">
<meta name=robots content="noindex">${STYLE}</head>
<body><header class=top><span class=brand>${brand}<span>·</span> Sign up</span></header>
<main class=wrap>${body}</main>
<footer>${brand} — your keys are generated on your device and never sent to us. Keep them safe.</footer>
</body></html>`;
}

// CLI: print the page with placeholders only (no real keys). Guarded so importing is side-effect-free.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(renderRegisterPage());
}
