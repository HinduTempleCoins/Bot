# Free News / Video / Gov Data Sources — survey for the SoapBox Data News tab + Chiron
_Surveyed 2026-06-02. Verdict columns: Free? / Key? / Rate limit / Commercial-OK?_

## Recommended starter stack (wire these first — all keyless or near-keyless, commercial-safe)
1. **GDELT DOC 2.0** — `https://api.gdeltproject.org/api/v2/doc/doc?query=...&mode=ArtList&format=json` — keyless global news search; engine for the rotating Top-5 + world-events chyron. ~15-min refresh, 3-month window.
2. **Google News RSS** — `https://news.google.com/rss/search?q=Bitcoin&hl=en-US&gl=US&ceid=US:en` (+ base top-stories) — keyword + general headline river. Link out + attribute (aggregator gray area).
3. **Crypto publisher RSS** — CoinDesk `https://www.coindesk.com/arc/outboundfeeds/rss/` + Cointelegraph `https://cointelegraph.com/rss` — crypto-native News tab + ticker.
4. **USGS earthquakes** — `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson` (also all_day, significant_week) — keyless disaster ticker.
5. **NWS alerts** — `https://api.weather.gov/alerts/active` (requires a `User-Agent` header) — live US weather/emergency items.
6. **ReliefWeb API** — `https://api.reliefweb.int/v1/reports?appname=soapbox` — keyless global humanitarian/disaster headlines (UN OCHA). 1,000/day.
7. **Federal Register API** — `https://www.federalregister.gov/api/v1/documents.json` — keyless US gov/regulatory items (incl. crypto rulemaking).
8. **YouTube live embeds** — `https://www.youtube.com/embed/<id>` iframes of news orgs' official 24/7 live streams (Reuters, AP, DW, Al Jazeera, Bloomberg TV, NBC/ABC News Live) — no key for playback; legal when the channel allows embedding. Use the keyed YouTube Data API (server-side) only to DISCOVER current live IDs.

## 1. General news APIs (keyed, freemium — server-side proxy only)
| Source | Free tier | Key | Commercial? | Note |
|---|---|---|---|---|
| NewsData.io | 200 credits/day, snippets, 12h delay | yes | **YES** | Best commercial-safe keyed option |
| APITube.io | request-capped | yes | **YES** | Commercial-safe alternative |
| NewsAPI.org | ~100/day or Lite 1k/mo | yes | **NO** (dev only) | Paid $449+/mo for prod |
| GNews | 100/day | yes | NO (dev only) | Multi-language |
| Mediastack / Currents / TheNewsAPI | low free tiers | yes | limited | Backups |

## 2. Keyless / open feeds (the backbone)
GDELT DOC 2.0 (keyless, JSON), Google News RSS (keyless; named topic paths now 302→hash, search+base work), Bing News RSS (keyless secondary), publisher RSS (BBC/CoinDesk/Cointelegraph keyless; **Reuters/AP official RSS largely retired** — reach via GDELT/Google News). Common Crawl = archival only, skip for v1.

## 3. Free video news
YouTube Data API v3 (10,000 quota units/day; search=100 units → ≤100 searches/day; server-side). YouTube **embeds keyless** — news orgs run embeddable 24/7 live streams (cleanest free video path). Pluto TV FAST embeds (Bloomberg/CBS/NBC/Cheddar) = secondary, check ToS. Tubi/Fox LiveNow = link-out only.

## 4. Government APIs
| Source | Endpoint | Key | Status |
|---|---|---|---|
| Federal Register | `federalregister.gov/api/v1/documents.json` | **none** | ✅ keyless, public domain |
| govinfo | `api.govinfo.gov` | free api.data.gov key | ✅ bills/CFR/hearings |
| Congress.gov | `api.congress.gov/v3` | free key | ⚠️ 2026 instability — verify live |
| data.gov | per-API | usually x-api-key | ✅ gateway |
| White House feeds | whitehouse.gov RSS | none | ✅ press releases |
| GovTrack | — | — | ❌ shutting down — don't build on it |
| ProPublica Congress | — | — | ❌ discontinued |
| C-SPAN | — | — | ❌ no official API; video embeds/link-out only |

## 5. Wire services — honesty: mostly paid
Reuters / AP / AFP / Bloomberg have **no free live developer API**. Content readable on-site; APIs are paid (Reuters Connect, AP Media API, Bloomberg Enterprise). Get their journalism indirectly (GDELT/Google News surface their articles as links) + their video via free YouTube/FAST live embeds.

## 6. Disaster / weather / global (chyron enrichment — already partly wired in chyron.mjs)
USGS earthquakes (keyless GeoJSON ✅ wired), NWS api.weather.gov (keyless, needs UA ✅ wired), GDELT (keyless global conflict/war), ReliefWeb (keyless `appname`), NASA EONET `eonet.gsfc.nasa.gov/api/v3/events` (keyless natural events), ACLED (keyed, restricted — use GDELT for free real-time conflict).

## Honesty flags
- No major wire service = free/live API. Aggregate indirectly.
- GovTrack + ProPublica Congress are dead/dying; Congress.gov had 2026 outages — verify before depending.
- NewsAPI.org / GNews free tiers forbid commercial + client-side use → dev-only unless paid.
- Google/Bing News RSS + publisher RSS are aggregator gray areas → always link out + attribute, never republish full bodies.
