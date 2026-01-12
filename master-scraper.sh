#!/bin/bash
#
# Van Kush Family - Master Scraper
#
# Orchestrates all scraping activities:
# - Mythology and ancient texts (Sacred-Texts, Theoi, Gutenberg)
# - Crypto news (CoinDesk, CoinTelegraph, Decrypt)
# - Email contacts and profiling
# - Timeline building
# - Knowledge base updates
#

set -e  # Exit on error

DATASETS_DIR="datasets"
RATE_LIMIT=2.0

echo "🚀 Van Kush Family Master Scraper"
echo "=================================="
echo ""

# Make scripts executable
chmod +x web-scraper.py crypto-news-scraper.py email-scraper.py knowledge-base.py 2>/dev/null || true

# Function to scrape mythology topics
scrape_mythology() {
    echo "📖 Scraping mythology and ancient texts..."
    echo ""

    # Sacred-Texts.com sections (check robots.txt first)
    echo "Note: Sacred-Texts.com may block scraping. Using Archive.org alternatives..."

    # Project Gutenberg books (mythology and ancient texts)
    echo "📚 Downloading mythology texts from Project Gutenberg..."

    # Bible and religious texts
    python3 web-scraper.py --source gutenberg --book-id "10" --output "$DATASETS_DIR"

    # You can add more Gutenberg book IDs related to mythology
    # Find book IDs at: https://www.gutenberg.org/

    echo "✅ Mythology scraping complete"
    echo ""
}

# Function to scrape crypto news
scrape_crypto_news() {
    echo "📰 Scraping cryptocurrency news..."
    echo ""

    python3 crypto-news-scraper.py --update-news --hours 48 --output "$DATASETS_DIR"

    echo "✅ Crypto news scraping complete"
    echo ""
}

# Function to build unified timeline
build_timeline() {
    echo "📅 Building unified timeline..."
    echo ""

    python3 crypto-news-scraper.py --build-timeline --output "$DATASETS_DIR"

    echo "✅ Timeline building complete"
    echo ""
}

# Function to scrape emails
scrape_emails() {
    echo "📧 Email scraping..."
    echo ""

    if [ -f "email-urls.txt" ]; then
        python3 email-scraper.py --file email-urls.txt --max-depth 1 --output "$DATASETS_DIR"
    else
        echo "⚠️  No email-urls.txt file found. Skipping email scraping."
        echo "   Create email-urls.txt with URLs to scrape (one per line)"
    fi

    echo ""
}

# Function to update knowledge base
update_knowledge_base() {
    echo "📚 Updating knowledge base..."
    echo ""

    python3 knowledge-base.py --datasets-dir "$DATASETS_DIR" --stats

    echo "✅ Knowledge base updated"
    echo ""
}

# Main menu
if [ "$#" -eq 0 ]; then
    echo "Usage: ./master-scraper.sh [OPTIONS]"
    echo ""
    echo "OPTIONS:"
    echo "  --all              Run all scrapers"
    echo "  --mythology        Scrape mythology and ancient texts"
    echo "  --crypto-news      Scrape crypto news (last 48 hours)"
    echo "  --emails           Scrape emails from URLs in email-urls.txt"
    echo "  --timeline         Build unified timeline from all datasets"
    echo "  --update-kb        Update knowledge base and show stats"
    echo "  --serve            Start knowledge base API server"
    echo ""
    echo "EXAMPLES:"
    echo "  ./master-scraper.sh --all"
    echo "  ./master-scraper.sh --crypto-news --timeline"
    echo "  ./master-scraper.sh --serve"
    exit 0
fi

# Parse arguments
while [ "$#" -gt 0 ]; do
    case "$1" in
        --all)
            scrape_mythology
            scrape_crypto_news
            scrape_emails
            build_timeline
            update_knowledge_base
            shift
            ;;
        --mythology)
            scrape_mythology
            shift
            ;;
        --crypto-news)
            scrape_crypto_news
            shift
            ;;
        --emails)
            scrape_emails
            shift
            ;;
        --timeline)
            build_timeline
            shift
            ;;
        --update-kb)
            update_knowledge_base
            shift
            ;;
        --serve)
            echo "🌐 Starting Knowledge Base API server..."
            echo "   Access at: http://localhost:8765"
            echo "   Press Ctrl+C to stop"
            echo ""
            python3 knowledge-base.py --datasets-dir "$DATASETS_DIR" --serve
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo ""
echo "✅ All scraping operations complete!"
echo ""
echo "Next steps:"
echo "  - Run: ./master-scraper.sh --update-kb"
echo "  - Run: ./master-scraper.sh --serve (to start API)"
echo "  - Query: python3 knowledge-base.py --search 'VKBT'"
