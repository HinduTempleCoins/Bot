# OpenRouter AI Integration Guide

**Purpose**: Add free AI alternative to Discord bot, replacing expired Gemini API

**Status**: ✅ Ready to integrate

---

## Why OpenRouter?

### Gemini Issues
- ❌ User's API key expired
- ❌ Free tier limited (1,000 requests/day, but key expired)
- ❌ Renewal requires SMS verification

### OpenRouter Benefits
- ✅ **100% FREE** Llama 4 Maverick model
- ✅ No API key expiration
- ✅ 17B active parameters (400B total MoE)
- ✅ 1 million token context window
- ✅ Multimodal (text + images)
- ✅ Easy signup at openrouter.ai

---

## Integration Steps

### 1. Install Dependencies

Already installed in package.json:
- axios ✅
- dotenv ✅

### 2. Get OpenRouter API Key

1. Go to https://openrouter.ai/
2. Sign up (free)
3. Go to https://openrouter.ai/keys
4. Create new API key
5. Copy key to .env file

### 3. Configure Environment

Edit `.env`:

```env
# OpenRouter AI (FREE Llama 4 Maverick - RECOMMENDED)
OPENROUTER_API_KEY=sk-or-v1-your-api-key-here
OPENROUTER_MODEL=meta-llama/llama-4-maverick:free

# Google / Gemini AI (Backup)
GEMINI_API_KEY=your_old_gemini_key
```

### 4. Modify index.js

Add OpenRouter import at top of file:

```javascript
// Add this after existing imports
import { OpenRouterAI, FallbackAI } from './openrouter-ai.js';
```

Replace Gemini initialization:

```javascript
// OLD CODE (Lines 145-150):
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

// NEW CODE:
// Initialize AI providers
const openRouterAI = new OpenRouterAI();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'placeholder');
const geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

// Fallback system: Try OpenRouter first, then Gemini
const model = new FallbackAI(openRouterAI, geminiModel);
```

That's it! The bot will now:
1. Try OpenRouter (free) first
2. Fall back to Gemini if OpenRouter fails
3. Show error if both fail

---

## Testing

### Test OpenRouter Connection

```bash
node -e "
import('./openrouter-ai.js').then(async ({ OpenRouterAI }) => {
  const ai = new OpenRouterAI();
  try {
    const result = await ai.generateContent('Say hello!');
    console.log('✅ SUCCESS:', result.response.text());
  } catch (error) {
    console.error('❌ FAILED:', error.message);
  }
});
"
```

Expected output:
```
✅ OpenRouter AI initialized with model: meta-llama/llama-4-maverick:free
✅ SUCCESS: Hello! How can I assist you today?
```

### Test Discord Bot

1. Start bot: `node index.js`
2. Send message mentioning bot
3. Check console for:
   ```
   🔄 Trying OpenRouter AI...
   ✅ OpenRouter succeeded
   ```

---

## Code Examples

### Basic Usage

```javascript
import { OpenRouterAI } from './openrouter-ai.js';

const ai = new OpenRouterAI();

// Simple prompt
const result = await ai.generateContent('Explain VKBT token');
console.log(result.response.text());

// With system context
const result2 = await ai.generateContent(
  'What is CURE token?',
  {
    systemContext: 'You are the Van Kush Family AI. Be helpful and friendly.',
    maxTokens: 500,
    temperature: 0.8
  }
);
console.log(result2.response.text());
```

### Multi-Turn Conversation

```javascript
import { OpenRouterAI } from './openrouter-ai.js';

const ai = new OpenRouterAI();
let conversationHistory = [];

// Turn 1
const turn1 = await ai.conversationTurn(
  conversationHistory,
  'Tell me about HIVE blockchain',
  'You are a HIVE blockchain expert.'
);
console.log('AI:', turn1.response);
conversationHistory = turn1.history;

// Turn 2
const turn2 = await ai.conversationTurn(
  conversationHistory,
  'What tokens can I trade on HIVE-Engine?'
);
console.log('AI:', turn2.response);
conversationHistory = turn2.history;
```

### Native Chat API

```javascript
const response = await ai.chat([
  { role: 'system', content: 'You are Van Kush AI' },
  { role: 'user', content: 'What is VKBT?' },
  { role: 'assistant', content: 'VKBT is...' },
  { role: 'user', content: 'How do I buy it?' }
]);

console.log(response.content);
console.log('Tokens used:', response.usage);
```

---

## Fallback System

The `FallbackAI` class automatically tries providers in order:

```javascript
import { OpenRouterAI, FallbackAI } from './openrouter-ai.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const openRouter = new OpenRouterAI();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const gemini = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

const ai = new FallbackAI(openRouter, gemini);

// Will try OpenRouter first, then Gemini
const result = await ai.generateContent('Hello!');

// Check which provider succeeded
console.log('Last successful provider:', ai.getLastProvider());
// Output: "openrouter" or "gemini"
```

---

## Available Free Models

```javascript
import { OpenRouterAI } from './openrouter-ai.js';

const models = OpenRouterAI.getFreeModels();
console.log(models);
```

Output:
```javascript
[
  {
    id: 'meta-llama/llama-4-maverick:free',
    name: 'Llama 4 Maverick (Free)',
    description: '17B active parameters, multimodal, 1M context',
    cost: 'FREE'
  },
  {
    id: 'meta-llama/llama-4-scout:free',
    name: 'Llama 4 Scout (Free)',
    description: 'Smaller, faster variant',
    cost: 'FREE'
  }
]
```

### Switch Models

```javascript
const ai = new OpenRouterAI();

// Default: Llama 4 Maverick
console.log(ai.getModel());
// meta-llama/llama-4-maverick:free

// Switch to Scout (smaller, faster)
ai.setModel('meta-llama/llama-4-scout:free');

// Or specify in constructor
const scoutAI = new OpenRouterAI('your-key', 'meta-llama/llama-4-scout:free');
```

---

## Error Handling

```javascript
try {
  const result = await ai.generateContent('Hello!');
  console.log(result.response.text());
} catch (error) {
  if (error.message.includes('API key')) {
    console.error('❌ OpenRouter API key not configured');
    console.error('   Set OPENROUTER_API_KEY in .env file');
  } else if (error.message.includes('rate limit')) {
    console.error('❌ Rate limit exceeded');
    console.error('   Wait a few minutes and try again');
  } else {
    console.error('❌ OpenRouter error:', error.message);
  }
}
```

---

## Monitoring & Debugging

### Console Output

When AI generation happens, you'll see:

```
🔄 Trying OpenRouter AI...
✅ OpenRouter succeeded
```

Or if OpenRouter fails:

```
🔄 Trying OpenRouter AI...
⚠️  OpenRouter failed, falling back to Gemini: Network error
🔄 Trying Gemini AI...
✅ Gemini succeeded
```

Or if both fail:

```
🔄 Trying OpenRouter AI...
⚠️  OpenRouter failed: API key invalid
🔄 Trying Gemini AI...
❌ Gemini also failed: API key expired
```

### Check Provider Status

```javascript
// Check if OpenRouter is configured
if (openRouterAI.isAvailable()) {
  console.log('✅ OpenRouter ready');
} else {
  console.log('❌ OpenRouter not configured');
}

// After generation, check which provider was used
console.log(`Last successful: ${fallbackAI.getLastProvider()}`);
```

---

## Performance Comparison

| Provider | Model | Cost | Speed | Quality |
|----------|-------|------|-------|---------|
| **OpenRouter** | Llama 4 Maverick | FREE | Fast | Excellent |
| OpenRouter | Llama 4 Scout | FREE | Very Fast | Good |
| Gemini | gemini-2.5-flash-lite | FREE (1K/day) | Very Fast | Excellent |
| Gemini | gemini-2.0-flash | $0.05/1M tokens | Fast | Good |

**Recommendation**: Use OpenRouter as primary, Gemini as backup.

---

## Troubleshooting

### "OpenRouter API key not configured"

**Solution**: Add to .env:
```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

### "All AI providers failed"

**Possible causes**:
1. No internet connection
2. Both API keys invalid
3. Rate limits exceeded
4. OpenRouter service down

**Solution**: Check console logs for specific error, verify API keys.

### "Chat completion failed"

**Possible causes**:
1. Prompt too long (>1M tokens)
2. Invalid message format
3. Model not available

**Solution**: Reduce prompt size, check message format.

### Bot not responding

**Check**:
1. Bot running: `pm2 list` or check terminal
2. OpenRouter key valid: Test with example above
3. Discord bot token valid
4. Bot has permission to read/send messages

---

## Integration Checklist

- [ ] OpenRouter API key obtained
- [ ] OPENROUTER_API_KEY added to .env
- [ ] openrouter-ai.js created in project root
- [ ] index.js modified (import + fallback initialization)
- [ ] Tested with `node -e` command
- [ ] Bot restarted
- [ ] Sent test message to Discord
- [ ] Verified console shows "OpenRouter succeeded"
- [ ] Removed old Gemini API key error handler

---

## Future Enhancements

### Planned Features
- [ ] Automatic model selection based on prompt length
- [ ] Token usage tracking and reporting
- [ ] Cost estimation (if switching to paid models)
- [ ] Conversation caching to reduce API calls
- [ ] Multimodal support (image input/output)

### Additional Free Models to Consider
- Mistral 7B (via Together AI)
- CodeLlama (code generation)
- Zephyr (chat-optimized)

---

## Related Files

- **openrouter-ai.js**: OpenRouter integration module
- **index.js**: Discord bot (needs modification)
- **.env.example**: Environment template (already updated)
- **FREE_AI_APIS.md**: Comprehensive guide to free AI options
- **GOOGLE_API_KEY_RENEWAL.md**: Gemini renewal guide (if needed)

---

**Status**: Ready to implement
**Impact**: Bot will work even if Gemini key expires
**Time to integrate**: 5 minutes
**Testing time**: 2 minutes

---

**Last Updated**: 2026-01-09
**Author**: Claude Code
