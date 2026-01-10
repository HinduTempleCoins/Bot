#!/usr/bin/env python3
"""
Van Kush Family - Crypto News Scraper with Timeline

Scrapes cryptocurrency news from major sources and organizes on timeline.
Updates regularly to keep knowledge base current.

Sources: CoinDesk, CoinTelegraph, The Block, Decrypt
"""

import os
import json
import time
import re
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import argparse

try:
    import requests
    from bs4 import BeautifulSoup
    import feedparser
except ImportError:
    print("Installing required packages...")
    os.system("pip3 install -q requests beautifulsoup4 feedparser")
    import requests
    from bs4 import BeautifulSoup
    import feedparser


class CryptoNewsScraper:
    """Scrape crypto news and organize on timeline"""

    def __init__(self, rate_limit: float = 2.0, output_dir: str = "datasets"):
        self.rate_limit = rate_limit
        self.output_dir = output_dir
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Van-Kush-Family-Bot/1.0 (News Aggregation)'
        })

        os.makedirs(output_dir, exist_ok=True)

    def fetch_rss_feed(self, url: str) -> List[Dict]:
        """Fetch and parse RSS feed"""
        time.sleep(self.rate_limit)

        try:
            feed = feedparser.parse(url)
            articles = []

            for entry in feed.entries:
                # Parse publish date
                pub_date = None
                if hasattr(entry, 'published_parsed'):
                    pub_date = datetime(*entry.published_parsed[:6])
                elif hasattr(entry, 'updated_parsed'):
                    pub_date = datetime(*entry.updated_parsed[:6])

                article = {
                    'title': entry.get('title', 'No title'),
                    'url': entry.get('link', ''),
                    'summary': entry.get('summary', ''),
                    'published': pub_date.isoformat() if pub_date else datetime.now().isoformat(),
                    'source': feed.feed.get('title', 'Unknown'),
                    'category': 'crypto-news',
                    'scraped_at': datetime.now().isoformat()
                }

                # Extract topics/tags
                if hasattr(entry, 'tags'):
                    article['tags'] = [tag.term for tag in entry.tags]

                articles.append(article)

            print(f"✅ Fetched {len(articles)} articles from {url}")
            return articles

        except Exception as e:
            print(f"❌ Failed to fetch RSS feed {url}: {e}")
            return []

    def scrape_coindesk(self) -> List[Dict]:
        """Scrape CoinDesk RSS feed"""
        # CoinDesk has multiple RSS feeds
        feeds = [
            'https://www.coindesk.com/arc/outboundfeeds/rss/',
            'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml'
        ]

        all_articles = []
        for feed_url in feeds:
            articles = self.fetch_rss_feed(feed_url)
            for article in articles:
                article['source'] = 'CoinDesk'
            all_articles.extend(articles)

        return all_articles

    def scrape_cointelegraph(self) -> List[Dict]:
        """Scrape CoinTelegraph RSS feed"""
        feed_url = 'https://cointelegraph.com/rss'

        articles = self.fetch_rss_feed(feed_url)
        for article in articles:
            article['source'] = 'CoinTelegraph'

        return articles

    def scrape_decrypt(self) -> List[Dict]:
        """Scrape Decrypt RSS feed"""
        feed_url = 'https://decrypt.co/feed'

        articles = self.fetch_rss_feed(feed_url)
        for article in articles:
            article['source'] = 'Decrypt'

        return articles

    def scrape_all_sources(self, hours_back: int = 24) -> List[Dict]:
        """Scrape all crypto news sources"""
        print("📰 Scraping crypto news from all sources...")

        all_articles = []

        # Scrape each source
        all_articles.extend(self.scrape_coindesk())
        all_articles.extend(self.scrape_cointelegraph())
        all_articles.extend(self.scrape_decrypt())

        # Filter by time
        cutoff = datetime.now() - timedelta(hours=hours_back)
        recent_articles = []

        for article in all_articles:
            try:
                pub_date = datetime.fromisoformat(article['published'])
                if pub_date >= cutoff:
                    recent_articles.append(article)
            except:
                recent_articles.append(article)  # Include if can't parse date

        print(f"✅ Found {len(recent_articles)} articles from last {hours_back} hours")

        return recent_articles

    def save_to_timeline(self, articles: List[Dict], filename: str = 'crypto_news_timeline.jsonl'):
        """Save articles to timeline format"""
        filepath = os.path.join(self.output_dir, filename)

        # Sort by publish date
        articles.sort(key=lambda x: x['published'], reverse=True)

        with open(filepath, 'w', encoding='utf-8') as f:
            for article in articles:
                f.write(json.dumps(article, ensure_ascii=False) + '\n')

        print(f"✅ Saved {len(articles)} articles to {filepath}")

    def update_timeline(self, hours_back: int = 24):
        """Update timeline with latest news"""
        articles = self.scrape_all_sources(hours_back=hours_back)
        self.save_to_timeline(articles)

        # Also save summary
        summary = {
            'total_articles': len(articles),
            'sources': list(set(a['source'] for a in articles)),
            'date_range': {
                'start': min(a['published'] for a in articles) if articles else None,
                'end': max(a['published'] for a in articles) if articles else None
            },
            'updated_at': datetime.now().isoformat()
        }

        summary_file = os.path.join(self.output_dir, 'crypto_news_summary.json')
        with open(summary_file, 'w', encoding='utf-8') as f:
            json.dump(summary, f, indent=2)


class TimelineBuilder:
    """Build unified timeline from all datasets"""

    def __init__(self, datasets_dir: str = "datasets"):
        self.datasets_dir = datasets_dir
        self.events: List[Dict] = []

    def extract_date_from_doc(self, doc: Dict) -> Optional[datetime]:
        """Extract date from document"""
        # Try various date fields
        date_fields = [
            'published', 'created_at', 'scraped_at',
            'imported_at', 'first_seen', 'last_updated'
        ]

        for field in date_fields:
            if field in doc:
                try:
                    return datetime.fromisoformat(doc[field])
                except:
                    pass

        return None

    def load_all_datasets(self) -> List[Dict]:
        """Load all datasets into timeline"""
        print("📅 Building unified timeline...")

        for filename in os.listdir(self.datasets_dir):
            if filename.endswith('.jsonl'):
                filepath = os.path.join(self.datasets_dir, filename)

                with open(filepath, 'r', encoding='utf-8') as f:
                    for line in f:
                        if line.strip():
                            doc = json.loads(line)
                            date = self.extract_date_from_doc(doc)

                            if date:
                                event = {
                                    'date': date.isoformat(),
                                    'title': doc.get('title', 'Unknown'),
                                    'category': doc.get('category', 'unknown'),
                                    'source': doc.get('source', 'unknown'),
                                    'content_preview': doc.get('content', doc.get('summary', ''))[:200],
                                    'url': doc.get('url', '')
                                }
                                self.events.append(event)

        # Sort by date
        self.events.sort(key=lambda x: x['date'], reverse=True)

        print(f"✅ Built timeline with {len(self.events)} events")
        return self.events

    def save_timeline(self, filename: str = 'unified_timeline.jsonl'):
        """Save unified timeline"""
        filepath = os.path.join(self.datasets_dir, filename)

        with open(filepath, 'w', encoding='utf-8') as f:
            for event in self.events:
                f.write(json.dumps(event, ensure_ascii=False) + '\n')

        print(f"✅ Saved unified timeline to {filepath}")

    def get_events_by_date_range(self, start_date: datetime, end_date: datetime) -> List[Dict]:
        """Get events in date range"""
        return [
            e for e in self.events
            if start_date <= datetime.fromisoformat(e['date']) <= end_date
        ]

    def get_events_by_category(self, category: str) -> List[Dict]:
        """Get all events in category"""
        return [e for e in self.events if e['category'] == category]


def main():
    parser = argparse.ArgumentParser(description='Van Kush Family Crypto News & Timeline Builder')
    parser.add_argument('--update-news', action='store_true', help='Update crypto news')
    parser.add_argument('--hours', type=int, default=24, help='Hours of news to fetch')
    parser.add_argument('--build-timeline', action='store_true', help='Build unified timeline')
    parser.add_argument('--output', default='datasets', help='Output directory')
    parser.add_argument('--rate-limit', type=float, default=2.0, help='Seconds between requests')

    args = parser.parse_args()

    if args.update_news:
        scraper = CryptoNewsScraper(rate_limit=args.rate_limit, output_dir=args.output)
        scraper.update_timeline(hours_back=args.hours)

    if args.build_timeline:
        builder = TimelineBuilder(datasets_dir=args.output)
        builder.load_all_datasets()
        builder.save_timeline()

    if not args.update_news and not args.build_timeline:
        print("Please specify --update-news or --build-timeline")
        print("\nExample usage:")
        print("  python3 crypto-news-scraper.py --update-news --hours 48")
        print("  python3 crypto-news-scraper.py --build-timeline")


if __name__ == '__main__':
    main()
