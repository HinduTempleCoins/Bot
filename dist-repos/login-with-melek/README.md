# Login with MELEK

**Add "Login with MELEK" to any website — a self-owned, portable identity, minimal permission.**

Like *Log in with Google/Facebook*, but the account is the user's own on-chain MELEK identity: a name, an
avatar, a reputation — no per-user rent, no password for a site to leak, and **identity only** (a site learns
*who* you are and never the power to act as you).

## Three ways to use it

### 1. Drop-in button (any site, one tag)
```html
<script src="https://soapy.blog/widgets/melek-login-embed.js"
        data-melek-login data-client-id="your-app" data-target="#melek-login"></script>
<div id="melek-login"></div>
```
Click → the MELEK-Signer consent popup → the signer's postback `postMessage`s the verified identity back
(origin + state checked; no password/key/token ever touches your page). Listen for it:
```js
window.addEventListener('melek:login', (e) => console.log(e.detail)); // { account, onchain, provider }
```

### 2. Standard OpenID Connect (plugins, aggregators, your existing OIDC library)
MELEK-Signer is a conformant **OIDC provider**. Point any OIDC client at the discovery document:
```
https://signer.melek.salon/.well-known/openid-configuration
```
You get `/authorize`, `/token`, `/userinfo`, JWKS, PKCE, a signed ID token — the MELEK account name is the
`sub` and `preferred_username`. WordPress/Shopify social-login plugins and aggregators (Auth0/WorkOS/Keycloak/
Passport) consume it unchanged. (`src/melek-oidc-provider.mjs` is the provider used on the signer.)

### 3. Server-side session (Node)
```js
import { completeLogin, requireSession } from './src/melek-login.mjs';
// after the OAuth callback:
const { account, session } = await completeLogin({ clientId: 'your-app', code, secret });
// on later requests:
const who = requireSession(req.headers.cookie, { secret }); // { account, provider, onchain } | null
```

## Minimal permission (the load-bearing property)
The public login grants **identity only**. On-chain capabilities (posting/active/transfer) are **never** handed
out through login — social actions require the Signer's own explicit approval screen, and **funds-moving is
disabled entirely**. See `src/melek-permission-tiers.mjs`: identity is auto, social is by consent, funds is
refused everywhere (`FUNDS_ENABLED = false`).

## Files
| File | What |
|---|---|
| `src/melek-login-embed.mjs` | The embeddable third-party button SDK (popup + postMessage). |
| `src/melek-oidc-provider.mjs` | MELEK-Signer as a standard OIDC provider (discovery/JWKS/token/userinfo). |
| `src/melek-signer-oauth.mjs` | The OAuth2 authorization-code client helpers. |
| `src/melek-login.mjs` | Multi-provider server session (MELEK + Google/Facebook/GitHub/Discord). |
| `src/melek-permission-tiers.mjs` | The identity/social/funds consent tiers (funds hard-off). |

Pure ESM, offline-testable (`node --test`), zero private keys anywhere in this package.

## License
MIT — see `LICENSE`. Part of the MELEK ecosystem. Openness is the moat.
