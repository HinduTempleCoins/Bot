import axios from 'axios';
import dotenv from 'dotenv';
import { readFile, writeFile } from 'fs/promises';
import dhive from '@hiveio/dhive';

dotenv.config();

// ========================================
// VAN KUSH MARKET MAKER BOT
// ========================================
// Strategy: RAISE prices of VKBT and CURE to 1:1 with HIVE
// Tactic: Use competing bots' behavior against them
//
// Bot Behavior Observed:
// - Bots keep prices LOW (suppression)
// - They BUY our tokens (accumulation)
// - If you place SLIGHTLY above them → they compete higher ✅
// - If you jump TOO HIGH → they SELL to you ❌
//
// Our Strategy:
// 1. Detect competing bot buy orders
// 2. Place order JUST above bot (e.g., +0.00000001 HIVE)
// 3. Bot responds by placing HIGHER order
// 4. Repeat several times per day
// 5. Incrementally raises price over time
// 6. Benefits ALL holders - tokens show at TOP of wallets

const HIVE_ENGINE_API = 'https://api.hive-engine.com/rpc/contracts';

const client = new dhive.Client([
  'https://api.hive.blog',
  'https://api.hivekings.com',
  'https://anyx.io',
  'https://api.openhive.network'
]);

const CONFIG = {
  TOKENS: ['VKBT', 'CURE'], // Van Kush tokens to market make
  BASE: 'SWAP.HIVE',

  // Nudge strategy settings
  NUDGE_INCREMENT: parseFloat(process.env.MM_NUDGE_INCREMENT || '0.00000010'), // Tiny increment above bot
  MAX_NUDGES_PER_DAY: parseInt(process.env.MM_MAX_NUDGES_DAY || '10'), // Max nudges per token per day
  NUDGE_INTERVAL: parseInt(process.env.MM_NUDGE_INTERVAL || '3600000'), // 1 hour between nudges

  // Safety - don't trigger bot sells
  MAX_PRICE_JUMP: parseFloat(process.env.MM_MAX_JUMP || '0.05'), // Max 5% jump per nudge
  SELL_TRIGGER_THRESHOLD: parseFloat(process.env.MM_SELL_TRIGGER || '0.10'), // 10%+ is sell trigger

  // Wall sizes
  BUY_WALL_SIZE: parseFloat(process.env.MM_BUY_WALL_SIZE || '50'), // HIVE per buy wall
  SUPPORT_WALL_SIZE: parseFloat(process.env.MM_SUPPORT_SIZE || '25'), // HIVE for support walls

  // Large holder tracking
  MIN_WHALE_SIZE: parseFloat(process.env.MM_MIN_WHALE || '100000'), // 100k tokens = whale

  DRY_RUN: process.env.MM_DRY_RUN !== 'false',
  DISCORD_WEBHOOK: process.env.MM_DISCORD_WEBHOOK || process.env.HIVE_DISCORD_WEBHOOK,
};

// State tracking
let marketState = {
  vkbt: { nudges: [], lastNudge: null, detectedBots: [], whales: [] },
  cure: { nudges: [], lastNudge: null, detectedBots: [], whales: [] }
};

// Load state
try {
  const data = await readFile('./vankush-market-state.json', 'utf8');
  marketState = JSON.parse(data);
  console.log('✅ Loaded market making state');
} catch (error) {
  console.log('📝 No existing state, starting fresh');
}

// Save state periodically
setInterval(async () => {
  try {
    await writeFile('./vankush-market-state.json', JSON.stringify(marketState, null, 2));
  } catch (error) {
    console.error('Error saving state:', error);
  }
}, 60000);

// ========================================
// HIVE-ENGINE API
// ========================================

async function getOrderBook(symbol) {
  try {
    const [buyOrders, sellOrders] = await Promise.all([
      axios.post(HIVE_ENGINE_API, {
        jsonrpc: '2.0',
        id: 1,
        method: 'find',
        params: {
          contract: 'market',
          table: 'buyBook',
          query: { symbol },
          limit: 100,
          indexes: [{ index: 'price', descending: true }]
        }
      }),
      axios.post(HIVE_ENGINE_API, {
        jsonrpc: '2.0',
        id: 1,
        method: 'find',
        params: {
          contract: 'market',
          table: 'sellBook',
          query: { symbol },
          limit: 100,
          indexes: [{ index: 'price', descending: false }]
        }
      })
    ]);

    return {
      bids: buyOrders.data.result || [],
      asks: sellOrders.data.result || []
    };
  } catch (error) {
    console.error('Error fetching order book:', error.message);
    return { bids: [], asks: [] };
  }
}

async function getLargeHolders(symbol) {
  try {
    const response = await axios.post(HIVE_ENGINE_API, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'balances',
        query: {
          symbol,
          balance: { $gte: CONFIG.MIN_WHALE_SIZE.toString() }
        },
        limit: 100,
        indexes: [{ index: 'balance', descending: true }]
      }
    });

    return (response.data.result || []).map(holder => ({
      account: holder.account,
      balance: parseFloat(holder.balance),
      stake: parseFloat(holder.stake || 0),
      total: parseFloat(holder.balance) + parseFloat(holder.stake || 0)
    }));
  } catch (error) {
    console.error('Error fetching holders:', error.message);
    return [];
  }
}

// ========================================
// BOT DETECTION
// ========================================

function detectCompetingBots(orderBook, tokenState) {
  /**
   * Detect bot behavior patterns:
   * - Same account with multiple orders
   * - Orders at very specific decimal places (bot precision)
   * - Quick order updates (< 1 minute between changes)
   * - Large volume relative to market
   */

  const potentialBots = new Map();

  // Analyze buy side for bots
  orderBook.bids.forEach(order => {
    const account = order.account;
    const price = parseFloat(order.price);
    const quantity = parseFloat(order.quantity);

    if (!potentialBots.has(account)) {
      potentialBots.set(account, {
        account,
        buyOrders: [],
        sellOrders: [],
        totalBuyVolume: 0,
        totalSellVolume: 0,
        botScore: 0
      });
    }

    const bot = potentialBots.get(account);
    bot.buyOrders.push({ price, quantity });
    bot.totalBuyVolume += price * quantity;

    // Bot indicators
    if (bot.buyOrders.length > 3) bot.botScore += 10; // Multiple orders
    if (price.toString().split('.')[1]?.length > 6) bot.botScore += 5; // High precision
  });

  // Analyze sell side
  orderBook.asks.forEach(order => {
    const account = order.account;
    const price = parseFloat(order.price);
    const quantity = parseFloat(order.quantity);

    if (!potentialBots.has(account)) {
      potentialBots.set(account, {
        account,
        buyOrders: [],
        sellOrders: [],
        totalBuyVolume: 0,
        totalSellVolume: 0,
        botScore: 0
      });
    }

    const bot = potentialBots.get(account);
    bot.sellOrders.push({ price, quantity });
    bot.totalSellVolume += price * quantity;

    if (bot.sellOrders.length > 3) bot.botScore += 10;
  });

  // Identify likely bots (score > 15)
  const bots = Array.from(potentialBots.values())
    .filter(b => b.botScore >= 15)
    .sort((a, b) => b.botScore - a.botScore);

  return bots;
}

function findTopBotBuyOrder(orderBook, detectedBots) {
  /**
   * Find the HIGHEST buy order from a detected bot
   * This is what we want to nudge above
   */

  if (detectedBots.length === 0) return null;

  const botAccounts = new Set(detectedBots.map(b => b.account));

  for (const order of orderBook.bids) {
    if (botAccounts.has(order.account)) {
      return {
        account: order.account,
        price: parseFloat(order.price),
        quantity: parseFloat(order.quantity),
        txId: order.txId
      };
    }
  }

  return null;
}

// ========================================
// MARKET MAKING ACTIONS
// ========================================

async function placeBuyOrder(symbol, price, quantity) {
  if (CONFIG.DRY_RUN) {
    console.log(`[DRY RUN] Would place BUY: ${quantity.toFixed(4)} ${symbol} @ ${price.toFixed(8)} ${CONFIG.BASE}`);
    return { success: true, txId: 'dry-run' };
  }

  try {
    const privateKey = dhive.PrivateKey.fromString(process.env.HIVE_ACTIVE_KEY);
    const username = process.env.HIVE_USERNAME;

    const json = {
      contractName: 'market',
      contractAction: 'buy',
      contractPayload: {
        symbol,
        quantity: quantity.toFixed(8),
        price: price.toFixed(8)
      }
    };

    const customJson = {
      id: 'ssc-mainnet-hive',
      required_auths: [username],
      required_posting_auths: [],
      json: JSON.stringify(json)
    };

    const result = await client.broadcast.json(customJson, privateKey);
    return { success: true, txId: result.id };
  } catch (error) {
    console.error('Error placing buy order:', error);
    return { success: false, error: error.message };
  }
}

async function sendDiscordNotification(message, color = 0x9b59b6) {
  if (!CONFIG.DISCORD_WEBHOOK) return;

  try {
    await axios.post(CONFIG.DISCORD_WEBHOOK, {
      embeds: [{
        title: '💎 Van Kush Market Maker',
        description: message,
        color,
        timestamp: new Date().toISOString(),
        footer: { text: CONFIG.DRY_RUN ? 'DRY RUN MODE' : 'LIVE TRADING' }
      }]
    });
  } catch (error) {
    console.error('Discord notification error:', error.message);
  }
}

// ========================================
// MAIN MARKET MAKING LOGIC
// ========================================

async function marketMakeToken(symbol) {
  const symbolLower = symbol.toLowerCase();
  const state = marketState[symbolLower];

  console.log(`\n💎 Market Making: ${symbol}`);

  // Get order book
  const orderBook = await getOrderBook(symbol);
  if (orderBook.bids.length === 0) {
    console.log('⚠️ No buy orders - market too thin');
    return;
  }

  const currentTopBid = parseFloat(orderBook.bids[0].price);
  console.log(`   Current Top Bid: ${currentTopBid.toFixed(8)} ${CONFIG.BASE}`);

  // Detect bots
  const detectedBots = detectCompetingBots(orderBook, state);
  console.log(`   Detected ${detectedBots.length} potential bot accounts`);

  if (detectedBots.length > 0) {
    console.log(`   Top Bot: ${detectedBots[0].account} (Score: ${detectedBots[0].botScore})`);
  }

  state.detectedBots = detectedBots;

  // Find top bot buy order
  const topBotOrder = findTopBotBuyOrder(orderBook, detectedBots);

  if (!topBotOrder) {
    console.log('   No bot orders detected - using current top bid');
  } else {
    console.log(`   Top Bot Order: ${topBotOrder.price.toFixed(8)} ${CONFIG.BASE} by @${topBotOrder.account}`);
  }

  // Check nudge limits
  const today = new Date().toDateString();
  const todayNudges = state.nudges.filter(n => new Date(n.timestamp).toDateString() === today);

  if (todayNudges.length >= CONFIG.MAX_NUDGES_PER_DAY) {
    console.log(`   ⚠️ Max nudges reached today (${todayNudges.length}/${CONFIG.MAX_NUDGES_PER_DAY})`);
    return;
  }

  // Check time since last nudge
  if (state.lastNudge) {
    const timeSinceNudge = Date.now() - state.lastNudge;
    if (timeSinceNudge < CONFIG.NUDGE_INTERVAL) {
      const remainingMin = Math.ceil((CONFIG.NUDGE_INTERVAL - timeSinceNudge) / 60000);
      console.log(`   ⏳ Too soon since last nudge (wait ${remainingMin} minutes)`);
      return;
    }
  }

  // Calculate nudge price
  const targetPrice = topBotOrder ? topBotOrder.price : currentTopBid;
  const nudgePrice = targetPrice + CONFIG.NUDGE_INCREMENT;
  const priceIncrease = ((nudgePrice - targetPrice) / targetPrice * 100);

  console.log(`\n🎯 NUDGE STRATEGY:`);
  console.log(`   Target (bot price): ${targetPrice.toFixed(8)} ${CONFIG.BASE}`);
  console.log(`   Our nudge price: ${nudgePrice.toFixed(8)} ${CONFIG.BASE}`);
  console.log(`   Increase: ${priceIncrease.toFixed(4)}%`);

  // Safety check - don't jump too high (triggers sell)
  if (priceIncrease > CONFIG.SELL_TRIGGER_THRESHOLD * 100) {
    console.log(`   ❌ BLOCKED: Jump too high (${priceIncrease.toFixed(2)}%) - would trigger bot sell`);
    await sendDiscordNotification(
      `🚫 **Nudge Blocked - ${symbol}**\n` +
      `Price jump too high: ${priceIncrease.toFixed(2)}%\n` +
      `Would trigger bot to SELL instead of compete\n` +
      `Waiting for better opportunity...`,
      0xff9900
    );
    return;
  }

  // Calculate quantity
  const quantity = CONFIG.BUY_WALL_SIZE / nudgePrice;

  console.log(`   Quantity: ${quantity.toFixed(4)} ${symbol}`);
  console.log(`   Total Cost: ${CONFIG.BUY_WALL_SIZE.toFixed(2)} ${CONFIG.BASE}`);

  // Execute nudge
  const result = await placeBuyOrder(symbol, nudgePrice, quantity);

  if (result.success) {
    state.nudges.push({
      timestamp: Date.now(),
      targetPrice,
      nudgePrice,
      priceIncrease,
      quantity,
      cost: CONFIG.BUY_WALL_SIZE,
      botAccount: topBotOrder?.account || 'none',
      txId: result.txId
    });

    state.lastNudge = Date.now();

    console.log(`\n✅ NUDGE EXECUTED!`);

    await sendDiscordNotification(
      `✅ **Nudge Executed - ${symbol}**\n` +
      `Previous Top: ${targetPrice.toFixed(8)} ${CONFIG.BASE}\n` +
      `New Bid: ${nudgePrice.toFixed(8)} ${CONFIG.BASE}\n` +
      `Increase: +${priceIncrease.toFixed(4)}%\n` +
      `Quantity: ${quantity.toFixed(4)} ${symbol}\n` +
      `Cost: ${CONFIG.BUY_WALL_SIZE.toFixed(2)} ${CONFIG.BASE}\n\n` +
      `${topBotOrder ? `Bot @${topBotOrder.account} should respond by going HIGHER! 📈` : 'Creating new price floor 🏗️'}\n` +
      `Nudges today: ${todayNudges.length + 1}/${CONFIG.MAX_NUDGES_PER_DAY}`,
      0x00ff00
    );
  }
}

// ========================================
// WHALE TRACKING
// ========================================

async function trackWhales() {
  console.log('\n🐋 Tracking Large Holders...\n');

  for (const symbol of CONFIG.TOKENS) {
    const whales = await getLargeHolders(symbol);
    const symbolLower = symbol.toLowerCase();

    console.log(`${symbol}: ${whales.length} whales (>${CONFIG.MIN_WHALE_SIZE.toLocaleString()} tokens)`);

    whales.slice(0, 5).forEach((whale, i) => {
      console.log(`  ${i + 1}. @${whale.account}: ${whale.total.toLocaleString()} ${symbol}`);
    });

    marketState[symbolLower].whales = whales;
  }

  // Report to Discord
  let whaleReport = '';
  for (const symbol of CONFIG.TOKENS) {
    const symbolLower = symbol.toLowerCase();
    const whales = marketState[symbolLower].whales.slice(0, 3);

    whaleReport += `\n**${symbol} Top Holders:**\n`;
    whales.forEach((w, i) => {
      whaleReport += `${i + 1}. @${w.account}: ${w.total.toLocaleString()} ${symbol}\n`;
    });
  }

  await sendDiscordNotification(
    `🐋 **Whale Update**\n${whaleReport}\n` +
    `Monitor these accounts - they could be competing bots or allies!`,
    0x0099ff
  );
}

// ========================================
// MAIN LOOP
// ========================================

async function runMarketMaker() {
  console.log('💎 Van Kush Market Maker Starting...\n');
  console.log(`Tokens: ${CONFIG.TOKENS.join(', ')}`);
  console.log(`Nudge Increment: ${CONFIG.NUDGE_INCREMENT.toFixed(8)} ${CONFIG.BASE}`);
  console.log(`Max Nudges/Day: ${CONFIG.MAX_NUDGES_PER_DAY}`);
  console.log(`Nudge Interval: ${CONFIG.NUDGE_INTERVAL / 60000} minutes`);
  console.log(`${CONFIG.DRY_RUN ? '🧪 DRY RUN MODE' : '🔴 LIVE TRADING'}\n`);

  await sendDiscordNotification(
    `🚀 **Market Maker Started**\n` +
    `Tokens: ${CONFIG.TOKENS.join(', ')}\n` +
    `Strategy: Incremental price nudging\n` +
    `Goal: Raise to 1:1 parity with HIVE\n` +
    `Mode: ${CONFIG.DRY_RUN ? 'Paper Trading' : 'LIVE'}`,
    0x9b59b6
  );

  // Initial whale tracking
  await trackWhales();

  // Market make each token
  for (const symbol of CONFIG.TOKENS) {
    await marketMakeToken(symbol);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limiting
  }

  console.log('\n✅ Market making cycle complete');
  console.log(`Next cycle in ${CONFIG.NUDGE_INTERVAL / 60000} minutes`);
}

// Run immediately
await runMarketMaker();

// Schedule periodic runs
setInterval(runMarketMaker, CONFIG.NUDGE_INTERVAL);

// Track whales every 6 hours
setInterval(trackWhales, 6 * 60 * 60 * 1000);
