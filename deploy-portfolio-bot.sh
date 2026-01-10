#!/bin/bash

# Stop the profit trader that's losing money
echo "Stopping profit-trader..."
pm2 stop profit-trader
pm2 delete profit-trader

# Pull latest code
echo "Pulling latest code..."
git pull origin claude/update-todos-9iXhF

# Run health scanner to populate database
echo "Running health scanner..."
node hive-token-scanner.js

# Start portfolio bot in dry run first
echo "Starting portfolio bot (dry run)..."
pm2 start vankush-portfolio-bot.js --name portfolio-bot

# Show status
pm2 status

echo ""
echo "Portfolio bot deployed!"
echo "Check logs: pm2 logs portfolio-bot"
echo ""
echo "To enable live trading: Set PORTFOLIO_DRY_RUN=false in .env"
