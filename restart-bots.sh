#!/bin/bash

# ========================================
# RESTART BOTS WITH LATEST FIXES
# ========================================
# Run this on the Google VM to apply fixes

set -e

echo "🔄 Pulling latest code..."
git pull origin claude/update-todos-9iXhF

echo ""
echo "🛑 Stopping ALL bots..."
pm2 stop pusher-live 2>/dev/null || true
pm2 stop portfolio-bot 2>/dev/null || true
pm2 delete pusher-live 2>/dev/null || true
pm2 delete portfolio-bot 2>/dev/null || true

echo ""
echo "🚀 Starting price pusher bot (places BUY orders to support VKBT/CURE prices)..."
pm2 start vankush-price-pusher.cjs --name pusher-live

echo ""
echo "✅ Pusher bot will check market every 15 minutes and compete with existing buyers"

echo ""
echo "💾 Saving PM2 config..."
pm2 save

echo ""
echo "✅ BOTS RESTARTED!"
echo ""
echo "📊 Check status:"
echo "   pm2 list"
echo ""
echo "📋 Check logs:"
echo "   pm2 logs pusher-live"
echo "   pm2 logs portfolio-bot"
echo ""
echo "🔍 Verify BUY orders are placed within 15 minutes:"
echo "   https://hive-engine.com/trade/VKBT"
echo "   https://hive-engine.com/trade/CURE"
echo ""
echo "🎯 BOT STRATEGY:"
echo "   ✅ Checks market every 15 minutes"
echo "   ✅ Places minimal buy orders to support VKBT/CURE prices"
echo "   ✅ Outbids existing buyers by tiny increments (0.00000010 HIVE)"
echo "   ✅ Conservative budget: 5 HIVE/day max"
echo ""
