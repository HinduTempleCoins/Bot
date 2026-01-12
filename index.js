import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { readFile, writeFile } from 'fs/promises';
import axios from 'axios';
import cron from 'node-cron';
import { YoutubeTranscript } from 'youtube-transcript';
import wtf from 'wtf_wikipedia';
import NodeCache from 'node-cache';

dotenv.config();

// Initialize caching (30 minutes TTL)
const cache = new NodeCache({ stdTTL: 1800, checkperiod: 120 });

// ========================================
// EMOTIONAL RELATIONSHIP TRACKING SYSTEM
// ========================================
// Inspired by LSD: Dream Emulator's graph system
// Tracks multi-dimensional relationships with users
// Influences conversation style, topic suggestions, and dialogue options

const userRelationships = new Map();

// Load existing relationships from file
try {
  const data = await readFile('./user-relationships.json', 'utf8');
  const saved = JSON.parse(data);
  Object.entries(saved).forEach(([userId, data]) => {
    userRelationships.set(userId, data);
  });
  console.log(`✅ Loaded ${userRelationships.size} user relationships`);
} catch (error) {
  console.log('📝 No existing relationships file, starting fresh');
}

// Save relationships periodically (every 5 minutes)
setInterval(async () => {
  try {
    const data = Object.fromEntries(userRelationships);
    await writeFile('./user-relationships.json', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving relationships:', error);
  }
}, 300000);

function getOrCreateRelationship(userId) {
  if (!userRelationships.has(userId)) {
    userRelationships.set(userId, {
      // Multi-dimensional emotional tracking
      trust: 0,        // -100 to 100: How much user trusts the AI
      warmth: 0,       // -100 to 100: Emotional closeness/friendliness
      respect: 0,      // -100 to 100: Intellectual respect, authority
      familiarity: 0,  // 0 to 100: How well AI knows user's preferences

      // Topic interests (for Crypt-ology conversation system)
      interests: {
        mythology: 0,      // Greek, Egyptian, etc.
        religion: 0,       // Bible, theology
        archaeology: 0,    // Ancient civilizations
        esoteric: 0,       // Angels, Nephilim, mysteries
        genetics: 0,       // Denisovans, human origins
        philosophy: 0      // Deep thought, existential
      },

      // Conversation style preferences
      preferredDepth: 'medium', // 'simple', 'medium', 'deep', 'academic'
      usesButtons: true,

      // Tracking
      totalInteractions: 0,
      lastInteraction: Date.now(),
      conversationPaths: [] // Track dialogue choices like LSD graph
    });
  }
  return userRelationships.get(userId);
}

function updateRelationship(userId, updates) {
  const rel = getOrCreateRelationship(userId);

  // Update dimensions (clamped to ranges)
  if (updates.trust !== undefined) rel.trust = Math.max(-100, Math.min(100, rel.trust + updates.trust));
  if (updates.warmth !== undefined) rel.warmth = Math.max(-100, Math.min(100, rel.warmth + updates.warmth));
  if (updates.respect !== undefined) rel.respect = Math.max(-100, Math.min(100, rel.respect + updates.respect));
  if (updates.familiarity !== undefined) rel.familiarity = Math.max(0, Math.min(100, rel.familiarity + updates.familiarity));

  // Update interests
  if (updates.interests) {
    Object.entries(updates.interests).forEach(([topic, change]) => {
      if (rel.interests[topic] !== undefined) {
        rel.interests[topic] = Math.max(0, Math.min(100, rel.interests[topic] + change));
      }
    });
  }

  // Track conversation path (like LSD graph)
  if (updates.pathChoice) {
    rel.conversationPaths.push({
      choice: updates.pathChoice,
      timestamp: Date.now(),
      context: updates.pathContext || ''
    });
    // Keep only last 50 choices to save memory
    if (rel.conversationPaths.length > 50) {
      rel.conversationPaths = rel.conversationPaths.slice(-50);
    }
  }

  rel.totalInteractions++;
  rel.lastInteraction = Date.now();

  return rel;
}

function getConversationTone(relationship) {
  // Determine conversation tone based on emotional dimensions
  const { trust, warmth, respect, familiarity } = relationship;

  if (trust < -50) return 'cautious'; // User seems distrustful
  if (warmth > 60 && familiarity > 50) return 'friendly'; // Close relationship
  if (respect > 60) return 'intellectual'; // User values deep knowledge
  if (familiarity < 20) return 'welcoming'; // New user

  return 'balanced'; // Default neutral tone
}

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

// ========================================
// OILAHUASCA KNOWLEDGE BASE LOADER
// ========================================
const oilahuascaKnowledge = {};

async function loadOilahuascaKnowledge() {
  const files = ['oilahuasca_comprehensive_theory.json', 'oilahuasca_theory.json', 'oilahuasca_space_paste_recipe.json', 'cyp450_enzyme_database.json', 'shulgin_ten_essential_oils.json'];
  for (const file of files) {
    try {
      const data = await readFile(`./${file}`, 'utf8');
      oilahuascaKnowledge[file.replace('.json', '')] = JSON.parse(data);
    } catch (e) { /* skip */ }
  }
  console.log(`✅ Oilahuasca KB: ${Object.keys(oilahuascaKnowledge).length} files loaded`);
}

function getOilahuascaResponse(topic) {
  const t = topic.toLowerCase().replace(/_/g, ' ');
  if (t.includes('oilahuasca') && !t.includes('theory') && !t.includes('recipe')) {
    return `🔮 **Oilahuasca: Sacred Spice Alchemy**\n\n**Definition**: Oilahuasca (oil + ayahuasca) is a theoretical framework for understanding how essential oils containing allylbenzene compounds (myristicin, elemicin, estragole) become psychoactive through CYP450 enzyme manipulation.\n\n**The Three Pillars**:\n1. **Allylbenzene Substrates** - Myristicin (nutmeg), Elemicin, Safrole\n2. **CYP450 Enzyme Manipulation** - INDUCE first (coffee), then BLOCK (spices)\n3. **Endogenous Amine Adducts** - 1'-oxo metabolites + gut amines = novel compounds\n\n⚠️ **NOT** DMT in an oil carrier. Completely different mechanism.`;
  }
  if (t.includes('space paste') || t.includes('recipe')) return `🌿 **Space Paste Recipe**\n\n**Origin**: J. Tye, 1991 Usenet\n\n**Recipe**: 4 parts Nutmeg/Almonds/Pistachios, 2 parts Cinnamon, 1 part Cumin/Tarragon/Oregano/Basil/Turmeric, 0.5 parts Cayenne/Black Pepper\n\n**Why It Works**: Each spice targets specific CYP450 enzymes.`;
  if (t.includes('cyp') || t.includes('enzyme')) return `🧬 **CYP450 in Oilahuasca**\n\n**CYP1A2**: Primary - metabolizes allylbenzenes AND caffeine\n**17bHSD2**: Master activation enzyme\n\n**Strategy**: INDUCE CYP1A2 (coffee), then INHIBIT (myristicin)`;
  if (t.includes('17bhsd2')) return `🔑 **17β-HSD2: Master Activation Enzyme**\n\nConverts 1'-hydroxyallylbenzenes → 1'-oxo metabolites\nRequires: NAD+ (niacinamide), Vitamin D3\nAvoid: Quercetin, Naringenin - these BLOCK it!`;
  if (t.includes('allylbenzene')) return `🧪 **Allylbenzenes**\n\n• **Myristicin** (nutmeg) - most reliable\n• **Elemicin** (elemi oil) - mescaline-like\n• **Safrole** (sassafras) - MDA-like\n• **Dillapiole** (dill) - "LSD-like visuals"\n\nPRODRUGS - inactive until CYP450 → 17bHSD2 → amine adduct`;
  if (t.includes('shulgin')) return `👨‍🔬 **Shulgin's Research**\n\nSafrole → MDA, Elemicin → TMA, Myristicin → MMDA\nAllylbenzenes share ring-substitution patterns with known psychedelics.`;
  if (t.includes('safety')) return `⚠️ **Safety**\n\nDuration: 24-72h, Onset: 2-8h - DO NOT REDOSE\nContraindications: SSRIs, MAOIs, liver conditions\nWhole nutmeg over 10g is dangerous`;
  return null;
}

loadOilahuascaKnowledge();

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

    // Validate response has required data
    if (searchResponse.data &&
        searchResponse.data.price !== undefined &&
        searchResponse.data.timestamp !== undefined) {
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

// ========================================
// CRYPT-OLOGY: "NOT-A-GAME" DIALOGUE SYSTEM
// ========================================
// Button-based knowledge exploration for esoteric topics
// Topics: Mythology, Angels, Nephilim, Phoenicians, Archaeology, Genetics

const cryptologyDialogues = {
  // Entry points - detect keywords in conversation
  triggers: {
    nephilim: ['nephilim', 'giants', 'watchers', 'book of enoch'],
    phoenicians: ['phoenician', 'carthage', 'punic', 'phaikian'],
    angels: ['angel', 'archangel', 'seraphim', 'cherubim'],
    egypt: ['egypt', 'hathor', 'osiris', 'isis', 'ptah'],
    greece: ['greek', 'zeus', 'athena', 'olympus', 'hades'],
    denisovans: ['denisovan', 'denisova', 'ancient human', 'archaic'],
    bible: ['bible', 'scripture', 'genesis', 'jude', 'revelation'],
    defi: ['defi', 'decentralized finance', 'yield farming', 'dex', 'uniswap'],
    hive: ['hive', 'steem', 'blurt', 'social fi', 'proof of brain'],
    vankush: ['vkbt', 'cure', 'punic', 'puco', 'puti', 'van kush'],
    burnmining: ['burn mining', 'proof of burn', 'pob', 'burn mine'],
    karma: ['karma', 'merit', 'siring', 'curation', 'dharma'],
    // OILAHUASCA TRIGGERS
    oilahuasca: ['oilahuasca', 'oil ahuasca', 'spice trip', 'nutmeg high', 'myristicin'],
    allylbenzenes: ['allylbenzene', 'allyl benzene', 'essential oil', 'estragole', 'safrole', 'elemicin'],
    cyp450: ['cyp450', 'cytochrome', 'p450', 'liver enzyme', 'drug metabolism'],
    shulgin: ['shulgin', 'pihkal', 'tihkal', 'essential amphetamines']
  },

  // Dialogue trees - each choice updates relationship interests
  trees: {
    nephilim: {
      intro: "The Nephilim... fallen ones, giants of old. This topic bridges mythology, genetics, and ancient history. What aspect intrigues you most?",
      choices: [
        { id: 'nephilim_biblical', label: '📖 Biblical Account', interest: {religion: 10, esoteric: 5} },
        { id: 'nephilim_enoch', label: '📜 Book of Enoch', interest: {esoteric: 15, religion: 5} },
        { id: 'nephilim_genetics', label: '🧬 Genetic Evidence', interest: {genetics: 15, archaeology: 5} },
        { id: 'nephilim_giants', label: '⚔️ Giants in History', interest: {mythology: 10, archaeology: 10} }
      ]
    },
    nephilim_biblical: {
      intro: "Genesis 6:4 speaks of the Nephilim - 'when the sons of God came unto the daughters of men.' This passage has sparked millennia of interpretation.",
      choices: [
        { id: 'nephilim_jude', label: '⚡ Book of Jude Connection', interest: {religion: 10, esoteric: 5} },
        { id: 'angels_watchers', label: '👁️ The Watchers', interest: {esoteric: 15} },
        { id: 'nephilim_hermon', label: '⛰️ Mt. Hermon Covenant', interest: {religion: 10, archaeology: 10} },
        { id: 'back', label: '← Back to Nephilim Overview', interest: {} }
      ]
    },
    phoenicians: {
      intro: "The Phoenicians - master sailors, inventors of the alphabet, worshippers of Ba'al and Tanit. Their legacy spans from Tyre to Carthage.",
      choices: [
        { id: 'phoenicians_tanit', label: '🌙 Goddess Tanit', interest: {religion: 10, archaeology: 5} },
        { id: 'phoenicians_alphabet', label: '📝 The Alphabet', interest: {archaeology: 10} },
        { id: 'phoenicians_carthage', label: '🏛️ Carthage & Punic Wars', interest: {archaeology: 15} },
        { id: 'phoenicians_phaikians', label: '⚓ Phaikians Connection', interest: {mythology: 15, esoteric: 5} }
      ]
    },
    egypt: {
      intro: "Ancient Egypt - land of pharaohs, pyramids, and profound mysteries. The Van Kush Family honors Hathor, goddess of love and the sky.",
      choices: [
        { id: 'egypt_hathor', label: '💫 Hathor Worship', interest: {religion: 15, mythology: 5} },
        { id: 'egypt_osiris', label: '⚰️ Osiris & Resurrection', interest: {religion: 10, esoteric: 10} },
        { id: 'egypt_pyramids', label: '🔺 Pyramid Mysteries', interest: {archaeology: 15, esoteric: 5} },
        { id: 'egypt_genetics', label: '🧬 Egyptian DNA', interest: {genetics: 15, archaeology: 5} }
      ]
    },
    denisovans: {
      intro: "The Denisovans - our mysterious cousins who interbred with Homo sapiens, leaving genetic traces in modern humans. The 75,000-year lineage begins here.",
      choices: [
        { id: 'denisovans_dna', label: '🧬 Denisovan DNA Today', interest: {genetics: 20} },
        { id: 'denisovans_cave', label: '🏔️ Denisova Cave', interest: {archaeology: 15, genetics: 5} },
        { id: 'denisovans_interbreeding', label: '👥 Human Interbreeding', interest: {genetics: 15} },
        { id: 'denisovans_migration', label: '🌍 Migration Patterns', interest: {genetics: 10, archaeology: 10} }
      ]
    },
    defi: {
      intro: "DeFi (Decentralized Finance) has evolved from ICOs to IEOs to yield farming and now SocialFi. This is the history of financial sovereignty on the blockchain.",
      choices: [
        { id: 'defi_evolution', label: '📈 DeFi Evolution Timeline', interest: {philosophy: 10} },
        { id: 'defi_dex', label: '💱 DEX vs CEX', interest: {philosophy: 10} },
        { id: 'defi_socialfi', label: '👥 SocialFi & Proof of Brain', interest: {philosophy: 15} },
        { id: 'defi_loopmining', label: '🔁 Loop Mining Mechanics', interest: {philosophy: 15} }
      ]
    },
    defi_evolution: {
      intro: "From Bitcoin's Silk Road utility to today's SocialFi platforms, DeFi has transformed. ICO (2017) → IEO (2019) → DeFi Summer (2020) → SocialFi (2024+).",
      choices: [
        { id: 'defi_ico', label: '💸 ICO Era & Lessons', interest: {philosophy: 10} },
        { id: 'defi_uniswap', label: '🦄 Uniswap & DEX Revolution', interest: {philosophy: 10} },
        { id: 'defi_tron', label: '🌐 TRON vs Ethereum', interest: {philosophy: 10} },
        { id: 'back', label: '← Back to DeFi Overview', interest: {} }
      ]
    },
    hive: {
      intro: "The HIVE/STEEM/BLURT ecosystem represents the pinnacle of SocialFi. Born from the hostile takeover of Steemit by Justin Sun, HIVE forked to preserve decentralization.",
      choices: [
        { id: 'hive_history', label: '⚔️ The Great Fork Story', interest: {philosophy: 15} },
        { id: 'hive_pob', label: '🧠 Proof of Brain Rewards', interest: {philosophy: 15} },
        { id: 'hive_smt', label: '🎨 Smart Media Tokens', interest: {philosophy: 15} },
        { id: 'hive_scot', label: '🤖 SCOT Bots & Communities', interest: {philosophy: 10} }
      ]
    },
    hive_history: {
      intro: "In 2020, Justin Sun (TRON) bought Steemit Inc. The community feared centralization. Using exchange-held tokens, Sun staged a 'hostile takeover' of witnesses. The community migrated to HIVE. BLURT followed, removing downvotes.",
      choices: [
        { id: 'hive_witnesses', label: '⚖️ Witness System', interest: {philosophy: 10} },
        { id: 'hive_dpos', label: '🗳️ Delegated Proof of Stake', interest: {philosophy: 10} },
        { id: 'hive_blurt', label: '🌸 BLURT: The Positive Fork', interest: {philosophy: 10} },
        { id: 'back', label: '← Back to HIVE Overview', interest: {} }
      ]
    },
    vankush: {
      intro: "The Van Kush Family operates as a 'Royal Family on the Blockchain' with a multi-chain token ecosystem spanning HIVE-Engine, Polygon, and TRON.",
      choices: [
        { id: 'vankush_vkbt', label: '💎 VKBT: Van Kush Beauty Token', interest: {philosophy: 15} },
        { id: 'vankush_punic', label: '🏛️ Punic Token Network', interest: {philosophy: 15, archaeology: 10} },
        { id: 'vankush_economy', label: '🧼 The Beauty Economy', interest: {philosophy: 10} },
        { id: 'vankush_burn', label: '🔥 Burn Mining Tokens', interest: {philosophy: 15} }
      ]
    },
    vankush_punic: {
      intro: "The Punic tokens connect ancient Phoenician/Carthaginian heritage to modern blockchain. PUCO (TRON) and PUTI (Steem-Engine) form the foundation.",
      choices: [
        { id: 'punic_puco', label: '🥉 PUCO: Punic Copper', interest: {philosophy: 10, archaeology: 5} },
        { id: 'punic_puti', label: '🥈 PUTI: Punic Tin', interest: {philosophy: 10, archaeology: 5} },
        { id: 'punic_economy', label: '🏺 Ancient Trade Models', interest: {archaeology: 15, philosophy: 5} },
        { id: 'back', label: '← Back to Van Kush Overview', interest: {} }
      ]
    },
    burnmining: {
      intro: "Burn Mining transforms traditional Proof of Burn (PoB) into a DeFi yield mechanism. Sacrifice tokens permanently to mint rare, valuable assets.",
      choices: [
        { id: 'burn_mechanics', label: '🔥 How Burn Mining Works', interest: {philosophy: 20} },
        { id: 'burn_tvl', label: '💰 Total Value Locked Strategy', interest: {philosophy: 15} },
        { id: 'burn_deflationary', label: '📉 Deflationary Economics', interest: {philosophy: 15} },
        { id: 'burn_contracts', label: '📜 Smart Contract Analysis', interest: {philosophy: 10} }
      ]
    },
    burn_mechanics: {
      intro: "Burn Mining: Send tokens to a burn address (0x000...) → Receive hash rate in the mine → Mint new tokens over time. Creates scarcity + rewards commitment.",
      choices: [
        { id: 'burn_vs_stake', label: '⚖️ Burn vs Stake', interest: {philosophy: 10} },
        { id: 'burn_subscription', label: '🎫 Burn as Subscription', interest: {philosophy: 10} },
        { id: 'burn_polygon', label: '🔷 Polygon Implementation', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Burn Mining Overview', interest: {} }
      ]
    },
    karma: {
      intro: "The 'Karma is the New Merit' proposal replaces subjective 'clique-based' rewards with algorithmic charity. The Siring Model treats charitable curation as a commodity.",
      choices: [
        { id: 'karma_siring', label: '🌱 The Siring Model Algorithm', interest: {philosophy: 20} },
        { id: 'karma_neediness', label: '📊 Neediness Weight Calculation', interest: {philosophy: 15} },
        { id: 'karma_dharma', label: '☯️ 100/100 Dharma Model', interest: {philosophy: 20} },
        { id: 'karma_kula', label: '🔄 Kula Ring Gift Economy', interest: {archaeology: 15, philosophy: 10} }
      ]
    },
    karma_siring: {
      intro: "Siring Formula: (Number of Users Voted × BP Gained) × Neediness Weight. Your rank increases when poor users you vote for become wealthy, active curators.",
      choices: [
        { id: 'karma_bp', label: '💪 Blockchain Power (BP)', interest: {philosophy: 10} },
        { id: 'karma_pyramid', label: '🔺 Multi-Layer Pyramid', interest: {philosophy: 15} },
        { id: 'karma_analytics', label: '📈 Siring Chart Analytics', interest: {philosophy: 10} },
        { id: 'back', label: '← Back to Karma Overview', interest: {} }
      ]
    },
    // ========================================
    // OILAHUASCA DIALOGUE TREES
    // ========================================
    oilahuasca: {
      intro: "Oilahuasca - the theory that culinary spices can produce psychoactive effects through CYP450 enzyme manipulation, analogous to how ayahuasca uses MAO inhibitors. What aspect intrigues you?",
      choices: [
        { id: 'oilahuasca_theory', label: '🧪 The Theory Explained', interest: {esoteric: 15, philosophy: 10} },
        { id: 'oilahuasca_shulgin', label: '👨‍🔬 Shulgin\'s Framework', interest: {philosophy: 15} },
        { id: 'oilahuasca_metabolism', label: '🔬 Metabolic Pathway', interest: {philosophy: 20} },
        { id: 'oilahuasca_herbs', label: '🌿 Key Herbs', interest: {esoteric: 10} }
      ]
    },
    oilahuasca_theory: {
      intro: "The Oilahuasca theory proposes that common spices (nutmeg, cinnamon, basil, pepper) contain allylbenzenes that can be 'activated' by manipulating CYP450 liver enzymes - just like ayahuasca uses MAOIs to activate DMT. The key insight: INDUCE enzymes (coffee), then BLOCK them (nutmeg) = maximum accumulation.",
      choices: [
        { id: 'oilahuasca_paradox', label: '🤔 The Paradox Explained', interest: {philosophy: 15} },
        { id: 'oilahuasca_adducts', label: '🧬 Endogenous Amine Adducts', interest: {philosophy: 20} },
        { id: 'oilahuasca_formula', label: '📋 Original Formula', interest: {esoteric: 15} },
        { id: 'back', label: '← Back to Oilahuasca', interest: {} }
      ]
    },
    oilahuasca_paradox: {
      intro: "Why INDUCE and INHIBIT the same enzyme? Naive logic says they cancel out. Reality: More enzyme (from coffee) = more 'targets' to block = BIGGER traffic jam when inhibited. Like building more highway lanes right before blocking them all - the bigger the highway, the worse the jam!",
      choices: [
        { id: 'oilahuasca_coffee', label: '☕ Coffee\'s Role (Inducer)', interest: {philosophy: 10} },
        { id: 'oilahuasca_nutmeg', label: '🥜 Nutmeg\'s Role (Inhibitor)', interest: {philosophy: 10} },
        { id: 'oilahuasca_mechanism_based', label: '💀 Mechanism-Based Inhibition', interest: {philosophy: 20} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_adducts: {
      intro: "REVOLUTIONARY: Allylbenzenes don't simply convert to amphetamines. They form 1'-oxo metabolites via 17bHSD2 enzyme, which then react with ENDOGENOUS AMINES (dimethylamine, piperidine, pyrrolidine from gut bacteria) to create NOVEL compounds unique to each individual!",
      choices: [
        { id: 'oilahuasca_17bhsd2', label: '🔑 17bHSD2 Master Enzyme', interest: {philosophy: 20} },
        { id: 'oilahuasca_amines', label: '🦠 Gut Microbiome Amines', interest: {philosophy: 15} },
        { id: 'oilahuasca_variation', label: '🎲 Individual Variation', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Theory', interest: {} }
      ]
    },
    oilahuasca_17bhsd2: {
      intro: "17β-HSD2 is the MASTER activation enzyme. Normally inactivates steroids (testosterone→androstenedione). In oilahuasca: converts 1'-hydroxyallylbenzenes → 1'-oxo metabolites (reactive ketones). Requires NAD+ cofactor. Induced by: Gallic acid, Vitamin D3, Vitamin A.",
      choices: [
        { id: 'oilahuasca_nad', label: '⚡ NAD+ Cofactor (Niacinamide)', interest: {philosophy: 15} },
        { id: 'oilahuasca_inducers', label: '📈 17bHSD2 Inducers', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Adducts', interest: {} }
      ]
    },
    oilahuasca_amines: {
      intro: "Endogenous amines for adduct formation come from: 1) GUT BACTERIA - Bacteroides, Clostridium produce dimethylamine, 2) L-LYSINE → Piperidine (colonic conversion, 3+ hours), 3) BLACK PEPPER TEA - direct piperidine source. SSAO enzyme destroys amines - block with GLUCOSAMINE.",
      choices: [
        { id: 'oilahuasca_piperidine', label: '🌶️ Piperidine Sources', interest: {philosophy: 15} },
        { id: 'oilahuasca_ssao', label: '🛡️ SSAO Inhibition', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Adducts', interest: {} }
      ]
    },
    oilahuasca_shulgin: {
      intro: "Dr. Alexander Shulgin (1925-2014) proposed that 10 essential oils could convert to psychoactive compounds via liver metabolism. He called them 'Essential Amphetamines' - though modern research shows they actually form aminopropiophenones, not amphetamines.",
      choices: [
        { id: 'oilahuasca_ten_oils', label: '🧴 The 10 Essential Oils', interest: {esoteric: 15, philosophy: 10} },
        { id: 'oilahuasca_correction', label: '⚠️ Critical Correction', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Oilahuasca', interest: {} }
      ]
    },
    oilahuasca_ten_oils: {
      intro: "Shulgin's 10 Essential Oils → Theoretical Targets:\n• Estragole (basil) → 4-MA\n• Methyleugenol (bay) → 3,4-DMA\n• Safrole (sassafras) → MDA\n• Myristicin (nutmeg) → MMDA ★KEY\n• Elemicin (nutmeg) → TMA\n• Asarone (calamus) → TMA-2\n• Apiole (parsley) → DMMDA ★POTENT\n• Dillapiole (dill) → DMMDA-2 ★POTENT",
      choices: [
        { id: 'oilahuasca_myristicin', label: '⭐ Myristicin (The Key)', interest: {philosophy: 15} },
        { id: 'oilahuasca_methoxy', label: '🔬 Methoxy Pattern Matrix', interest: {philosophy: 20} },
        { id: 'back', label: '← Back to Shulgin', interest: {} }
      ]
    },
    oilahuasca_methoxy: {
      intro: "THREE methoxy patterns in nutmeg create metabolic complexity:\n1) METHYLENEDIOXY (myristicin) - CYP1A2 inhibitor\n2) TRIMETHOXY (elemicin) - like mescaline core\n3) HYDROXY-DIMETHOXY (5-methoxyeugenol) - PPAR-gamma activator\nEach saturates DIFFERENT enzymes = total metabolic overwhelm!",
      choices: [
        { id: 'oilahuasca_elemicin', label: '🌿 Elemicin (Trimethoxy)', interest: {philosophy: 15} },
        { id: 'oilahuasca_5me', label: '✨ 5-Methoxyeugenol', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Essential Oils', interest: {} }
      ]
    },
    oilahuasca_metabolism: {
      intro: "The 3-Step Pathway:\n1️⃣ CYP450 oxidation: Allylbenzene → 1'-Hydroxyallylbenzene\n2️⃣ 17bHSD2 + NAD+: → 1'-Oxo metabolite (reactive ketone)\n3️⃣ Spontaneous Mannich: + Endogenous amines → Tertiary aminopropiophenones\nStep 3 requires NO enzyme - it's spontaneous chemistry!",
      choices: [
        { id: 'oilahuasca_cyp1a2', label: '🔑 CYP1A2 (Primary Enzyme)', interest: {philosophy: 15} },
        { id: 'oilahuasca_phase2', label: '🚫 Phase II Blockade', interest: {philosophy: 15} },
        { id: 'oilahuasca_glutathione', label: '🛡️ Glutathione Depletion', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Oilahuasca', interest: {} }
      ]
    },
    oilahuasca_cyp1a2: {
      intro: "CYP1A2 - The primary enzyme for allylbenzene metabolism:\n• Also metabolizes caffeine (95%)\n• Induced by coffee (2-3x increase over 24-72h)\n• Inhibited by myristicin (mechanism-based - PERMANENT)\n• The KEY target in oilahuasca strategy",
      choices: [
        { id: 'oilahuasca_coffee', label: '☕ Coffee Induction', interest: {philosophy: 10} },
        { id: 'oilahuasca_mechanism_based', label: '💀 Mechanism-Based Inhibition', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Metabolism', interest: {} }
      ]
    },
    oilahuasca_phase2: {
      intro: "Phase II enzymes must ALL be blocked:\n• UGT (glucuronidation) - Block with STEVIOSIDES\n• SULT (sulfation) - Block with EGCG from green tea\n• GST (glutathione) - Deplete GSH with CINNAMON\n• SSAO (amine oxidase) - Block with GLUCOSAMINE\nNo escape routes = metabolite accumulation!",
      choices: [
        { id: 'oilahuasca_glutathione', label: '🛡️ Glutathione Strategy', interest: {philosophy: 15} },
        { id: 'oilahuasca_blockers', label: '🚫 Complete Blocker List', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Metabolism', interest: {} }
      ]
    },
    oilahuasca_glutathione: {
      intro: "CRITICAL: Glutathione (GSH) BLOCKS myristicin's CYP1A2 inhibition! Depleting GSH removes this 'brake'. CINNAMON (cinnamaldehyde) depletes GSH to ~40% of normal. BUT: Vitamin D3 INDUCES GSH synthesis - must balance with extra cinnamon!",
      choices: [
        { id: 'oilahuasca_cinnamon', label: '🌿 Cinnamon Mechanism', interest: {philosophy: 15} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_herbs: {
      intro: "Key herbs in oilahuasca formulations:\n☕ COFFEE - CYP1A2 inducer (preparation)\n🥜 NUTMEG - CYP1A2 inhibitor + psychoactive precursors\n🌿 CINNAMON - Multi-CYP inhibitor + GSH depletion\n🌶️ BLACK PEPPER - CYP3A4 inhibitor + piperidine source\n🌿 BASIL - SULT inhibitor + estragole substrate",
      choices: [
        { id: 'oilahuasca_coffee', label: '☕ Coffee (Inducer)', interest: {philosophy: 10} },
        { id: 'oilahuasca_nutmeg', label: '🥜 Nutmeg (Star Player)', interest: {esoteric: 15} },
        { id: 'oilahuasca_blockers', label: '🚫 Pathway Blockers', interest: {philosophy: 10} },
        { id: 'oilahuasca_safety', label: '⚠️ Safety & Risks', interest: {philosophy: 10} },
        { id: 'back', label: '← Back to Oilahuasca', interest: {} }
      ]
    },
    oilahuasca_coffee: {
      intro: "Coffee induces CYP1A2 by 2-3x over 24-72 hours. Also contains β-CARBOLINES (harman, norharman) - the SAME MAO inhibitors found in ayahuasca! Coffee = enzyme inducer + MAO inhibitor. The paradox: more enzyme = more targets to block = bigger metabolic traffic jam.",
      choices: [
        { id: 'oilahuasca_betacarbolines', label: '🍵 β-Carbolines (MAOIs)', interest: {philosophy: 15} },
        { id: 'oilahuasca_paradox', label: '🤔 The Paradox', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Herbs', interest: {} }
      ]
    },
    oilahuasca_nutmeg: {
      intro: "Nutmeg is the KEYSTONE:\n• Contains myristicin, elemicin, 5-methoxyeugenol (3 methoxy patterns!)\n• MECHANISM-BASED CYP1A2 inhibitor (kills enzyme permanently)\n• Also has MAO inhibitory properties (Truitt 1963)\n⚠️ Toxic at 10g+, effects last 24-72 hours!",
      choices: [
        { id: 'oilahuasca_mechanism_based', label: '💀 Mechanism-Based Inhibition', interest: {philosophy: 20} },
        { id: 'oilahuasca_myristicin', label: '🔬 Myristicin Studies', interest: {philosophy: 15} },
        { id: 'oilahuasca_safety', label: '⚠️ Safety Concerns', interest: {philosophy: 10} },
        { id: 'back', label: '← Back to Herbs', interest: {} }
      ]
    },
    oilahuasca_mechanism_based: {
      intro: "Mechanism-based inhibition = 'suicide inhibition'. Enzyme processes myristicin → creates REACTIVE intermediate → permanently destroys enzyme. Evidence: 3.21-fold IC50 shift (gets stronger over time). Unlike regular inhibitors, enzyme must be RE-SYNTHESIZED (takes days)!",
      choices: [
        { id: 'oilahuasca_glutathione', label: '🛡️ Glutathione Rescue', interest: {philosophy: 15} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_blockers: {
      intro: "When CYP1A2 blocked, body tries alternate routes. Block these too:\n🌿 CINNAMON - CYP3A4, 2C9, 2A6 + GSH depletion\n🌶️ PEPPER - CYP3A4 + P-glycoprotein\n🫖 GREEN TEA - SULT1A1/1A3 (EGCG)\n🍬 STEVIA - UGT2B7\n💊 GLUCOSAMINE - SSAO\n💊 BERBERINE - CYP2D6, CYP3A4 (NOT CYP2E1!)",
      choices: [
        { id: 'oilahuasca_berberine', label: '💊 Berberine (Key Inhibitor)', interest: {philosophy: 15} },
        { id: 'oilahuasca_cyp2e1', label: '🔥 CYP2E1 (Must INDUCE)', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Herbs', interest: {} }
      ]
    },
    oilahuasca_berberine: {
      intro: "BERBERINE (500-1000mg) is critical:\n• Potent CYP2D6 inhibitor (CYP2D6 is DETRIMENTAL to activation!)\n• Also inhibits CYP2C9 and CYP3A4\n• Does NOT inhibit CYP2E1 (this selectivity is crucial!)\nCYP2D6 genetic variants explain why some people never respond to nutmeg.",
      choices: [
        { id: 'oilahuasca_cyp2e1', label: '🔥 CYP2E1 (Vital Activator)', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Blockers', interest: {} }
      ]
    },
    oilahuasca_cyp2e1: {
      intro: "CYP2E1 is the VITAL ACTIVATOR - must be INDUCED, not inhibited!\n• Smallest active site of all human P450s\n• Perfect for small hydrophobic allylbenzenes\n• INDUCE with: Glycerol (5-10g), ketogenic diet\n• AVOID inhibitors: Excessive piperine inhibits CYP2E1 (filter black pepper tea!)",
      choices: [
        { id: 'back', label: '← Back to Blockers', interest: {} }
      ]
    },
    oilahuasca_safety: {
      intro: "⚠️ SERIOUS SAFETY CONCERNS:\n• Nutmeg toxic at 10g+ (nausea, tachycardia, convulsions)\n• Effects last 24-72 HOURS (extremely long)\n• Safrole/estragole are hepatotoxic & potentially carcinogenic\n• CYP inhibition affects ALL prescription drugs\n• NO controlled human studies exist\n• This is EXPERIMENTAL - harm reduction essential",
      choices: [
        { id: 'oilahuasca_harm_reduction', label: '🛡️ Harm Reduction', interest: {philosophy: 10} },
        { id: 'oilahuasca_drugs', label: '💊 Drug Interactions', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Herbs', interest: {} }
      ]
    },
    oilahuasca_harm_reduction: {
      intro: "If exploring (NOT a recommendation):\n• Start with VERY LOW doses\n• Never use alone - have a sitter\n• Plan for 24-72 hour duration\n• AVOID if on ANY prescription meds\n• Do NOT use chronically (carcinogenicity)\n• Stay hydrated, do not drive for 3 days\n• Know emergency resources",
      choices: [
        { id: 'oilahuasca_drugs', label: '💊 Drug Interactions', interest: {philosophy: 10} },
        { id: 'back', label: '← Back to Safety', interest: {} }
      ]
    },
    oilahuasca_drugs: {
      intro: "⚠️ CRITICAL DRUG INTERACTIONS:\nCYP450 inhibition affects metabolism of:\n• SSRIs, antidepressants - SEROTONIN SYNDROME risk\n• Benzodiazepines - prolonged sedation\n• Opioids - respiratory depression\n• Blood thinners - bleeding risk\n• Statins - muscle damage\nWait 2 weeks after stopping oilahuasca before resuming meds!",
      choices: [
        { id: 'back', label: '← Back to Safety', interest: {} }
      ]
    },
    oilahuasca_formula: {
      intro: "Original anecdotal formula: Coffee + Almond + Cinnamon + Vanilla + Nutmeg\n☕ Coffee: CYP1A2 induction + β-carbolines\n🥜 Nutmeg: Myristicin/elemicin + CYP1A2 inhibition\n🌿 Cinnamon: Multi-CYP inhibition + GSH depletion\n🍦 Vanilla: Metabolic modulator\n🥜 Almond: Minor (benzaldehyde)",
      choices: [
        { id: 'oilahuasca_herbs', label: '🌿 All Key Herbs', interest: {philosophy: 10} },
        { id: 'oilahuasca_complete', label: '🧪 Complete Protocol', interest: {philosophy: 20} },
        { id: 'back', label: '← Back to Theory', interest: {} }
      ]
    },
    oilahuasca_complete: {
      intro: "COMPLETE ENZYMATIC PROTOCOL:\nPHASE 1 (1-4h before): Gallic acid, Vit D3, Vit A, Niacinamide, Glycerol\nPHASE 2 (with dose): Steviosides, EGCG, Cinnamon, Glucosamine\nPHASE 3 (with dose): Berberine, Coffee, Nutmeg\nPHASE 4: L-Lysine (3h+ before) OR Black pepper tea (filtered)",
      choices: [
        { id: 'oilahuasca_17bhsd2', label: '🔑 Phase 1: 17bHSD2 Induction', interest: {philosophy: 15} },
        { id: 'oilahuasca_phase2', label: '🚫 Phase 2: Pathway Blockade', interest: {philosophy: 15} },
        { id: 'oilahuasca_safety', label: '⚠️ Safety First', interest: {philosophy: 10} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_myristicin: {
      intro: "Myristicin (5-allyl-1-methoxy-2,3-methylenedioxybenzene):\n• Primary psychoactive in nutmeg (1-3%)\n• CYP1A2 substrate AND mechanism-based inhibitor\n• Metabolites: piperidine + pyrrolidine conjugates\n• PMID 26091900: 'most significantly inhibits CYP1A2'\n• Induces GST 4-14 fold (but depleted GSH = no substrate)",
      choices: [
        { id: 'oilahuasca_studies', label: '📚 Research Citations', interest: {philosophy: 15} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_studies: {
      intro: "Key Research Citations:\n• PMID 12523956: CYP3A4 and CYP1A2 in myristicin oxidation\n• PMID 26091900: Myristicin mechanism-based CYP1A2 inhibition\n• PMID 8554622: Myristicin induces CYP450s 2-20 fold\n• PMID 9245741: Myristicin induces GST 4-14 fold\n• Truitt 1963: MAO inhibition evidence",
      choices: [
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    allylbenzenes: {
      intro: "Allylbenzenes: benzene ring + allyl chain (-CH2-CH=CH2) + oxygen substituents. CRITICAL: Only ALLYLbenzenes form psychoactive metabolites - PROPENYLbenzenes (like anethole) do NOT because the conjugated double bond blocks oxidation at the 1' position.",
      choices: [
        { id: 'oilahuasca_allyl_vs_propenyl', label: '⚗️ Allyl vs Propenyl', interest: {philosophy: 15} },
        { id: 'oilahuasca_ten_oils', label: '🧴 The 10 Essential Oils', interest: {esoteric: 10} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_allyl_vs_propenyl: {
      intro: "ALLYL: Benzene-CH2-CH=CH2 (oxidizable at 1') ✓\nPROPENYL: Benzene-CH=CH-CH3 (conjugated, blocked) ✗\n\nActive (allyl): myristicin, safrole, estragole, elemicin, apiole\nNOT active (propenyl): anethole, asarone, isosafrole\n\nFennel is 80-90% anethole (NOT active) but 5-10% estragole (active)",
      choices: [
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    cyp450: {
      intro: "Cytochrome P450 (CYP450) enzymes are the liver's primary drug metabolizers. CYP3A4 handles >50% of all drugs. CYP1A2 handles allylbenzenes + caffeine. CYP2E1 activates small molecules. CYP2D6 DEACTIVATES (must inhibit!). Oilahuasca = precise enzyme orchestra.",
      choices: [
        { id: 'oilahuasca_cyp1a2', label: '🔑 CYP1A2 (Primary)', interest: {philosophy: 15} },
        { id: 'oilahuasca_cyp2e1', label: '🔥 CYP2E1 (Activator)', interest: {philosophy: 15} },
        { id: 'oilahuasca_berberine', label: '💊 CYP2D6 (Block It!)', interest: {philosophy: 15} },
        { id: 'oilahuasca_drugs', label: '💊 Drug Implications', interest: {philosophy: 15} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    shulgin: {
      intro: "Dr. Alexander 'Sasha' Shulgin (1925-2014) - the godfather of psychedelic chemistry. Author of PIHKAL and TIHKAL. Synthesized and self-tested 230+ psychoactive compounds. His 'Essential Amphetamines' theory sparked oilahuasca research.",
      choices: [
        { id: 'oilahuasca_shulgin', label: '🧴 Essential Oils Theory', interest: {philosophy: 15} },
        { id: 'oilahuasca_correction', label: '⚠️ Modern Corrections', interest: {philosophy: 15} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_correction: {
      intro: "CRITICAL CORRECTION: Modern research (1977-2024) shows allylbenzenes do NOT form amphetamines in vivo. They form TERTIARY AMINOPROPIOPHENONES (Mannich bases) via endogenous amine adduct formation - structurally different with different pharmacology than Shulgin predicted.",
      choices: [
        { id: 'oilahuasca_adducts', label: '🧬 Adduct Formation', interest: {philosophy: 20} },
        { id: 'oilahuasca_metabolism', label: '🔬 Actual Pathway', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Shulgin', interest: {} }
      ]
    },
    oilahuasca_variation: {
      intro: "Why same dose affects people differently:\n• Different microbiomes = different endogenous amines\n• CYP2D6 ultra-rapid metabolizers may never respond\n• Different 17bHSD2 levels = different 1'-oxo formation\n• Different NAD+ status = different enzyme activity\n• Recent antibiotics = depleted amine-producing bacteria",
      choices: [
        { id: 'oilahuasca_amines', label: '🦠 Microbiome Factor', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Adducts', interest: {} }
      ]
    },
    oilahuasca_betacarbolines: {
      intro: "Coffee contains β-CARBOLINES formed during roasting:\n• Harman (1-methyl-9H-pyrido[3,4-b]indole)\n• Norharman\nThese are the SAME compounds in ayahuasca (Banisteriopsis caapi)! They inhibit MAO-A and MAO-B. Coffee = natural MAOI + CYP1A2 inducer.",
      choices: [
        { id: 'oilahuasca_mao', label: '🧠 MAO Inhibition', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Coffee', interest: {} }
      ]
    },
    oilahuasca_mao: {
      intro: "MAO (Monoamine Oxidase) breaks down serotonin, dopamine, tyramine. Coffee β-carbolines + nutmeg myristicin both inhibit MAO. This is why oilahuasca parallels ayahuasca - both combine psychoactive precursors with MAO inhibition to prevent breakdown of active compounds.",
      choices: [
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_cinnamon: {
      intro: "CINNAMON (cinnamaldehyde 100-200mg):\n• Depletes glutathione to ~40% of normal\n• Inhibits CYP3A4, CYP2C9, CYP2A6\n• The reactive aldehyde directly binds GSH\n• Removes the 'brake' on myristicin's CYP1A2 inhibition\n• Essential for the mechanism to work!",
      choices: [
        { id: 'oilahuasca_glutathione', label: '🛡️ GSH Depletion', interest: {philosophy: 15} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_piperidine: {
      intro: "PIPERIDINE sources:\n1) L-LYSINE (1000-3000mg) → Gut bacteria convert to cadaverine → piperidine (takes 3+ hours to reach colon)\n2) BLACK PEPPER TEA: 5-10g in hot water, FILTER SOLIDS (removes piperine which inhibits CYP2E1)\nPiperidine forms 6-membered ring adducts with unique pharmacology.",
      choices: [
        { id: 'back', label: '← Back to Amines', interest: {} }
      ]
    },
    oilahuasca_ssao: {
      intro: "SSAO (Semicarbazide-Sensitive Amine Oxidase) destroys primary amines needed for adduct formation. Block with GLUCOSAMINE (1500mg) - acts as competitive inhibitor. Dose 1 hour before and every 4-6 hours. Different from MAO - both must be addressed!",
      choices: [
        { id: 'back', label: '← Back to Amines', interest: {} }
      ]
    },
    oilahuasca_nad: {
      intro: "NAD+ is ESSENTIAL - 17bHSD2 cannot function without it!\nNiacinamide (500-1000mg) → NMN → NAD+\nUse NIACINAMIDE not niacin (niacin causes flushing)\nDose 1 hour before for optimal levels\nWhy some don't respond: Poor NAD+ synthesis, B-vitamin deficiency, aging",
      choices: [
        { id: 'back', label: '← Back to 17bHSD2', interest: {} }
      ]
    },
    oilahuasca_inducers: {
      intro: "17bHSD2 INDUCERS (take 1-4h before):\n• Gallic acid (500mg) - BUT also induces SULT (pair with EGCG)\n• Vitamin D3 (2000-5000 IU) - BUT induces GSH (pair with extra cinnamon)\n• Vitamin A (5000-10,000 IU)\n• AVOID Genistein - binds 5-HT receptors, may reduce effects",
      choices: [
        { id: 'back', label: '← Back to 17bHSD2', interest: {} }
      ]
    },
    oilahuasca_elemicin: {
      intro: "ELEMICIN (3,4,5-trimethoxybenzene pattern):\n• Same trimethoxy pattern as MESCALINE\n• May convert to TMA (trimethoxyamphetamine)\n• Requires sequential demethylation (multiple enzyme steps)\n• Creates 'traffic jam' when combined with myristicin\n• Hepatotoxicity documented - affects gut microbiota",
      choices: [
        { id: 'back', label: '← Back to Methoxy Patterns', interest: {} }
      ]
    },
    oilahuasca_5me: {
      intro: "5-METHOXYEUGENOL (syring pattern: OH between two methoxys):\n• Found in nutmeg CRUDE EXTRACT but NOT essential oil!\n• Activates PPAR-gamma (affects liver metabolism broadly)\n• Requires specialized enzymes (SyoA) for demethylation\n• Rate-limiting = forces alternative pathways\n• Also in magnolia",
      choices: [
        { id: 'back', label: '← Back to Methoxy Patterns', interest: {} }
      ]
    }
  }
};

function createDialogueButtons(dialogueKey) {
  const dialogue = cryptologyDialogues.trees[dialogueKey];
  if (!dialogue) return null;

  const rows = [];
  let currentRow = new ActionRowBuilder();

  dialogue.choices.forEach((choice, index) => {
    // Discord allows max 5 buttons per row, max 5 rows
    if (index > 0 && index % 5 === 0) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }

    const button = new ButtonBuilder()
      .setCustomId(`crypt_${choice.id}`)
      .setLabel(choice.label)
      .setStyle(choice.id === 'back' ? ButtonStyle.Secondary : ButtonStyle.Primary);

    currentRow.addComponents(button);
  });

  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  return { intro: dialogue.intro, rows };
}

// Discord ready event
client.on('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🌿 Van Kush Family Bot is ready!`);

  // Initial price fetch
  await checkPriceAlerts();
  console.log('📊 Price monitoring initialized');
  console.log('🎮 Crypt-ology dialogue system loaded');
});

// ========================================
// BUTTON INTERACTION HANDLER
// ========================================
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isButton()) return;

    const userId = interaction.user.id;
    const relationship = getOrCreateRelationship(userId);

    // Handle Crypt-ology dialogue buttons
    if (interaction.customId.startsWith('crypt_')) {
      const choiceId = interaction.customId.replace('crypt_', '');

      // Find the choice in dialogue trees
      let selectedChoice = null;
      let nextDialogue = null;

      for (const [treeKey, tree] of Object.entries(cryptologyDialogues.trees)) {
        const choice = tree.choices?.find(c => c.id === choiceId);
        if (choice) {
          selectedChoice = choice;
          // Update user interests based on choice
          if (choice.interest && Object.keys(choice.interest).length > 0) {
            updateRelationship(userId, {
              interests: choice.interest,
              pathChoice: choiceId,
              pathContext: treeKey,
              familiarity: 2,
              respect: 1
            });
          }
          break;
        }
      }

      // Get next dialogue
      nextDialogue = cryptologyDialogues.trees[choiceId];

      if (nextDialogue) {
        // Continue dialogue tree
        const buttonData = createDialogueButtons(choiceId);

        await interaction.update({
          content: `🔮 **Crypt-ology Exploration**\n\n${buttonData.intro}`,
          components: buttonData.rows
        });
      } else if (choiceId === 'back') {
        // Go back (simplified - would need stack in full implementation)
        await interaction.update({
          content: '🔮 **Crypt-ology**\n\nWhat mysterious topic shall we explore?',
          components: []
        });
      } else {
        // Leaf node - provide deep information
        await interaction.deferUpdate();

        const searchQuery = choiceId.replace(/_/g, ' ');
        let response = '';

        // PRIORITY: Check oilahuasca knowledge base FIRST (before Wikipedia/Gemini)
        const oilahuascaResponse = getOilahuascaResponse(searchQuery);
        if (oilahuascaResponse) {
          response = oilahuascaResponse;
        } else {
          // Not oilahuasca - use Wikipedia/Gemini
          const wikiResult = await searchWikipedia(searchQuery);
          if (wikiResult) {
            response = `📚 **${searchQuery}**\n\n${wikiResult.substring(0, 1500)}...\n\n_Want to explore deeper? Try asking me specific questions!_`;
          } else {
            // Fallback to Gemini
            try {
              const tone = getConversationTone(relationship);
              let prompt = `Explain ${searchQuery} in relation to ancient mysteries, archaeology, and mythology.`;

              if (tone === 'academic') prompt += ' Use scholarly depth.';
              else if (tone === 'welcoming') prompt += ' Keep it accessible for newcomers.';

              const result = await model.generateContent(prompt);
              let geminiText = result.response.text();

              const prefix = `🔮 **${searchQuery}**\n\n`;
              const maxContentLength = 1900 - prefix.length;
              if (geminiText.length > maxContentLength) {
                geminiText = geminiText.substring(0, maxContentLength) + '...';
              }

              response = prefix + geminiText;
            } catch (error) {
              console.error('Crypt-ology content generation error:', error);
              response = '🔮 The mysteries are clouded at this moment.\n\n💡 **Tip:** This feature requires a valid Google/Gemini API key. See GOOGLE_API_KEY_RENEWAL.md for renewal instructions.\n\nIn the meantime, try asking me questions directly instead of using the button system!';
            }
          }
        }

        await interaction.editReply({
          content: response,
          components: [] // Remove buttons at leaf nodes
        });
      }
    }
  } catch (error) {
    console.error('❌ Interaction error:', error);

    // Attempt to notify user of the error
    try {
      const errorMessage = '❌ An error occurred processing your button click.\n\n' +
        '**Possible causes:**\n' +
        '• Expired Google/Gemini API key\n' +
        '• Network connectivity issue\n' +
        '• Bot permissions issue\n\n' +
        'Please check GOOGLE_API_KEY_RENEWAL.md or try again later.';

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: errorMessage,
          components: []
        });
      } else {
        await interaction.reply({
          content: errorMessage,
          ephemeral: true,
          components: []
        });
      }
    } catch (replyError) {
      console.error('❌ Could not send error message to user:', replyError);
      console.error('Original error was:', error);
    }
  }
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

      if (priceData && priceData.price !== undefined && priceData.timestamp !== undefined) {
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

    // /cryptology command for NPC dialogue exploration
    if (command === 'cryptology' || command === 'crypt' || command === 'explore') {
      const topic = args[1]?.toLowerCase();

      // Get user relationship to personalize
      const relationship = getOrCreateRelationship(message.author.id);

      if (topic && cryptologyDialogues.trees[topic]) {
        // Specific topic requested
        const buttonData = createDialogueButtons(topic);
        await message.reply({
          content: `🔮 **Crypt-ology: ${topic.charAt(0).toUpperCase() + topic.slice(1)}**\n\n${buttonData.intro}`,
          components: buttonData.rows
        });
      } else {
        // Show main menu with topics user might be interested in
        const topInterests = Object.entries(relationship.interests)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 3)
          .map(([topic]) => topic);

        let suggestionText = '';
        if (topInterests.length > 0 && topInterests[0] > 20) {
          suggestionText = `\n\n📊 Based on our conversations, you might enjoy: **${topInterests.join(', ')}**`;
        }

        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('🔮 Crypt-ology: The Not-a-Game')
          .setDescription('Explore esoteric knowledge through guided conversations. Choose a topic to begin your journey into ancient mysteries.' + suggestionText)
          .addFields(
            { name: '📖 Available Topics', value: '• **nephilim** - Giants, Watchers, Book of Enoch\n• **phoenicians** - Tanit, Carthage, Punic Wars\n• **egypt** - Hathor, Osiris, Ancient Mysteries\n• **denisovans** - 75,000-year lineage, human origins\n• **oilahuasca** - CYP450 enzyme activation, allylbenzenes\n• **shulgin** - Essential oils, psychedelic chemistry\n• **cyp450** - Liver enzymes, drug metabolism' },
            { name: '🎮 How to Play', value: 'Type `/cryptology [topic]` to explore\nExample: `/cryptology nephilim`\n\nOr just mention keywords like "Nephilim" or "Hathor" in conversation!' }
          )
          .setFooter({ text: 'Your choices shape our future conversations' });

        await message.reply({ embeds: [embed] });
      }
      return;
    }

    // /portfolio command - Show wallet holdings
    if (command === 'portfolio') {
      await message.channel.sendTyping();

      try {
        const fs = require('fs');
        if (!fs.existsSync('./vankush-portfolio-data.json')) {
          return message.reply('📊 Portfolio tracker not running yet. Start it with: `node vankush-portfolio-tracker.js`');
        }

        const portfolioData = JSON.parse(fs.readFileSync('./vankush-portfolio-data.json', 'utf8'));
        const latestUpdate = portfolioData.updates[portfolioData.updates.length - 1];

        if (!latestUpdate) {
          return message.reply('📊 No portfolio data available yet. Waiting for first update...');
        }

        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('💎 Van Kush Portfolio')
          .setDescription(`Tracking since: ${new Date(portfolioData.startTime).toLocaleString()}`)
          .addFields(
            { name: '💰 Total Value', value: `${latestUpdate.totalValueHive.toFixed(2)} HIVE\n$${latestUpdate.totalValueUSD.toFixed(2)} USD`, inline: true },
            { name: '📊 HIVE Price', value: `$${latestUpdate.hivePrice.toFixed(4)}`, inline: true },
            { name: '📈 Updates', value: `${portfolioData.updates.length}`, inline: true }
          )
          .setTimestamp(new Date(latestUpdate.timestamp));

        // Add priority tokens
        if (latestUpdate.priorityTokens) {
          let tokenFields = [];
          for (const [symbol, data] of Object.entries(latestUpdate.priorityTokens)) {
            tokenFields.push({
              name: symbol,
              value: `${data.amount.toFixed(4)}\n$${data.valueUSD.toFixed(2)}`,
              inline: true
            });
          }
          embed.addFields(...tokenFields);
        }

        await message.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Error reading portfolio data:', error);
        await message.reply('❌ Error reading portfolio data. Make sure the portfolio tracker is running.');
      }
      return;
    }

    // /vkbt command - VKBT token status
    if (command === 'vkbt') {
      await message.channel.sendTyping();

      const priceData = await getHiveEnginePrice('VKBT');
      if (priceData) {
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('💎 VKBT (Van Kush Beauty Token)')
          .setDescription('Tier 1 Core Token - Highest Priority')
          .addFields(
            { name: 'Last Price', value: `${priceData.lastPrice.toFixed(8)} HIVE`, inline: true },
            { name: '24h Volume', value: `${priceData.volume.toFixed(2)} HIVE`, inline: true },
            { name: '24h Change', value: `${priceData.priceChangePercent.toFixed(2)}%`, inline: true },
            { name: 'Highest Bid', value: `${priceData.highestBid.toFixed(8)} HIVE`, inline: true },
            { name: 'Lowest Ask', value: `${priceData.lowestAsk.toFixed(8)} HIVE`, inline: true },
            { name: '\u200B', value: '\u200B', inline: true }
          )
          .setFooter({ text: 'HIVE-Engine • See TRADING_STRATEGY.md for details' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      } else {
        await message.reply('Could not fetch VKBT price data. The token may not exist on HIVE-Engine yet.');
      }
      return;
    }

    // /cure command - CURE token status
    if (command === 'cure') {
      await message.channel.sendTyping();

      const priceData = await getHiveEnginePrice('CURE');
      if (priceData) {
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('💎 CURE (Van Kush Token)')
          .setDescription('Tier 1 Core Token - Highest Priority')
          .addFields(
            { name: 'Last Price', value: `${priceData.lastPrice.toFixed(8)} HIVE`, inline: true },
            { name: '24h Volume', value: `${priceData.volume.toFixed(2)} HIVE`, inline: true },
            { name: '24h Change', value: `${priceData.priceChangePercent.toFixed(2)}%`, inline: true },
            { name: 'Highest Bid', value: `${priceData.highestBid.toFixed(8)} HIVE`, inline: true },
            { name: 'Lowest Ask', value: `${priceData.lowestAsk.toFixed(8)} HIVE`, inline: true },
            { name: '\u200B', value: '\u200B', inline: true }
          )
          .setFooter({ text: 'HIVE-Engine • See TRADING_STRATEGY.md for details' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      } else {
        await message.reply('Could not fetch CURE price data. The token may not exist on HIVE-Engine yet.');
      }
      return;
    }

    // /pnl command - Profit/Loss report
    if (command === 'pnl') {
      await message.channel.sendTyping();

      try {
        const fs = require('fs');
        if (!fs.existsSync('./vankush-portfolio-data.json')) {
          return message.reply('📊 Portfolio tracker not running yet. Start it with: `node vankush-portfolio-tracker.js`');
        }

        const portfolioData = JSON.parse(fs.readFileSync('./vankush-portfolio-data.json', 'utf8'));
        const latestUpdate = portfolioData.updates[portfolioData.updates.length - 1];

        if (!latestUpdate || !portfolioData.startingBalances) {
          return message.reply('📊 Not enough data for P&L calculation. Waiting for more updates...');
        }

        // Calculate performance metrics
        const startHive = portfolioData.startingBalances['SWAP.HIVE']?.amount || 0;
        const currentHive = latestUpdate.priorityTokens['SWAP.HIVE']?.amount || 0;
        const hiveChange = startHive > 0 ? ((currentHive - startHive) / startHive) * 100 : 0;

        const hivePriceChange = portfolioData.startingHivePrice > 0
          ? ((latestUpdate.hivePrice - portfolioData.startingHivePrice) / portfolioData.startingHivePrice) * 100
          : 0;

        const embed = new EmbedBuilder()
          .setColor(hiveChange >= 0 ? 0x00ff00 : 0xff0000)
          .setTitle('📈 Van Kush P&L Report')
          .setDescription(`Performance since ${new Date(portfolioData.startTime).toLocaleDateString()}`)
          .addFields(
            { name: '💰 HIVE Balance', value: `${(hiveChange >= 0 ? '+' : '')}${hiveChange.toFixed(2)}%\n${startHive.toFixed(2)} → ${currentHive.toFixed(2)} HIVE`, inline: true },
            { name: '📊 HIVE Price', value: `${(hivePriceChange >= 0 ? '+' : '')}${hivePriceChange.toFixed(2)}%\n$${portfolioData.startingHivePrice.toFixed(4)} → $${latestUpdate.hivePrice.toFixed(4)}`, inline: true },
            { name: '⏱️ Tracking Time', value: `${Math.floor((Date.now() - new Date(portfolioData.startTime)) / (1000 * 60 * 60 * 24))} days`, inline: true }
          )
          .setFooter({ text: 'Goal: End HIVE balance > Starting HIVE balance' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Error calculating P&L:', error);
        await message.reply('❌ Error calculating P&L. Make sure the portfolio tracker is running.');
      }
      return;
    }

    // /arbitrage command - Recent arbitrage opportunities
    if (command === 'arbitrage') {
      await message.channel.sendTyping();

      try {
        const fs = require('fs');
        if (!fs.existsSync('./vankush-arbitrage-history.json')) {
          return message.reply('🔍 Arbitrage scanner not running yet. Start it with: `node vankush-arbitrage-scanner.js`');
        }

        const arbData = JSON.parse(fs.readFileSync('./vankush-arbitrage-history.json', 'utf8'));

        if (arbData.opportunities.length === 0) {
          return message.reply('🔍 No arbitrage opportunities found yet. Scanner is still searching...');
        }

        // Get most recent opportunities (last 5)
        const recentOpps = arbData.opportunities.slice(-5).reverse();

        const embed = new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle('🚨 Recent Arbitrage Opportunities')
          .setDescription(`Total scans: ${arbData.scans} | Opportunities found: ${arbData.opportunitiesFound}`)
          .setFooter({ text: 'Alert-only mode • Manual approval required' })
          .setTimestamp();

        for (const opp of recentOpps) {
          const age = Math.floor((Date.now() - new Date(opp.metadata.timestamp)) / (1000 * 60));
          embed.addFields({
            name: `${opp.symbol} (${age}m ago)`,
            value: `**Net Profit:** ${opp.netProfitPercent.toFixed(2)}%\n` +
                   `HIVE-Engine: $${opp.hiveEnginePrice.inUSD.toFixed(2)}\n` +
                   `External: $${opp.externalPrice.toFixed(2)}\n` +
                   `Example $1K trade: $${opp.exampleTrade.netProfit.toFixed(2)} profit`,
            inline: false
          });
        }

        await message.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Error reading arbitrage data:', error);
        await message.reply('❌ Error reading arbitrage data. Make sure the scanner is running.');
      }
      return;
    }

    // /bots command - Bot status dashboard
    if (command === 'bots') {
      const fs = require('fs');

      const botStatus = {
        portfolio: fs.existsSync('./vankush-portfolio-data.json'),
        arbitrage: fs.existsSync('./vankush-arbitrage-history.json'),
        marketMaker: fs.existsSync('./vankush-market-state.json'),
        trading: fs.existsSync('./hive-trading-state.json')
      };

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('🤖 Van Kush Bot Status Dashboard')
        .setDescription('Status of all trading bots in the ecosystem')
        .addFields(
          {
            name: '💎 Market Maker',
            value: botStatus.marketMaker
              ? '✅ Active (vankush-market-maker.js)\nNudging VKBT/CURE prices'
              : '⚠️ Not running\nStart: `node vankush-market-maker.js`',
            inline: false
          },
          {
            name: '📊 Portfolio Tracker',
            value: botStatus.portfolio
              ? '✅ Active (vankush-portfolio-tracker.js)\nMonitoring wallet balances'
              : '⚠️ Not running\nStart: `node vankush-portfolio-tracker.js`',
            inline: false
          },
          {
            name: '🔍 Arbitrage Scanner',
            value: botStatus.arbitrage
              ? '✅ Active (vankush-arbitrage-scanner.js)\nScanning Swap.* opportunities'
              : '⚠️ Not running\nStart: `node vankush-arbitrage-scanner.js`',
            inline: false
          },
          {
            name: '💹 HIVE-Engine Trader',
            value: botStatus.trading
              ? '✅ Active (hive-trading-bot.js)\nExecuting trades'
              : '⚠️ Not running\nStart: `node hive-trading-bot.js`',
            inline: false
          }
        )
        .setFooter({ text: 'See TRADING_STRATEGY.md for strategy details' })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      return;
    }

    // /help command
    if (command === 'help') {
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('🌿 Van Kush Family Bot Commands')
        .setDescription('Here are all available commands and features:')
        .addFields(
          { name: '💎 Trading & Portfolio', value: '`/portfolio` - Show wallet holdings\n`/vkbt` - VKBT token status\n`/cure` - CURE token status\n`/pnl` - Profit/loss report\n`/arbitrage` - Recent opportunities\n`/bots` - Bot status dashboard' },
          { name: '💰 Market Data', value: '`/price [token]` - HIVE-Engine token price\nExample: `/price BEE`' },
          { name: '🎨 AI & Content', value: '`/generate [prompt]` - Generate AI art\nExample: `/generate Hathor goddess vaporwave`\n`/cryptology [topic]` - Explore mysteries\nExample: `/cryptology nephilim`' },
          { name: '⚔️ Gaming', value: '`/rs3 [item]` - RuneScape 3 prices\nExample: `/rs3 Dragon bones`' },
          { name: '❓ Help', value: '`/help` - Show this message' },
          { name: '💬 Chat Features', value: '• @mention me or DM me to chat!\n• I search Wikipedia, Google, Discord\n• I summarize YouTube videos\n• I respond to keywords (VKBT, quest, price)\n• I can analyze images!' },
          { name: '🤖 Proactive Features', value: '• I monitor keywords without @mention\n• I respond to help-seeking phrases\n• Natural commands work (e.g., "show me the price of VKBT")\n• New users get welcome messages!' },
          { name: '📅 Scheduled Posts', value: '• Daily motivation at 9 AM UTC\n• Weekly crypto summary Sundays 8 PM UTC' }
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

  // Intent Recognition: Help-seeking phrases (Proactive Engagement)
  const helpSeekingPatterns = [
    // Availability checks
    { pattern: /(?:is )?(?:anyone|anybody) (?:here|around|awake|online|available)\??/i, category: 'availability' },
    { pattern: /(?:anyone|anybody) (?:can|able to) help\??/i, category: 'availability' },
    { pattern: /dead chat/i, category: 'availability' },
    { pattern: /(?:hello|hi|hey)[?!]*$/i, category: 'availability' },

    // Distress/Urgency
    { pattern: /(?:i'?m |i am )?(?:stuck|lost|confused)/i, category: 'distress' },
    { pattern: /(?:need|want) (?:a |some )?help/i, category: 'distress' },
    { pattern: /(?:can|could) (?:someone|anybody|anyone) (?:help|explain|show)/i, category: 'distress' },
    { pattern: /quick question/i, category: 'distress' },
    { pattern: /(?:help|assist) me/i, category: 'distress' },

    // Social seeking
    { pattern: /(?:i'?m |i am )?bored/i, category: 'social' },
    { pattern: /what'?s? (?:everyone|everybody) (?:up to|doing)\??/i, category: 'social' },
    { pattern: /(?:anyone|anybody) (?:want|wanna) (?:to )?(?:chat|talk|play)/i, category: 'social' },

    // Verification/Onboarding
    { pattern: /how (?:do|can) i (?:get in|join|access)/i, category: 'onboarding' },
    { pattern: /where (?:do|can) i (?:go|find)/i, category: 'onboarding' },
    { pattern: /(?:i )?(?:can'?t|cannot) see (?:the |any )?channel/i, category: 'onboarding' }
  ];

  let helpIntent = null;
  for (const { pattern, category } of helpSeekingPatterns) {
    if (pattern.test(message.content)) {
      helpIntent = { category, originalMessage: message.content };
      break;
    }
  }

  // Respond to help-seeking intents proactively
  if (helpIntent && !client.user.id === message.author.id) {
    const responses = {
      availability: [
        "👋 I'm here! How can I help you today?",
        "🌿 Hey! I'm always around. What's on your mind?",
        "✨ Not a dead chat at all! I'm listening. What do you need?",
        "💬 I'm online and ready to chat! Ask away!"
      ],
      distress: [
        "🆘 I'm here to help! What's the issue you're facing?",
        "💡 Let me assist you. Could you describe what's confusing you?",
        "🤝 Don't worry, I'm here! Tell me more about what you're stuck on.",
        "📚 I'm listening! Fire away with your question."
      ],
      social: [
        "💭 I'm here for a chat! What interests you?",
        "🎮 Always up for conversation! What would you like to talk about?",
        "🌟 I'm around! Want to explore ancient mysteries, crypto, or something else?",
        "💬 Let's chat! Try asking me about VKBT, CURE, or use `/cryptology` to explore topics!"
      ],
      onboarding: [
        "🗺️ Welcome! I can help you navigate. What are you looking for?",
        "👋 New here? Let me help you get oriented! What channels or features are you looking for?",
        "📍 I'm here to guide you! Tell me what you need access to.",
        "🔑 Having trouble accessing something? Let me know and I'll help!"
      ]
    };

    const responseList = responses[helpIntent.category] || responses.availability;
    const response = responseList[Math.floor(Math.random() * responseList.length)];

    await message.reply(response);
    return;
  }

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
      if (priceData && priceData.price !== undefined && priceData.timestamp !== undefined) {
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

  // ========================================
  // CRYPT-OLOGY KEYWORD DETECTION
  // ========================================
  // Check if message contains any Crypt-ology trigger keywords
  let detectedTopic = null;
  const lowerMessage = message.content.toLowerCase();

  for (const [topic, keywords] of Object.entries(cryptologyDialogues.triggers)) {
    if (keywords.some(keyword => lowerMessage.includes(keyword))) {
      detectedTopic = topic;
      break;
    }
  }

  // If a topic was detected and user hasn't explored it much, offer dialogue
  if (detectedTopic && cryptologyDialogues.trees[detectedTopic]) {
    const relationship = getOrCreateRelationship(message.author.id);
    const topicInterest = relationship.interests[detectedTopic === 'bible' ? 'religion' :
                                                   detectedTopic === 'greece' ? 'mythology' :
                                                   detectedTopic] || 0;

    // Only offer if they haven't explored this topic extensively (interest < 50)
    if (topicInterest < 50 && Math.random() < 0.7) { // 70% chance to avoid spam
      const buttonData = createDialogueButtons(detectedTopic);

      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`🔮 I sense interest in ${detectedTopic}...`)
        .setDescription(`Would you like to explore this topic deeper through the Crypt-ology dialogue system?\n\n${buttonData.intro.substring(0, 200)}...`)
        .setFooter({ text: 'Click below to begin, or continue your conversation normally' });

      await message.reply({
        embeds: [embed],
        components: buttonData.rows
      });

      // Update that we offered this topic
      updateRelationship(message.author.id, {
        interests: { [detectedTopic === 'bible' ? 'religion' : detectedTopic === 'greece' ? 'mythology' : detectedTopic]: 5 },
        familiarity: 1
      });

      return;
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

    // Get user relationship for personalization
    const relationship = getOrCreateRelationship(message.author.id);
    const tone = getConversationTone(relationship);

    // Build personalized system context
    let personalizedContext = systemContext;

    // Add relationship-based context
    if (relationship.totalInteractions > 0) {
      personalizedContext += `\n\nRELATIONSHIP CONTEXT:`;
      personalizedContext += `\nYou have ${relationship.totalInteractions} previous interactions with this user.`;
      personalizedContext += `\nConversation tone: ${tone}`;

      // Add top interests if any
      const topInterests = Object.entries(relationship.interests)
        .filter(([,v]) => v > 20)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([k]) => k);

      if (topInterests.length > 0) {
        personalizedContext += `\nUser's known interests: ${topInterests.join(', ')}`;
      }

      // Adjust tone based on relationship dimensions
      if (tone === 'welcoming') {
        personalizedContext += `\nBe warm and patient, this user is still getting to know you.`;
      } else if (tone === 'friendly') {
        personalizedContext += `\nYou have a close relationship. Be casual, warm, and reference shared knowledge.`;
      } else if (tone === 'intellectual') {
        personalizedContext += `\nThis user values deep knowledge. Provide detailed, academic-level responses.`;
      } else if (tone === 'cautious') {
        personalizedContext += `\nBe diplomatic and rebuild trust. Avoid controversial topics.`;
      }
    }

    // Create chat with history
    const chat = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: personalizedContext }],
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

    // Update user relationship after successful interaction
    updateRelationship(message.author.id, {
      warmth: 1,  // Positive interaction
      familiarity: 2,  // Learning more about the user
      trust: message.content.length > 100 ? 1 : 0  // Longer messages show more trust
    });

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
