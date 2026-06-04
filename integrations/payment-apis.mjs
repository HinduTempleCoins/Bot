// payment-apis.mjs — a curated registry of ~100 Payment & Finance industry APIs (card processors,
// wallets, open-banking/bank-data, crypto pay, payouts/disbursement, tax/compliance, fraud/risk,
// BNPL, and affiliate/cashback payout networks). This is a PURE catalog module — no live network
// calls, no secrets — so it is deterministic, safe to import anywhere, and never throws. It feeds
// the Resource Center, the money-making/verticals aggregators, and the brief/annal writers (so the
// AIs know which payment rails exist AND which keep MELEK out of PCI scope).
//
// Design discipline matches security-api-catalog.mjs / govapis.mjs:
//   - ESM `.mjs`, pure/deterministic (no fetch, no fs, no Date-dependent logic).
//   - NO SECRETS: names + URLs only. No keys, no tokens, not even env-var names with values.
//   - soft-fail: every accessor tolerates bad input and returns []/null/{} rather than throwing.
//   - CLI guarded by process.argv[1] so importing never runs the CLI.
//
// Catalog entry shape:
//   { name, slug, category, url, auth, pciScope, goLiveReq, notes }
//     name      : human label.
//     slug      : stable kebab-case identifier (unique across the registry).
//     category  : functional bucket (see CATEGORIES).
//     url       : the service / API docs base URL.
//     auth      : how we authenticate to it — 'key' | 'oauth' | 'partner'.
//                   'key'     → API key / secret-key credential.
//                   'oauth'   → OAuth2 / Connect-style delegated auth flow.
//                   'partner' → requires a partner/reseller/ISO agreement or sponsorship.
//     pciScope  : the PCI-DSS scope this integration drags us into —
//                   'none-hosted' → hosted fields / redirect / tokenization: card data never
//                                   touches our servers, so we stay OUT of PCI scope (SAQ-A class).
//                   'sad'         → Self-Assessment-with-some-data: we touch tokens/limited data
//                                   (SAQ-A-EP class) — light scope, still no raw PAN storage.
//                   'full'        → raw card data flows through us (SAQ-D class) — full PCI scope.
//                                   AVOID unless a processor's hosted path is unavailable.
//                   (Non-card rails — bank/open-banking, crypto, payouts, tax, fraud, affiliate —
//                    are 'none-hosted' because no cardholder data is in play for that call.)
//     goLiveReq : plain-English list of what's needed to go live (account, API key,
//                 business verification, partner agreement, domain verification, etc.).
//     notes     : plain-English description of what it gives + PCI-scope guidance.
//
//   import { PAYMENT_APIS, CATEGORIES, AUTH, PCI_SCOPE,
//            byCategory, pciSafe, goLiveChecklist, find, summary, renderCatalog } from './payment-apis.mjs'

export const AUTH = ['key', 'oauth', 'partner'];

export const PCI_SCOPE = ['none-hosted', 'sad', 'full'];

export const CATEGORIES = [
  'Card Processor',
  'Wallet',
  'Bank Data / Open Banking',
  'Crypto Pay',
  'Payouts / Disbursement',
  'Tax / Compliance',
  'Fraud / Risk',
  'BNPL',
  'Affiliate / Cashback Payout',
];

// ── PAYMENT & FINANCE APIS ───────────────────────────────────────────────────────────────────────
export const PAYMENT_APIS = [
  // ── CARD PROCESSORS ──────────────────────────────────────────────────────────────────────────
  { name: 'Stripe', slug: 'stripe', category: 'Card Processor', url: 'https://stripe.com/docs/api', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Stripe account', 'secret + publishable API keys', 'business verification (KYB)', 'bank account for payouts'], notes: 'Stripe Elements / Checkout / Payment Links host the card fields — card data never hits our servers, keeping us in SAQ-A (out of PCI scope). The default rail.' },
  { name: 'PayPal', slug: 'paypal', category: 'Card Processor', url: 'https://developer.paypal.com/api/rest/', auth: 'oauth', pciScope: 'none-hosted', goLiveReq: ['PayPal business account', 'app client-id + secret (OAuth2)', 'business verification'], notes: 'Smart Payment Buttons / hosted checkout redirect to PayPal — no card data on our side. Also exposes Venmo & Pay Later in the same SDK.' },
  { name: 'Braintree', slug: 'braintree', category: 'Card Processor', url: 'https://developer.paypal.com/braintree/docs', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Braintree (PayPal) account', 'merchant-id + public/private keys', 'business verification'], notes: 'Hosted Fields / Drop-in UI tokenize cards client-side → SAQ-A. PayPal-owned; bundles Venmo, Apple Pay, Google Pay, PayPal.' },
  { name: 'Square', slug: 'square', category: 'Card Processor', url: 'https://developer.squareup.com/docs', auth: 'oauth', pciScope: 'none-hosted', goLiveReq: ['Square account', 'application-id + access token (OAuth)', 'business verification'], notes: 'Web Payments SDK tokenizes cards in-browser → out of PCI scope. Also fronts Cash App Pay (Block-owned) and Afterpay BNPL.' },
  { name: 'Adyen', slug: 'adyen', category: 'Card Processor', url: 'https://docs.adyen.com/api-explorer/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Adyen company + merchant account', 'API key + client key', 'business verification (full KYB)', 'live-endpoint contract'], notes: 'Drop-in / Components host the PCI surface (SAQ-A). Enterprise-grade global acquiring; onboarding is heavier than Stripe.' },
  { name: 'Authorize.Net', slug: 'authorize-net', category: 'Card Processor', url: 'https://developer.authorize.net/api/reference/', auth: 'key', pciScope: 'sad', goLiveReq: ['Authorize.Net + merchant account/gateway', 'API login-id + transaction key', 'business verification'], notes: 'Accept.js / Accept Hosted keep you SAQ-A; the classic direct AIM/API path touches card data (SAQ-A-EP / SAD). Prefer Accept Hosted.' },
  { name: 'Checkout.com', slug: 'checkout-com', category: 'Card Processor', url: 'https://www.checkout.com/docs', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Checkout.com account', 'secret + public keys', 'business verification (KYB)', 'signed contract'], notes: 'Frames / hosted payments page tokenize cards → SAQ-A. Strong for cross-border/enterprise; partner-style onboarding.' },
  { name: 'Worldpay (FIS)', slug: 'worldpay', category: 'Card Processor', url: 'https://developer.worldpay.com/', auth: 'partner', pciScope: 'none-hosted', goLiveReq: ['Worldpay merchant agreement (ISO/partner)', 'API credentials', 'business verification'], notes: 'Hosted Payment Pages keep card data off our servers. Large legacy acquirer; integration gated behind a merchant/partner contract.' },
  { name: 'Razorpay', slug: 'razorpay', category: 'Card Processor', url: 'https://razorpay.com/docs/api/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Razorpay account (India entity)', 'key-id + key-secret', 'business + bank verification (KYC)'], notes: 'Standard Checkout / hosted page → SAQ-A. India-first (UPI, cards, netbanking, wallets). Settlement requires an Indian bank account.' },
  { name: 'Paddle', slug: 'paddle', category: 'Card Processor', url: 'https://developer.paddle.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Paddle account', 'API key', 'seller verification', 'website/product review'], notes: 'Merchant of Record: Paddle is the seller, handles cards + global sales tax/VAT for you. Hosted overlay/checkout → fully out of PCI scope. Ideal for SaaS/digital.' },
  { name: 'Lemon Squeezy', slug: 'lemon-squeezy', category: 'Card Processor', url: 'https://docs.lemonsqueezy.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Lemon Squeezy store', 'API key', 'store/identity verification'], notes: 'Merchant of Record (now Stripe-owned) for digital products/SaaS — hosted checkout, handles tax + PCI. Out of scope for us. Great low-friction start.' },
  { name: '2Checkout / Verifone', slug: '2checkout-verifone', category: 'Card Processor', url: 'https://verifone.cloud/docs/2checkout', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Verifone (2Checkout) account', 'merchant code + secret key', 'business verification'], notes: 'Merchant-of-Record digital-commerce platform; hosted ConvertPlus/InLine checkout → SAQ-A. Global tax + subscriptions handled.' },
  { name: 'Mollie', slug: 'mollie', category: 'Card Processor', url: 'https://docs.mollie.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Mollie account (EU/UK entity)', 'API key', 'business verification (KYB)'], notes: 'Hosted checkout + Components → SAQ-A. Europe-first (iDEAL, SEPA, cards, Bancontact). Simple onboarding for EU merchants.' },
  { name: 'Helcim', slug: 'helcim', category: 'Card Processor', url: 'https://devdocs.helcim.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Helcim merchant account', 'API token', 'business verification'], notes: 'HelcimPay.js hosted payment modal → SAQ-A. Interchange-plus pricing; US/Canada SMB acquirer.' },
  { name: 'Stax (Fattmerchant)', slug: 'stax', category: 'Card Processor', url: 'https://staxpayments.com/developers/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Stax merchant account', 'API key', 'business verification'], notes: 'Hosted/tokenized card fields → SAQ-A. Subscription-pricing US acquirer (flat monthly + interchange).' },
  { name: 'Payoneer Checkout', slug: 'payoneer-checkout', category: 'Card Processor', url: 'https://www.payoneer.com/', auth: 'partner', pciScope: 'none-hosted', goLiveReq: ['Payoneer business account', 'merchant agreement', 'business verification'], notes: 'Hosted checkout for global/marketplace sellers; card data stays off our servers. Strong for cross-border payouts + acceptance.' },
  { name: 'Nuvei', slug: 'nuvei', category: 'Card Processor', url: 'https://docs.nuvei.com/', auth: 'partner', pciScope: 'none-hosted', goLiveReq: ['Nuvei merchant agreement', 'API credentials', 'business verification'], notes: 'Simply Connect hosted fields → SAQ-A. Global acquiring + alternative payment methods; partner/contract onboarding.' },
  { name: 'Fiserv (Clover/Payeezy)', slug: 'fiserv', category: 'Card Processor', url: 'https://developer.fiserv.com/', auth: 'partner', pciScope: 'none-hosted', goLiveReq: ['Fiserv/First Data merchant account', 'API credentials', 'business verification'], notes: 'Hosted checkout / tokenization keeps card data off our servers. Major US processor (Clover, Payeezy); ISO/partner onboarding.' },
  { name: 'Stripe Terminal', slug: 'stripe-terminal', category: 'Card Processor', url: 'https://stripe.com/docs/terminal', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Stripe account', 'API keys', 'certified reader hardware'], notes: 'In-person card-present via certified readers — the reader is the PCI surface, our app stays SAQ-A class. Out of scope for online MELEK but useful for events.' },
  { name: 'Paystack', slug: 'paystack', category: 'Card Processor', url: 'https://paystack.com/docs/api/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Paystack account (African entity)', 'secret + public keys', 'business + bank verification'], notes: 'Hosted Popup/Inline checkout → SAQ-A. Africa-first (Nigeria/Ghana/SA); Stripe-owned. Settlement to a local bank account.' },
  { name: 'Flutterwave', slug: 'flutterwave', category: 'Card Processor', url: 'https://developer.flutterwave.com/docs', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Flutterwave account', 'secret/public/encryption keys', 'business + KYC verification'], notes: 'Standard hosted checkout → SAQ-A. Pan-African cards/mobile-money/bank rails; also does payouts.' },
  { name: 'Chargebee', slug: 'chargebee', category: 'Card Processor', url: 'https://apidocs.chargebee.com/docs/api', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Chargebee site/account', 'API key', 'a connected gateway (Stripe/Braintree/etc.)'], notes: 'Subscription-billing layer over a gateway; hosted checkout/portal → SAQ-A. Cards live at the connected processor, not with us.' },
  { name: 'Recurly', slug: 'recurly', category: 'Card Processor', url: 'https://recurly.com/developers/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Recurly account', 'API key + public key', 'a connected gateway'], notes: 'Subscription/recurring-billing platform; Recurly.js tokenizes cards → SAQ-A. Gateway-agnostic.' },
  { name: 'Rapyd', slug: 'rapyd', category: 'Card Processor', url: 'https://docs.rapyd.net/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Rapyd account', 'access + secret keys', 'business verification'], notes: 'Global cards + 900+ local payment methods via hosted Checkout → SAQ-A. Single integration for many countries.' },
  { name: 'Airwallex', slug: 'airwallex', category: 'Card Processor', url: 'https://www.airwallex.com/docs', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Airwallex account', 'client-id + API key', 'business verification (KYB)'], notes: 'Hosted Payment Page / Drop-in → SAQ-A. Global acquiring + multi-currency accounts + FX; APAC-strong.' },
  { name: 'Tilled (PayFac-as-a-Service)', slug: 'tilled', category: 'Card Processor', url: 'https://docs.tilled.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Tilled account', 'API key', 'merchant/sub-merchant onboarding'], notes: 'Embedded payments (PayFac-as-a-service); hosted card fields → SAQ-A. For platforms that want to monetize payments.' },

  // ── WALLETS ──────────────────────────────────────────────────────────────────────────────────
  { name: 'Apple Pay (via processor)', slug: 'apple-pay', category: 'Wallet', url: 'https://developer.apple.com/apple-pay/', auth: 'partner', pciScope: 'none-hosted', goLiveReq: ['Apple Developer account', 'merchant-id + domain verification', 'processor that supports Apple Pay (Stripe/Braintree/Adyen/Square)'], notes: 'Token-based wallet — the device returns a network token, the processor decrypts it. We never see PAN → out of PCI scope. Requires Apple domain-association file.' },
  { name: 'Google Pay (via processor)', slug: 'google-pay', category: 'Wallet', url: 'https://developers.google.com/pay/api', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Google Pay business profile', 'merchant-id', 'processor that supports Google Pay'], notes: 'Tokenized wallet; the processor (Stripe/Braintree/Adyen/Square) handles the token. No card data on our servers → out of PCI scope.' },
  { name: 'Stripe wallet support', slug: 'stripe-wallets', category: 'Wallet', url: 'https://stripe.com/docs/payments/payment-methods/overview', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Stripe account', 'API keys', 'domain verification for Apple Pay'], notes: 'Payment Request Button / Elements surface Apple Pay, Google Pay, Link in one integration. Wallet tokens via Stripe → SAQ-A.' },
  { name: 'Braintree wallet support', slug: 'braintree-wallets', category: 'Wallet', url: 'https://developer.paypal.com/braintree/docs/guides/apple-pay/overview', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Braintree account', 'merchant keys', 'Apple Pay domain verification'], notes: 'Drop-in surfaces Apple Pay, Google Pay, Venmo, PayPal. All tokenized through Braintree → out of PCI scope.' },
  { name: 'Venmo (via Braintree/PayPal)', slug: 'venmo', category: 'Wallet', url: 'https://developer.paypal.com/braintree/docs/guides/venmo/overview', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Braintree/PayPal account with Venmo enabled', 'merchant keys', 'US-based business'], notes: 'US consumer wallet, accepted only through Braintree/PayPal. Funding source abstracted by PayPal → no card data for us.' },
  { name: 'Cash App Pay (via Square/Block)', slug: 'cash-app-pay', category: 'Wallet', url: 'https://developer.squareup.com/docs/web-payments/cash-app-pay', auth: 'oauth', pciScope: 'none-hosted', goLiveReq: ['Square/Block account with Cash App Pay enabled', 'application-id + access token', 'US business'], notes: 'US wallet from Block; accepted via Square Web Payments SDK. Tokenized → out of PCI scope.' },
  { name: 'PayPal Wallet (via PayPal)', slug: 'paypal-wallet', category: 'Wallet', url: 'https://developer.paypal.com/docs/checkout/', auth: 'oauth', pciScope: 'none-hosted', goLiveReq: ['PayPal business account', 'app client-id + secret'], notes: 'PayPal balance/wallet checkout via the standard PayPal SDK — redirect/overlay, no card data on our side.' },
  { name: 'Amazon Pay', slug: 'amazon-pay', category: 'Wallet', url: 'https://developer.amazon.com/docs/amazon-pay/intro.html', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Amazon Pay merchant account', 'public/private key pair', 'business verification', 'domain registration'], notes: 'Buyers pay with their Amazon-stored methods; Amazon hosts the wallet/checkout → out of PCI scope.' },
  { name: 'Alipay (via processor)', slug: 'alipay', category: 'Wallet', url: 'https://global.alipay.com/docs/', auth: 'partner', pciScope: 'none-hosted', goLiveReq: ['processor that supports Alipay (Stripe/Adyen/Checkout.com)', 'or direct Alipay merchant agreement', 'business verification'], notes: 'China cross-border wallet; usually enabled as a payment method through an acquirer — redirect flow, no card data.' },
  { name: 'WeChat Pay (via processor)', slug: 'wechat-pay', category: 'Wallet', url: 'https://pay.weixin.qq.com/', auth: 'partner', pciScope: 'none-hosted', goLiveReq: ['processor supporting WeChat Pay (Stripe/Adyen)', 'or direct WeChat merchant agreement', 'business verification'], notes: 'China wallet; QR/redirect via an acquirer. No card data on our servers.' },

  // ── BANK DATA / OPEN BANKING ───────────────────────────────────────────────────────────────────
  { name: 'Plaid', slug: 'plaid', category: 'Bank Data / Open Banking', url: 'https://plaid.com/docs/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Plaid account', 'client-id + secret', 'production access request (use-case review)'], notes: 'Bank-account linking, balances, transactions, auth (ACH numbers), identity. Link UI handles credentials → no bank passwords on our servers. The default bank-data rail.' },
  { name: 'Stripe Financial Connections', slug: 'stripe-financial-connections', category: 'Bank Data / Open Banking', url: 'https://stripe.com/docs/financial-connections', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Stripe account', 'API keys', 'enablement in Stripe dashboard'], notes: 'Stripe-native bank linking for ACH debit, balances, ownership. Same vendor as the card rail → one integration, one contract.' },
  { name: 'MX', slug: 'mx', category: 'Bank Data / Open Banking', url: 'https://docs.mx.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['MX partner account', 'client-id + API key', 'partner agreement'], notes: 'Account aggregation, data enhancement/categorization, connectivity. Bank-data enrichment leader; partner onboarding.' },
  { name: 'Yodlee (Envestnet)', slug: 'yodlee', category: 'Bank Data / Open Banking', url: 'https://developer.yodlee.com/', auth: 'oauth', pciScope: 'none-hosted', goLiveReq: ['Yodlee/Envestnet account', 'API credentials (OAuth)', 'partner agreement'], notes: 'Long-standing aggregation platform — accounts, transactions, verification. Enterprise/partner contract to go live.' },
  { name: 'Finicity (Mastercard)', slug: 'finicity', category: 'Bank Data / Open Banking', url: 'https://developer.finicity.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Finicity/Mastercard account', 'app key + partner secret', 'partner agreement'], notes: 'Open-banking data + Verification of Assets/Income (lending use-cases). Mastercard-owned; partner onboarding.' },
  { name: 'TrueLayer', slug: 'truelayer', category: 'Bank Data / Open Banking', url: 'https://docs.truelayer.com/', auth: 'oauth', pciScope: 'none-hosted', goLiveReq: ['TrueLayer account (UK/EU)', 'client-id + secret (OAuth)', 'business verification', 'live access approval'], notes: 'UK/EU open banking — account info + instant bank-to-bank payments (PIS). Redirect/app auth; no credentials on our side.' },
  { name: 'GoCardless', slug: 'gocardless', category: 'Bank Data / Open Banking', url: 'https://developer.gocardless.com/', auth: 'oauth', pciScope: 'none-hosted', goLiveReq: ['GoCardless account', 'access token (OAuth)', 'business verification'], notes: 'Bank debit (ACH, SEPA, BACS) + open-banking payments — recurring/subscription pull from bank accounts. Hosted mandate flow.' },
  { name: 'Tink (Visa)', slug: 'tink', category: 'Bank Data / Open Banking', url: 'https://docs.tink.com/', auth: 'oauth', pciScope: 'none-hosted', goLiveReq: ['Tink account (EU)', 'client-id + secret', 'business verification'], notes: 'EU open banking — account data + payment initiation. Visa-owned; redirect auth, no bank creds on our servers.' },
  { name: 'Akoya', slug: 'akoya', category: 'Bank Data / Open Banking', url: 'https://datarecipient.docs.akoya.com/', auth: 'oauth', pciScope: 'none-hosted', goLiveReq: ['Akoya data-recipient agreement', 'OAuth credentials', 'partner onboarding'], notes: 'Tokenized, API-direct bank-data access (no screen-scraping) backed by US banks. Partner/contract onboarding.' },
  { name: 'Nordigen / GoCardless Bank Account Data', slug: 'nordigen', category: 'Bank Data / Open Banking', url: 'https://developer.gocardless.com/bank-account-data/overview', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['GoCardless Bank Account Data account', 'secret-id + secret-key'], notes: 'Free EU/UK open-banking account data (formerly Nordigen). Balances + transactions; redirect consent flow.' },
  { name: 'Salt Edge', slug: 'salt-edge', category: 'Bank Data / Open Banking', url: 'https://docs.saltedge.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Salt Edge account', 'app-id + secret', 'business verification'], notes: 'Global open-banking aggregation + payment initiation across 5,000+ banks. Redirect consent; no creds on our side.' },
  { name: 'Belvo', slug: 'belvo', category: 'Bank Data / Open Banking', url: 'https://developers.belvo.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Belvo account (LatAm)', 'secret-id + secret-password'], notes: 'Latin-America open-finance aggregation — accounts, transactions, income. Redirect/widget consent.' },

  // ── CRYPTO PAY ─────────────────────────────────────────────────────────────────────────────────
  { name: 'Coinbase Commerce', slug: 'coinbase-commerce', category: 'Crypto Pay', url: 'https://docs.cdp.coinbase.com/commerce-onchain/docs/welcome', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Coinbase Commerce account', 'API key', 'webhook shared secret'], notes: 'Hosted crypto checkout (BTC/ETH/USDC etc.). Customer pays on-chain; we just verify webhooks. No card rails → no PCI scope.' },
  { name: 'BTCPay Server', slug: 'btcpay-server', category: 'Crypto Pay', url: 'https://docs.btcpayserver.org/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['self-hosted BTCPay instance (or host)', 'store + API key', 'a wallet/xpub'], notes: 'Open-source, self-hosted, non-custodial BTC/Lightning processor — zero fees, no third party. Aligns with MELEK self-sovereignty. We hold the keys.' },
  { name: 'NOWPayments', slug: 'nowpayments', category: 'Crypto Pay', url: 'https://documenter.getpostman.com/view/7907941/S1a32n38', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['NOWPayments account', 'API key', 'a payout wallet'], notes: 'Non-custodial crypto gateway across 100+ coins with auto-conversion. Hosted invoice/widget. No card data, no PCI.' },
  { name: 'BitPay', slug: 'bitpay', category: 'Crypto Pay', url: 'https://developer.bitpay.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['BitPay merchant account', 'API token', 'business verification (KYB)'], notes: 'Hosted crypto invoices with fiat settlement option. Established processor; business verification required.' },
  { name: 'OpenNode', slug: 'opennode', category: 'Crypto Pay', url: 'https://developers.opennode.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['OpenNode account', 'API key', 'business verification for fiat payout'], notes: 'Bitcoin + Lightning gateway with optional fiat conversion. Hosted checkout/charges. No card scope.' },
  { name: 'MELEK / PRANA rails (native)', slug: 'melek-prana-rails', category: 'Crypto Pay', url: 'https://github.com/HinduTempleCoins/melek-chain', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['MELEK-Signer service + scoped bearer token', 'Hathor witness account', 'no WIF on host (signer-mediated broadcast)'], notes: 'Our own on-chain rails — transfers/grants on the MELEK Graphene chain via MELEK-Signer. Fully self-custodied, no third-party processor, no PCI. The endgame payment surface.' },
  { name: 'CoinGate', slug: 'coingate', category: 'Crypto Pay', url: 'https://developer.coingate.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['CoinGate account', 'API token', 'business verification for fiat settlement'], notes: 'Hosted multi-coin checkout with EUR/USD settlement option. EU-based. No card data.' },
  { name: 'Coinbase Onchain Payments / CDP', slug: 'coinbase-cdp', category: 'Crypto Pay', url: 'https://docs.cdp.coinbase.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Coinbase Developer Platform account', 'API key', 'onchain wallet'], notes: 'Programmatic onchain payments + wallet APIs (USDC/Base). Developer-platform onboarding; no card scope.' },
  { name: 'Cryptomus', slug: 'cryptomus', category: 'Crypto Pay', url: 'https://doc.cryptomus.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Cryptomus merchant account', 'merchant-id + API key', 'a payout wallet'], notes: 'Hosted multi-coin crypto checkout + payouts, low fees. No card data, no PCI.' },
  { name: 'Transak (fiat-to-crypto on-ramp)', slug: 'transak', category: 'Crypto Pay', url: 'https://docs.transak.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Transak partner account', 'API key', 'partner onboarding'], notes: 'Embeddable fiat→crypto on-ramp widget; Transak handles the card/KYC surface → no PCI for us. Lets users buy MELEK/PRANA-adjacent assets with cards.' },
  { name: 'MoonPay', slug: 'moonpay', category: 'Crypto Pay', url: 'https://dev.moonpay.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['MoonPay partner account', 'publishable + secret keys', 'partner onboarding'], notes: 'Fiat on/off-ramp widget for crypto. MoonPay owns the card + KYC surface → out of PCI scope for us.' },

  // ── PAYOUTS / DISBURSEMENT ─────────────────────────────────────────────────────────────────────
  { name: 'Stripe Connect', slug: 'stripe-connect', category: 'Payouts / Disbursement', url: 'https://stripe.com/docs/connect', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Stripe account with Connect enabled', 'API keys', 'platform profile + KYB', 'connected-account onboarding (hosted)'], notes: 'Marketplace/platform payouts to sellers/creators. Hosted Connect onboarding handles recipient KYC. No card data on our servers.' },
  { name: 'PayPal Payouts', slug: 'paypal-payouts', category: 'Payouts / Disbursement', url: 'https://developer.paypal.com/docs/payouts/', auth: 'oauth', pciScope: 'none-hosted', goLiveReq: ['PayPal business account with Payouts enabled', 'app client-id + secret', 'business verification'], notes: 'Mass/single payouts to PayPal/Venmo recipients by email/phone. Recipient just needs a PayPal account.' },
  { name: 'Wise (TransferWise)', slug: 'wise', category: 'Payouts / Disbursement', url: 'https://docs.wise.com/api-docs', auth: 'oauth', pciScope: 'none-hosted', goLiveReq: ['Wise Platform/business account', 'API token (OAuth)', 'business verification'], notes: 'Low-cost multi-currency cross-border payouts to bank accounts. Strong FX. Platform onboarding for programmatic use.' },
  { name: 'Dwolla', slug: 'dwolla', category: 'Payouts / Disbursement', url: 'https://developers.dwolla.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Dwolla account', 'API key + secret', 'business verification', 'production access approval'], notes: 'US ACH payments/payouts platform — pull and push via bank accounts. White-label; KYC handled via API.' },
  { name: 'Payoneer Payouts', slug: 'payoneer-payouts', category: 'Payouts / Disbursement', url: 'https://www.payoneer.com/developers/', auth: 'partner', pciScope: 'none-hosted', goLiveReq: ['Payoneer mass-payout agreement', 'API credentials', 'business verification'], notes: 'Global mass payouts to freelancers/sellers in 190+ countries. Partner agreement; strong for international creators.' },
  { name: 'Tipalti', slug: 'tipalti', category: 'Payouts / Disbursement', url: 'https://documentation.tipalti.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Tipalti account', 'API key', 'partner agreement', 'business verification'], notes: 'End-to-end AP/mass-payouts with tax-form collection (W-8/W-9) and compliance. Enterprise; partner onboarding.' },
  { name: 'Trolley (Payment Rails)', slug: 'trolley', category: 'Payouts / Disbursement', url: 'https://docs.trolley.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Trolley account', 'API key', 'business verification'], notes: 'Global payouts + recipient tax compliance for marketplaces/creators. Lighter onboarding than Tipalti.' },
  { name: 'Stripe Treasury', slug: 'stripe-treasury', category: 'Payouts / Disbursement', url: 'https://stripe.com/docs/treasury', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Stripe Connect platform', 'Treasury access approval', 'API keys'], notes: 'Banking-as-a-service: store balances, issue accounts, move money for connected users. US; approval-gated.' },
  { name: 'PayPal Mass Payments (legacy)', slug: 'paypal-masspay', category: 'Payouts / Disbursement', url: 'https://developer.paypal.com/docs/payouts/standard/', auth: 'oauth', pciScope: 'none-hosted', goLiveReq: ['PayPal business account', 'app client-id + secret', 'Payouts enabled'], notes: 'Batch payouts via the Payouts API to many recipients at once by email/phone. Recipient needs a PayPal account.' },
  { name: 'Hyperwallet (PayPal)', slug: 'hyperwallet', category: 'Payouts / Disbursement', url: 'https://docs.hyperwallet.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Hyperwallet program account', 'API credentials', 'program/partner agreement'], notes: 'PayPal-owned mass-payout platform for marketplaces — bank/card/PayPal/check payout methods + tax. Partner onboarding.' },
  { name: 'Routable', slug: 'routable', category: 'Payouts / Disbursement', url: 'https://docs.routable.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Routable account', 'API key', 'business verification'], notes: 'B2B mass-payouts/AP automation with ACH + tax-form collection. Lighter than Tipalti for mid-market.' },

  // ── TAX / COMPLIANCE ───────────────────────────────────────────────────────────────────────────
  { name: 'TaxJar', slug: 'taxjar', category: 'Tax / Compliance', url: 'https://developers.taxjar.com/api/reference/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['TaxJar account', 'API token'], notes: 'US sales-tax calculation, nexus tracking, filing. Plugs into the checkout to compute tax at order time.' },
  { name: 'Avalara AvaTax', slug: 'avalara', category: 'Tax / Compliance', url: 'https://developer.avalara.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Avalara account', 'account-id + license key', 'company profile'], notes: 'Global tax calculation + returns + exemption-certificate management. Enterprise-grade; broad jurisdiction coverage.' },
  { name: 'Stripe Tax', slug: 'stripe-tax', category: 'Tax / Compliance', url: 'https://stripe.com/docs/tax', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Stripe account', 'API keys', 'tax registrations entered in dashboard'], notes: 'Automatic tax calc on Stripe payments/invoices in 50+ countries. Zero extra vendor if already on Stripe.' },
  { name: 'Quaderno', slug: 'quaderno', category: 'Tax / Compliance', url: 'https://developers.quaderno.io/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Quaderno account', 'API key'], notes: 'Tax compliance + invoicing for digital sales (VAT MOSS, US sales tax, GST). Good for SaaS/digital products.' },
  { name: 'Sphere / Numeral (tax filing)', slug: 'numeral-tax', category: 'Tax / Compliance', url: 'https://www.numeralhq.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Numeral account', 'API key', 'state registrations'], notes: 'Automated US sales-tax registration + filing on top of a calc engine. Reduces filing ops for small teams.' },
  { name: 'Vertex', slug: 'vertex', category: 'Tax / Compliance', url: 'https://developer.vertexinc.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Vertex account', 'API credentials', 'company profile'], notes: 'Enterprise global indirect-tax (sales/use/VAT) calculation + returns. Avalara competitor; broad jurisdiction depth.' },
  { name: 'Sovos', slug: 'sovos', category: 'Tax / Compliance', url: 'https://sovos.com/', auth: 'partner', pciScope: 'none-hosted', goLiveReq: ['Sovos account', 'API credentials', 'partner agreement'], notes: 'Global tax compliance + e-invoicing + regulatory reporting. Enterprise; strong for cross-border VAT/e-invoice mandates.' },

  // ── FRAUD / RISK ───────────────────────────────────────────────────────────────────────────────
  { name: 'Stripe Radar', slug: 'stripe-radar', category: 'Fraud / Risk', url: 'https://stripe.com/docs/radar', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Stripe account', 'API keys (Radar is built in)'], notes: 'ML fraud scoring + rules on Stripe payments. Zero extra integration if on Stripe; tune via dashboard rules.' },
  { name: 'Sift', slug: 'sift', category: 'Fraud / Risk', url: 'https://sift.com/developers/docs/curl/apis-overview', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Sift account', 'API key + JS beacon', 'integration/onboarding'], notes: 'Digital-trust + fraud platform — payment fraud, account takeover, content abuse via event streaming + ML scores.' },
  { name: 'SEON', slug: 'seon', category: 'Fraud / Risk', url: 'https://docs.seon.io/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['SEON account', 'API key'], notes: 'Fraud prevention via email/phone/IP/device enrichment + rules. Strong digital-footprint signals; quick to integrate.' },
  { name: 'Kount (Equifax)', slug: 'kount', category: 'Fraud / Risk', url: 'https://developer.kount.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Kount account', 'API key + device data collector', 'merchant onboarding'], notes: 'Enterprise payment-fraud + chargeback-prevention platform (Equifax). Device fingerprinting + ML decisioning.' },
  { name: 'Signifyd', slug: 'signifyd', category: 'Fraud / Risk', url: 'https://www.signifyd.com/resources/developers/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Signifyd account', 'API key', 'merchant onboarding'], notes: 'Guaranteed-fraud-protection (chargeback liability shift) + decision API. Good for ecommerce with chargeback exposure.' },
  { name: 'Riskified', slug: 'riskified', category: 'Fraud / Risk', url: 'https://developers.riskified.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Riskified account', 'API credentials', 'merchant agreement'], notes: 'Chargeback-guarantee fraud platform for larger merchants. Decision API on order events.' },
  { name: 'Stripe Identity', slug: 'stripe-identity', category: 'Fraud / Risk', url: 'https://stripe.com/docs/identity', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Stripe account', 'API keys', 'Identity enabled'], notes: 'Document + selfie KYC verification (hosted) on Stripe. Useful for high-risk signup/payout gating; no card scope.' },
  { name: 'Persona', slug: 'persona', category: 'Fraud / Risk', url: 'https://docs.withpersona.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Persona account', 'API key', 'hosted inquiry template'], notes: 'Identity verification + KYC/KYB orchestration (hosted flows). Gate fraud at onboarding/payout; no card data.' },
  { name: 'FingerprintJS', slug: 'fingerprintjs', category: 'Fraud / Risk', url: 'https://dev.fingerprint.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Fingerprint account', 'public + secret API keys'], notes: 'Device-identification/visitor-ID to detect repeat fraudsters + bots. Signal source for risk rules; no card data.' },

  // ── BNPL ───────────────────────────────────────────────────────────────────────────────────────
  { name: 'Affirm', slug: 'affirm', category: 'BNPL', url: 'https://docs.affirm.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Affirm merchant account', 'public + private API keys', 'merchant approval/underwriting'], notes: 'US installment BNPL. Affirm hosts the loan checkout/redirect → no card or loan data on our servers. Affirm carries the credit risk.' },
  { name: 'Klarna', slug: 'klarna', category: 'BNPL', url: 'https://docs.klarna.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Klarna merchant account', 'API username + password (credential pair)', 'merchant onboarding/region setup'], notes: 'Pay-in-4 / financing across US/EU. Hosted/embedded widget; Klarna assumes credit risk → out of PCI scope.' },
  { name: 'Afterpay / Clearpay', slug: 'afterpay', category: 'BNPL', url: 'https://developers.afterpay.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Afterpay (Square/Block) merchant account', 'merchant-id + secret', 'merchant onboarding'], notes: 'Pay-in-4 BNPL (Block-owned, ties into Square). Hosted redirect checkout → no card data on our side.' },
  { name: 'Zip (Quadpay)', slug: 'zip', category: 'BNPL', url: 'https://developers.zip.co/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Zip merchant account', 'API key', 'merchant onboarding'], notes: 'US/AU installment BNPL. Hosted checkout; Zip carries the credit. Out of PCI scope.' },
  { name: 'Sezzle', slug: 'sezzle', category: 'BNPL', url: 'https://docs.sezzle.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Sezzle merchant account', 'public + private keys', 'merchant onboarding'], notes: 'Pay-in-4 BNPL for SMB/ecommerce. Hosted checkout; no card data for us.' },
  { name: 'Splitit', slug: 'splitit', category: 'BNPL', url: 'https://www.splitit.com/developers/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Splitit merchant account', 'API credentials', 'merchant onboarding'], notes: 'Installments on a shopper\'s existing card (no new loan). Hosted/embedded flow → out of PCI scope.' },

  // ── AFFILIATE / CASHBACK PAYOUT ─────────────────────────────────────────────────────────────────
  { name: 'Impact.com (payout side)', slug: 'impact', category: 'Affiliate / Cashback Payout', url: 'https://developer.impact.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Impact partner/media account', 'account SID + auth token', 'partner approval'], notes: 'Partnership/affiliate platform — pull conversions + commission payouts owed to us. Money-in side of an aggregator. No card scope.' },
  { name: 'CJ Affiliate (Commission Junction)', slug: 'cj-affiliate', category: 'Affiliate / Cashback Payout', url: 'https://developers.cj.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['CJ publisher account', 'personal access token', 'publisher approval'], notes: 'Commission/earnings + payout reporting API for publishers. Read what affiliate revenue is due to us.' },
  { name: 'ShareASale (Awin)', slug: 'shareasale', category: 'Affiliate / Cashback Payout', url: 'https://account.shareasale.com/a-apiintro.cfm', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['ShareASale affiliate account', 'API token + secret', 'affiliate approval'], notes: 'Affiliate transactions + commission/payment-status API for affiliates. Awin-owned. Money-in reporting.' },
  { name: 'Awin', slug: 'awin', category: 'Affiliate / Cashback Payout', url: 'https://wiki.awin.com/index.php/Publisher_API', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Awin publisher account', 'API token (OAuth2 bearer)', 'publisher approval'], notes: 'Publisher API for transactions, commissions, and payment reports. Tracks affiliate revenue owed to us.' },
  { name: 'Rakuten Advertising', slug: 'rakuten-advertising', category: 'Affiliate / Cashback Payout', url: 'https://developers.rakutenadvertising.com/', auth: 'oauth', pciScope: 'none-hosted', goLiveReq: ['Rakuten Advertising publisher account', 'OAuth client credentials', 'publisher approval'], notes: 'Affiliate/cashback network — events + earnings reporting via OAuth. Read commissions/payouts owed.' },
  { name: 'Skimlinks', slug: 'skimlinks', category: 'Affiliate / Cashback Payout', url: 'https://developers.skimlinks.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Skimlinks publisher account', 'API key', 'publisher approval'], notes: 'Content-monetization affiliate layer — reporting API for clicks/sales/commissions earned. Money-in side.' },
  { name: 'Honey / PayPal Partner (cashback)', slug: 'honey-cashback', category: 'Affiliate / Cashback Payout', url: 'https://www.joinhoney.com/', auth: 'partner', pciScope: 'none-hosted', goLiveReq: ['PayPal/Honey partner program agreement', 'partner credentials'], notes: 'PayPal-owned cashback/coupon network; payout/commission access is partner-gated. Reference for the cashback-payout side of aggregators.' },
  { name: 'Partnerize', slug: 'partnerize', category: 'Affiliate / Cashback Payout', url: 'https://developer.partnerize.com/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Partnerize partner account', 'application key + user API key', 'partner approval'], notes: 'Partnership-automation platform — conversions + commission/payout reporting for publishers. Money-in reporting.' },
  { name: 'Refersion', slug: 'refersion', category: 'Affiliate / Cashback Payout', url: 'https://www.refersion.com/developers/', auth: 'key', pciScope: 'none-hosted', goLiveReq: ['Refersion account', 'API key + secret'], notes: 'Affiliate-program management with commission + payout APIs (PayPal/Trolley payout integrations). Both run-the-program and earn sides.' },
];

// ── ACCESSORS ──────────────────────────────────────────────────────────────────────────────────
// All accessors are pure + soft-fail: bad input returns []/null/{} rather than throwing.

/** Entries grouped by category → { [category]: entry[] }. */
export function byCategory(list = PAYMENT_APIS) {
  const arr = Array.isArray(list) ? list : [];
  const out = {};
  for (const e of arr) {
    if (!e || typeof e.category !== 'string') continue;
    (out[e.category] ||= []).push(e);
  }
  return out;
}

/** PCI-safe entries: those whose integration keeps us OUT of PCI scope (pciScope 'none-hosted'). */
export function pciSafe(list = PAYMENT_APIS) {
  const arr = Array.isArray(list) ? list : [];
  return arr.filter((e) => e && e.pciScope === 'none-hosted');
}

/** Find an entry by slug. Returns the entry or null. */
export function find(slug) {
  if (!slug) return null;
  return PAYMENT_APIS.find((e) => e && e.slug === slug) || null;
}

/**
 * Go-live checklist for a given slug.
 * Returns { slug, name, category, auth, pciScope, steps[] } where steps are the
 * concrete actions to go live (goLiveReq prefixed with PCI guidance), or null if no such slug.
 */
export function goLiveChecklist(slug) {
  const e = find(slug);
  if (!e) return null;
  const req = Array.isArray(e.goLiveReq) ? e.goLiveReq : [];
  const pciStep =
    e.pciScope === 'none-hosted'
      ? 'Use the hosted/redirect/tokenized flow — keeps MELEK OUT of PCI scope (SAQ-A class).'
      : e.pciScope === 'sad'
        ? 'Integration touches tokens/limited card data (SAQ-A-EP) — prefer the hosted variant if available.'
        : 'Raw card data flows through us (SAQ-D, full PCI scope) — AVOID unless no hosted path exists.';
  return {
    slug: e.slug,
    name: e.name,
    category: e.category,
    auth: e.auth,
    pciScope: e.pciScope,
    steps: [pciStep, ...req],
  };
}

/** Counts: total, by-category, by-auth, by-pciScope, and how many are PCI-safe. Pure. */
export function summary(list = PAYMENT_APIS) {
  const arr = Array.isArray(list) ? list : [];
  const authCounts = { key: 0, oauth: 0, partner: 0 };
  const pciCounts = { 'none-hosted': 0, sad: 0, full: 0 };
  for (const e of arr) {
    if (e && authCounts[e.auth] != null) authCounts[e.auth] += 1;
    if (e && pciCounts[e.pciScope] != null) pciCounts[e.pciScope] += 1;
  }
  const cat = byCategory(arr);
  const catCounts = Object.fromEntries(Object.entries(cat).map(([k, v]) => [k, v.length]));
  return {
    total: arr.length,
    byCategory: catCounts,
    byAuth: authCounts,
    byPciScope: pciCounts,
    pciSafe: pciSafe(arr).length,
  };
}

// HTML-escape so an entry's text can never inject markup into a rendered page.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render the catalog as an escaped table. format: 'html' (default) or 'md'. Pure, never throws. */
export function renderCatalog(list = PAYMENT_APIS, format = 'html') {
  const arr = Array.isArray(list) ? list : [];
  const reqStr = (e) => (Array.isArray(e.goLiveReq) ? e.goLiveReq.join('; ') : '');
  if (format === 'md') {
    const head = '| Name | Category | Auth | PCI scope | Go-live | Notes |\n|---|---|---|---|---|---|';
    const cell = (v) => esc(v).replace(/\|/g, '\\|');
    const rows = arr.map(
      (e) =>
        `| [${cell(e.name)}](${cell(e.url)}) | ${cell(e.category)} | ${cell(e.auth)} | ${cell(e.pciScope)} | ${cell(reqStr(e))} | ${cell(e.notes)} |`,
    );
    return [head, ...rows].join('\n');
  }
  const rows = arr.map(
    (e) =>
      `    <tr>` +
      `<td><a href="${esc(e.url)}">${esc(e.name)}</a></td>` +
      `<td>${esc(e.category)}</td>` +
      `<td>${esc(e.auth)}</td>` +
      `<td>${esc(e.pciScope)}</td>` +
      `<td>${esc(reqStr(e))}</td>` +
      `<td>${esc(e.notes)}</td>` +
      `</tr>`,
  );
  return (
    `<table class="payment-api-catalog">\n` +
    `  <thead><tr><th>Name</th><th>Category</th><th>Auth</th><th>PCI scope</th><th>Go-live</th><th>Notes</th></tr></thead>\n` +
    `  <tbody>\n${rows.join('\n')}\n  </tbody>\n</table>`
  );
}

// CLI:  node integrations/payment-apis.mjs           (prints the summary)
//       node integrations/payment-apis.mjs --md      (prints the markdown table)
if (process.argv[1] && process.argv[1].endsWith('payment-apis.mjs')) {
  const s = summary();
  console.log('\nMELEK payment & finance API catalog');
  console.log('─'.repeat(64));
  console.log(`Total: ${s.total}   PCI-safe (none-hosted): ${s.pciSafe}`);
  console.log(`Auth:  key ${s.byAuth.key} · oauth ${s.byAuth.oauth} · partner ${s.byAuth.partner}`);
  console.log(`PCI:   none-hosted ${s.byPciScope['none-hosted']} · sad ${s.byPciScope.sad} · full ${s.byPciScope.full}`);
  console.log('\nBy category:');
  for (const [c, n] of Object.entries(s.byCategory)) console.log(`  ${c.padEnd(34)} ${n}`);
  console.log('─'.repeat(64));
  if (process.argv.includes('--md')) {
    console.log('\n## Payment & Finance APIs\n');
    console.log(renderCatalog(PAYMENT_APIS, 'md'));
  }
}
