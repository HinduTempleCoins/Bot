#!/usr/bin/env python3
"""
Van Kush Family - Web Scraper & Knowledge Base Builder

Scrapes content from multiple sources:
- Sacred-Texts.com (mythology, ancient texts)
- Project Gutenberg (classic texts)
- Theoi.com (Greek mythology)
- Generic websites (configurable)
- PDF extraction

Outputs: JSONL format for AI training and knowledge base
"""

import os
import json
import time
import re
from datetime import datetime
from urllib.parse import urljoin, urlparse
from typing import List, Dict, Optional, Set
import argparse

try:
    import requests
    from bs4 import BeautifulSoup
    import PyPDF2
    from io import BytesIO
except ImportError:
    print("Installing required packages...")
    os.system("pip3 install -q requests beautifulsoup4 PyPDF2")
    import requests
    from bs4 import BeautifulSoup
    import PyPDF2
    from io import BytesIO


class WebScraper:
    """Base web scraper with rate limiting and robots.txt respect"""

    def __init__(self, rate_limit: float = 2.0, output_dir: str = "datasets"):
        self.rate_limit = rate_limit  # seconds between requests
        self.output_dir = output_dir
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Van-Kush-Family-Bot/1.0 (Educational/Research Purpose)'
        })
        self.visited_urls: Set[str] = set()

        os.makedirs(output_dir, exist_ok=True)

    def check_robots_txt(self, url: str) -> bool:
        """Check if scraping is allowed by robots.txt"""
        parsed = urlparse(url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"

        try:
            response = self.session.get(robots_url, timeout=10)
            if response.status_code == 200:
                # Simple check - just look for "Disallow: /"
                if "Disallow: /" in response.text:
                    print(f"⚠️  {parsed.netloc} blocks all bots via robots.txt")
                    return False
        except Exception as e:
            print(f"ℹ️  Could not fetch robots.txt for {parsed.netloc}: {e}")

        return True  # Assume allowed if can't check

    def fetch_url(self, url: str) -> Optional[requests.Response]:
        """Fetch URL with rate limiting"""
        if url in self.visited_urls:
            return None

        time.sleep(self.rate_limit)  # Rate limit

        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            self.visited_urls.add(url)
            return response
        except Exception as e:
            print(f"❌ Failed to fetch {url}: {e}")
            return None

    def extract_text_from_pdf(self, pdf_url: str) -> Optional[str]:
        """Download and extract text from PDF"""
        print(f"📄 Extracting PDF: {pdf_url}")

        response = self.fetch_url(pdf_url)
        if not response:
            return None

        try:
            pdf_file = BytesIO(response.content)
            pdf_reader = PyPDF2.PdfReader(pdf_file)

            text = ""
            for page_num, page in enumerate(pdf_reader.pages):
                text += f"\n--- Page {page_num + 1} ---\n"
                text += page.extract_text()

            return text.strip()
        except Exception as e:
            print(f"❌ PDF extraction failed: {e}")
            return None

    def clean_text(self, text: str) -> str:
        """Clean extracted text"""
        # Remove excessive whitespace
        text = re.sub(r'\n\s*\n\s*\n+', '\n\n', text)
        text = re.sub(r' +', ' ', text)
        return text.strip()

    def save_to_jsonl(self, data: List[Dict], filename: str):
        """Save data to JSONL format"""
        filepath = os.path.join(self.output_dir, filename)

        with open(filepath, 'w', encoding='utf-8') as f:
            for item in data:
                f.write(json.dumps(item, ensure_ascii=False) + '\n')

        print(f"✅ Saved {len(data)} entries to {filepath}")


class SacredTextsScraper(WebScraper):
    """Scraper for Sacred-Texts.com"""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.base_url = "https://www.sacred-texts.com"

    def scrape_page(self, url: str) -> Optional[Dict]:
        """Scrape a single page from Sacred-Texts"""
        response = self.fetch_url(url)
        if not response:
            return None

        soup = BeautifulSoup(response.content, 'html.parser')

        # Extract title
        title = soup.find('h1')
        title_text = title.get_text(strip=True) if title else "Unknown"

        # Extract main content
        content_div = soup.find('div', {'id': 'content'}) or soup.find('body')

        if not content_div:
            return None

        # Get text, removing script and style tags
        for tag in content_div(['script', 'style', 'nav', 'header', 'footer']):
            tag.decompose()

        content = self.clean_text(content_div.get_text())

        return {
            'source': 'sacred-texts.com',
            'url': url,
            'title': title_text,
            'content': content,
            'scraped_at': datetime.now().isoformat(),
            'category': 'mythology'
        }

    def scrape_section(self, section_url: str, max_pages: int = 100) -> List[Dict]:
        """Scrape an entire section (e.g., Egyptian mythology)"""
        print(f"📖 Scraping Sacred-Texts section: {section_url}")

        response = self.fetch_url(section_url)
        if not response:
            return []

        soup = BeautifulSoup(response.content, 'html.parser')

        # Find all links in the index
        links = soup.find_all('a', href=True)

        pages = []
        count = 0

        for link in links:
            if count >= max_pages:
                break

            href = link['href']

            # Skip external links and non-content pages
            if href.startswith('http') or href.startswith('#'):
                continue

            full_url = urljoin(section_url, href)

            # Only scrape .htm files
            if not full_url.endswith(('.htm', '.html')):
                continue

            page_data = self.scrape_page(full_url)
            if page_data:
                pages.append(page_data)
                count += 1
                print(f"  ✓ {count}/{max_pages}: {page_data['title']}")

        return pages


class GutenbergScraper(WebScraper):
    """Scraper for Project Gutenberg"""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.base_url = "https://www.gutenberg.org"

    def scrape_book(self, book_id: str) -> Optional[Dict]:
        """Scrape a book by ID from Project Gutenberg"""
        # Try plain text format first
        text_url = f"{self.base_url}/files/{book_id}/{book_id}-0.txt"

        print(f"📚 Downloading Gutenberg book {book_id}...")

        response = self.fetch_url(text_url)
        if not response:
            # Try alternative format
            text_url = f"{self.base_url}/files/{book_id}/{book_id}.txt"
            response = self.fetch_url(text_url)

        if not response:
            return None

        text = response.text

        # Extract title from header
        title_match = re.search(r'Title: (.+)', text)
        author_match = re.search(r'Author: (.+)', text)

        title = title_match.group(1).strip() if title_match else f"Book {book_id}"
        author = author_match.group(1).strip() if author_match else "Unknown"

        # Remove Gutenberg header/footer
        start = text.find('***START OF')
        end = text.find('***END OF')

        if start != -1 and end != -1:
            content = text[start:end]
            # Remove the START line itself
            content = re.sub(r'\*\*\*START OF[^\n]+\n+', '', content)
        else:
            content = text

        return {
            'source': 'gutenberg.org',
            'url': text_url,
            'book_id': book_id,
            'title': title,
            'author': author,
            'content': self.clean_text(content),
            'scraped_at': datetime.now().isoformat(),
            'category': 'classic-literature'
        }


class TheoiScraper(WebScraper):
    """Scraper for Theoi.com (Greek mythology)"""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.base_url = "https://www.theoi.com"

    def scrape_page(self, url: str) -> Optional[Dict]:
        """Scrape a single page from Theoi"""
        response = self.fetch_url(url)
        if not response:
            return None

        soup = BeautifulSoup(response.content, 'html.parser')

        # Extract title
        title = soup.find('h1')
        title_text = title.get_text(strip=True) if title else "Unknown"

        # Main content is usually in a specific div
        content_div = soup.find('div', {'class': 'content'}) or soup.find('body')

        if not content_div:
            return None

        # Remove navigation and ads
        for tag in content_div(['script', 'style', 'nav', 'aside', 'header', 'footer']):
            tag.decompose()

        content = self.clean_text(content_div.get_text())

        return {
            'source': 'theoi.com',
            'url': url,
            'title': title_text,
            'content': content,
            'scraped_at': datetime.now().isoformat(),
            'category': 'greek-mythology'
        }


class ClaudeArchiveImporter(WebScraper):
    """Import Claude discussion archives (PDF or text)"""

    def import_text_file(self, filepath: str, title: str, category: str = 'claude-discussion') -> Dict:
        """Import plain text file"""
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        return {
            'source': 'claude-archive',
            'filepath': filepath,
            'title': title,
            'content': self.clean_text(content),
            'imported_at': datetime.now().isoformat(),
            'category': category
        }

    def import_pdf_file(self, filepath: str, title: str, category: str = 'claude-discussion') -> Optional[Dict]:
        """Import PDF file"""
        try:
            with open(filepath, 'rb') as f:
                pdf_reader = PyPDF2.PdfReader(f)

                text = ""
                for page_num, page in enumerate(pdf_reader.pages):
                    text += f"\n--- Page {page_num + 1} ---\n"
                    text += page.extract_text()

            return {
                'source': 'claude-archive',
                'filepath': filepath,
                'title': title,
                'content': self.clean_text(text),
                'imported_at': datetime.now().isoformat(),
                'category': category
            }
        except Exception as e:
            print(f"❌ Failed to import PDF {filepath}: {e}")
            return None


def main():
    parser = argparse.ArgumentParser(description='Van Kush Family Web Scraper & Knowledge Base Builder')
    parser.add_argument('--source', choices=['sacred-texts', 'gutenberg', 'theoi', 'archive'],
                        required=True, help='Source to scrape')
    parser.add_argument('--url', help='URL or section to scrape')
    parser.add_argument('--book-id', help='Gutenberg book ID (comma-separated for multiple)')
    parser.add_argument('--file', help='File to import (for archive mode)')
    parser.add_argument('--title', help='Title for imported file')
    parser.add_argument('--max-pages', type=int, default=100, help='Maximum pages to scrape')
    parser.add_argument('--output', default='datasets', help='Output directory')
    parser.add_argument('--rate-limit', type=float, default=2.0, help='Seconds between requests')

    args = parser.parse_args()

    # Scrape based on source
    if args.source == 'sacred-texts':
        scraper = SacredTextsScraper(rate_limit=args.rate_limit, output_dir=args.output)

        if not scraper.check_robots_txt('https://www.sacred-texts.com'):
            print("❌ Scraping blocked by robots.txt. Consider using Archive.org or manual download.")
            return

        if args.url:
            pages = scraper.scrape_section(args.url, max_pages=args.max_pages)
            scraper.save_to_jsonl(pages, 'sacred_texts_dataset.jsonl')
        else:
            print("Please provide --url with the section URL to scrape")

    elif args.source == 'gutenberg':
        scraper = GutenbergScraper(rate_limit=args.rate_limit, output_dir=args.output)

        if args.book_id:
            books = []
            for book_id in args.book_id.split(','):
                book_id = book_id.strip()
                book_data = scraper.scrape_book(book_id)
                if book_data:
                    books.append(book_data)

            scraper.save_to_jsonl(books, 'gutenberg_dataset.jsonl')
        else:
            print("Please provide --book-id (e.g., '1,2,3' for multiple books)")

    elif args.source == 'theoi':
        scraper = TheoiScraper(rate_limit=args.rate_limit, output_dir=args.output)

        if not scraper.check_robots_txt('https://www.theoi.com'):
            print("❌ Scraping blocked by robots.txt. Consider using Archive.org or manual download.")
            return

        if args.url:
            page_data = scraper.scrape_page(args.url)
            if page_data:
                scraper.save_to_jsonl([page_data], 'theoi_dataset.jsonl')
        else:
            print("Please provide --url with the page URL to scrape")

    elif args.source == 'archive':
        importer = ClaudeArchiveImporter(output_dir=args.output)

        if not args.file or not args.title:
            print("Please provide both --file and --title for archive import")
            return

        if args.file.endswith('.pdf'):
            data = importer.import_pdf_file(args.file, args.title)
        else:
            data = importer.import_text_file(args.file, args.title)

        if data:
            importer.save_to_jsonl([data], 'claude_archives_dataset.jsonl')


if __name__ == '__main__':
    main()
