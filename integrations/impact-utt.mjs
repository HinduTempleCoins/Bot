// impact-utt.mjs — the Impact.com Universal Tracking Tag (UTT) for our public <head>.
//
// The UTT is CLIENT-SIDE. Once in the <head> of an affiliate-outbound page it does two jobs:
//   - impactStat('transformLinks')  — auto-rewrites outbound MERCHANT links into tracked affiliate
//     links (this is where transformLinks EARNS), and
//   - impactStat('trackImpression') — records a page impression.
//
// This complements integrations/affiliate.mjs (which builds tagged deep-links server-side from
// IMPACT_PARTNER_ID). The UTT is the browser-side counterpart keyed on the Impact ACCOUNT id, which
// is embedded in the CDN URL. The account id is read from process.env.IMPACT_ACCOUNT_ID and falls
// back to the operator-provided default, so a box can override it without a code change.
//
// PURE. No deps, no network, no secrets. The emitted snippet is a fixed, operator-supplied script;
// the only interpolated value is the account id, which we VALIDATE to the P-[\w-]+ shape (and fall
// back to the default on anything malformed) so a bad env can never inject markup into <head>.
//
//   import { impactUtt, impactUttSrc } from './impact-utt.mjs'
//   ${impactUtt()}   // -> the full <script>…</script> to drop right before </head>

// The operator-provided Impact account id (embedded in the UTT CDN URL). Overridable via env.
export const DEFAULT_ACCOUNT_ID = 'P-A7672350-347e-4dc5-bdf6-3ec4f2e841c51';

// Impact account ids look like `P-<hex-ish/uuid-with-dashes>`. Accept only that shape; anything
// else (empty, spaces, angle-brackets, injection attempts) is rejected in favour of the default.
const ACCOUNT_ID_RE = /^P-[\w-]+$/;

// Resolve the effective account id: env override if it is present AND well-formed, else the default.
// Never throws; never emits an invalid id into the page.
export function impactAccountId() {
  const fromEnv = process.env.IMPACT_ACCOUNT_ID;
  if (typeof fromEnv === 'string' && ACCOUNT_ID_RE.test(fromEnv.trim())) {
    return fromEnv.trim();
  }
  return DEFAULT_ACCOUNT_ID;
}

// The UTT script src on Impact's CDN — the account id is part of the URL path.
export function impactUttSrc() {
  return `https://utt.impactcdn.com/${impactAccountId()}.js`;
}

// The exact UTT <script> string, ready to drop right before </head>. This is the operator-pasted
// snippet verbatim, with the account id (in both the src and the loader arg) resolved from env/default.
export function impactUtt() {
  const src = impactUttSrc();
  return `<script type="text/javascript">(function(i,m,p,a,c,t){c.ire_o=p;c[p]=c[p]||function(){(c[p].a=c[p].a||[]).push(arguments)};t=a.createElement(m);var z=a.getElementsByTagName(m)[0];t.async=1;t.src=i;z.parentNode.insertBefore(t,z)})('${src}','script','impactStat',document,window);impactStat('transformLinks');impactStat('trackImpression');</script>`;
}

// --- CLI (guarded) ---------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('impact-utt.mjs')) {
  console.log(`Impact account id : ${impactAccountId()}`);
  console.log(`UTT src           : ${impactUttSrc()}`);
  console.log('\nSnippet:\n' + impactUtt());
}
