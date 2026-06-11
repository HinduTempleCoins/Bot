// server.mjs — the ACCOUNT-RECOVERY PAGE ("I lost my keys") for the MELEK chain. A standalone,
// zero-dependency HTTP service in the SoapBox/site house style (mirrors site/dudael, site/coupons).
//
// It is the PLAIN-LANGUAGE front door for a non-programmer who lost — or had stolen — the keys to an
// account whose recovery helper is `hathor`. It EXPLAINS Steem-style account recovery in everyday
// words and shows the form that starts it. The actual ops are built server-side by
// signup/recovery.mjs (request_account_recovery / recover_account / change_recovery_account); this
// page never touches that module's signing path — it only collects the account name and the user's
// NEW PUBLIC key and explains what happens next.
//
//   PORT=8127 BASE_URL=https://recovery.melek.salon node site/recovery/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the recovery explainer + the start-recovery form
//   /health      liveness probe
//
// ── KEY CUSTODY (BRIEF.md §7, HARD RULE — mirrors the signup custody rule) ─────────────────────────
//   This page NEVER shows a private key and NEVER collects one server-side. Your NEW key pair is made
//   in YOUR browser; only the NEW *public* key is ever submitted. The recent/old owner key that proves
//   you are the real owner is used to SIGN in your browser — it is never typed into this page, never
//   transmitted, never logged, never stored. The form is plain GET-shape illustration; the real
//   condenser wires the client-side keygen + browser signing at integration time. There is zero WIF
//   on this host by construction.
//
// House pattern: pure render functions (renderRecovery(opts) is pure + esc()'d), injectable reader
// seam (__setReader) so any future status lookup is offline-testable, soft-fail-never-throw, esc() on
// EVERY interpolated value, handler(req,res) exported for tests, CLI guarded by process.argv[1].

import http from 'node:http';

const PORT = +(process.env.PORT || 8127);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = 'MELEK Account Recovery';

// The recovery helper account for signup-created accounts (matches signup/recovery.mjs RECOVERY_ACCOUNT).
export const RECOVERY_ACCOUNT = 'hathor';
// Mainnet Steem default recovery window, stated in plain language for the user (informational only —
// the chain enforces the real value; we never gate on it here).
export const RECOVERY_WINDOW_PLAIN = 'about 30 days';

// ── esc() — escape EVERY interpolated value ───────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

// ── injectable reader seam ────────────────────────────────────────────────────────────────────────
// A future status reader (e.g. "is there an open recovery request for this account?") plugs in here.
// Default: none. With no reader injected the page still renders fully (soft-fail). Kept so the module
// has the same injectable shape as its siblings and stays offline-testable.
let _reader = null;
/** Inject the reader: async (accountName) => ({...}) | null. Optional; the page renders without it. */
export function __setReader(fn) { _reader = typeof fn === 'function' ? fn : null; }
/** Read recovery status if a reader is wired; soft-fail to null. Never throws. */
export async function recoveryStatus(account) {
  if (typeof _reader !== 'function') return null;
  try { return await _reader(String(account == null ? '' : account)); }
  catch { return null; }
}

// ── theme (the shared SoapBox dark theme) ─────────────────────────────────────────────────────────
const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--warn:#f85149}
  *{box-sizing:border-box} body{font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.top{background:var(--panel);border-bottom:1px solid var(--line);padding:14px 22px;display:flex;gap:14px;align-items:center}
  .brand{font-weight:800;font-size:20px;letter-spacing:.5px} .brand span{color:var(--gold)}
  .wrap{max-width:680px;margin:0 auto;padding:30px 20px}
  h1{font-size:27px;margin:0 0 6px} h2{font-size:19px;margin:24px 0 8px} .sub{color:var(--mut);margin:0 0 22px}
  p{margin:0 0 12px} .muted{color:var(--mut)}
  ol.steps{margin:8px 0 18px;padding-left:22px} ol.steps li{margin:0 0 12px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin:16px 0}
  label.fld{display:block;font-weight:600;margin:14px 0 6px}
  input.text{width:100%;background:#0b0f14;border:1px solid var(--line);border-radius:8px;color:var(--fg);padding:11px 13px;font-size:16px;font-family:inherit}
  input.text:focus{border-color:var(--blue);outline:none}
  .hint{color:var(--mut);font-size:13px;margin:6px 0 4px}
  .warn{background:#f8514922;border:1px solid #f8514955;border-radius:8px;padding:14px 16px;margin:18px 0;font-size:14px}
  .warn b{color:var(--warn)}
  .safe{background:#3fb95015;border:1px solid #3fb95044;border-radius:8px;padding:14px 16px;margin:18px 0;font-size:14px}
  .safe b{color:var(--up)}
  .btn{display:block;width:100%;background:var(--gold);color:#0d1117;font-weight:800;font-size:17px;border:0;border-radius:8px;padding:14px;cursor:pointer;margin-top:14px}
  .btn:hover{filter:brightness(1.08)}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 20px;border-top:1px solid var(--line);margin-top:30px;line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

// ── renderRecovery(opts) — PURE. Builds the explainer + form body. esc() on every interpolation. ───
// opts: { account?: string, newOwnerKey?: string, status?: object|null, recoveryAccount?: string }
// All values are user-controlled / optional; everything is escaped. Never throws.
export function renderRecovery(opts = {}) {
  const account = esc(opts.account || '');
  const newOwnerKey = esc(opts.newOwnerKey || '');
  const helper = esc(opts.recoveryAccount || RECOVERY_ACCOUNT);
  const window = esc(RECOVERY_WINDOW_PLAIN);

  // Optional status line (only when a reader returned something). Soft, plain, escaped.
  let statusBlock = '';
  const st = opts.status;
  if (st && typeof st === 'object') {
    const open = st.open === true;
    const note = esc(st.note || (open ? 'A recovery request is already open for this account.' : 'No open recovery request found for this account yet.'));
    statusBlock = `<div class="${open ? 'safe' : 'card'}"><b>Status:</b> ${note}</div>`;
  }

  return `<h1>Lost your keys? Recover your account</h1>
    <p class=sub>If you lost — or someone stole — the keys to your MELEK account, you may be able to get it back.
      Here is how it works, in plain words.</p>

    <div class=card>
      <h2 style="margin-top:0">How recovery works</h2>
      <p>When you signed up, your account was given a <b>recovery helper</b>: the account
        <b>${helper}</b>. The helper cannot take your account — it can only <i>help you prove</i> that the
        account is yours and put a brand-new key on it that you control.</p>
      <ol class=steps>
        <li><b>You make a new key on your own device.</b> Just like at signup, a fresh key pair is created
          right in your browser. Only the new <i>public</i> key is sent on — never the secret half.</li>
        <li><b>${helper} opens a recovery request</b> for your account, naming that new key. This starts a
          recovery window of ${window}.</li>
        <li><b>You finish it by proving it is you.</b> You sign — in your own browser — with a key you
          held <i>before</i> the problem (a recent or old key from your account's history). That proof,
          plus the new key, completes the recovery. ${helper} can never do this part for you, which is
          exactly why it can never seize your account.</li>
      </ol>
      <p class=muted>Because finishing requires a key you once held, recovery only works if you still have an
        older backup of a key. If you have lost <i>every</i> key with no backup at all, no one — not even
        ${helper} — can recover the account. Keep your backups safe.</p>
    </div>

    <div class=safe><b>Your keys stay yours.</b> Your new key pair is made on your own device. We never see,
      ask for, or store any secret key. The only thing this page collects is your account name and your new
      <b>public</b> key — and the proof step is signed in your browser, never typed here.</div>

    ${statusBlock}

    <div class=card>
      <h2 style="margin-top:0">Start recovery</h2>
      <p class=muted>Enter your account name and the new <b>public</b> key you just generated on your device.
        Then your browser does the rest — it never sends a secret key anywhere.</p>
      <form method=get action="/">
        <label class=fld for=account>Your account name</label>
        <input class=text id=account name=account value="${account}" placeholder="yourname" autocomplete=off spellcheck=false>
        <div class=hint>The name you signed up with. Lowercase letters and numbers.</div>

        <label class=fld for=newOwnerKey>Your new public key</label>
        <input class=text id=newOwnerKey name=newOwnerKey value="${newOwnerKey}" placeholder="TST… (public key only)" autocomplete=off spellcheck=false>
        <div class=hint>The <b>public</b> half only — it starts with TST on the testnet. Never paste a secret/private key here.</div>

        <div class=warn><b>Never</b> type a secret key, master/owner private key, or recovery phrase into this
          page or any website. This page only needs your account name and your new <b>public</b> key.</div>

        <button class=btn type=submit>Continue recovery in my browser</button>
      </form>
    </div>

    <p class=muted style="font-size:13px">Still stuck? Account recovery is a chain feature, not a password
      reset — there is no "email me a new password" because no one but you ever holds your keys. If you kept a
      backup of an older key, the steps above can restore your access.</p>`;
}

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="Lost your keys? Plain-language account recovery for the MELEK chain. Your keys are made on your own device and never sent to us.">
<meta name=robots content="noindex,follow">
${STYLE}</head><body>
<header class=top><span class=brand>MELEK<span>·</span> Recovery</span></header>
<main class=wrap>${body}</main>
<footer>${esc(SITE_NAME)} — your keys are generated on your own device and never sent to us. Recovery proves
  ownership with a key you already held; it is not a password reset.
  <div style="margin-top:8px"><a href="/">Recovery</a></div>
</footer>
</body></html>`;
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

/**
 * The request handler — exported so offline tests drive routes through a mock req/res (no port bound).
 * Soft-fail: any error renders a plain 500 line; it never throws out of the handler.
 */
export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('ok');
    }

    if (path === '/') {
      const sp = url.searchParams;
      const account = sp.get('account') || '';
      const newOwnerKey = sp.get('newOwnerKey') || '';
      // Optional status lookup (soft-fail to null; page renders either way).
      const status = account ? await recoveryStatus(account) : null;
      const body = renderRecovery({ account, newOwnerKey, status });
      return sendHtml(res, page(`Lost your keys? — ${SITE_NAME}`, body));
    }

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/recovery\//.test(process.argv[1])) {
  http.createServer(handler).listen(PORT, HOST, () => {
    console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
