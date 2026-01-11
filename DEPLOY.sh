#!/bin/bash

# ========================================
# VAN KUSH TRADING BOT DEPLOYMENT
# ========================================
# Target: Google VM (already has Gemini CLI)
# Purpose: Deploy HIVE-Engine/TribalDEX trading bots
# Date: 2026-01-10

set -e  # Exit on error

echo "🚀 VAN KUSH TRADING BOT DEPLOYMENT"
echo "=================================="
echo ""

# Check if we're in the right directory
if [ ! -f "vankush-price-pusher.cjs" ]; then
    echo "❌ Error: Not in Bot directory!"
    echo "   Please cd to /home/user/Bot first"
    exit 1
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ Error: .env file not found!"
    echo "   Create .env with your HIVE credentials"
    exit 1
fi

# Check if credentials are set
if ! grep -q "HIVE_USERNAME=angelicalist" .env; then
    echo "⚠️  Warning: HIVE_USERNAME not set in .env"
fi

if ! grep -q "HIVE_ACTIVE_KEY=" .env | grep -q "5J"; then
    echo "⚠️  Warning: HIVE_ACTIVE_KEY not set in .env"
fi

echo "✅ Environment check passed"
echo ""

# Install PM2 if not already installed
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    npm install -g pm2
    echo "✅ PM2 installed"
else
    echo "✅ PM2 already installed"
fi

echo ""
echo "🔧 DEPLOYMENT OPTIONS:"
echo "=================================="
echo ""
echo "1. Portfolio Tracker (Read-only, safe to start)"
echo "2. Market Maker with Dance Strategy (DRY RUN)"
echo "3. Market Maker with Dance Strategy (LIVE - competes with bots!)"
echo "4. Price Pusher (DRY RUN - no real trades)"
echo "5. Price Pusher (LIVE - real trades!)"
echo "6. HIVE Content Bot (Daily VKBT/CURE posts + tips)"
echo "7. All bots (Portfolio + Market Maker + Content)"
echo "8. Test bots (run once, no PM2)"
echo ""
read -p "Choose option (1-8): " OPTION

case $OPTION in
    1)
        echo ""
        echo "📊 Deploying Portfolio Tracker..."
        pm2 start vankush-portfolio-tracker.cjs --name portfolio
        pm2 save
        echo "✅ Portfolio tracker started!"
        echo "   View logs: pm2 logs portfolio"
        ;;

    2)
        echo ""
        echo "💎 Deploying Market Maker (DRY RUN)..."
        echo "   Strategy: Competitive 'dance' with other bots"
        echo "   Places orders above competing bots every 15-60min"
        echo ""

        # Ensure dry run is enabled
        if ! grep -q "MM_DRY_RUN=true" .env; then
            echo "⚠️  Setting MM_DRY_RUN=true in .env..."
            if grep -q "MM_DRY_RUN=" .env; then
                sed -i 's/MM_DRY_RUN=.*/MM_DRY_RUN=true/' .env
            else
                echo "MM_DRY_RUN=true" >> .env
            fi
        fi

        # Set 15-minute interval for the dance
        if ! grep -q "MM_NUDGE_INTERVAL=" .env; then
            echo "MM_NUDGE_INTERVAL=900000" >> .env
            echo "ℹ️  Set dance interval to 15 minutes"
        fi

        pm2 start vankush-market-maker.cjs --name market-maker-dry
        pm2 save
        echo "✅ Market Maker started in DRY RUN mode!"
        echo "   View logs: pm2 logs market-maker-dry"
        echo "   💡 Bot will detect competing bots and place orders above them"
        echo "   ⚠️  Watch for 24 hours before enabling live trading!"
        ;;

    3)
        echo ""
        echo "💎 Deploying Market Maker (LIVE TRADING)..."
        echo "   Strategy: Competitive 'dance' with other bots"
        echo "⚠️  WARNING: This will spend real HIVE competing with bots!"
        echo ""
        read -p "Are you sure? Type 'YES' to continue: " CONFIRM

        if [ "$CONFIRM" != "YES" ]; then
            echo "❌ Deployment cancelled"
            exit 0
        fi

        # Set dry run to false
        if grep -q "MM_DRY_RUN=" .env; then
            sed -i 's/MM_DRY_RUN=.*/MM_DRY_RUN=false/' .env
        else
            echo "MM_DRY_RUN=false" >> .env
        fi

        # Set 15-minute interval for the dance
        if ! grep -q "MM_NUDGE_INTERVAL=" .env; then
            echo "MM_NUDGE_INTERVAL=900000" >> .env
            echo "ℹ️  Set dance interval to 15 minutes"
        fi

        pm2 start vankush-market-maker.cjs --name market-maker-live
        pm2 save
        echo "✅ Market Maker started in LIVE mode!"
        echo "   View logs: pm2 logs market-maker-live"
        echo "   💎 Every 15 min: Detect bots → Place order above them → Force competition"
        echo "   🎯 Goal: Raise VKBT/CURE to 1:1 with HIVE"
        echo "   💰 Check logs to see bot detection and dance execution"
        ;;

    4)
        echo ""
        echo "🔒 Deploying Price Pusher (DRY RUN)..."

        # Ensure dry run is enabled
        if ! grep -q "MM_DRY_RUN=true" .env; then
            echo "⚠️  Setting MM_DRY_RUN=true in .env..."
            if grep -q "MM_DRY_RUN=" .env; then
                sed -i 's/MM_DRY_RUN=.*/MM_DRY_RUN=true/' .env
            else
                echo "MM_DRY_RUN=true" >> .env
            fi
        fi

        pm2 start vankush-price-pusher.cjs --name pusher-dry
        pm2 save
        echo "✅ Price pusher started in DRY RUN mode!"
        echo "   View logs: pm2 logs pusher-dry"
        echo "   ⚠️  Watch for 24 hours before enabling live trading!"
        ;;

    5)
        echo ""
        echo "⚡ Deploying Price Pusher (LIVE TRADING)..."
        echo "⚠️  WARNING: This will spend real HIVE!"
        echo ""
        read -p "Are you sure? Type 'YES' to continue: " CONFIRM

        if [ "$CONFIRM" != "YES" ]; then
            echo "❌ Deployment cancelled"
            exit 0
        fi

        # Set dry run to false
        if grep -q "MM_DRY_RUN=" .env; then
            sed -i 's/MM_DRY_RUN=.*/MM_DRY_RUN=false/' .env
        else
            echo "MM_DRY_RUN=false" >> .env
        fi

        pm2 start vankush-price-pusher.cjs --name pusher-live
        pm2 save
        echo "✅ Price pusher started in LIVE mode!"
        echo "   View logs: pm2 logs pusher-live"
        echo "   💰 Budget: Check .env for MAX_DAILY_BUDGET_HIVE"
        ;;

    6)
        echo ""
        echo "📝 Deploying HIVE Content Bot..."

        # Ensure HIVE_POSTING_KEY is set
        if ! grep -q "HIVE_POSTING_KEY=" .env | grep -q "5J"; then
            echo "⚠️  Warning: HIVE_POSTING_KEY not set in .env"
            echo "   The bot needs posting key to publish content"
        fi

        # Set dry run for content bot (default safe)
        if ! grep -q "HIVE_BOT_DRY_RUN=" .env; then
            echo "HIVE_BOT_DRY_RUN=true" >> .env
            echo "ℹ️  Set to DRY RUN mode (edit .env to enable posting)"
        fi

        pm2 start hive-content-bot.cjs --name hive-content
        pm2 save
        echo "✅ HIVE Content Bot started!"
        echo "   View logs: pm2 logs hive-content"
        echo "   Posts daily at 14:00 UTC with VKBT/CURE updates"
        echo "   Requests tips: !PIZZA !BEER !LUV !WINEX !HUG !hivebits !GM"
        ;;

    5)
        echo ""
        echo "📊 Deploying ALL bots..."

        # Portfolio tracker
        pm2 start vankush-portfolio-tracker.cjs --name portfolio

        # Price pusher (dry run by default)
        if ! grep -q "MM_DRY_RUN=true" .env; then
            if grep -q "MM_DRY_RUN=" .env; then
                sed -i 's/MM_DRY_RUN=.*/MM_DRY_RUN=true/' .env
            else
                echo "MM_DRY_RUN=true" >> .env
            fi
        fi
        pm2 start vankush-price-pusher.cjs --name pusher

        # HIVE Content Bot (dry run by default)
        if ! grep -q "HIVE_BOT_DRY_RUN=true" .env; then
            if grep -q "HIVE_BOT_DRY_RUN=" .env; then
                sed -i 's/HIVE_BOT_DRY_RUN=.*/HIVE_BOT_DRY_RUN=true/' .env
            else
                echo "HIVE_BOT_DRY_RUN=true" >> .env
            fi
        fi
        pm2 start hive-content-bot.cjs --name hive-content

        pm2 save
        echo "✅ All bots started!"
        echo "   View status: pm2 list"
        echo "   View logs: pm2 logs"
        ;;

    6)
        echo ""
        echo "🧪 Testing bots (one-time run)..."
        echo ""
        echo "1. Testing wall analyzer..."
        node test-wall-analyzer.cjs
        echo ""
        echo "2. Testing holder analyzer..."
        node holder-analyzer.cjs
        echo ""
        echo "3. Testing psychology tracker..."
        node psychology-tracker.cjs
        echo ""
        echo "✅ All tests complete!"
        echo "   Review output above for any errors"
        exit 0
        ;;

    *)
        echo "❌ Invalid option"
        exit 1
        ;;
esac

echo ""
echo "=================================="
echo "🎉 DEPLOYMENT COMPLETE!"
echo "=================================="
echo ""
echo "📊 Monitoring Commands:"
echo "   pm2 list              - Show all running bots"
echo "   pm2 logs              - View all logs"
echo "   pm2 logs portfolio    - View portfolio tracker logs"
echo "   pm2 logs pusher       - View price pusher logs"
echo "   pm2 stop all          - Stop all bots"
echo "   pm2 restart all       - Restart all bots"
echo "   pm2 delete all        - Remove all bots from PM2"
echo ""
echo "📈 Analysis Commands:"
echo "   node test-wall-analyzer.cjs     - Check current opportunities"
echo "   node holder-analyzer.cjs        - Update holder distribution"
echo "   node psychology-tracker.cjs     - Capture market snapshot"
echo "   node psychology-tracker.cjs --report  - Generate weekly report"
echo ""
echo "🔧 Configuration:"
echo "   Edit .env to change settings"
echo "   pm2 restart all to apply changes"
echo ""
echo "📁 Files to Monitor:"
echo "   ./price-snapshots.json     - Psychology metrics"
echo "   ./holder-history.json      - Holder distribution"
echo "   ./portfolio_history.json   - Wallet tracking"
echo ""
echo "🚀 Next Steps:"
if [ "$OPTION" == "2" ]; then
    echo "   1. Monitor dry run for 24 hours"
    echo "   2. Review logs: pm2 logs pusher-dry"
    echo "   3. Check snapshots: node psychology-tracker.cjs"
    echo "   4. If satisfied, re-run with Option 3 (LIVE)"
elif [ "$OPTION" == "3" ]; then
    echo "   1. Monitor closely for first hour"
    echo "   2. Check budget usage: pm2 logs pusher-live | grep Budget"
    echo "   3. Track weekly: node psychology-tracker.cjs --report"
    echo "   4. Adjust strategy based on holder growth"
else
    echo "   1. Monitor logs: pm2 logs"
    echo "   2. Check for errors"
    echo "   3. Review data collection"
fi
echo ""
echo "✅ Trading bot is LIVE on HIVE-Engine/TribalDEX!"
echo ""
