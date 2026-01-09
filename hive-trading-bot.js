import axios from 'axios';
import dotenv from 'dotenv';
import { readFile, writeFile } from 'fs/promises';
import dhive from '@hiveio/dhive';
import { isTokenHealthy, getTokenHealth } from './hive-token-scanner.js';

dotenv.config();

// ========================================
// HIVE-ENGINE TRADING BOT
// ========================================
// Automated trading for BEE:SWAP.HIVE pair
// Buy: 5% below market price
// Sell: 2% profit margin
// Discord webhook notifications

// HIVE-Engine API endpoints
const HIVE_ENGINE_API = 'https://api.hive-engine.com/rpc/contracts';
const HIVE_ENGINE_RPC = 'https://engine.rishipanthee.com';

// Configuration
const CONFIG = {
  TOKEN_PAIR: process.env.HIVE_TOKEN_PAIR || 'BEE:SWAP.HIVE',
  BUY_THRESHOLD: parseFloat(process.env.HIVE_BUY_THRESHOLD || '5'), // 5% below market
  SELL_THRESHOLD: parseFloat(process.env.HIVE_SELL_THRESHOLD || '2'), // 2% profit
  TRADE_AMOUNT: parseFloat(process.env.HIVE_TRADE_AMOUNT || '10'), // HIVE per trade
  CHECK_INTERVAL: parseInt(process.env.HIVE_CHECK_INTERVAL || '60000'), // 1 minute
  MAX_POSITION_SIZE: parseFloat(process.env.HIVE_MAX_POSITION || '100'), // Max HIVE exposure
  STOP_LOSS_PERCENT: parseFloat(process.env.HIVE_STOP_LOSS || '10'), // Stop loss at -10%
  DRY_RUN: process.env.HIVE_DRY_RUN === 'true', // Paper trading mode
  DISCORD_WEBHOOK: process.env.HIVE_DISCORD_WEBHOOK,
};

// Parse token pair
const [TOKEN, BASE] = CONFIG.TOKEN_PAIR.split(':');

// Initialize HIVE client
const client = new dhive.Client([
  'https://api.hive.blog',
  'https://api.hivekings.com',
  'https://anyx.io',
  'https://api.openhive.network'
]);

// Trading state
let tradingState = {
  positions: [], // Open positions
  totalProfit: 0,
  totalTrades: 0,
  lastPrice: null,
  balance: {
    token: 0,
    base: 0
  }
};

// Load trading state from file
try {
  const data = await readFile('./hive-trading-state.json', 'utf8');
  tradingState = JSON.parse(data);
  console.log('✅ Loaded trading state:', tradingState);
} catch (error) {
  console.log('📝 No existing trading state, starting fresh');
}

// Save trading state periodically
setInterval(async () => {
  try {
    await writeFile('./hive-trading-state.json', JSON.stringify(tradingState, null, 2));
  } catch (error) {
    console.error('Error saving trading state:', error);
  }
}, 60000); // Every minute

// ========================================
// HIVE-ENGINE API FUNCTIONS
// ========================================

async function getMarketMetrics(symbol) {
  try {
    const response = await axios.post(HIVE_ENGINE_API, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'market',
        table: 'metrics',
        query: { symbol },
        limit: 1
      }
    });

    return response.data.result?.[0] || null;
  } catch (error) {
    console.error('Error fetching market metrics:', error.message);
    return null;
  }
}

async function getOrderBook(symbol) {
  try {
    // Get buy orders
    const buyOrders = await axios.post(HIVE_ENGINE_API, {
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
    });

    // Get sell orders
    const sellOrders = await axios.post(HIVE_ENGINE_API, {
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
    });

    return {
      bids: buyOrders.data.result || [],
      asks: sellOrders.data.result || []
    };
  } catch (error) {
    console.error('Error fetching order book:', error.message);
    return { bids: [], asks: [] };
  }
}

async function getUserBalances(username) {
  try {
    const response = await axios.post(HIVE_ENGINE_API, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'balances',
        query: { account: username },
        limit: 1000
      }
    });

    const balances = response.data.result || [];
    const tokenBalance = balances.find(b => b.symbol === TOKEN);
    const baseBalance = balances.find(b => b.symbol === BASE);

    return {
      token: parseFloat(tokenBalance?.balance || 0),
      base: parseFloat(baseBalance?.balance || 0)
    };
  } catch (error) {
    console.error('Error fetching balances:', error.message);
    return { token: 0, base: 0 };
  }
}

// ========================================
// TRADING LOGIC
// ========================================

async function executeBuy(price, quantity) {
  if (CONFIG.DRY_RUN) {
    console.log(`[DRY RUN] Would BUY ${quantity} ${TOKEN} at ${price} ${BASE}`);
    return { success: true, txId: 'dry-run' };
  }

  try {
    const privateKey = dhive.PrivateKey.fromString(process.env.HIVE_ACTIVE_KEY);
    const username = process.env.HIVE_USERNAME;

    const json = {
      contractName: 'market',
      contractAction: 'buy',
      contractPayload: {
        symbol: TOKEN,
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
    console.error('Error executing buy:', error);
    return { success: false, error: error.message };
  }
}

async function executeSell(price, quantity) {
  if (CONFIG.DRY_RUN) {
    console.log(`[DRY RUN] Would SELL ${quantity} ${TOKEN} at ${price} ${BASE}`);
    return { success: true, txId: 'dry-run' };
  }

  try {
    const privateKey = dhive.PrivateKey.fromString(process.env.HIVE_ACTIVE_KEY);
    const username = process.env.HIVE_USERNAME;

    const json = {
      contractName: 'market',
      contractAction: 'sell',
      contractPayload: {
        symbol: TOKEN,
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
    console.error('Error executing sell:', error);
    return { success: false, error: error.message };
  }
}

async function sendDiscordNotification(message, color = 0x00ff00) {
  if (!CONFIG.DISCORD_WEBHOOK) return;

  try {
    await axios.post(CONFIG.DISCORD_WEBHOOK, {
      embeds: [{
        title: '🤖 HIVE Trading Bot',
        description: message,
        color: color,
        timestamp: new Date().toISOString(),
        footer: { text: `${CONFIG.TOKEN_PAIR} • ${CONFIG.DRY_RUN ? 'DRY RUN' : 'LIVE'}` }
      }]
    });
  } catch (error) {
    console.error('Error sending Discord notification:', error.message);
  }
}

// ========================================
// MAIN TRADING LOOP
// ========================================

async function analyzeMarket() {
  try {
    // Get current market data
    const metrics = await getMarketMetrics(TOKEN);
    if (!metrics) {
      console.log('⚠️ Could not fetch market metrics');
      return;
    }

    const currentPrice = parseFloat(metrics.lastPrice || 0);
    const volume = parseFloat(metrics.volume || 0);

    if (currentPrice === 0) {
      console.log('⚠️ Invalid price data');
      return;
    }

    console.log(`\n📊 ${TOKEN} Market Analysis`);
    console.log(`   Current Price: ${currentPrice.toFixed(8)} ${BASE}`);
    console.log(`   24h Volume: ${volume.toFixed(2)} ${BASE}`);
    console.log(`   Last Price: ${tradingState.lastPrice?.toFixed(8) || 'N/A'}`);

    // Get order book
    const orderBook = await getOrderBook(TOKEN);
    const bestBid = orderBook.bids[0] ? parseFloat(orderBook.bids[0].price) : 0;
    const bestAsk = orderBook.asks[0] ? parseFloat(orderBook.asks[0].price) : 0;

    console.log(`   Best Bid: ${bestBid.toFixed(8)} ${BASE}`);
    console.log(`   Best Ask: ${bestAsk.toFixed(8)} ${BASE}`);

    // Update balances
    if (process.env.HIVE_USERNAME) {
      tradingState.balance = await getUserBalances(process.env.HIVE_USERNAME);
      console.log(`   Balance: ${tradingState.balance.token.toFixed(4)} ${TOKEN}, ${tradingState.balance.base.toFixed(4)} ${BASE}`);
    }

    // Check for buy opportunity (price dropped 5% or more)
    if (tradingState.lastPrice) {
      const priceChange = ((currentPrice - tradingState.lastPrice) / tradingState.lastPrice) * 100;

      if (priceChange <= -CONFIG.BUY_THRESHOLD) {
        // Price dropped enough - buy opportunity
        const buyQuantity = CONFIG.TRADE_AMOUNT / currentPrice;

        // Check if we have enough balance
        if (tradingState.balance.base >= CONFIG.TRADE_AMOUNT) {
          // Check max position size
          const currentExposure = tradingState.positions.reduce((sum, pos) => sum + pos.cost, 0);

          if (currentExposure + CONFIG.TRADE_AMOUNT <= CONFIG.MAX_POSITION_SIZE) {
            console.log(`\n🟢 BUY SIGNAL: Price dropped ${Math.abs(priceChange).toFixed(2)}%`);

            // ⚠️ TOKEN HEALTH CHECK - Don't buy dead tokens!
            const tokenHealth = getTokenHealth(TOKEN);
            if (!tokenHealth) {
              console.log(`⚠️ No health data for ${TOKEN} - run token scanner first!`);
              console.log(`   Run: npm run scan-tokens`);
            } else if (!isTokenHealthy(TOKEN)) {
              console.log(`❌ TRADE BLOCKED: ${TOKEN} is not healthy!`);
              console.log(`   Status: ${tokenHealth.healthStatus.toUpperCase()}`);
              console.log(`   Score: ${tokenHealth.healthScore}/100`);
              console.log(`   Issues: ${tokenHealth.issues.join(', ')}`);

              await sendDiscordNotification(
                `🚫 **BUY BLOCKED - UNHEALTHY TOKEN**\n` +
                `Token: ${TOKEN}\n` +
                `Status: ${tokenHealth.healthStatus.toUpperCase()}\n` +
                `Health Score: ${tokenHealth.healthScore}/100\n` +
                `Issues: ${tokenHealth.issues.join(', ')}\n\n` +
                `This token does not meet minimum health criteria. Trade cancelled.`,
                0xff9900
              );
              return; // Skip this buy
            } else {
              console.log(`✅ Token health check passed (Score: ${tokenHealth.healthScore}/100)`);
            }

            const result = await executeBuy(currentPrice, buyQuantity);

            if (result.success) {
              // Record position
              tradingState.positions.push({
                type: 'long',
                entryPrice: currentPrice,
                quantity: buyQuantity,
                cost: CONFIG.TRADE_AMOUNT,
                timestamp: Date.now(),
                txId: result.txId
              });

              tradingState.totalTrades++;

              await sendDiscordNotification(
                `✅ **BUY ORDER EXECUTED**\n` +
                `Price: ${currentPrice.toFixed(8)} ${BASE}\n` +
                `Quantity: ${buyQuantity.toFixed(4)} ${TOKEN}\n` +
                `Cost: ${CONFIG.TRADE_AMOUNT} ${BASE}\n` +
                `Reason: Price dropped ${Math.abs(priceChange).toFixed(2)}%\n` +
                `TX: ${result.txId}`,
                0x00ff00
              );
            }
          } else {
            console.log(`⚠️ Max position size reached (${currentExposure.toFixed(2)}/${CONFIG.MAX_POSITION_SIZE} ${BASE})`);
          }
        } else {
          console.log(`⚠️ Insufficient ${BASE} balance (have: ${tradingState.balance.base.toFixed(4)}, need: ${CONFIG.TRADE_AMOUNT})`);
        }
      }
    }

    // Check open positions for sell opportunities
    for (let i = tradingState.positions.length - 1; i >= 0; i--) {
      const position = tradingState.positions[i];
      const profitPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

      // Check for take profit (2% profit)
      if (profitPercent >= CONFIG.SELL_THRESHOLD) {
        console.log(`\n🟢 SELL SIGNAL: Position up ${profitPercent.toFixed(2)}%`);

        const result = await executeSell(currentPrice, position.quantity);

        if (result.success) {
          const profit = (currentPrice - position.entryPrice) * position.quantity;
          tradingState.totalProfit += profit;

          await sendDiscordNotification(
            `✅ **SELL ORDER EXECUTED** (Take Profit)\n` +
            `Entry: ${position.entryPrice.toFixed(8)} ${BASE}\n` +
            `Exit: ${currentPrice.toFixed(8)} ${BASE}\n` +
            `Quantity: ${position.quantity.toFixed(4)} ${TOKEN}\n` +
            `Profit: ${profit.toFixed(4)} ${BASE} (+${profitPercent.toFixed(2)}%)\n` +
            `Total Profit: ${tradingState.totalProfit.toFixed(4)} ${BASE}\n` +
            `TX: ${result.txId}`,
            0x00ff00
          );

          tradingState.positions.splice(i, 1);
          tradingState.totalTrades++;
        }
      }
      // Check for stop loss (-10% loss)
      else if (profitPercent <= -CONFIG.STOP_LOSS_PERCENT) {
        console.log(`\n🔴 STOP LOSS TRIGGERED: Position down ${Math.abs(profitPercent).toFixed(2)}%`);

        const result = await executeSell(currentPrice, position.quantity);

        if (result.success) {
          const loss = (currentPrice - position.entryPrice) * position.quantity;
          tradingState.totalProfit += loss; // Will be negative

          await sendDiscordNotification(
            `⚠️ **SELL ORDER EXECUTED** (Stop Loss)\n` +
            `Entry: ${position.entryPrice.toFixed(8)} ${BASE}\n` +
            `Exit: ${currentPrice.toFixed(8)} ${BASE}\n` +
            `Quantity: ${position.quantity.toFixed(4)} ${TOKEN}\n` +
            `Loss: ${loss.toFixed(4)} ${BASE} (${profitPercent.toFixed(2)}%)\n` +
            `Total Profit: ${tradingState.totalProfit.toFixed(4)} ${BASE}\n` +
            `TX: ${result.txId}`,
            0xff0000
          );

          tradingState.positions.splice(i, 1);
          tradingState.totalTrades++;
        }
      }
    }

    // Update last price
    tradingState.lastPrice = currentPrice;

    // Print status
    console.log(`\n📈 Trading Status:`);
    console.log(`   Open Positions: ${tradingState.positions.length}`);
    console.log(`   Total Trades: ${tradingState.totalTrades}`);
    console.log(`   Total Profit: ${tradingState.totalProfit.toFixed(4)} ${BASE}`);

  } catch (error) {
    console.error('Error in market analysis:', error);
    await sendDiscordNotification(
      `❌ **ERROR IN TRADING BOT**\n${error.message}`,
      0xff0000
    );
  }
}

// ========================================
// STARTUP
// ========================================

console.log('🤖 HIVE-Engine Trading Bot Starting...');
console.log(`📊 Token Pair: ${CONFIG.TOKEN_PAIR}`);
console.log(`📉 Buy Threshold: ${CONFIG.BUY_THRESHOLD}% below market`);
console.log(`📈 Sell Threshold: ${CONFIG.SELL_THRESHOLD}% profit`);
console.log(`💰 Trade Amount: ${CONFIG.TRADE_AMOUNT} ${BASE}`);
console.log(`🛡️ Stop Loss: ${CONFIG.STOP_LOSS_PERCENT}%`);
console.log(`🔄 Check Interval: ${CONFIG.CHECK_INTERVAL / 1000}s`);
console.log(`${CONFIG.DRY_RUN ? '🧪 DRY RUN MODE' : '🔴 LIVE TRADING'}\n`);

if (CONFIG.DRY_RUN) {
  console.log('⚠️  Paper trading mode enabled. No real trades will be executed.');
  console.log('⚠️  Set HIVE_DRY_RUN=false in .env to enable live trading.\n');
}

await sendDiscordNotification(
  `🚀 **Trading Bot Started**\n` +
  `Pair: ${CONFIG.TOKEN_PAIR}\n` +
  `Mode: ${CONFIG.DRY_RUN ? 'Paper Trading' : 'LIVE'}\n` +
  `Buy: ${CONFIG.BUY_THRESHOLD}% below market\n` +
  `Sell: ${CONFIG.SELL_THRESHOLD}% profit\n` +
  `Stop Loss: ${CONFIG.STOP_LOSS_PERCENT}%`,
  0x0099ff
);

// Run initial analysis
await analyzeMarket();

// Start trading loop
setInterval(analyzeMarket, CONFIG.CHECK_INTERVAL);
