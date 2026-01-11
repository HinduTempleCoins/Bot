# Google Gemini API Key Renewal Guide

**Issue:** Your Google Gemini API key has expired, causing all AI features in the Discord bot to fail.

**Error Message:**
```
API key expired. Please renew the API key.
code: 400
reason: API_KEY_INVALID
```

---

## Quick Fix Steps

### 1. Get a New API Key

Go to Google AI Studio:
**https://makersuite.google.com/app/apikey**

Or alternatively:
**https://aistudio.google.com/app/apikey**

### 2. Generate New Key

1. Click **"Create API Key"** or **"Get API Key"**
2. Select your Google Cloud project (or create a new one)
3. Copy the generated API key (it will look like: `AIzaSyC-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)

### 3. Update Your `.env` File

Open the `.env` file in this directory and update the line:

```env
GOOGLE_API_KEY=your_new_key_here
```

Replace `your_new_key_here` with the key you just copied.

### 4. Restart the Bot

If the bot is running, restart it to load the new key:

```bash
# If using PM2:
pm2 restart index

# If running directly:
# Stop the bot (Ctrl+C) and start again:
node index.js
```

---

## Verification

Test if the API key is working:

```bash
# Test in terminal:
node -e "require('dotenv').config(); const { GoogleGenerativeAI } = require('@google/generative-ai'); const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY); genAI.getGenerativeModel({ model: 'gemini-pro' }).generateContent('Hello').then(() => console.log('✅ API key is working!')).catch(err => console.error('❌ API key error:', err.message));"
```

Or test in Discord:
- Use the `/cryptology` command
- Ask the bot a question about ancient mysteries
- Try the Crypt-ology interactive buttons

---

## Troubleshooting

### "API key not found" Error

Make sure your `.env` file has this line:
```env
GOOGLE_API_KEY=AIzaSyC-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

And that you've restarted the bot after updating it.

### "Billing not enabled" Error

Google Gemini API requires billing to be enabled (but has a generous free tier):

1. Go to https://console.cloud.google.com/billing
2. Enable billing for your project
3. The free tier includes:
   - 60 requests per minute
   - 1,500 requests per day
   - Completely free up to these limits

### "Quota exceeded" Error

If you're hitting rate limits:
- The bot caches responses to reduce API calls
- Consider upgrading to a paid plan for higher limits
- Or implement additional caching/rate limiting

---

## API Key Security

**Important Security Notes:**

1. **Never commit `.env` to git:**
   ```bash
   # Make sure .gitignore includes:
   .env
   ```

2. **Keep your API key secret:**
   - Don't share it publicly
   - Don't paste it in Discord or other public channels
   - Rotate it periodically (every 90 days recommended)

3. **Restrict API key usage:**
   - In Google Cloud Console, restrict the key to only Generative Language API
   - Add IP restrictions if possible

---

## Affected Features

These Discord bot features require the Google Gemini API key:

1. **Crypt-ology System**
   - `/cryptology` command
   - Interactive dialogue trees
   - Ancient mysteries explanations

2. **AI Conversations**
   - Natural language chat with the bot
   - Context-aware responses
   - Van Kush Family assistant personality

3. **Knowledge Base Queries**
   - Questions about Van Kush history
   - Maritime history
   - Token information

When the API key is expired, these features will show error messages instead of working properly.

---

## Alternative: Free API Key Workaround

If you don't want to enable billing, you can:

1. **Use a different AI model:**
   - Switch to OpenAI GPT (requires OpenAI API key)
   - Use local LLMs via Ollama (free but requires more setup)

2. **Disable AI features temporarily:**
   - Comment out Gemini-dependent code
   - Bot will still work for price checks, art generation, etc.

---

## Need Help?

If you continue to have issues:
1. Check the bot logs for detailed error messages
2. Verify your API key is copied correctly (no extra spaces)
3. Ensure the key hasn't been deleted in Google Cloud Console
4. Try generating a completely new key instead of reusing an old one

---

**After updating the key, all Gemini features should work immediately!**
