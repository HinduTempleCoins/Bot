#!/usr/bin/env python3
"""
Wiki Populator - Library of Ashurbanipal

Reads JSON knowledge base files and uses AI to synthesize wiki articles.
Uses Pywikibot to publish to MediaWiki.

Usage:
    python populate_wiki.py                    # Populate all articles
    python populate_wiki.py --dry-run          # Preview without publishing
    python populate_wiki.py --limit=5          # Only process 5 articles
    python populate_wiki.py --domain=oilahuasca # Only process one domain
"""

import os
import sys
import json
import argparse
import requests
from pathlib import Path
from typing import Dict, List, Optional

# Add families directory to path
sys.path.insert(0, str(Path(__file__).parent / 'families'))

import pywikibot
from pywikibot import pagegenerators

# Configuration
KNOWLEDGE_BASE = Path('/home/user/Bot/knowledge')
OLLAMA_URL = 'http://127.0.0.1:11434/api/chat'
OLLAMA_MODEL = 'phi3:mini'

# Domain priority order (core knowledge first)
DOMAIN_PRIORITY = [
    'oilahuasca',           # ROOT - Core knowledge
    'phoenician',           # PRIMARY - Headcones, Kyphi
    'shulgin-pihkal-tihkal', # PRIMARY - Shulgin research
    'ayahuasca',            # Related
    'psychedelics',
    'herbs',
    'consciousness',
    'ancient_egypt',
    'vankush',
    'history',
    'mystery_schools',
    'spirituality',
    'soapmaking',
    'cryptocurrency',
]

# System prompt for AI synthesis
SYSTEM_PROMPT = """You are the Library of Ashurbanipal wiki bot. Your task is to convert JSON knowledge documents into well-formatted MediaWiki articles.

FORMATTING RULES:
1. Use proper MediaWiki markup:
   - == Section Header ==
   - === Subsection ===
   - '''bold''' for emphasis
   - ''italic'' for terms
   - [[Internal Link]] for wiki links
   - * for bullet lists
   - # for numbered lists

2. Article structure:
   - Start with a brief introduction (no header)
   - Use 3-5 main sections
   - Include a == See Also == section with related topics
   - Include a == References == section if sources are mentioned

3. Content guidelines:
   - Write in encyclopedic tone
   - Explain connections to Oilahuasca, Headcones, or Shulgin research where relevant
   - Be informative but concise (300-800 words)
   - Don't use tables unless the data requires it

Output ONLY the MediaWiki article content, no explanations."""


class KnowledgeBase:
    """Loads and manages the JSON knowledge base."""

    def __init__(self, base_path: Path):
        self.base_path = base_path
        self.documents: Dict[str, dict] = {}
        self.by_domain: Dict[str, List[str]] = {}

    def load_all(self):
        """Load all JSON files from the knowledge base."""
        for domain_dir in self.base_path.iterdir():
            if domain_dir.is_dir():
                domain = domain_dir.name
                self.by_domain[domain] = []

                for json_file in domain_dir.glob('*.json'):
                    try:
                        with open(json_file, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            doc_id = f"{domain}/{json_file.stem}"
                            self.documents[doc_id] = {
                                'domain': domain,
                                'filename': json_file.name,
                                'path': str(json_file),
                                'data': data
                            }
                            self.by_domain[domain].append(doc_id)
                    except json.JSONDecodeError as e:
                        print(f"  [WARN] Failed to load {json_file}: {e}")

        print(f"Loaded {len(self.documents)} documents from {len(self.by_domain)} domains")

    def get_domain_docs(self, domain: str) -> List[dict]:
        """Get all documents for a domain."""
        doc_ids = self.by_domain.get(domain, [])
        return [self.documents[doc_id] for doc_id in doc_ids]

    def get_doc(self, doc_id: str) -> Optional[dict]:
        """Get a specific document by ID."""
        return self.documents.get(doc_id)


class OllamaClient:
    """Client for Ollama AI synthesis."""

    def __init__(self, url: str = OLLAMA_URL, model: str = OLLAMA_MODEL):
        self.url = url
        self.model = model

    def synthesize(self, json_data: dict, title: str) -> str:
        """Convert JSON data to MediaWiki article using AI."""

        # Format the JSON nicely for the prompt
        json_str = json.dumps(json_data, indent=2, ensure_ascii=False)
        if len(json_str) > 3000:
            json_str = json_str[:3000] + "\n... (truncated)"

        user_prompt = f"""Convert this JSON document into a MediaWiki article titled "{title}":

```json
{json_str}
```

Create a well-structured wiki article from this data."""

        try:
            response = requests.post(
                self.url,
                json={
                    'model': self.model,
                    'messages': [
                        {'role': 'system', 'content': SYSTEM_PROMPT},
                        {'role': 'user', 'content': user_prompt}
                    ],
                    'stream': False,
                    'options': {
                        'temperature': 0.7,
                        'num_predict': 2048
                    }
                },
                timeout=600  # 10 minute timeout
            )
            response.raise_for_status()
            result = response.json()
            return result.get('message', {}).get('content', '')
        except requests.exceptions.RequestException as e:
            print(f"  [ERROR] Ollama request failed: {e}")
            return None


class WikiPopulator:
    """Main wiki populator using Pywikibot."""

    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self.kb = KnowledgeBase(KNOWLEDGE_BASE)
        self.ai = OllamaClient()
        self.site = None

    def connect(self):
        """Connect to the wiki."""
        if self.dry_run:
            print("[DRY RUN] Skipping wiki connection")
            return True

        try:
            self.site = pywikibot.Site('en', 'ashurbanipal')
            self.site.login()
            print(f"Connected to wiki as {self.site.username()}")
            return True
        except Exception as e:
            print(f"[ERROR] Failed to connect to wiki: {e}")
            return False

    def json_to_title(self, filename: str, domain: str) -> str:
        """Convert JSON filename to wiki article title."""
        # Remove .json extension
        title = filename.replace('.json', '')
        # Convert underscores to spaces
        title = title.replace('_', ' ')
        # Title case
        title = title.title()
        return title

    def publish_article(self, title: str, content: str, summary: str = "Bot: Article from knowledge base"):
        """Publish an article to the wiki."""
        if self.dry_run:
            print(f"  [DRY RUN] Would publish: {title}")
            print(f"  Content preview: {content[:200]}...")
            return True

        try:
            page = pywikibot.Page(self.site, title)
            page.text = content
            page.save(summary=summary, minor=False, bot=True)
            print(f"  Published: {title}")
            return True
        except Exception as e:
            print(f"  [ERROR] Failed to publish {title}: {e}")
            return False

    def process_document(self, doc: dict) -> bool:
        """Process a single document and create wiki article."""
        domain = doc['domain']
        filename = doc['filename']
        data = doc['data']

        title = self.json_to_title(filename, domain)
        print(f"  Processing: {title}")

        # Use AI to synthesize the article
        content = self.ai.synthesize(data, title)
        if not content:
            print(f"  [SKIP] AI synthesis failed")
            return False

        # Publish to wiki
        return self.publish_article(
            title,
            content,
            f"Bot: Synthesized from {domain}/{filename}"
        )

    def process_domain(self, domain: str) -> int:
        """Process all documents in a domain."""
        docs = self.kb.get_domain_docs(domain)
        if not docs:
            print(f"No documents in domain: {domain}")
            return 0

        print(f"\n=== Processing domain: {domain} ({len(docs)} documents) ===")
        success = 0
        for doc in docs:
            if self.process_document(doc):
                success += 1
        return success

    def run(self, domains: Optional[List[str]] = None, limit: Optional[int] = None):
        """Run the wiki populator."""
        print("=" * 50)
        print("  LIBRARY OF ASHURBANIPAL WIKI POPULATOR")
        print("=" * 50)
        print(f"Mode: {'DRY RUN' if self.dry_run else 'LIVE'}")
        print()

        # Load knowledge base
        print("Loading knowledge base...")
        self.kb.load_all()
        print()

        # Connect to wiki
        if not self.connect():
            return
        print()

        # Determine which domains to process
        if domains:
            process_domains = [d for d in domains if d in self.kb.by_domain]
        else:
            # Use priority order
            process_domains = [d for d in DOMAIN_PRIORITY if d in self.kb.by_domain]
            # Add any domains not in priority list
            for d in self.kb.by_domain:
                if d not in process_domains:
                    process_domains.append(d)

        # Process documents
        total_success = 0
        total_processed = 0

        for domain in process_domains:
            if limit and total_processed >= limit:
                break

            docs = self.kb.get_domain_docs(domain)
            print(f"\n=== Domain: {domain} ({len(docs)} documents) ===")

            for doc in docs:
                if limit and total_processed >= limit:
                    break

                if self.process_document(doc):
                    total_success += 1
                total_processed += 1

        print()
        print("=" * 50)
        print(f"  COMPLETE: {total_success}/{total_processed} articles published")
        print("=" * 50)


def main():
    parser = argparse.ArgumentParser(description='Populate wiki from knowledge base')
    parser.add_argument('--dry-run', action='store_true', help='Preview without publishing')
    parser.add_argument('--limit', type=int, help='Limit number of articles')
    parser.add_argument('--domain', type=str, help='Process only this domain')
    args = parser.parse_args()

    domains = [args.domain] if args.domain else None

    populator = WikiPopulator(dry_run=args.dry_run)
    populator.run(domains=domains, limit=args.limit)


if __name__ == '__main__':
    main()
