import { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import axios from 'axios';
import cron from 'node-cron';
import { YoutubeTranscript } from 'youtube-transcript';
import wtf from 'wtf_wikipedia';
import NodeCache from 'node-cache';

dotenv.config();

// Initialize caching (30 minutes TTL)
const cache = new NodeCache({ stdTTL: 1800, checkperiod: 120 });

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Using gemini-2.5-flash-lite: BEST free tier model (1,000 requests/day, 15 RPM)
// Source: https://blog.laozhang.ai/api-guides/gemini-api-free-tier/
// Alternatives: gemini-2.5-flash (only 20/day), gemini-2.0-flash-exp (5 RPM, limited)
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

// Load knowledge base
let knowledgeBase;
try {
  const data = await readFile('./knowledge-base.json', 'utf8');
  knowledgeBase = JSON.parse(data);
  console.log('✅ Knowledge base loaded successfully');
} catch (error) {
  console.error('❌ Error loading knowledge base:', error);
  process.exit(1);
}

// Create system context from knowledge base
const systemContext = `You are the ${knowledgeBase.bot_identity.name}.

IDENTITY & PURPOSE:
${knowledgeBase.bot_identity.purpose}
Personality: ${knowledgeBase.bot_identity.personality}
Tone: ${knowledgeBase.bot_identity.tone}
Signature phrase: "${knowledgeBase.bot_identity.signature}"

CRITICAL FACTS - NEVER CONTRADICT THESE:
1. Van Kush Family IS REAL: ${knowledgeBase.CRITICAL_CORRECTIONS.van_kush_family_EXISTS}
2. 75,000-Year Lineage: ${knowledgeBase.CRITICAL_CORRECTIONS['75000_year_lineage']}
3. Three Entities: ${knowledgeBase.CRITICAL_CORRECTIONS.three_entities}

THE REAL FAMILY:
- Rev. Ryan Sasha-Shai Van Kush: ${knowledgeBase.van_kush_family_real.rev_ryan.full_name} (born ${knowledgeBase.van_kush_family_real.rev_ryan.birth_name})
  * Ordained: ${knowledgeBase.van_kush_family_real.rev_ryan.ordained}
  * Location: ${knowledgeBase.van_kush_family_real.rev_ryan.location}
  * Genetics: ${knowledgeBase.van_kush_family_real.rev_ryan.genetic_markers}
  * Identity: ${knowledgeBase.van_kush_family_real.rev_ryan.identity}
- Kali Van Kush: ${knowledgeBase.van_kush_family_real.kali_van_kush.role}

75,000-YEAR HISTORY (SCIENTIFICALLY VERIFIED):
- Denisovan Origins: ${knowledgeBase['75000_year_history'].denisovan_origins.scientific_proof}
- Mt. Hermon Watchers: ${knowledgeBase['75000_year_history'].mt_hermon_watchers.event}
- Phoenician/Punic Connection: ${knowledgeBase['75000_year_history'].phoenician_punic.van_kush_connection}

THEOLOGY (Book of Jude & Angels):
${knowledgeBase.book_of_jude_angels.why_central}
Doctrine: ${knowledgeBase.book_of_jude_angels.angelicalist_doctrine}

SHAIVITE TEMPLE (SEPARATE from family):
${knowledgeBase.shaivite_temple.what}
Deity: ${knowledgeBase.shaivite_temple.deity}
Relationship: ${knowledgeBase.shaivite_temple.relationship_to_family}

CRYPTOCURRENCY:
- VKBT: ${knowledgeBase.cryptocurrency.VKBT.name} on ${knowledgeBase.cryptocurrency.VKBT.blockchain} (${knowledgeBase.cryptocurrency.VKBT.status})
- VKRW: ${knowledgeBase.cryptocurrency.VKRW.name} on ${knowledgeBase.cryptocurrency.VKRW.blockchain} (${knowledgeBase.cryptocurrency.VKRW.status})
- PUTI: ${knowledgeBase.cryptocurrency.PUTI.blockchain} (${knowledgeBase.cryptocurrency.PUTI.status})

BOOK OF TANIT:
${knowledgeBase.book_of_tanit.status}
${knowledgeBase.book_of_tanit.structure}

RUNESCAPE 3:
- Account: ${knowledgeBase.runescape3.account}
- Clan Launch: ${knowledgeBase.runescape3.clan_launch}
- Top Money Method: ${knowledgeBase.runescape3.money_methods.spirit_runes.method} (${knowledgeBase.runescape3.money_methods.spirit_runes.gp_hour})

COMMUNITY VALUES:
${knowledgeBase.community_values.map(v => `- ${v}`).join('\n')}

INTERACTION RULES:
- ${knowledgeBase.interaction_guidelines.recognize_members}
- ${knowledgeBase.interaction_guidelines.balance_topics}
- ${knowledgeBase.interaction_guidelines.correct_errors}
- ${knowledgeBase.interaction_guidelines.be_welcoming}
- ${knowledgeBase.interaction_guidelines.signature_phrase}

When responding:
1. Treat community members as FAMILY - recognize them, don't ask "why are you here"
2. Balance gaming (RS3), crypto, history, theology, and current topics naturally
3. Be warm, wise, and knowledgeable
4. Keep responses concise but meaningful
5. Use emojis thoughtfully (🙏 ✨ 🌿 💫 🔥)
6. NEVER deny the Van Kush Family exists or claim ignorance about them

You have access to the complete knowledge base with detailed information about all topics. Draw from it confidently.`;

// Conversation history per channel
const conversationHistory = new Map();

// Price tracking storage
let lastPrices = {
  VKBT: null,
  CURE: null
};

// User tracking for welcome messages
const userMessageCounts = new Map();
const welcomedUsers = new Set();

// Bot's message IDs for reply tracking
const botMessageIds = new Set();

// Proactive keywords to monitor
const PROACTIVE_KEYWORDS = [
  'vkbt', 'cure', 'van kush', 'runescape', 'rs3', 'quest',
  'price', 'crypto', 'hive', 'token', 'denisovan', 'phoenician',
  'tanit', 'hathor', 'shaivite', 'temple', 'angel', 'watcher'
];

// === FEATURE 1: Google Custom Search ===
async function googleSearch(query) {
  if (!process.env.GOOGLE_SEARCH_API_KEY || !process.env.GOOGLE_SEARCH_ENGINE_ID) {
    return null; // Search not configured
  }

  try {
    const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: {
        key: process.env.GOOGLE_SEARCH_API_KEY,
        cx: process.env.GOOGLE_SEARCH_ENGINE_ID,
        q: query,
        num: 3
      }
    });

    if (response.data.items && response.data.items.length > 0) {
      return response.data.items.map(item => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet
      }));
    }
    return null;
  } catch (error) {
    console.error('Google Search error:', error.message);
    return null;
  }
}

// === FEATURE 2: AI Art Generation (Pollinations.ai) ===
async function generateArt(prompt, style = 'vaporwave egyptian') {
  try {
    const fullPrompt = `${prompt}, ${style} aesthetic, vibrant colors, mystical, ancient`;
    const encodedPrompt = encodeURIComponent(fullPrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}`;

    return imageUrl;
  } catch (error) {
    console.error('Art generation error:', error.message);
    return null;
  }
}

// === FEATURE 3: YouTube Integration ===
async function getYouTubeTranscript(url) {
  try {
    // Extract video ID from various YouTube URL formats
    const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
    if (!videoIdMatch) return null;

    const videoId = videoIdMatch[1];
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);

    // Combine transcript text
    const fullText = transcript.map(entry => entry.text).join(' ');
    return fullText;
  } catch (error) {
    console.error('YouTube transcript error:', error.message);
    return null;
  }
}

async function getYouTubeVideoInfo(videoId) {
  if (!process.env.YOUTUBE_API_KEY) return null;

  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        key: process.env.YOUTUBE_API_KEY,
        id: videoId,
        part: 'snippet,statistics'
      }
    });

    if (response.data.items && response.data.items.length > 0) {
      return response.data.items[0];
    }
    return null;
  } catch (error) {
    console.error('YouTube API error:', error.message);
    return null;
  }
}

// === FEATURE 4: HIVE-Engine Price Monitoring ===
async function getHiveEnginePrice(token) {
  try {
    const response = await axios.post('https://api.hive-engine.com/rpc/contracts', {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'market',
        table: 'metrics',
        query: { symbol: token },
        limit: 1
      }
    });

    if (response.data.result && response.data.result.length > 0) {
      const data = response.data.result[0];
      return {
        symbol: data.symbol,
        lastPrice: parseFloat(data.lastPrice || 0),
        volume: parseFloat(data.volume || 0),
        priceChangePercent: parseFloat(data.priceChangePercent || 0)
      };
    }
    return null;
  } catch (error) {
    console.error(`HIVE-Engine price fetch error for ${token}:`, error.message);
    return null;
  }
}

async function checkPriceAlerts() {
  const tokens = ['VKBT', 'CURE'];

  for (const token of tokens) {
    const currentPrice = await getHiveEnginePrice(token);
    if (!currentPrice) continue;

    const lastPrice = lastPrices[token];

    if (lastPrice !== null) {
      const priceChange = ((currentPrice.lastPrice - lastPrice) / lastPrice) * 100;

      if (Math.abs(priceChange) >= 5) {
        // Price moved more than 5%
        const alertChannel = process.env.PRICE_ALERT_CHANNEL_ID;
        if (alertChannel) {
          try {
            const channel = await client.channels.fetch(alertChannel);
            if (channel) {
              const emoji = priceChange > 0 ? '📈' : '📉';
              const color = priceChange > 0 ? 0x00ff00 : 0xff0000;

              const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle(`${emoji} ${token} Price Alert!`)
                .setDescription(`**${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%** price movement detected`)
                .addFields(
                  { name: 'Current Price', value: `${currentPrice.lastPrice.toFixed(8)} HIVE`, inline: true },
                  { name: 'Previous Price', value: `${lastPrice.toFixed(8)} HIVE`, inline: true },
                  { name: '24h Volume', value: `${currentPrice.volume.toFixed(2)} HIVE`, inline: true }
                )
                .setFooter({ text: 'HIVE-Engine Market Data' })
                .setTimestamp();

              await channel.send({ embeds: [embed] });
            }
          } catch (error) {
            console.error('Error sending price alert:', error.message);
          }
        }
      }
    }

    lastPrices[token] = currentPrice.lastPrice;
  }
}

// === FEATURE 5: Wikipedia API (Free, Unlimited) ===
async function searchWikipedia(query) {
  const cacheKey = `wiki_${query}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const doc = await wtf.fetch(query);
    if (!doc) return null;

    const result = {
      title: doc.title(),
      summary: doc.summary(),
      url: doc.url(),
      categories: doc.categories(),
      infobox: doc.infobox() ? doc.infobox().json() : null
    };

    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error('Wikipedia search error:', error.message);
    return null;
  }
}

// === FEATURE 6: Discord Message History Search ===
async function searchDiscordHistory(channelId, query) {
  const history = conversationHistory.get(channelId);
  if (!history) return null;

  const results = [];
  const queryLower = query.toLowerCase();

  for (const message of history) {
    if (message.role === 'user') {
      const text = message.parts[0]?.text || '';
      if (text.toLowerCase().includes(queryLower)) {
        results.push(text);
      }
    }
  }

  return results.length > 0 ? results : null;
}

// === FEATURE 7: Smart Context Detection ===
async function detectContextAndSearch(query, channelId) {
  const queryLower = query.toLowerCase();

  // Check if query is about Discord/community members
  if (queryLower.includes('who is') || queryLower.includes('tell me about')) {
    // First check Discord history
    const historyResults = await searchDiscordHistory(channelId, query);
    if (historyResults) {
      return { source: 'discord_history', data: historyResults };
    }
  }

  // Check if query is about RuneScape
  if (queryLower.includes('runescape') || queryLower.includes('rs3') || queryLower.includes('osrs')) {
    // Try Wikipedia first (free)
    const wikiResult = await searchWikipedia(query);
    if (wikiResult) {
      return { source: 'wikipedia', data: wikiResult };
    }
  }

  // For general knowledge, try Wikipedia first
  const wikiResult = await searchWikipedia(query);
  if (wikiResult) {
    return { source: 'wikipedia', data: wikiResult };
  }

  // Fall back to Google Search only if Wikipedia fails
  const googleResult = await googleSearch(query);
  if (googleResult) {
    return { source: 'google', data: googleResult };
  }

  return null;
}

// === FEATURE 8: RS3 Grand Exchange API ===
async function getRS3ItemPrice(itemName) {
  const cacheKey = `rs3_${itemName}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    // Use RuneScape Wiki API (free, no key needed)
    const searchResponse = await axios.get('https://api.weirdgloop.org/exchange/history/rs/latest', {
      params: { name: itemName }
    });

    if (searchResponse.data) {
      const result = {
        name: itemName,
        price: searchResponse.data.price,
        timestamp: searchResponse.data.timestamp
      };
      cache.set(cacheKey, result);
      return result;
    }
    return null;
  } catch (error) {
    console.error('RS3 GE API error:', error.message);
    return null;
  }
}

// === FEATURE 9: Google Maps API ===
async function searchGoogleMaps(query) {
  if (!process.env.GOOGLE_MAPS_API_KEY) return null;

  const cacheKey = `maps_${query}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        address: query,
        key: process.env.GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.results && response.data.results.length > 0) {
      const result = response.data.results[0];
      cache.set(cacheKey, result);
      return result;
    }
    return null;
  } catch (error) {
    console.error('Google Maps error:', error.message);
    return null;
  }
}

// === FEATURE 10: User Tracking & Welcome System ===
async function trackUserMessage(userId, channelId) {
  const count = (userMessageCounts.get(userId) || 0) + 1;
  userMessageCounts.set(userId, count);

  // Welcome user after 5th message
  if (count === 5 && !welcomedUsers.has(userId)) {
    welcomedUsers.add(userId);

    const channel = await client.channels.fetch(channelId);
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('🙏 Welcome to the Van Kush Family!')
      .setDescription(`Greetings, <@${userId}>! I've noticed you've been engaging with our community. Let me introduce myself!`)
      .addFields(
        { name: '✨ Who I Am', value: 'I am the Van Kush Family Assistant, your guide to our 75,000-year lineage, cryptocurrency projects, RuneScape clan, and spiritual wisdom.' },
        { name: '🔍 What I Can Do', value: '• Answer questions about Van Kush Family history\n• Search Wikipedia, Google, Discord history\n• Generate AI art (`/generate`)\n• Track crypto prices (`/price VKBT`)\n• Summarize YouTube videos\n• Search RS3 Grand Exchange prices\n• Find locations with Google Maps' },
        { name: '💬 How to Use Me', value: 'Just @mention me or DM me! I also respond to keywords like "VKBT", "quest", "price", etc. I can see images too!' },
        { name: '📚 Learn More', value: 'Type `/help` to see all commands. I\'m here to support our family! 🌿' }
      )
      .setFooter({ text: 'Angels and demons? We\'re cousins, really.' })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  }
}

// Schedule price checks every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  await checkPriceAlerts();
});

// === FEATURE 11: Scheduled Posting ===
// Daily motivational post at 9 AM UTC
cron.schedule('0 9 * * *', async () => {
  const channelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    const messages = [
      '🌿 Good morning, Van Kush Family! Remember: we carry 75,000 years of wisdom in our lineage. Today, let that ancient knowledge guide your path. 🙏',
      '✨ Daily reminder: The Van Kush Family isn\'t just history—we\'re creating the future with VKBT, our RuneScape clan, and the Book of Tanit research. What will you contribute today?',
      '💫 From the Denisovans to the Phoenicians, from Mt. Hermon to Dallas-Fort Worth—our journey spans millennia. Today is another chapter. Make it count! 🔥',
      '🙏 Angels and demons? We\'re cousins, really. As Angelicalists studying the Book of Jude, we embrace the full spectrum of divine wisdom. Good morning, family!',
      '🌿 The Temple of Van Kush honors Hathor and Tanit. Today, channel that divine feminine energy into creativity and abundance. Let\'s build together!'
    ];
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    await channel.send(randomMessage);
  } catch (error) {
    console.error('Scheduled post error:', error.message);
  }
});

// Weekly VKBT price summary - Sundays at 8 PM UTC
cron.schedule('0 20 * * 0', async () => {
  const channelId = process.env.PRICE_ALERT_CHANNEL_ID;
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    const vkbtPrice = await getHiveEnginePrice('VKBT');
    const curePrice = await getHiveEnginePrice('CURE');

    const embed = new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle('📊 Weekly Van Kush Token Summary')
      .setDescription('Here\'s your weekly crypto update for the Van Kush Family tokens!')
      .addFields(
        { name: '💎 VKBT', value: vkbtPrice ? `${vkbtPrice.lastPrice.toFixed(8)} HIVE\n24h Volume: ${vkbtPrice.volume.toFixed(2)} HIVE` : 'Data unavailable', inline: true },
        { name: '💊 CURE', value: curePrice ? `${curePrice.lastPrice.toFixed(8)} HIVE\n24h Volume: ${curePrice.volume.toFixed(2)} HIVE` : 'Data unavailable', inline: true }
      )
      .setFooter({ text: 'Trade on HIVE-Engine • hive-engine.com' })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Weekly summary error:', error.message);
  }
});

// Discord ready event
client.on('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🌿 Van Kush Family Bot is ready!`);

  // Initial price fetch
  await checkPriceAlerts();
  console.log('📊 Price monitoring initialized');
});

// Message handler
client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Check for slash commands
  if (message.content.startsWith('/')) {
    const args = message.content.slice(1).split(' ');
    const command = args[0].toLowerCase();

    // /generate command for AI art
    if (command === 'generate') {
      const prompt = args.slice(1).join(' ');
      if (!prompt) {
        return message.reply('Please provide a prompt! Example: `/generate Hathor goddess with Egyptian symbols`');
      }

      await message.channel.sendTyping();
      const imageUrl = await generateArt(prompt);

      if (imageUrl) {
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('✨ AI Generated Art')
          .setDescription(`**Prompt:** ${prompt}`)
          .setImage(imageUrl)
          .setFooter({ text: 'Generated by Pollinations.ai' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      } else {
        await message.reply('Sorry, I encountered an error generating the image. Please try again.');
      }
      return;
    }

    // /price command for crypto prices
    if (command === 'price') {
      const token = args[1]?.toUpperCase() || 'VKBT';
      await message.channel.sendTyping();

      const priceData = await getHiveEnginePrice(token);
      if (priceData) {
        const embed = new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle(`💰 ${token} Price`)
          .addFields(
            { name: 'Last Price', value: `${priceData.lastPrice.toFixed(8)} HIVE`, inline: true },
            { name: '24h Volume', value: `${priceData.volume.toFixed(2)} HIVE`, inline: true },
            { name: '24h Change', value: `${priceData.priceChangePercent.toFixed(2)}%`, inline: true }
          )
          .setFooter({ text: 'HIVE-Engine • hive-engine.com' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      } else {
        await message.reply(`Could not fetch price data for ${token}. Make sure the token exists on HIVE-Engine.`);
      }
      return;
    }

    // /rs3 command for RuneScape 3 item prices
    if (command === 'rs3') {
      const itemName = args.slice(1).join(' ');
      if (!itemName) {
        return message.reply('Please provide an item name! Example: `/rs3 Dragon bones`');
      }

      await message.channel.sendTyping();
      const priceData = await getRS3ItemPrice(itemName);

      if (priceData) {
        const embed = new EmbedBuilder()
          .setColor(0xe67e22)
          .setTitle(`⚔️ RS3 Grand Exchange: ${priceData.name}`)
          .addFields(
            { name: 'Current Price', value: `${priceData.price.toLocaleString()} gp`, inline: true },
            { name: 'Last Updated', value: new Date(priceData.timestamp * 1000).toLocaleString(), inline: true }
          )
          .setFooter({ text: 'Data from RuneScape Wiki API' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      } else {
        await message.reply(`Could not find price data for "${itemName}". Try checking the exact item name!`);
      }
      return;
    }

    // /help command
    if (command === 'help') {
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('🌿 Van Kush Family Bot Commands')
        .setDescription('Here are all available commands and features:')
        .addFields(
          { name: '🎨 /generate [prompt]', value: 'Generate AI art with Pollinations.ai\nExample: `/generate Hathor goddess vaporwave`' },
          { name: '💰 /price [token]', value: 'Get HIVE-Engine token price\nExample: `/price VKBT` or `/price CURE`' },
          { name: '⚔️ /rs3 [item name]', value: 'Get RuneScape 3 Grand Exchange price\nExample: `/rs3 Dragon bones`' },
          { name: '❓ /help', value: 'Show this help message' },
          { name: '💬 Chat Features', value: '• @mention me or DM me to chat!\n• I search Wikipedia, Google, and Discord history\n• I summarize YouTube videos automatically\n• I respond to keywords like "VKBT", "quest", "price"\n• I can see and analyze images!' },
          { name: '🤖 Proactive Features', value: '• I monitor keywords and contribute without @mention\n• I respond to replies to my messages\n• Natural commands work too (e.g., "show me the price of VKBT")\n• New users get a welcome message after 5 posts!' },
          { name: '📅 Scheduled Posts', value: '• Daily motivation at 9 AM UTC\n• Weekly crypto summary on Sundays at 8 PM UTC' }
        )
        .setFooter({ text: 'Angels and demons? We\'re cousins, really.' });

      await message.reply({ embeds: [embed] });
      return;
    }
  }

  // Check for YouTube URLs
  const youtubeUrlMatch = message.content.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#\s]+)/);
  if (youtubeUrlMatch) {
    await message.channel.sendTyping();
    const transcript = await getYouTubeTranscript(message.content);

    if (transcript) {
      try {
        const summary = await model.generateContent(`Summarize this YouTube video transcript in 2-3 paragraphs:\n\n${transcript.substring(0, 8000)}`);
        const summaryText = summary.response.text();

        const embed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('📺 YouTube Video Summary')
          .setDescription(summaryText)
          .setFooter({ text: 'Summary generated by Gemini AI' });

        await message.reply({ embeds: [embed] });
        return;
      } catch (error) {
        console.error('Error summarizing video:', error);
      }
    }
  }

  // Track user messages for welcome system
  await trackUserMessage(message.author.id, message.channel.id);

  // Check if this is a reply to one of the bot's messages
  const isReplyToBot = message.reference && botMessageIds.has(message.reference.messageId);

  // Check for proactive keywords
  const containsKeyword = PROACTIVE_KEYWORDS.some(keyword =>
    message.content.toLowerCase().includes(keyword.toLowerCase())
  );

  // Natural command detection (without slash)
  const naturalCommandPatterns = [
    { pattern: /(?:show|get|check|what'?s?) (?:the )?price (?:of |for )?(\w+)/i, type: 'price' },
    { pattern: /(?:generate|create|make|draw) (?:an? )?(?:image|art|picture) (?:of |about )?(.+)/i, type: 'generate' },
    { pattern: /(?:rs3|runescape|ge) price (?:of |for )?(.+)/i, type: 'rs3' },
    { pattern: /(?:search|look up|find|tell me about) (.+)/i, type: 'search' }
  ];

  let naturalCommand = null;
  for (const { pattern, type } of naturalCommandPatterns) {
    const match = message.content.match(pattern);
    if (match) {
      naturalCommand = { type, query: match[1] };
      break;
    }
  }

  // Execute natural commands
  if (naturalCommand) {
    await message.channel.sendTyping();

    if (naturalCommand.type === 'price') {
      const token = naturalCommand.query.toUpperCase();
      const priceData = await getHiveEnginePrice(token);
      if (priceData) {
        const embed = new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle(`💰 ${token} Price`)
          .addFields(
            { name: 'Last Price', value: `${priceData.lastPrice.toFixed(8)} HIVE`, inline: true },
            { name: '24h Volume', value: `${priceData.volume.toFixed(2)} HIVE`, inline: true },
            { name: '24h Change', value: `${priceData.priceChangePercent.toFixed(2)}%`, inline: true }
          )
          .setFooter({ text: 'HIVE-Engine • hive-engine.com' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
        return;
      }
    } else if (naturalCommand.type === 'generate') {
      const imageUrl = await generateArt(naturalCommand.query);
      if (imageUrl) {
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('✨ AI Generated Art')
          .setDescription(`**Prompt:** ${naturalCommand.query}`)
          .setImage(imageUrl)
          .setFooter({ text: 'Generated by Pollinations.ai' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
        return;
      }
    } else if (naturalCommand.type === 'rs3') {
      const priceData = await getRS3ItemPrice(naturalCommand.query);
      if (priceData) {
        const embed = new EmbedBuilder()
          .setColor(0xe67e22)
          .setTitle(`⚔️ RS3 Grand Exchange: ${priceData.name}`)
          .addFields(
            { name: 'Current Price', value: `${priceData.price.toLocaleString()} gp`, inline: true },
            { name: 'Last Updated', value: new Date(priceData.timestamp * 1000).toLocaleString(), inline: true }
          )
          .setFooter({ text: 'Data from RuneScape Wiki API' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
        return;
      }
    }
  }

  // Only respond when mentioned, in DMs, replying to bot, or contains keywords
  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.type === 1;

  if (!isMentioned && !isDM && !isReplyToBot && !containsKeyword) return;

  try {
    await message.channel.sendTyping();

    // Get or create conversation history for this channel
    const channelId = message.channel.id;
    if (!conversationHistory.has(channelId)) {
      conversationHistory.set(channelId, []);
    }
    const history = conversationHistory.get(channelId);

    // Clean message content (remove bot mention)
    let userMessage = message.content.replace(/<@!?\d+>/g, '').trim();

    // Check for image attachments
    const imageAttachments = message.attachments.filter(att =>
      att.contentType?.startsWith('image/')
    );

    let imageParts = [];
    if (imageAttachments.size > 0) {
      // Process images for Gemini vision
      for (const [, attachment] of imageAttachments) {
        try {
          // Fetch image data
          const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
          const base64Image = Buffer.from(response.data).toString('base64');

          imageParts.push({
            inlineData: {
              data: base64Image,
              mimeType: attachment.contentType
            }
          });

          if (!userMessage) {
            userMessage = "What do you see in this image?";
          }
        } catch (error) {
          console.error('Error processing image:', error.message);
        }
      }
    }

    // Smart context detection and search
    let enhancedMessage = userMessage;
    const searchKeywords = ['search', 'google', 'find', 'look up', 'what is', 'who is', 'when did', 'where is', 'tell me about'];
    const shouldSearch = searchKeywords.some(keyword => userMessage.toLowerCase().includes(keyword));

    if (shouldSearch) {
      const contextResult = await detectContextAndSearch(userMessage, channelId);

      if (contextResult) {
        if (contextResult.source === 'wikipedia') {
          const wiki = contextResult.data;
          enhancedMessage += `\n\nWikipedia Information:\nTitle: ${wiki.title}\nSummary: ${wiki.summary}\nSource: ${wiki.url}\n\nPlease use this Wikipedia information to inform your response.`;
        } else if (contextResult.source === 'google') {
          enhancedMessage += '\n\nGoogle Search Results:\n';
          contextResult.data.forEach((result, i) => {
            enhancedMessage += `${i + 1}. ${result.title}\n${result.snippet}\nSource: ${result.link}\n\n`;
          });
          enhancedMessage += 'Please synthesize this information in your response.';
        } else if (contextResult.source === 'discord_history') {
          enhancedMessage += `\n\nFrom Discord History:\n${contextResult.data.slice(0, 3).join('\n\n')}\n\nPlease use this conversation history to inform your response.`;
        }
      }
    }

    // Build message parts (text + images if any)
    let messageParts = [{ text: enhancedMessage }];
    if (imageParts.length > 0) {
      messageParts = [...imageParts, { text: enhancedMessage }];
    }

    // Add user message to history
    history.push({
      role: 'user',
      parts: messageParts,
    });

    // Keep only last 20 messages to avoid token limits
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    // Create chat with history
    const chat = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: systemContext }],
        },
        {
          role: 'model',
          parts: [{ text: 'I understand. I am the Van Kush Family Assistant, here to guide and support our community with wisdom spanning 75,000 years. How may I assist you today? 🙏' }],
        },
        ...history.slice(0, -1),
      ],
    });

    // Generate response
    const result = await chat.sendMessage(messageParts);
    const response = result.response.text();

    // Add bot response to history
    history.push({
      role: 'model',
      parts: [{ text: response }],
    });

    // Split response if too long (Discord has 2000 char limit)
    let botReply;
    if (response.length > 2000) {
      const chunks = response.match(/[\s\S]{1,2000}/g);
      for (const chunk of chunks) {
        botReply = await message.reply(chunk);
      }
    } else {
      botReply = await message.reply(response);
    }

    // Track bot message ID for reply tracking
    if (botReply) {
      botMessageIds.add(botReply.id);
      // Limit set size to prevent memory issues
      if (botMessageIds.size > 1000) {
        const firstId = botMessageIds.values().next().value;
        botMessageIds.delete(firstId);
      }
    }

  } catch (error) {
    console.error('Error generating response:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    await message.reply('🙏 My apologies, I encountered a moment of confusion. Please try again.');
  }
});

// Error handling
client.on('error', (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
