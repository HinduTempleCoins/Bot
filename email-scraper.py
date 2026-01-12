#!/usr/bin/env python3
"""
Van Kush Family - Email Scraper & Contact Profiler

Scrapes emails from websites and builds contact profiles with metadata.
Later: Will send personalized outreach emails.

Features:
- Extract emails from web pages
- Build contact profiles with metadata
- Track email sources and context
- Export to JSON for email campaigns
"""

import os
import json
import re
import time
from datetime import datetime
from urllib.parse import urljoin, urlparse
from typing import List, Dict, Set, Optional
import argparse

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Installing required packages...")
    os.system("pip3 install -q requests beautifulsoup4")
    import requests
    from bs4 import BeautifulSoup


class EmailScraper:
    """Scrape emails from websites and build contact profiles"""

    def __init__(self, rate_limit: float = 2.0, output_dir: str = "datasets"):
        self.rate_limit = rate_limit
        self.output_dir = output_dir
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Van-Kush-Family-Bot/1.0 (Contact Research)'
        })

        self.visited_urls: Set[str] = set()
        self.found_emails: Dict[str, Dict] = {}  # email -> profile

        os.makedirs(output_dir, exist_ok=True)

    def extract_emails_from_text(self, text: str) -> Set[str]:
        """Extract email addresses from text"""
        # Regex for email addresses
        email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
        emails = set(re.findall(email_pattern, text, re.IGNORECASE))

        # Filter out common noise
        noise_domains = ['example.com', 'test.com', 'localhost', 'sentry.io']
        emails = {e for e in emails if not any(d in e.lower() for d in noise_domains)}

        return emails

    def extract_context(self, email: str, soup: BeautifulSoup) -> Dict:
        """Extract context around email (name, title, organization, etc.)"""
        context = {
            'name': None,
            'title': None,
            'organization': None,
            'topics': [],
            'social_links': []
        }

        # Find the element containing the email
        email_element = None
        for tag in soup.find_all(text=re.compile(re.escape(email))):
            if tag.parent:
                email_element = tag.parent
                break

        if not email_element:
            return context

        # Look for name nearby (often in same paragraph or preceding/following)
        nearby_text = email_element.get_text()

        # Common patterns for names
        name_patterns = [
            r'([A-Z][a-z]+ [A-Z][a-z]+)',  # John Smith
            r'Contact: ([A-Z][a-z]+ [A-Z][a-z]+)',
            r'By ([A-Z][a-z]+ [A-Z][a-z]+)',
        ]

        for pattern in name_patterns:
            match = re.search(pattern, nearby_text)
            if match:
                context['name'] = match.group(1)
                break

        # Look for organization (often in domain or nearby text)
        domain = email.split('@')[1]
        context['organization'] = self.extract_organization_from_domain(domain)

        # Extract topics from page title and headings
        page_title = soup.find('title')
        if page_title:
            context['topics'].append(page_title.get_text(strip=True))

        headings = soup.find_all(['h1', 'h2', 'h3'])
        for heading in headings[:3]:  # Top 3 headings
            context['topics'].append(heading.get_text(strip=True))

        # Look for social links
        for link in soup.find_all('a', href=True):
            href = link['href'].lower()
            if any(social in href for social in ['twitter.com', 'linkedin.com', 'github.com', 'facebook.com']):
                context['social_links'].append(link['href'])

        return context

    def extract_organization_from_domain(self, domain: str) -> str:
        """Extract organization name from domain"""
        # Remove common TLDs and subdomains
        domain = re.sub(r'\.com$|\.org$|\.net$|\.io$|\.edu$|\.gov$', '', domain)
        domain = re.sub(r'^www\.', '', domain)

        # Capitalize
        return domain.title()

    def scrape_url(self, url: str, max_depth: int = 1, current_depth: int = 0) -> List[Dict]:
        """Scrape URL and optionally follow links"""
        if url in self.visited_urls or current_depth > max_depth:
            return []

        time.sleep(self.rate_limit)

        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            self.visited_urls.add(url)
        except Exception as e:
            print(f"❌ Failed to fetch {url}: {e}")
            return []

        soup = BeautifulSoup(response.content, 'html.parser')

        # Extract emails
        page_text = soup.get_text()
        emails = self.extract_emails_from_text(page_text)

        print(f"📧 Found {len(emails)} emails on {url}")

        profiles = []

        for email in emails:
            if email not in self.found_emails:
                context = self.extract_context(email, soup)

                profile = {
                    'email': email,
                    'domain': email.split('@')[1],
                    'name': context['name'],
                    'title': context['title'],
                    'organization': context['organization'],
                    'topics': context['topics'],
                    'social_links': context['social_links'],
                    'sources': [url],
                    'first_seen': datetime.now().isoformat(),
                    'last_updated': datetime.now().isoformat()
                }

                self.found_emails[email] = profile
                profiles.append(profile)
                print(f"  ✓ {email} ({context.get('name', 'Unknown')})")
            else:
                # Update existing profile
                existing = self.found_emails[email]
                if url not in existing['sources']:
                    existing['sources'].append(url)
                existing['last_updated'] = datetime.now().isoformat()

        # Optionally follow links
        if current_depth < max_depth:
            links = soup.find_all('a', href=True)
            base_domain = urlparse(url).netloc

            for link in links[:10]:  # Limit to 10 links per page
                href = link['href']
                full_url = urljoin(url, href)

                # Only follow links on same domain
                if urlparse(full_url).netloc == base_domain:
                    profiles.extend(self.scrape_url(full_url, max_depth, current_depth + 1))

        return profiles

    def scrape_multiple_urls(self, urls: List[str], max_depth: int = 1) -> List[Dict]:
        """Scrape multiple URLs"""
        all_profiles = []

        for url in urls:
            print(f"\n🌐 Scraping {url}...")
            profiles = self.scrape_url(url, max_depth=max_depth)
            all_profiles.extend(profiles)

        return all_profiles

    def save_profiles(self, filename: str = 'email_contacts.json'):
        """Save all contact profiles to JSON"""
        filepath = os.path.join(self.output_dir, filename)

        profiles_list = list(self.found_emails.values())

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(profiles_list, f, indent=2, ensure_ascii=False)

        print(f"\n✅ Saved {len(profiles_list)} contact profiles to {filepath}")

        # Also save summary stats
        stats = {
            'total_contacts': len(profiles_list),
            'domains': list(set(p['domain'] for p in profiles_list)),
            'with_names': len([p for p in profiles_list if p['name']]),
            'with_organizations': len([p for p in profiles_list if p['organization']]),
            'scraped_at': datetime.now().isoformat()
        }

        stats_file = os.path.join(self.output_dir, 'email_scraping_stats.json')
        with open(stats_file, 'w', encoding='utf-8') as f:
            json.dump(stats, f, indent=2)

        print(f"📊 Stats: {stats['total_contacts']} contacts, {stats['with_names']} with names")


def main():
    parser = argparse.ArgumentParser(description='Van Kush Family Email Scraper & Contact Profiler')
    parser.add_argument('--urls', nargs='+', help='URLs to scrape for emails')
    parser.add_argument('--file', help='File containing URLs (one per line)')
    parser.add_argument('--max-depth', type=int, default=1, help='Max depth to follow links (0=no links, 1=one level)')
    parser.add_argument('--output', default='datasets', help='Output directory')
    parser.add_argument('--rate-limit', type=float, default=2.0, help='Seconds between requests')

    args = parser.parse_args()

    scraper = EmailScraper(rate_limit=args.rate_limit, output_dir=args.output)

    urls_to_scrape = []

    if args.urls:
        urls_to_scrape.extend(args.urls)

    if args.file:
        with open(args.file, 'r') as f:
            urls_to_scrape.extend([line.strip() for line in f if line.strip()])

    if not urls_to_scrape:
        print("Please provide URLs via --urls or --file")
        print("\nExample usage:")
        print("  python3 email-scraper.py --urls https://example.com https://another.com")
        print("  python3 email-scraper.py --file urls.txt --max-depth 2")
        return

    scraper.scrape_multiple_urls(urls_to_scrape, max_depth=args.max_depth)
    scraper.save_profiles()


if __name__ == '__main__':
    main()
