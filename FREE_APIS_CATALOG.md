# Free APIs for Van Kush Bot - Complete Catalog

## 🎯 Priority APIs (Recommended for Immediate Integration)

### AI & Language Processing
- **HuggingFace Inference API** - Free tier for text generation, sentiment, translation
  - URL: https://huggingface.co/inference-api
  - Auth: Required (free tier available)
  - Use case: Fallback AI when Gemini hits limits

### Communication & Notifications (FREE)
- **Discord Webhooks** - Built-in Discord feature (no API key needed!)
  - URL: Create in Discord channel settings
  - Auth: None (webhook URL is the auth)
  - Use case: Send automated messages, alerts, summaries

- **Telegram Bot API** - Free unlimited messaging
  - URL: https://core.telegram.org/bots/api
  - Auth: Bot token (free)
  - Use case: Backup notification system, cross-platform alerts

### Data & Information
- **Wikipedia API** - Already integrated! ✅
  - URL: Uses wtf_wikipedia npm package
  - Auth: None
  - Limit: Unlimited

- **Disease-sh API** - COVID-19 and global disease data
  - URL: https://disease.sh/
  - Auth: None
  - Use case: Health information queries

- **BBC API** - News in 29 languages
  - URL: https://bbc-api.vercel.app/
  - Auth: None
  - Use case: News summaries for community

---

## 🎨 Image & Media APIs

### **Free (No Authentication Required)**

#### Animals & Nature
- **HTTP.cat** - https://http.cat
  - Cat images for HTTP status codes
  - No auth, unlimited

- **Random Dog** - https://random.dog/woof.json
  - Random dog pictures
  - No auth, unlimited

- **Random Fox** - https://randomfox.ca/floof/
  - Fox pictures
  - No auth, unlimited

- **Random Duck** - https://random-d.uk/api
  - Duck pictures
  - No auth, unlimited

#### Anime & Gaming
- **Nekos.best** - https://nekos.best
  - Anime imagery
  - No auth, unlimited

- **Nekos.life** - https://nekos.life/api/v2/endpoints
  - Character images and GIFs
  - No auth, unlimited

- **Waifu.pics** - https://waifu.pics/docs
  - Anime imagery (SFW and NSFW)
  - No auth, unlimited

- **PokeAPI** - https://pokeapi.co/
  - Complete Pokémon database
  - No auth, unlimited

#### Memes & Fun
- **MemeGen** - https://memegen.link/
  - Add text to meme templates
  - No auth, unlimited

- **Pop Cat API** - https://popcat.xyz/api
  - Image generation and meme tools
  - No auth, unlimited

---

## 💬 Chat, Jokes & Entertainment

### **Free (No Authentication)**

- **Advice Slip API** - https://api.adviceslip.com/
  - Random advice with topic filtering
  - Perfect for daily wisdom posts

- **Affirmations** - https://www.affirmations.dev/
  - Positive affirmations
  - Use for motivation posts

- **Animechan** - https://animechan.vercel.app/
  - Anime quotes
  - Community engagement

- **Forismatic** - https://forismatic.com/en/api/
  - Inspirational quotes
  - Daily motivation feature

- **Joke API** - https://v2.jokeapi.dev/
  - Various joke categories
  - Entertainment feature

- **icanhazdadjoke** - https://icanhazdadjoke.com/
  - Dad jokes
  - Fun community engagement

- **Chuck Norris API** - https://api.chucknorris.io/
  - Chuck Norris facts
  - Easter egg content

- **Evilinsult** - https://evilinsult.com/generate_insult.php?lang=en&type=json
  - Creative insults (use sparingly!)
  - Fun roast commands

- **Trivia API** - https://the-trivia-api.com/
  - Trivia questions for games
  - **🎮 PERFECT for interactive quiz games!**

---

## 🔍 Information & Utility APIs

### **Free (No Authentication)**

- **Agify** - https://agify.io
  - Estimate age from name
  - Community stats feature

- **Genderize** - https://genderize.io/
  - Gender prediction from names
  - User profiling (opt-in)

- **Nationalize** - https://nationalize.io
  - Nationality prediction from names
  - Cultural awareness

- **Urban Dictionary** - https://api.urbandictionary.com/v0/define?term=word
  - Slang definitions
  - Community language learning

- **Numbers API** - http://numbersapi.com
  - Interesting number facts
  - Fun educational content

- **Deck of Cards API** - https://deckofcardsapi.com/
  - Card game creation
  - **🎮 PERFECT for card games!**

### **Free (Requires Auth/Key)**

- **OpenWeatherMap** - https://openweathermap.org/api
  - Weather data (60 calls/min free)
  - Location-based info

- **NASA API** - https://api.nasa.gov/
  - Astronomy Picture of the Day, Mars rover photos
  - Free tier: 1,000 requests/hour

---

## 💻 Developer & Code APIs

### **Free (No Authentication)**

- **MystBin API** - https://mystb.in/api/documentation
  - Code/text sharing
  - Share configs, scripts

- **Pastebin API** - https://pastebin.com/doc_api
  - Paste sharing
  - Share code snippets

- **PyPI** - https://docs.pypi.org/api/
  - Python package information
  - Developer resources

- **Reddit JSON** - https://www.reddit.com/r/SUBREDDIT/hot.json
  - Reddit content (replace SUBREDDIT)
  - Community aggregation

---

## 🎮 Gaming APIs

### **Free (No Authentication)**

- **PokeAPI** - https://pokeapi.co/
  - Complete Pokémon database
  - Perfect for Pokemon games/trivia

- **Deck of Cards** - https://deckofcardsapi.com/
  - Virtual deck for card games
  - Game night features

### **Free (Requires Auth)**

- **Fortnite-API** - https://dash.fortnite-api.com
  - Fortnite data
  - Gaming community stats

---

## 🌐 Minecraft & Gaming

- **Minotar** - https://minotar.net/
  - Minecraft avatar service
  - No auth, unlimited
  - Player skin rendering

---

## 🚀 RECOMMENDED INTEGRATION PRIORITIES

### Phase 1: Immediate Value (This Week)
1. **Trivia API** - Add `/trivia` command for quiz games
2. **Advice Slip** - Daily wisdom posts
3. **Deck of Cards** - `/blackjack` or `/poker` commands
4. **Joke API** - `/joke` command for entertainment
5. **PokeAPI** - Pokemon trivia/info commands

### Phase 2: Community Engagement (Next Week)
1. **Discord Webhooks** - Automated alerts for price changes
2. **Affirmations** - Morning motivation posts
3. **Animechan** - Anime quote integration
4. **Random Animals** - `/fox`, `/dog`, `/duck` commands
5. **Urban Dictionary** - `/define [word]` command

### Phase 3: Advanced Features (Future)
1. **NASA API** - Space facts and images
2. **OpenWeatherMap** - Weather info by location
3. **HuggingFace** - Fallback AI models
4. **Telegram Bot** - Cross-platform notifications

---

## 📊 API CATEGORIES SUMMARY

### No Authentication Required: 31 APIs
- Perfect for immediate integration
- No rate limits (most)
- Zero cost

### Requires Free API Key: 16 APIs
- Free tier available
- Reasonable limits
- Worth setting up

---

## 🔥 SPECIAL MENTIONS

### **Bing Services (As Requested)**
Microsoft Bing has several APIs:
- **Bing Web Search API** - $0 for first 1,000 queries/month
- **Bing News Search** - News aggregation
- **Bing Image Search** - Image search results
- URL: https://azure.microsoft.com/en-us/services/cognitive-services/bing-web-search-api/

### **Gemini CLI (As Requested)**
- **GitHub**: https://github.com/google-gemini/gemini-cli
- **Docs**: https://geminicli.com/docs/
- **Free Tier**: Up to 1,000 requests/day via Gemini Code Assist license
- **Setup**: Requires Google account authentication
- **Best For**: Local development, coding assistance

### **Alternative LLM APIs (Free Tier)**
- **Llama Models via Together.ai** - Free tier available
- **Groq** - Fast inference (free tier: 14,400 requests/day)
- **Anthropic Claude** - You're already paying for this! 😄

---

## 🎯 IMPLEMENTATION PLAN

### Immediate Wins (Can do TODAY):
```javascript
// 1. Add trivia command
app.get('/trivia', () => fetch('https://the-trivia-api.com/api/questions'));

// 2. Add joke command
app.get('/joke', () => fetch('https://v2.jokeapi.dev/joke/Any'));

// 3. Add advice command
app.get('/advice', () => fetch('https://api.adviceslip.com/advice'));

// 4. Add animal commands
app.get('/dog', () => fetch('https://random.dog/woof.json'));
app.get('/fox', () => fetch('https://randomfox.ca/floof/'));
```

### This Weekend:
1. Set up Discord webhooks for automated posts
2. Integrate Deck of Cards API for card games
3. Add Pokemon info commands with PokeAPI
4. Create `/define` command with Urban Dictionary

### Next Week:
1. Build interactive quiz game with Trivia API
2. Add daily scheduled posts with Advice/Affirmation APIs
3. Implement gaming features (Blackjack, Pokemon battles)
4. Cross-post to Telegram for broader reach

---

## 📚 SOURCES
- [Discord Bot APIs Collection](https://gist.github.com/Soheab/332ba85f8989648449c71bdc8ef32368)
- [DevSpen Discord Bot APIs](https://github.com/DevSpen/Discord-Bot-APIs)
- [Gemini API Rate Limits 2026](https://blog.laozhang.ai/api-guides/gemini-api-free-tier/)
- [Gemini CLI Documentation](https://geminicli.com/docs/)

---

**Last Updated**: 2026-01-09
**Total Free APIs Cataloged**: 47
**Zero-Auth APIs**: 31
**Free-Tier APIs**: 16
