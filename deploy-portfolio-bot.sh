#!/bin/bash

# Stop ALL broken bots
echo "Stopping broken bots..."
pm2 stop profit-trader 2>/dev/null || true
pm2 delete profit-trader 2>/dev/null || true
pm2 stop intelligent-trader 2>/dev/null || true
pm2 delete intelligent-trader 2>/dev/null || true

# Pull latest code
echo "Pulling latest code..."
git pull origin claude/update-todos-9iXhF

# Run health scanner to populate database
echo "Running health scanner..."
node hive-token-scanner.js

# Start portfolio bot LIVE
echo "Starting portfolio bot (LIVE TRADING)..."
pm2 start vankush-portfolio-bot.js --name portfolio-bot

# Show status
pm2 status

echo ""
echo "Portfolio bot deployed and LIVE!"
echo "Check logs: pm2 logs portfolio-bot"
echo "It will process gifts and make money NOW"
