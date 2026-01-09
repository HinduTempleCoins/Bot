# Railway Environment Variables Setup

## Required (Already Have):
```
DISCORD_TOKEN=your_discord_bot_token
GEMINI_API_KEY=your_gemini_api_key
```

## Optional (Adds More Features):

### Google Custom Search (100 searches/day free)
1. Go to https://console.cloud.google.com/
2. Create project or select existing
3. Enable "Custom Search API"
4. Create API key
5. Go to https://programmablesearchengine.google.com/
6. Create search engine (search entire web)
7. Get Search Engine ID

Add to Railway:
```
GOOGLE_SEARCH_API_KEY=AIza...
GOOGLE_SEARCH_ENGINE_ID=...
```

### YouTube Data API (10,000 quota/day free)
1. Go to https://console.cloud.google.com/
2. Enable "YouTube Data API v3"
3. Create API key

Add to Railway:
```
YOUTUBE_API_KEY=AIza...
```

### Google Maps API (Geocoding)
1. Go to https://console.cloud.google.com/
2. Enable "Geocoding API"
3. Create API key
4. Restrict to Geocoding API only

Add to Railway:
```
GOOGLE_MAPS_API_KEY=AIza...
```

### Discord Channel IDs (Optional - for scheduled posts)
1. Enable Developer Mode in Discord (User Settings → Advanced)
2. Right-click channels → Copy ID

Add to Railway:
```
ANNOUNCEMENT_CHANNEL_ID=123456789...
PRICE_ALERT_CHANNEL_ID=123456789...
```

## How to Add to Railway:
1. Go to https://railway.app/
2. Select your project
3. Click on your service
4. Go to "Variables" tab
5. Click "New Variable"
6. Paste variable name and value
7. Click "Add"
8. Railway will auto-redeploy

## Priority:
- **REQUIRED**: DISCORD_TOKEN, GEMINI_API_KEY
- **HIGH**: GOOGLE_SEARCH_API_KEY + ENGINE_ID (fallback when Wikipedia doesn't have answer)
- **MEDIUM**: YOUTUBE_API_KEY (adds video metadata)
- **LOW**: GOOGLE_MAPS_API_KEY, CHANNEL_IDs
