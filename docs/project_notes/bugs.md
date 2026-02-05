# Bug Log

## 2026-01-10 - CURE Paper Wall Detection

- **Issue**: CURE paper walls not being detected correctly
- **Root Cause**: Only checking `costUSD`, not also checking `currentPrice`
- **Solution**: Updated to check both `costUSD` AND `currentPrice` for wall detection
- **Prevention**: Always validate detection logic against both metrics

## 2026-01-10 - CURE Target Price Too Low

- **Issue**: CURE target price set to 0.001 HIVE (too low for 1:1 parity)
- **Root Cause**: Initial conservative estimate didn't match strategy goal
- **Solution**: Updated target to 1.0 HIVE for 1:1 parity minimum
- **Prevention**: Verify target prices match strategic goals before deployment

## 2026-01-10 - HIVE-Engine API 404 with Axios

- **Issue**: Axios returning 404 for HIVE-Engine API calls
- **Root Cause**: Axios header/request format incompatible with HIVE-Engine API
- **Solution**: Created `hive-engine-api.cjs` with curl-based wrapper (100% reliable)
- **Prevention**: Use curl wrapper for HIVE-Engine calls, not raw axios

## 2026-01-09 - Sacred-Texts/Theoi 403/SSL Errors

- **Issue**: Web scrapers getting 403 and SSL errors from Sacred-Texts.com and Theoi.com
- **Root Cause**: Sites block automated access (robots.txt / cloudflare)
- **Solution**: Noted for manual extraction; will check Archive.org as alternative
- **Prevention**: Always check robots.txt before scraping; have fallback sources ready
