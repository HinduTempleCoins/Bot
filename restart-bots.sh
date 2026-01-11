#!/bin/bash

# ========================================
# RESTART BOTS WITH LATEST FIXES
# ========================================
# Run this on the Google VM to apply fixes

set -e

echo "🔄 Pulling latest code..."
git pull origin claude/update-todos-9iXhF

echo ""
echo "🛑 Stopping old bots..."
pm2 stop pusher-live 2>/dev/null || true
pm2 stop portfolio-bot 2>/dev/null || true
pm2 delete pusher-live 2>/dev/null || true
pm2 delete portfolio-bot 2>/dev/null || true

echo ""
echo "🚀 Starting FIXED pusher bot (LIVE)..."
pm2 start vankush-price-pusher.cjs --name pusher-live

echo ""
echo "🚀 Starting FIXED portfolio bot (LIVE)..."
pm2 start vankush-portfolio-bot.js --name portfolio-bot

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
echo "🔍 Verify buy orders in 5-15 minutes:"
echo "   https://hive-engine.com/trade/VKBT"
echo "   https://hive-engine.com/trade/CURE"
echo ""
echo "🎯 FIXED ISSUES:"
echo "   ✅ Pusher processes BOTH VKBT and CURE every 15 min"
echo "   ✅ Cooldown reduced from 6 hours to 15 minutes"
echo "   ✅ Correct bid pricing when no buy orders exist"
echo "   ✅ Portfolio bot analyzes WHOLE wallet for trading opportunities"
echo ""
