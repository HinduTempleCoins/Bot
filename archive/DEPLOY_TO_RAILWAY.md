# Deploy Van Kush Bot to Railway - Step by Step

## Prerequisites
- GitHub account with this repository
- Railway account (free - sign up at railway.app)

## Deployment Steps

### Step 1: Sign Up for Railway
1. Go to: https://railway.app
2. Click **"Login"** or **"Start a New Project"**
3. Click **"Login With GitHub"**
4. Authorize Railway to access your GitHub account

### Step 2: Create New Project
1. Once logged in, click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. You may need to **"Configure GitHub App"** first:
   - Click "Configure GitHub App"
   - Select "HinduTempleCoins" organization (or your personal account)
   - Grant access to the "Bot" repository
   - Go back to Railway

### Step 3: Select Repository
1. Find and select **"HinduTempleCoins/Bot"** from the list
2. Click on the repository to deploy it
3. Railway will detect your project and start deploying

### Step 4: Select Branch
1. Railway may ask which branch to deploy
2. Select: **`claude/discord-bot-gemini-6xYFz`**
3. Click **"Deploy"**

### Step 5: Add Environment Variables (CRITICAL!)
1. Click on your deployed service
2. Click the **"Variables"** tab
3. Click **"New Variable"**
4. Add these TWO variables:

**Variable 1:**
```
Name: DISCORD_TOKEN
Value: [Your Discord bot token from discord.com/developers/applications]
       (Starts with: MTQ1NzcxNjU1...)
```

**Variable 2:**
```
Name: GEMINI_API_KEY
Value: [Your Gemini API key from aistudio.google.com]
       (Starts with: AIzaSy...)
```

**Your actual values:**
- DISCORD_TOKEN: Check your local `.env` file or Discord Developer Portal
- GEMINI_API_KEY: Check your local `.env` file or Google AI Studio

5. Click **"Add"** or **"Save"** after each variable

### Step 6: Redeploy (if needed)
1. If the deployment started before you added variables, click **"Redeploy"**
2. Or Railway will automatically redeploy when you add variables

### Step 7: Check Deployment Logs
1. Click the **"Deployments"** tab
2. Click on the latest deployment
3. View the logs - you should see:
   ```
   ✅ Knowledge base loaded successfully
   ✅ Logged in as [Your Bot Name]
   🌿 Temple of Van Kush Bot is ready!
   ```

### Step 8: Test Your Bot!
1. Go to your Van Kush Community Discord server
2. In any channel, mention your bot:
   ```
   @YourBotName Hello! What is the Temple of Van Kush?
   ```
3. Or send it a DM directly

## Troubleshooting

### Bot doesn't respond
- Check Railway logs for errors
- Verify both environment variables are set correctly
- Make sure Message Content Intent is enabled in Discord Developer Portal
- Confirm bot is in your server with proper permissions

### "Invalid Token" error
- Double-check DISCORD_TOKEN in Railway variables
- No extra spaces or quotes around the token
- Token should start with: MTQ1NzcxNjU1...

### "Invalid API Key" error
- Verify GEMINI_API_KEY in Railway variables
- Should start with: AIzaSy...
- Check no extra spaces or quotes

### Deployment fails
- Check Railway logs for specific error
- Ensure package.json and index.js are in repository
- Verify railway.json configuration is present

## Cost
- **Railway Free Tier**: $5 trial credit or 500 execution hours/month
- **Gemini API**: FREE - 1,000 requests/day forever
- **Discord Bot**: FREE

## Railway Dashboard URLs
- Main Dashboard: https://railway.app/dashboard
- Project Settings: Click your project → Settings
- Environment Variables: Click your project → Variables
- Deployment Logs: Click your project → Deployments → Latest

## Important Notes
- Your bot will run 24/7 on Railway
- Railway auto-deploys when you push to GitHub
- Free tier may sleep after inactivity (upgrade to $5/month to prevent this)
- Logs are available in real-time in Railway dashboard

## Success Indicators
✅ Deployment status shows "Active" or "Success"
✅ Logs show "Logged in as [BotName]"
✅ Bot appears online in Discord
✅ Bot responds to mentions and DMs

---

Your Van Kush Temple Bot is now running 24/7! 🌿
