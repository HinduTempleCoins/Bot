# Van Kush Family Discord Bot 🌿

A comprehensive Discord bot for the Van Kush Family ecosystem, featuring AI conversation, art generation, crypto monitoring, and more - **100% FREE APIs!**

## Why This Bot?

- ✅ **100% FREE**: All APIs are free tier (Gemini, Pollinations.ai, HIVE-Engine)
- ✅ **No Credit Card Required**: Unlike Claude's $5 trial credit
- ✅ **Multi-Functional**: Chat, art, crypto prices, YouTube summaries, search
- ✅ **Easy Setup**: Get started in minutes with free APIs

## Core Features

### 🤖 AI Conversation (Gemini 2.5 Flash)
- Natural conversation with 75,000-year Van Kush Family knowledge
- Context awareness per channel
- Warm, wise, knowledgeable responses
- **NEW: Vision - Can see and analyze images!** 👁️
- FREE: 1,500 requests/day

### 🎨 AI Art Generation (Pollinations.ai)
- `/generate [prompt]` - Create vaporwave/Egyptian style art
- Unlimited FREE generations
- Perfect for Hathor-Mehit character art

### 💰 Crypto Price Monitoring (HIVE-Engine)
- `/price [token]` - Get real-time VKBT/CURE prices
- Automatic price alerts when >5% movement
- FREE unlimited price checks every 5 minutes

### 📺 YouTube Integration
- Auto-summarizes videos when URLs posted
- Fetches transcripts and creates summaries with Gemini
- FREE: Works without YouTube API key

### 🔍 Google Search Integration (Optional)
- Bot can search Google when answering questions
- Cites sources in responses
- FREE: 100 searches/day with Custom Search API

### 📚 Van Kush Family Knowledge Base
- 75,000-year history (Denisovan origins → present)
- RuneScape 3 clan information
- Cryptocurrency tokens (VKBT, VKRW, PUTI)
- Book of Tanit research
- Shaivite Temple information
- Angel theology and Angelicalism

## Quick Start

### 1. Get Your API Keys (Both FREE!)

#### Discord Bot Token
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Go to "Bot" section
4. Click "Add Bot"
5. Enable these intents:
   - Message Content Intent
   - Server Members Intent
   - Presence Intent
6. Copy your bot token

#### Gemini API Key (FREE!)
1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click "Create API Key"
3. Copy your API key
4. That's it! You get 1,000 free requests per day forever!

### 2. Local Setup

```bash
# Clone the repository
git clone <your-repo-url>
cd Bot

# Install dependencies
npm install

# Create .env file from example
cp .env.example .env

# Edit .env and add your tokens
# DISCORD_TOKEN=your_discord_bot_token_here
# GEMINI_API_KEY=your_gemini_api_key_here

# Run the bot
npm start

# Or run in development mode with auto-reload
npm run dev
```

### 3. Invite Bot to Your Server

1. Go to Discord Developer Portal
2. Select your application
3. Go to "OAuth2" → "URL Generator"
4. Select scopes:
   - `bot`
   - `applications.commands`
5. Select bot permissions:
   - Read Messages/View Channels
   - Send Messages
   - Read Message History
6. Copy the generated URL and open it in your browser
7. Select your server and authorize

## Deploy to Railway

Railway offers free hosting for hobby projects!

### Step 1: Prepare Your Repository
```bash
# Make sure all changes are committed
git add .
git commit -m "Initial bot setup"
git push
```

### Step 2: Deploy on Railway
1. Go to [Railway.app](https://railway.app)
2. Sign up with GitHub
3. Click "New Project"
4. Select "Deploy from GitHub repo"
5. Select this repository
6. Railway will auto-detect the configuration

### Step 3: Add Environment Variables
In Railway dashboard:
1. Go to your project
2. Click "Variables"
3. Add:
   - `DISCORD_TOKEN` = your Discord bot token
   - `GEMINI_API_KEY` = your Gemini API key

### Step 4: Deploy
- Railway will automatically deploy
- Check logs to confirm bot is running
- Look for: "✅ Logged in as [BotName]"

## Usage

### In Discord Servers
Mention the bot to start a conversation:
```
@VanKushBot Hello! What is the Temple of Van Kush?
```

### In DMs
Just send a message directly - no need to mention:
```
Tell me about mindfulness practices
```

## Customization

### Update Knowledge Base
Edit `knowledge-base.json` to customize:
- Temple information
- Values and guidelines
- Activities and FAQs
- Bot personality and tone

### Modify Bot Behavior
Edit `index.js` to change:
- Response style
- Command handling
- Conversation history length
- Error messages

## File Structure

```
Bot/
├── index.js              # Main bot code
├── knowledge-base.json   # Temple information and bot personality
├── package.json          # Dependencies and scripts
├── .env.example          # Environment variables template
├── .gitignore           # Git ignore rules
├── railway.json         # Railway deployment config
├── Procfile            # Process configuration
└── README.md           # This file
```

## Troubleshooting

### Bot doesn't respond
- Make sure "Message Content Intent" is enabled in Discord Developer Portal
- Check that the bot has permissions to read and send messages
- Verify your API keys are correct in `.env`

### "Invalid API Key" error
- Double-check your Gemini API key from [AI Studio](https://aistudio.google.com/app/apikey)
- Make sure there are no extra spaces in `.env` file

### Railway deployment fails
- Check Railway logs for specific errors
- Verify environment variables are set correctly
- Ensure `railway.json` and `Procfile` are in repository

## Cost Breakdown

- **Gemini API**: FREE (1,000 requests/day forever) 🎉
- **Discord Bot**: FREE
- **Railway Hosting**: FREE tier available ($5/month for hobby)

**Total monthly cost**: $0-5 (vs $20+ with Claude API)

## Links

- [Get Gemini API Key (FREE)](https://aistudio.google.com/app/apikey)
- [Discord Developer Portal](https://discord.com/developers/applications)
- [Railway Hosting](https://railway.app)
- [Discord.js Documentation](https://discord.js.org)
- [Gemini API Documentation](https://ai.google.dev/docs)

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review Railway logs if deployed
3. Verify all API keys are correct
4. Check Discord bot permissions

## License

ISC

---

Built with 💚 for the Temple of Van Kush community
