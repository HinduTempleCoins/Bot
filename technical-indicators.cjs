#!/usr/bin/env node

// ========================================
// TECHNICAL INDICATORS FOR TRADING
// ========================================
// Bollinger Bands, RSI, SMA, EMA calculations
// Used for entry/exit trading signals

/**
 * Calculate Simple Moving Average (SMA)
 * @param {Array} prices - Array of prices
 * @param {number} period - Period for SMA (e.g., 20)
 * @returns {number} SMA value
 */
function calculateSMA(prices, period) {
  if (prices.length < period) return null;

  const slice = prices.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

/**
 * Calculate Exponential Moving Average (EMA)
 * @param {Array} prices - Array of prices
 * @param {number} period - Period for EMA (e.g., 12)
 * @returns {number} EMA value
 */
function calculateEMA(prices, period) {
  if (prices.length < period) return null;

  const multiplier = 2 / (period + 1);
  let ema = calculateSMA(prices.slice(0, period), period);

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate Bollinger Bands
 * @param {Array} prices - Array of prices
 * @param {number} period - Period (typically 20)
 * @param {number} stdDev - Standard deviations (typically 2)
 * @returns {Object} {upper, middle, lower, bandwidth, percentB}
 */
function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return null;

  const sma = calculateSMA(prices, period);
  if (!sma) return null;

  // Calculate standard deviation
  const slice = prices.slice(-period);
  const squaredDiffs = slice.map(price => Math.pow(price - sma, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
  const standardDeviation = Math.sqrt(variance);

  const upper = sma + (standardDeviation * stdDev);
  const lower = sma - (standardDeviation * stdDev);
  const bandwidth = ((upper - lower) / sma) * 100;

  // %B indicator (where current price is within bands)
  // 0 = at lower band, 1 = at upper band, 0.5 = at middle
  const currentPrice = prices[prices.length - 1];
  const percentB = (currentPrice - lower) / (upper - lower);

  return {
    upper,
    middle: sma,
    lower,
    bandwidth,
    percentB,
    standardDeviation
  };
}

/**
 * Calculate RSI (Relative Strength Index)
 * @param {Array} prices - Array of prices
 * @param {number} period - Period (typically 14)
 * @returns {number} RSI value (0-100)
 */
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;

  // Calculate price changes
  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  // Separate gains and losses
  const gains = changes.map(change => change > 0 ? change : 0);
  const losses = changes.map(change => change < 0 ? Math.abs(change) : 0);

  // Calculate average gain and loss
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return rsi;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * @param {Array} prices - Array of prices
 * @param {number} fastPeriod - Fast EMA period (typically 12)
 * @param {number} slowPeriod - Slow EMA period (typically 26)
 * @param {number} signalPeriod - Signal line period (typically 9)
 * @returns {Object} {macd, signal, histogram}
 */
function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (prices.length < slowPeriod) return null;

  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);

  if (!fastEMA || !slowEMA) return null;

  const macdLine = fastEMA - slowEMA;

  // For signal line, we need MACD history
  // Simplified: just return the current MACD for now
  return {
    macd: macdLine,
    signal: null, // Would need MACD history to calculate properly
    histogram: null
  };
}

/**
 * Generate trading signals based on indicators
 * @param {Object} indicators - {bb, rsi, sma, currentPrice}
 * @returns {Object} {signal, strength, reasons}
 */
function generateTradingSignal(indicators) {
  const { bb, rsi, sma, currentPrice } = indicators;

  let signal = 'HOLD';
  let strength = 0;
  const reasons = [];

  // Bollinger Bands signals
  if (bb) {
    // Price at or below lower band = oversold = BUY signal
    if (bb.percentB <= 0.2) {
      signal = 'BUY';
      strength += 30;
      reasons.push(`Price near lower BB (${(bb.percentB * 100).toFixed(0)}%)`);
    }
    // Price at or above upper band = overbought = SELL signal
    else if (bb.percentB >= 0.8) {
      signal = 'SELL';
      strength += 30;
      reasons.push(`Price near upper BB (${(bb.percentB * 100).toFixed(0)}%)`);
    }

    // Squeeze (low volatility) = potential breakout coming
    if (bb.bandwidth < 10) {
      reasons.push(`BB squeeze detected (${bb.bandwidth.toFixed(1)}% bandwidth)`);
    }
  }

  // RSI signals
  if (rsi !== null) {
    // RSI < 30 = oversold = BUY signal
    if (rsi < 30) {
      if (signal === 'HOLD') signal = 'BUY';
      if (signal === 'BUY') strength += 35;
      reasons.push(`RSI oversold (${rsi.toFixed(1)})`);
    }
    // RSI > 70 = overbought = SELL signal
    else if (rsi > 70) {
      if (signal === 'HOLD') signal = 'SELL';
      if (signal === 'SELL') strength += 35;
      reasons.push(`RSI overbought (${rsi.toFixed(1)})`);
    }
    // RSI 40-60 = neutral
    else if (rsi >= 40 && rsi <= 60) {
      reasons.push(`RSI neutral (${rsi.toFixed(1)})`);
    }
  }

  // SMA trend
  if (sma !== null) {
    // Price above SMA = uptrend = potential BUY
    if (currentPrice > sma) {
      if (signal === 'BUY') strength += 20;
      reasons.push(`Price above SMA (uptrend)`);
    }
    // Price below SMA = downtrend = potential SELL
    else if (currentPrice < sma) {
      if (signal === 'SELL') strength += 20;
      reasons.push(`Price below SMA (downtrend)`);
    }
  }

  // Normalize strength to 0-100
  strength = Math.min(strength, 100);

  return {
    signal,
    strength,
    reasons,
    confidence: strength >= 60 ? 'HIGH' : strength >= 40 ? 'MEDIUM' : 'LOW'
  };
}

/**
 * Analyze price history and generate complete trading analysis
 * @param {Array} priceHistory - Array of historical prices
 * @returns {Object} Complete technical analysis
 */
function analyzeTechnicals(priceHistory) {
  if (!priceHistory || priceHistory.length < 20) {
    return {
      error: 'Insufficient price history (need at least 20 data points)',
      hasSignal: false
    };
  }

  const currentPrice = priceHistory[priceHistory.length - 1];

  // Calculate all indicators
  const bb = calculateBollingerBands(priceHistory, 20, 2);
  const rsi = calculateRSI(priceHistory, 14);
  const sma20 = calculateSMA(priceHistory, 20);
  const sma50 = calculateSMA(priceHistory, 50);
  const ema12 = calculateEMA(priceHistory, 12);
  const ema26 = calculateEMA(priceHistory, 26);

  // Generate trading signal
  const tradingSignal = generateTradingSignal({
    bb,
    rsi,
    sma: sma20,
    currentPrice
  });

  return {
    currentPrice,
    indicators: {
      bollingerBands: bb,
      rsi,
      sma20,
      sma50,
      ema12,
      ema26
    },
    signal: tradingSignal,
    hasSignal: tradingSignal.strength >= 40, // Only act on medium+ confidence
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  calculateSMA,
  calculateEMA,
  calculateBollingerBands,
  calculateRSI,
  calculateMACD,
  generateTradingSignal,
  analyzeTechnicals
};
