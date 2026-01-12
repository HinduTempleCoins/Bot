#!/usr/bin/env python3
"""
Van Kush Family - Knowledge Curation Tool

Helps review and curate knowledge before importing into knowledge base.
Extracts key facts, sanitizes sensitive info, and organizes by category.

Use Cases:
1. Claude Code conversations → Context for future Claude Code sessions
2. Regular Claude Chat → Knowledge for Discord bot to answer questions
"""

import os
import json
import re
from datetime import datetime
from typing import List, Dict, Optional

class KnowledgeCurator:
    """Curate and sanitize knowledge before importing"""

    def __init__(self, output_dir: str = "datasets"):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)

    def sanitize_text(self, text: str) -> str:
        """Remove sensitive information from text"""

        # Remove HIVE private keys (5J...)
        text = re.sub(r'5J[A-Za-z0-9]{50}', '5J***REDACTED***', text)

        # Remove key assignments
        text = re.sub(r'HIVE_ACTIVE_KEY\s*=\s*[^\s\n]+', 'HIVE_ACTIVE_KEY=***REDACTED***', text)
        text = re.sub(r'HIVE_POSTING_KEY\s*=\s*[^\s\n]+', 'HIVE_POSTING_KEY=***REDACTED***', text)

        # Remove email addresses (optional - uncomment if needed)
        # text = re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '***EMAIL***', text)

        # Remove potential API keys
        text = re.sub(r'api[_-]?key\s*[:=]\s*[\'"]?[A-Za-z0-9_-]{20,}[\'"]?',
                     'api_key=***REDACTED***', text, flags=re.IGNORECASE)

        return text

    def extract_facts(self, text: str, topic: str = "general") -> List[Dict]:
        """Extract key facts from conversation"""

        facts = []

        # Split into sections (rough heuristic)
        sections = text.split('\n\n')

        for section in sections:
            section = section.strip()

            # Skip very short sections
            if len(section) < 100:
                continue

            # Check if section contains important keywords
            if any(keyword in section.lower() for keyword in [
                'vkbt', 'cure', 'trading', 'strategy', 'token',
                'hive', 'blurt', 'capital', 'bot', 'discord'
            ]):
                # Extract as a fact
                # Try to find a title (first line or sentence)
                lines = section.split('\n')
                title = lines[0][:100] if lines else "Untitled"

                fact = {
                    'title': title,
                    'content': section,
                    'topic': topic,
                    'extracted_at': datetime.now().isoformat()
                }

                facts.append(fact)

        return facts

    def categorize_content(self, text: str) -> str:
        """Auto-detect category based on content"""

        text_lower = text.lower()

        if 'vkbt' in text_lower and 'cure' in text_lower:
            return 'token-strategy'
        elif 'discord' in text_lower and 'bot' in text_lower:
            return 'discord-bot'
        elif 'trading' in text_lower or 'capital' in text_lower:
            return 'trading-bot'
        elif 'knowledge base' in text_lower or 'scraping' in text_lower:
            return 'knowledge-base'
        elif 'hive' in text_lower and 'smt' in text_lower:
            return 'hive-ecosystem'
        elif 'timeline' in text_lower or 'january' in text_lower:
            return 'project-planning'
        else:
            return 'general'

    def curate_conversation(self, filepath: str, title: str,
                          category: Optional[str] = None,
                          for_discord: bool = False) -> Dict:
        """Curate a conversation for import"""

        print(f"📖 Curating: {title}")

        # Read file
        with open(filepath, 'r', encoding='utf-8') as f:
            text = f.read()

        # Sanitize
        print("  🔒 Sanitizing sensitive information...")
        sanitized = self.sanitize_text(text)

        # Auto-categorize if not specified
        if not category:
            category = self.categorize_content(sanitized)

        print(f"  📂 Category: {category}")

        # Create curated document
        curated = {
            'source': 'claude-code' if not for_discord else 'claude-chat',
            'filepath': filepath,
            'title': title,
            'content': sanitized,
            'category': category,
            'curated_at': datetime.now().isoformat(),
            'for_discord_bot': for_discord
        }

        print(f"  ✅ Curated {len(sanitized)} characters")

        return curated

    def save_curated(self, documents: List[Dict], filename: str = 'curated_knowledge.jsonl'):
        """Save curated documents"""

        filepath = os.path.join(self.output_dir, filename)

        with open(filepath, 'w', encoding='utf-8') as f:
            for doc in documents:
                f.write(json.dumps(doc, ensure_ascii=False) + '\n')

        print(f"\n✅ Saved {len(documents)} curated documents to {filepath}")

    def preview_curated(self, doc: Dict):
        """Preview a curated document"""

        print("\n" + "="*60)
        print(f"Title: {doc['title']}")
        print(f"Category: {doc['category']}")
        print(f"Source: {doc['source']}")
        print(f"For Discord: {doc.get('for_discord_bot', False)}")
        print("-"*60)
        print(doc['content'][:500] + "...")
        print("="*60)


def main():
    import argparse

    parser = argparse.ArgumentParser(description='Curate knowledge for import')
    parser.add_argument('--file', required=True, help='File to curate')
    parser.add_argument('--title', required=True, help='Title for this knowledge')
    parser.add_argument('--category', help='Category (auto-detected if not specified)')
    parser.add_argument('--for-discord', action='store_true',
                       help='This is for Discord bot (not Claude Code context)')
    parser.add_argument('--preview', action='store_true',
                       help='Preview before saving')
    parser.add_argument('--output', default='datasets', help='Output directory')

    args = parser.parse_args()

    curator = KnowledgeCurator(output_dir=args.output)

    # Curate the conversation
    curated = curator.curate_conversation(
        filepath=args.file,
        title=args.title,
        category=args.category,
        for_discord=args.for_discord
    )

    # Preview if requested
    if args.preview:
        curator.preview_curated(curated)
        response = input("\nSave this? (y/n): ")
        if response.lower() != 'y':
            print("Cancelled")
            return

    # Determine filename based on purpose
    if args.for_discord:
        filename = 'discord_bot_knowledge.jsonl'
    else:
        filename = 'claude_code_context.jsonl'

    # Save
    curator.save_curated([curated], filename=filename)

    print(f"\n📊 Next steps:")
    if args.for_discord:
        print("  - Discord bot can now query this knowledge")
        print("  - Test: python3 knowledge-base.py --search 'topic'")
    else:
        print("  - Future Claude Code sessions will have this context")
        print("  - Saves tokens by not re-explaining everything")


if __name__ == '__main__':
    main()
