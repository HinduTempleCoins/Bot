// security-api-catalog.mjs — a COMPREHENSIVE catalog of security APIs (threat-intel, vuln, TLS/headers,
// DNS/WHOIS, malware sandbox…) PLUS free/freemium AI-review APIs the ensemble can call to ease its
// annal/brief writing. This is a PURE catalog module — no live network calls — so it is deterministic,
// safe to import anywhere, and never throws. It feeds the Resource Center (via `forResourceCenter()`),
// the security-scan layer, and the brief/annal writers (so the AIs know which review helpers exist).
//
// Design discipline matches govapis.mjs / macro.mjs:
//   - ESM `.mjs`, pure/deterministic (no fetch, no fs, no Date-dependent logic).
//   - NO SECRETS: a keyed service references its key ONLY by env-var NAME (`keyEnv`), never a value.
//   - soft-fail: every accessor tolerates bad input and returns []/null/{} rather than throwing.
//   - CLI guarded by process.argv[1] so importing never runs the CLI.
//
// Catalog entry shape (shared by SECURITY_APIS and AI_REVIEW_APIS):
//   { id, name, category, url, access:'open'|'key'|'freemium', keyEnv?, note }
//     id       : stable kebab-case identifier (unique within its list).
//     name     : human label.
//     category : functional bucket (see CATEGORIES / AI_CATEGORIES).
//     url       : the service / API docs base URL.
//     access   : 'open'    → usable with no key/signup at all.
//                'freemium'→ free tier exists; a key (often) lifts limits.
//                'key'     → a key/registration is required to call it.
//     keyEnv   : (optional) the ENV-VAR NAME that would hold the key — NAME ONLY, never a value.
//     note     : plain-English description of what it gives.
//
//   import { SECURITY_APIS, AI_REVIEW_APIS, byCategory, keyless, find,
//            forResourceCenter, summary, renderCatalog } from './security-api-catalog.mjs'

export const ACCESS = ['open', 'freemium', 'key'];

export const CATEGORIES = [
  'Threat Intelligence',
  'IP & Network Reputation',
  'URL & Phishing',
  'Malware & Sandbox',
  'Vulnerabilities & Advisories',
  'TLS, Headers & Web Posture',
  'DNS & WHOIS',
  'Breach & Credential Exposure',
  'Attack Surface & Recon',
  'Email & Domain Auth',
  'Secrets & Code Scanning',
  'Abuse & Spam',
];

export const AI_CATEGORIES = [
  'LLM Gateway (free tier)',
  'Code Review',
  'Lint & Static Analysis',
  'Grounding & Fact-check',
  'Quality & Eval',
];

// ── SECURITY APIS ────────────────────────────────────────────────────────────────────────────────
export const SECURITY_APIS = [
  // ── THREAT INTELLIGENCE ──────────────────────────────────────────────────────────────────────
  { id: 'virustotal', name: 'VirusTotal API v3', category: 'Threat Intelligence', url: 'https://developers.virustotal.com/reference/overview', access: 'freemium', keyEnv: 'VIRUSTOTAL_API_KEY', note: 'Aggregated file/URL/domain/IP reputation across 70+ AV engines + sandbox behavior.' },
  { id: 'otx', name: 'AlienVault OTX (Open Threat Exchange)', category: 'Threat Intelligence', url: 'https://otx.alienvault.com/api', access: 'freemium', keyEnv: 'OTX_API_KEY', note: 'Community threat "pulses" — IOCs (IPs/domains/hashes/URLs) tagged to campaigns and malware.' },
  { id: 'threatfox', name: 'ThreatFox (abuse.ch)', category: 'Threat Intelligence', url: 'https://threatfox.abuse.ch/api/', access: 'freemium', keyEnv: 'ABUSECH_AUTH_KEY', note: 'Free IOC database (malware C2, payload hashes) with a JSON query API.' },
  { id: 'misp', name: 'MISP (self-hosted threat-share)', category: 'Threat Intelligence', url: 'https://www.misp-project.org/openapi/', access: 'key', keyEnv: 'MISP_API_KEY', note: 'Open-source threat-intel sharing platform with a full REST API (run your own instance).' },
  { id: 'cisa-kev', name: 'CISA Known Exploited Vulnerabilities', category: 'Threat Intelligence', url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', access: 'open', note: 'Keyless JSON feed of CVEs actively exploited in the wild — "patch these now".' },
  { id: 'pulsedive', name: 'Pulsedive API', category: 'Threat Intelligence', url: 'https://pulsedive.com/api/', access: 'freemium', keyEnv: 'PULSEDIVE_API_KEY', note: 'Threat-intel search over IPs/domains/URLs with risk scoring and enrichment.' },
  { id: 'threatcrowd', name: 'ThreatCrowd / open IOC search', category: 'Threat Intelligence', url: 'https://www.threatcrowd.org/', access: 'open', note: 'Keyless graph search relating domains/IPs/emails/hashes (legacy open API).' },
  { id: 'maltiverse', name: 'Maltiverse API', category: 'Threat Intelligence', url: 'https://maltiverse.com/', access: 'freemium', keyEnv: 'MALTIVERSE_API_KEY', note: 'IOC enrichment + classification feed (IP/hostname/URL/sample) with a free tier.' },

  // ── IP & NETWORK REPUTATION ─────────────────────────────────────────────────────────────────
  { id: 'abuseipdb', name: 'AbuseIPDB API v2', category: 'IP & Network Reputation', url: 'https://docs.abuseipdb.com/', access: 'freemium', keyEnv: 'ABUSEIPDB_API_KEY', note: 'Crowd-sourced IP abuse confidence score + report history (free daily check quota).' },
  { id: 'greynoise', name: 'GreyNoise Community API', category: 'IP & Network Reputation', url: 'https://docs.greynoise.io/', access: 'freemium', keyEnv: 'GREYNOISE_API_KEY', note: 'Tells whether an IP is internet-wide background noise vs. targeted — cuts alert fatigue.' },
  { id: 'shodan', name: 'Shodan API', category: 'IP & Network Reputation', url: 'https://developer.shodan.io/', access: 'freemium', keyEnv: 'SHODAN_API_KEY', note: 'Search exposed hosts/services/ports/banners across the internet; host enrichment lookups.' },
  { id: 'censys', name: 'Censys Search API', category: 'IP & Network Reputation', url: 'https://search.censys.io/api', access: 'freemium', keyEnv: 'CENSYS_API_TOKEN', note: 'Internet-wide host/cert scans — services, TLS, software, exposure (free tier).' },
  { id: 'ipinfo', name: 'IPinfo API', category: 'IP & Network Reputation', url: 'https://ipinfo.io/developers', access: 'freemium', keyEnv: 'IPINFO_TOKEN', note: 'Geolocation, ASN, company, hosting/VPN/Tor flags for any IP (free tier).' },
  { id: 'ipqualityscore', name: 'IPQualityScore API', category: 'IP & Network Reputation', url: 'https://www.ipqualityscore.com/documentation', access: 'freemium', keyEnv: 'IPQS_API_KEY', note: 'Fraud/proxy/VPN/bot scoring for IPs, emails, phones, and URLs (free tier).' },
  { id: 'spur', name: 'Spur (anonymity/proxy detection)', category: 'IP & Network Reputation', url: 'https://spur.us/', access: 'key', keyEnv: 'SPUR_API_KEY', note: 'Detects VPN/residential-proxy/anonymizer infrastructure behind an IP.' },
  { id: 'ip-api', name: 'ip-api.com', category: 'IP & Network Reputation', url: 'https://ip-api.com/docs', access: 'open', note: 'Keyless IP geolocation + ASN/ISP/hosting lookup (free non-commercial tier).' },

  // ── URL & PHISHING ──────────────────────────────────────────────────────────────────────────
  { id: 'urlhaus', name: 'URLhaus API (abuse.ch)', category: 'URL & Phishing', url: 'https://urlhaus-api.abuse.ch/', access: 'open', note: 'Keyless database of malware-distribution URLs; query by URL/host/payload hash.' },
  { id: 'phishtank', name: 'PhishTank API', category: 'URL & Phishing', url: 'https://www.phishtank.com/developer_info.php', access: 'freemium', keyEnv: 'PHISHTANK_API_KEY', note: 'Community-verified phishing-URL database; check if a URL is a known phish.' },
  { id: 'openphish', name: 'OpenPhish feed', category: 'URL & Phishing', url: 'https://openphish.com/', access: 'open', note: 'Public feed of live phishing URLs (community tier is keyless).' },
  { id: 'gsb', name: 'Google Safe Browsing API v4', category: 'URL & Phishing', url: 'https://developers.google.com/safe-browsing', access: 'key', keyEnv: 'GOOGLE_SAFEBROWSING_API_KEY', note: 'Check URLs against Google\'s malware/phishing/unwanted-software lists.' },
  { id: 'urlscan', name: 'urlscan.io API', category: 'URL & Phishing', url: 'https://urlscan.io/docs/api/', access: 'freemium', keyEnv: 'URLSCAN_API_KEY', note: 'Submit a URL → full scan (DOM, resources, screenshots, verdicts); search public scans.' },
  { id: 'phishstats', name: 'PhishStats API', category: 'URL & Phishing', url: 'https://phishstats.info/', access: 'open', note: 'Keyless phishing-URL search/feed with scoring and IOC fields.' },

  // ── MALWARE & SANDBOX ───────────────────────────────────────────────────────────────────────
  { id: 'malwarebazaar', name: 'MalwareBazaar API (abuse.ch)', category: 'Malware & Sandbox', url: 'https://bazaar.abuse.ch/api/', access: 'freemium', keyEnv: 'ABUSECH_AUTH_KEY', note: 'Query/download malware samples by hash, tag, signature, or file type.' },
  { id: 'hybrid-analysis', name: 'Hybrid Analysis API', category: 'Malware & Sandbox', url: 'https://www.hybrid-analysis.com/docs/api/v2', access: 'freemium', keyEnv: 'HYBRID_ANALYSIS_API_KEY', note: 'CrowdStrike Falcon Sandbox — submit files/URLs, retrieve behavioral reports.' },
  { id: 'anyrun', name: 'ANY.RUN API', category: 'Malware & Sandbox', url: 'https://any.run/api-documentation/', access: 'freemium', keyEnv: 'ANYRUN_API_KEY', note: 'Interactive malware sandbox; submit samples and pull analysis/IOCs.' },
  { id: 'joe-sandbox', name: 'Joe Sandbox Cloud API', category: 'Malware & Sandbox', url: 'https://www.joesecurity.org/joe-sandbox-cloud', access: 'freemium', keyEnv: 'JOE_SANDBOX_API_KEY', note: 'Deep dynamic+static malware analysis with a free Basic tier.' },
  { id: 'cuckoo', name: 'CAPE / Cuckoo Sandbox (self-host)', category: 'Malware & Sandbox', url: 'https://github.com/kevoreilly/CAPEv2', access: 'open', note: 'Open-source dynamic-analysis sandbox you run yourself; REST API for submissions.' },
  { id: 'malshare', name: 'MalShare API', category: 'Malware & Sandbox', url: 'https://malshare.com/doc.php', access: 'freemium', keyEnv: 'MALSHARE_API_KEY', note: 'Free community malware-sample repository with a hash/download API.' },

  // ── VULNERABILITIES & ADVISORIES ────────────────────────────────────────────────────────────
  { id: 'nvd', name: 'NVD CVE API 2.0', category: 'Vulnerabilities & Advisories', url: 'https://nvd.nist.gov/developers/vulnerabilities', access: 'open', keyEnv: 'NVD_API_KEY', note: 'National Vulnerability Database — CVEs, CVSS scores, CPE; keyless (free key lifts rate).' },
  { id: 'osv', name: 'OSV.dev API', category: 'Vulnerabilities & Advisories', url: 'https://google.github.io/osv.dev/api/', access: 'open', note: 'Open-source-package vulnerability lookup by package/version or commit — fully keyless.' },
  { id: 'github-advisory', name: 'GitHub Advisory Database (GraphQL)', category: 'Vulnerabilities & Advisories', url: 'https://docs.github.com/en/rest/security-advisories', access: 'key', keyEnv: 'GITHUB_TOKEN', note: 'GHSA security advisories for packages across ecosystems via the GitHub API.' },
  { id: 'snyk', name: 'Snyk API', category: 'Vulnerabilities & Advisories', url: 'https://docs.snyk.io/snyk-api', access: 'freemium', keyEnv: 'SNYK_TOKEN', note: 'Dependency/container/IaC vulnerability scanning + curated advisory DB (free tier).' },
  { id: 'vulners', name: 'Vulners API', category: 'Vulnerabilities & Advisories', url: 'https://vulners.com/docs', access: 'freemium', keyEnv: 'VULNERS_API_KEY', note: 'Aggregated vulnerability/exploit search engine (CVEs, advisories, exploits).' },
  { id: 'osv-scanner', name: 'OSV-Scanner (CLI/lib)', category: 'Vulnerabilities & Advisories', url: 'https://github.com/google/osv-scanner', access: 'open', note: 'Scan a lockfile/SBOM against OSV; no key, runs locally.' },
  { id: 'exploitdb', name: 'Exploit-DB (searchsploit)', category: 'Vulnerabilities & Advisories', url: 'https://www.exploit-db.com/', access: 'open', note: 'Public exploit archive; mirror + searchsploit CLI, keyless.' },
  { id: 'epss', name: 'FIRST EPSS API', category: 'Vulnerabilities & Advisories', url: 'https://www.first.org/epss/api', access: 'open', note: 'Exploit Prediction Scoring System — probability a CVE will be exploited; keyless.' },
  { id: 'endoflife', name: 'endoflife.date API', category: 'Vulnerabilities & Advisories', url: 'https://endoflife.date/docs/api', access: 'open', note: 'Keyless API of product end-of-life/EOL dates — flag unsupported, unpatched software.' },

  // ── TLS, HEADERS & WEB POSTURE ──────────────────────────────────────────────────────────────
  { id: 'ssllabs', name: 'Qualys SSL Labs API v3', category: 'TLS, Headers & Web Posture', url: 'https://github.com/ssllabs/ssllabs-scan/blob/master/ssllabs-api-docs-v3.md', access: 'open', note: 'Deep TLS/SSL grade for a host (protocols, ciphers, cert chain) — keyless.' },
  { id: 'mozilla-observatory', name: 'Mozilla HTTP Observatory API', category: 'TLS, Headers & Web Posture', url: 'https://github.com/mozilla/http-observatory/blob/master/httpobs/docs/api.md', access: 'open', note: 'Scores a site\'s HTTP security headers + config and grades them — keyless.' },
  { id: 'securityheaders', name: 'SecurityHeaders.com', category: 'TLS, Headers & Web Posture', url: 'https://securityheaders.com/', access: 'open', note: 'Grades response security headers (CSP/HSTS/etc.); JSON via query params, keyless.' },
  { id: 'crtsh', name: 'crt.sh (Certificate Transparency)', category: 'TLS, Headers & Web Posture', url: 'https://crt.sh/', access: 'open', note: 'Keyless CT-log search — every issued cert for a domain (subdomain discovery too).' },
  { id: 'hardenize', name: 'Hardenize / report cards', category: 'TLS, Headers & Web Posture', url: 'https://www.hardenize.com/', access: 'freemium', keyEnv: 'HARDENIZE_API_KEY', note: 'Continuous web/email security posture monitoring (TLS, DNSSEC, headers).' },
  { id: 'sslmate-ct', name: 'SSLMate Cert Spotter API', category: 'TLS, Headers & Web Posture', url: 'https://sslmate.com/ct_search_api/', access: 'freemium', keyEnv: 'SSLMATE_API_KEY', note: 'CT-log monitoring API — alert on certs issued for your domains.' },

  // ── DNS & WHOIS ─────────────────────────────────────────────────────────────────────────────
  { id: 'dns-google', name: 'Google Public DNS-over-HTTPS', category: 'DNS & WHOIS', url: 'https://developers.google.com/speed/public-dns/docs/doh', access: 'open', note: 'Keyless DoH JSON resolver — resolve any record type for any name.' },
  { id: 'dns-cloudflare', name: 'Cloudflare 1.1.1.1 DoH', category: 'DNS & WHOIS', url: 'https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/', access: 'open', note: 'Keyless DoH JSON resolver alternative for DNS lookups + DNSSEC checks.' },
  { id: 'rdap', name: 'RDAP (IANA bootstrap)', category: 'DNS & WHOIS', url: 'https://www.rdap.net/', access: 'open', note: 'Keyless successor to WHOIS — structured JSON registration data for domains/IPs/ASNs.' },
  { id: 'whoisxml', name: 'WhoisXML API', category: 'DNS & WHOIS', url: 'https://whoisxmlapi.com/', access: 'freemium', keyEnv: 'WHOISXML_API_KEY', note: 'WHOIS, DNS, reverse-WHOIS, domain-availability, and history APIs (free tier).' },
  { id: 'securitytrails', name: 'SecurityTrails API', category: 'DNS & WHOIS', url: 'https://docs.securitytrails.com/', access: 'freemium', keyEnv: 'SECURITYTRAILS_API_KEY', note: 'Historical DNS + WHOIS, subdomain enumeration, IP neighbors (free tier).' },
  { id: 'dnsdumpster', name: 'DNSDumpster / hackertarget', category: 'DNS & WHOIS', url: 'https://hackertarget.com/ip-tools/', access: 'freemium', keyEnv: 'HACKERTARGET_API_KEY', note: 'Recon DNS/host tooling (subdomains, reverse DNS); limited keyless queries.' },

  // ── BREACH & CREDENTIAL EXPOSURE ────────────────────────────────────────────────────────────
  { id: 'hibp', name: 'Have I Been Pwned API v3', category: 'Breach & Credential Exposure', url: 'https://haveibeenpwned.com/API/v3', access: 'key', keyEnv: 'HIBP_API_KEY', note: 'Check an email/account across known breaches (account API needs a key).' },
  { id: 'hibp-pwned-passwords', name: 'HIBP Pwned Passwords (k-anon)', category: 'Breach & Credential Exposure', url: 'https://haveibeenpwned.com/API/v3#PwnedPasswords', access: 'open', note: 'Keyless k-anonymity range API — check a password hash prefix without sending the password.' },
  { id: 'dehashed', name: 'DeHashed API', category: 'Breach & Credential Exposure', url: 'https://www.dehashed.com/docs', access: 'key', keyEnv: 'DEHASHED_API_KEY', note: 'Search leaked-credential datasets by email/username/IP/name (paid).' },
  { id: 'leakcheck', name: 'LeakCheck API', category: 'Breach & Credential Exposure', url: 'https://leakcheck.io/api', access: 'freemium', keyEnv: 'LEAKCHECK_API_KEY', note: 'Breach/leak lookup by email, username, or keyword (free public check).' },
  { id: 'intelx', name: 'Intelligence X API', category: 'Breach & Credential Exposure', url: 'https://intelx.io/integrations', access: 'freemium', keyEnv: 'INTELX_API_KEY', note: 'Search leaks, pastes, darkweb selectors (emails/domains/BTC/IPs); free tier.' },

  // ── ATTACK SURFACE & RECON ──────────────────────────────────────────────────────────────────
  { id: 'fofa', name: 'FOFA API', category: 'Attack Surface & Recon', url: 'https://en.fofa.info/api', access: 'freemium', keyEnv: 'FOFA_API_KEY', note: 'Cyberspace asset search engine (like Shodan) — query exposed assets (free tier).' },
  { id: 'zoomeye', name: 'ZoomEye API', category: 'Attack Surface & Recon', url: 'https://www.zoomeye.org/doc', access: 'freemium', keyEnv: 'ZOOMEYE_API_KEY', note: 'Internet-asset search engine for hosts/web apps with a free monthly quota.' },
  { id: 'binaryedge', name: 'BinaryEdge API', category: 'Attack Surface & Recon', url: 'https://docs.binaryedge.io/', access: 'freemium', keyEnv: 'BINARYEDGE_API_KEY', note: 'Internet-scan data — open ports, services, exposed databases (free tier).' },
  { id: 'leakix', name: 'LeakIX API', category: 'Attack Surface & Recon', url: 'https://leakix.net/', access: 'freemium', keyEnv: 'LEAKIX_API_KEY', note: 'Indexes exposed services and misconfigurations/leaks across the internet.' },
  { id: 'wappalyzer', name: 'Wappalyzer API', category: 'Attack Surface & Recon', url: 'https://www.wappalyzer.com/api/', access: 'freemium', keyEnv: 'WAPPALYZER_API_KEY', note: 'Tech-stack fingerprinting for a URL — frameworks, servers, CMS, analytics.' },
  { id: 'builtwith', name: 'BuiltWith API', category: 'Attack Surface & Recon', url: 'https://api.builtwith.com/', access: 'freemium', keyEnv: 'BUILTWITH_API_KEY', note: 'Technology profile + history for any domain (free limited lookups).' },

  // ── EMAIL & DOMAIN AUTH ─────────────────────────────────────────────────────────────────────
  { id: 'mailcheck-disposable', name: 'Disposable-email check (open lists)', category: 'Email & Domain Auth', url: 'https://github.com/disposable-email-domains/disposable-email-domains', access: 'open', note: 'Open block-list of disposable/throwaway email domains; load locally, keyless.' },
  { id: 'hunter', name: 'Hunter.io Email Verifier', category: 'Email & Domain Auth', url: 'https://hunter.io/api-documentation/v2', access: 'freemium', keyEnv: 'HUNTER_API_KEY', note: 'Verify deliverability + find/enrich email addresses for a domain (free tier).' },
  { id: 'abstract-email', name: 'Abstract Email Validation API', category: 'Email & Domain Auth', url: 'https://www.abstractapi.com/api/email-verification-validation-api', access: 'freemium', keyEnv: 'ABSTRACT_EMAIL_API_KEY', note: 'Validate syntax/MX/disposable/free-provider for an email (free monthly quota).' },
  { id: 'dmarc-checker', name: 'DMARC/SPF/DKIM record check (DNS)', category: 'Email & Domain Auth', url: 'https://dmarc.org/', access: 'open', note: 'Read _dmarc / SPF / DKIM TXT records via any DoH resolver; pure DNS, keyless.' },
  { id: 'mxtoolbox', name: 'MxToolbox API', category: 'Email & Domain Auth', url: 'https://mxtoolbox.com/restapi.aspx', access: 'freemium', keyEnv: 'MXTOOLBOX_API_KEY', note: 'Blacklist checks, MX/SPF/DMARC diagnostics, deliverability monitoring.' },

  // ── SECRETS & CODE SCANNING ─────────────────────────────────────────────────────────────────
  { id: 'gitleaks', name: 'Gitleaks (secret scanner)', category: 'Secrets & Code Scanning', url: 'https://github.com/gitleaks/gitleaks', access: 'open', note: 'Open-source secret/credential scanner for git repos and files; runs locally.' },
  { id: 'trufflehog', name: 'TruffleHog', category: 'Secrets & Code Scanning', url: 'https://github.com/trufflesecurity/trufflehog', access: 'open', note: 'Find + verify leaked secrets across repos/filesystems/cloud; keyless local run.' },
  { id: 'semgrep', name: 'Semgrep (SAST)', category: 'Secrets & Code Scanning', url: 'https://semgrep.dev/docs/', access: 'freemium', keyEnv: 'SEMGREP_APP_TOKEN', note: 'Pattern-based static analysis for bugs/vulns/secrets; CLI is free + keyless.' },
  { id: 'github-secret-scanning', name: 'GitHub Secret Scanning / Dependabot', category: 'Secrets & Code Scanning', url: 'https://docs.github.com/en/code-security', access: 'key', keyEnv: 'GITHUB_TOKEN', note: 'Repo secret-scanning alerts + Dependabot vuln alerts via the GitHub API.' },
  { id: 'codeql', name: 'CodeQL', category: 'Secrets & Code Scanning', url: 'https://codeql.github.com/', access: 'open', note: 'Semantic code-analysis engine; query code for vulnerabilities, runs locally/CI.' },

  // ── ABUSE & SPAM ────────────────────────────────────────────────────────────────────────────
  { id: 'spamhaus-dbl', name: 'Spamhaus DBL/ZEN (DNSBL)', category: 'Abuse & Spam', url: 'https://www.spamhaus.org/', access: 'open', note: 'Keyless DNS blocklist lookups for spam/malware IPs and domains (fair-use limits).' },
  { id: 'stopforumspam', name: 'StopForumSpam API', category: 'Abuse & Spam', url: 'https://www.stopforumspam.com/usage', access: 'open', note: 'Keyless check of IP/email/username against a forum-spam database.' },
  { id: 'cleantalk', name: 'CleanTalk Anti-Spam API', category: 'Abuse & Spam', url: 'https://cleantalk.org/help/api', access: 'freemium', keyEnv: 'CLEANTALK_API_KEY', note: 'Spam/bot detection for signups and comments (IP/email/content checks).' },
  { id: 'projecthoneypot', name: 'Project Honey Pot http:BL', category: 'Abuse & Spam', url: 'https://www.projecthoneypot.org/httpbl_api.php', access: 'key', keyEnv: 'HTTPBL_ACCESS_KEY', note: 'DNS-based lookup of an IP\'s spam/harvester/comment-spam reputation.' },
];

// ── AI REVIEW APIS ───────────────────────────────────────────────────────────────────────────────
// Free / freemium AI helpers the ensemble can call to EASE annal/brief writing: free-tier model
// gateways, linters-as-a-service, and grounding/eval helpers. Same entry shape; keys by env NAME only.
export const AI_REVIEW_APIS = [
  // ── LLM GATEWAY (FREE TIER) ─────────────────────────────────────────────────────────────────
  { id: 'github-models', name: 'GitHub Models (Azure AI Inference)', category: 'LLM Gateway (free tier)', url: 'https://github.com/marketplace/models', access: 'freemium', keyEnv: 'GITHUB_TOKEN', note: 'Free-tier access to gpt-4o/Llama/Phi/Mistral via a GitHub PAT — review drafts & summarize.' },
  { id: 'groq', name: 'Groq API (free tier)', category: 'LLM Gateway (free tier)', url: 'https://console.groq.com/docs', access: 'freemium', keyEnv: 'GROQ_API_KEY', note: 'Very fast Llama/Mixtral/Gemma inference with a generous free tier — quick brief review.' },
  { id: 'openrouter', name: 'OpenRouter (free models)', category: 'LLM Gateway (free tier)', url: 'https://openrouter.ai/docs', access: 'freemium', keyEnv: 'OPENROUTER_API_KEY', note: 'One API across many models incl. several free `:free` endpoints — ensemble fan-out.' },
  { id: 'google-ai-studio', name: 'Google AI Studio (Gemini free tier)', category: 'LLM Gateway (free tier)', url: 'https://ai.google.dev/', access: 'freemium', keyEnv: 'GEMINI_API_KEY', note: 'Free-tier Gemini Flash for long-context review/grounding of annals.' },
  { id: 'cloudflare-ai', name: 'Cloudflare Workers AI', category: 'LLM Gateway (free tier)', url: 'https://developers.cloudflare.com/workers-ai/', access: 'freemium', keyEnv: 'CLOUDFLARE_API_TOKEN', note: 'Free daily-quota inference for Llama/Mistral/embedding models at the edge.' },
  { id: 'huggingface-inference', name: 'Hugging Face Inference API', category: 'LLM Gateway (free tier)', url: 'https://huggingface.co/docs/api-inference', access: 'freemium', keyEnv: 'HUGGINGFACE_API_TOKEN', note: 'Free-tier hosted inference for thousands of open models (classify/summarize/embed).' },
  { id: 'mistral', name: 'Mistral La Plateforme (free tier)', category: 'LLM Gateway (free tier)', url: 'https://docs.mistral.ai/', access: 'freemium', keyEnv: 'MISTRAL_API_KEY', note: 'Free experimentation tier for Mistral models — code/text review and summarization.' },
  { id: 'ollama', name: 'Ollama (self-host, local)', category: 'LLM Gateway (free tier)', url: 'https://github.com/ollama/ollama', access: 'open', note: 'Run small models locally with an OpenAI-compatible API — zero cost, zero key, the ensemble floor.' },

  // ── CODE REVIEW ─────────────────────────────────────────────────────────────────────────────
  { id: 'codium-pr-agent', name: 'Qodo (PR-Agent) review', category: 'Code Review', url: 'https://github.com/qodo-ai/pr-agent', access: 'freemium', keyEnv: 'QODO_API_KEY', note: 'Open-source AI PR reviewer (describe/review/improve); self-host with a model key.' },
  { id: 'coderabbit', name: 'CodeRabbit AI review', category: 'Code Review', url: 'https://coderabbit.ai/', access: 'freemium', keyEnv: 'CODERABBIT_API_KEY', note: 'AI code-review bot for PRs (free for open-source) — line-level suggestions.' },
  { id: 'sourcery', name: 'Sourcery', category: 'Code Review', url: 'https://sourcery.ai/', access: 'freemium', keyEnv: 'SOURCERY_TOKEN', note: 'AI refactoring + review suggestions; free for open-source projects.' },

  // ── LINT & STATIC ANALYSIS ──────────────────────────────────────────────────────────────────
  { id: 'sonarcloud', name: 'SonarCloud', category: 'Lint & Static Analysis', url: 'https://sonarcloud.io/', access: 'freemium', keyEnv: 'SONAR_TOKEN', note: 'Code-quality + security static analysis as a service; free for public repos.' },
  { id: 'codacy', name: 'Codacy API', category: 'Lint & Static Analysis', url: 'https://api.codacy.com/', access: 'freemium', keyEnv: 'CODACY_API_TOKEN', note: 'Automated code review / quality grades across many languages (free for OSS).' },
  { id: 'deepsource', name: 'DeepSource', category: 'Lint & Static Analysis', url: 'https://deepsource.io/', access: 'freemium', keyEnv: 'DEEPSOURCE_DSN', note: 'Continuous static analysis with autofix; free tier for small/OSS projects.' },
  { id: 'languagetool', name: 'LanguageTool API', category: 'Lint & Static Analysis', url: 'https://languagetool.org/http-api/', access: 'freemium', keyEnv: 'LANGUAGETOOL_API_KEY', note: 'Grammar/style/spell check for prose — clean up annal/brief text (free public tier, self-hostable).' },

  // ── GROUNDING & FACT-CHECK ──────────────────────────────────────────────────────────────────
  { id: 'wikimedia-rest', name: 'Wikimedia / Wikipedia REST API', category: 'Grounding & Fact-check', url: 'https://www.mediawiki.org/wiki/API:REST_API', access: 'open', note: 'Keyless article summaries/extracts for grounding claims in annals/briefs.' },
  { id: 'wikidata-sparql', name: 'Wikidata SPARQL / REST', category: 'Grounding & Fact-check', url: 'https://query.wikidata.org/', access: 'open', note: 'Keyless structured-fact lookups (entities, relations, identifiers) for verification.' },
  { id: 'tavily', name: 'Tavily Search API', category: 'Grounding & Fact-check', url: 'https://docs.tavily.com/', access: 'freemium', keyEnv: 'TAVILY_API_KEY', note: 'LLM-oriented web search returning cited snippets — grounding for briefs (free tier).' },
  { id: 'serper', name: 'Serper (Google Search API)', category: 'Grounding & Fact-check', url: 'https://serper.dev/', access: 'freemium', keyEnv: 'SERPER_API_KEY', note: 'Fast Google SERP/results API for fact-finding with a free starter credit.' },
  { id: 'crossref', name: 'Crossref REST API', category: 'Grounding & Fact-check', url: 'https://api.crossref.org/', access: 'open', note: 'Keyless scholarly-metadata lookups (DOIs, citations) to ground research claims.' },

  // ── QUALITY & EVAL ──────────────────────────────────────────────────────────────────────────
  { id: 'ragas', name: 'Ragas (RAG eval, lib)', category: 'Quality & Eval', url: 'https://docs.ragas.io/', access: 'open', note: 'Faithfulness / answer-relevance / context metrics for grounded briefs; runs locally.' },
  { id: 'deepeval', name: 'DeepEval (LLM eval, lib)', category: 'Quality & Eval', url: 'https://docs.confident-ai.com/', access: 'freemium', keyEnv: 'CONFIDENT_API_KEY', note: 'Hallucination/faithfulness/G-Eval scoring for drafts; library is free + local.' },
  { id: 'promptfoo', name: 'promptfoo', category: 'Quality & Eval', url: 'https://www.promptfoo.dev/', access: 'open', note: 'Prompt/model eval + red-team harness; keyless CLI you run yourself.' },
  { id: 'langfuse', name: 'Langfuse (trace/eval)', category: 'Quality & Eval', url: 'https://langfuse.com/docs', access: 'freemium', keyEnv: 'LANGFUSE_SECRET_KEY', note: 'Self-hostable tracing + scoring of model calls; free cloud tier for low volume.' },
];

// ── ACCESSORS ──────────────────────────────────────────────────────────────────────────────────
// All accessors operate over both lists combined unless a list is passed explicitly. Pure + soft-fail.

const ALL = () => [...SECURITY_APIS, ...AI_REVIEW_APIS];

/** Entries grouped by category. Pass a list (defaults to SECURITY_APIS) → { [category]: entry[] }. */
export function byCategory(list = SECURITY_APIS) {
  const arr = Array.isArray(list) ? list : [];
  const out = {};
  for (const e of arr) {
    if (!e || typeof e.category !== 'string') continue;
    (out[e.category] ||= []).push(e);
  }
  return out;
}

/** Entries usable with no key/signup (access === 'open'). Defaults to SECURITY_APIS. */
export function keyless(list = SECURITY_APIS) {
  const arr = Array.isArray(list) ? list : [];
  return arr.filter((e) => e && e.access === 'open');
}

/** Find an entry by id across BOTH catalogs (security + AI). Returns the entry or null. */
export function find(id) {
  if (!id) return null;
  return ALL().find((e) => e && e.id === id) || null;
}

/** Adapter: normalize every entry into the Resource-Center ingest record shape. Pure. */
export function forResourceCenter() {
  return ALL().map((e) => ({
    id: e.id,
    title: e.name,
    kind: SECURITY_APIS.includes(e) ? 'security-api' : 'ai-review-api',
    category: e.category,
    url: e.url,
    access: e.access,
    keyless: e.access === 'open',
    keyEnv: e.keyEnv || null,
    description: e.note || '',
  }));
}

/** Counts: totals, by-category, and by-access for each list. Pure. */
export function summary() {
  const accessCounts = (arr) => {
    const c = { open: 0, freemium: 0, key: 0 };
    for (const e of arr) if (e && c[e.access] != null) c[e.access] += 1;
    return c;
  };
  const catCounts = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v.length]));
  return {
    security: {
      total: SECURITY_APIS.length,
      byCategory: catCounts(byCategory(SECURITY_APIS)),
      byAccess: accessCounts(SECURITY_APIS),
    },
    aiReview: {
      total: AI_REVIEW_APIS.length,
      byCategory: catCounts(byCategory(AI_REVIEW_APIS)),
      byAccess: accessCounts(AI_REVIEW_APIS),
    },
    total: SECURITY_APIS.length + AI_REVIEW_APIS.length,
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

/** Render a catalog as an escaped table. format: 'html' (default) or 'md'. Pure, never throws. */
export function renderCatalog(list = SECURITY_APIS, format = 'html') {
  const arr = Array.isArray(list) ? list : [];
  if (format === 'md') {
    const head = '| Name | Category | Access | Key (env) | Notes |\n|---|---|---|---|---|';
    const rows = arr.map((e) => {
      const key = e.keyEnv ? `\`${e.keyEnv}\`` : '—';
      // pipes inside cells would break the table — neutralize them.
      const cell = (v) => esc(v).replace(/\|/g, '\\|');
      return `| [${cell(e.name)}](${cell(e.url)}) | ${cell(e.category)} | ${cell(e.access)} | ${key === '—' ? '—' : '`' + cell(e.keyEnv) + '`'} | ${cell(e.note)} |`;
    });
    return [head, ...rows].join('\n');
  }
  const rows = arr.map((e) => {
    const key = e.keyEnv ? `<code>${esc(e.keyEnv)}</code>` : '&mdash;';
    return `    <tr>`
      + `<td><a href="${esc(e.url)}">${esc(e.name)}</a></td>`
      + `<td>${esc(e.category)}</td>`
      + `<td>${esc(e.access)}</td>`
      + `<td>${key}</td>`
      + `<td>${esc(e.note)}</td>`
      + `</tr>`;
  });
  return `<table class="security-api-catalog">\n`
    + `  <thead><tr><th>Name</th><th>Category</th><th>Access</th><th>Key (env)</th><th>Notes</th></tr></thead>\n`
    + `  <tbody>\n${rows.join('\n')}\n  </tbody>\n</table>`;
}

// CLI:  node integrations/security-api-catalog.mjs            (prints the summary)
//       node integrations/security-api-catalog.mjs --md       (prints the markdown tables)
if (process.argv[1] && process.argv[1].endsWith('security-api-catalog.mjs')) {
  const s = summary();
  console.log('\nMELEK security-API + AI-review catalog');
  console.log('─'.repeat(64));
  console.log(`Security APIs: ${s.security.total}  (open ${s.security.byAccess.open} · freemium ${s.security.byAccess.freemium} · key ${s.security.byAccess.key})`);
  console.log(`AI-review APIs: ${s.aiReview.total}  (open ${s.aiReview.byAccess.open} · freemium ${s.aiReview.byAccess.freemium} · key ${s.aiReview.byAccess.key})`);
  console.log(`Total: ${s.total}`);
  console.log('\nSecurity by category:');
  for (const [c, n] of Object.entries(s.security.byCategory)) console.log(`  ${c.padEnd(34)} ${n}`);
  console.log('\nAI-review by category:');
  for (const [c, n] of Object.entries(s.aiReview.byCategory)) console.log(`  ${c.padEnd(34)} ${n}`);
  console.log('─'.repeat(64));
  if (process.argv.includes('--md')) {
    console.log('\n## Security APIs\n');
    console.log(renderCatalog(SECURITY_APIS, 'md'));
    console.log('\n## AI-review APIs\n');
    console.log(renderCatalog(AI_REVIEW_APIS, 'md'));
  }
}
