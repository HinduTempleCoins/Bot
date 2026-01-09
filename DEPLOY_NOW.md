# 🚀 DEPLOY BOT NOW - Simple Steps

## Problem Found:
Railway is running OLD code with `gemini-1.5-flash` (doesn't exist = 404 error)

## Solution:
Railway needs to deploy the NEW code with `gemini-2.5-flash-lite`

---

## Step 1: Force Railway to Redeploy

### Option A: Via Railway Dashboard (Easiest)
1. Go to https://railway.app/dashboard
2. Select your bot project
3. Click on the service
4. Click "Redeploy" or "Restart"
5. Wait 2-3 minutes for build

### Option B: Push Again to Trigger Deploy
```bash
cd /path/to/Bot
git checkout claude/discord-bot-gemini-6xYFz
git commit --allow-empty -m "Trigger Railway redeploy"
git push origin claude/discord-bot-gemini-6xYFz
```

---

## Step 2: Verify It Worked

Check Railway logs for:
```
✅ Knowledge base loaded successfully
🌿 Van Kush Family Bot is ready!
✅ Logged in as VanKushFamilyMod#...
📊 Price monitoring initialized
```

**NO MORE 404 ERRORS!**

---

## Step 3: Test in Discord

Try these commands:
```
@bot tell me about ancient egypt
/price VKBT
/generate hathor goddess
/rs3 dragon bones
```

Post a YouTube URL and watch it summarize!

---

## If Still Getting Errors:

### Check which branch Railway is using:
- Settings → Deploy → Branch
- Should be: `claude/discord-bot-gemini-6xYFz`
- If not, change it and save

### Check environment variables:
- DISCORD_TOKEN ✅ (must be set)
- GEMINI_API_KEY ✅ (must be set)
- Others optional for now

---

## After It's Working:

Add these optional API keys to make it even better:

```
GOOGLE_SEARCH_API_KEY=...      # Fallback when Wikipedia doesn't have answer
GOOGLE_SEARCH_ENGINE_ID=...    # Goes with above
YOUTUBE_API_KEY=...             # Adds video metadata
GOOGLE_MAPS_API_KEY=...         # Location searches
```

See RAILWAY_SETUP.md for how to get these keys.

---

**BOTTOM LINE**: Railway needs to pull the latest commit from `claude/discord-bot-gemini-6xYFz` branch.
