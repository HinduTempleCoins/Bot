#!/usr/bin/env python3
"""
Claude.ai Discussion Scraper - AUTOMATED

This script automatically processes Claude.ai exports without manual pasting.

Methods:
1. Process exported PDF/TXT files from a directory
2. Use Claude API to fetch conversations (if API key provided)
3. Monitor a folder for new exports and auto-import

No more copy/paste crashing!
"""

import os
import json
import sys
import time
from datetime import datetime
from pathlib import Path
import re
import argparse

try:
    import anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False

try:
    import PyPDF2
    HAS_PDF = True
except ImportError:
    HAS_PDF = False


class ClaudeDiscussionScraper:
    """Automated Claude discussion importer"""

    def __init__(self, output_dir="datasets", api_key=None):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        self.api_key = api_key

        if api_key and HAS_ANTHROPIC:
            self.client = anthropic.Anthropic(api_key=api_key)
        else:
            self.client = None

    def extract_pdf_text(self, pdf_path):
        """Extract text from Claude PDF export"""
        if not HAS_PDF:
            print("❌ PyPDF2 not installed. Install: pip3 install PyPDF2")
            return None

        try:
            with open(pdf_path, 'rb') as f:
                reader = PyPDF2.PdfReader(f)
                text = ""
                for page in reader.pages:
                    text += page.extract_text() + "\n"
            return text
        except Exception as e:
            print(f"❌ Failed to extract PDF: {e}")
            return None

    def extract_txt_file(self, txt_path):
        """Read text file"""
        try:
            with open(txt_path, 'r', encoding='utf-8') as f:
                return f.read()
        except Exception as e:
            print(f"❌ Failed to read text file: {e}")
            return None

    def parse_claude_conversation(self, text, title=None):
        """
        Parse Claude conversation text into structured data

        Handles both:
        - Claude.ai web export format
        - Claude Code/CLI format
        - Plain text conversations
        """
        # Try to extract title from content if not provided
        if not title:
            # Look for first heading or first line
            lines = text.split('\n')
            for line in lines[:10]:
                if line.strip() and not line.startswith('#'):
                    title = line.strip()[:100]
                    break
            if not title:
                title = "Claude Discussion"

        # Parse conversation turns
        turns = []

        # Try to split by common patterns
        # Pattern 1: "User:" and "Claude:" or "Assistant:"
        if re.search(r'\b(User|Human):\s', text, re.IGNORECASE):
            pattern = r'\b(?P<role>User|Human|Claude|Assistant):\s*(?P<content>.*?)(?=\b(?:User|Human|Claude|Assistant):|$)'
            matches = re.finditer(pattern, text, re.DOTALL | re.IGNORECASE)

            for match in matches:
                role = match.group('role').lower()
                content = match.group('content').strip()
                if content:
                    turns.append({
                        'role': 'user' if role in ['user', 'human'] else 'assistant',
                        'content': content
                    })

        # Pattern 2: Just store full text if no clear structure
        if not turns:
            turns.append({
                'role': 'document',
                'content': text
            })

        return {
            'title': title,
            'turns': turns,
            'total_length': len(text),
            'turn_count': len(turns)
        }

    def create_knowledge_entries(self, conversation, source_file):
        """Convert conversation to knowledge base JSONL entries"""
        entries = []

        title = conversation['title']

        # Create one entry for full conversation
        full_text = ""
        for turn in conversation['turns']:
            role = turn['role'].upper()
            full_text += f"\n{role}: {turn['content']}\n"

        entry = {
            'source': 'claude-discussion',
            'category': 'claude-discussion',
            'title': title,
            'content': full_text.strip(),
            'metadata': {
                'source_file': str(source_file),
                'turn_count': conversation['turn_count'],
                'total_length': conversation['total_length']
            },
            'created_at': datetime.now().isoformat()
        }

        entries.append(entry)

        # Also create entries for individual turns if conversation is long
        if conversation['turn_count'] > 5:
            for i, turn in enumerate(conversation['turns']):
                if len(turn['content']) > 200:  # Only substantial turns
                    turn_entry = {
                        'source': 'claude-discussion',
                        'category': 'claude-discussion',
                        'title': f"{title} - Part {i+1}",
                        'content': turn['content'],
                        'metadata': {
                            'source_file': str(source_file),
                            'turn_index': i,
                            'role': turn['role']
                        },
                        'created_at': datetime.now().isoformat()
                    }
                    entries.append(turn_entry)

        return entries

    def process_file(self, file_path, title=None):
        """Process a single Claude export file"""
        file_path = Path(file_path)

        print(f"📄 Processing: {file_path.name}")

        # Extract text based on file type
        if file_path.suffix.lower() == '.pdf':
            text = self.extract_pdf_text(file_path)
        elif file_path.suffix.lower() in ['.txt', '.md']:
            text = self.extract_txt_file(file_path)
        else:
            print(f"⚠️  Unsupported file type: {file_path.suffix}")
            return 0

        if not text:
            return 0

        # Parse conversation
        conversation = self.parse_claude_conversation(text, title)

        # Create knowledge entries
        entries = self.create_knowledge_entries(conversation, file_path)

        # Save to JSONL
        output_file = self.output_dir / 'claude_discussions.jsonl'

        with open(output_file, 'a', encoding='utf-8') as f:
            for entry in entries:
                f.write(json.dumps(entry) + '\n')

        print(f"✅ Added {len(entries)} entries from {file_path.name}")
        return len(entries)

    def process_directory(self, directory, pattern="*"):
        """Process all matching files in directory"""
        directory = Path(directory)

        if not directory.exists():
            print(f"❌ Directory not found: {directory}")
            return 0

        print(f"🔍 Scanning: {directory}")

        total_entries = 0
        files_processed = 0

        # Find all PDF and TXT files
        for ext in ['.pdf', '.txt', '.md']:
            for file_path in directory.glob(f"*{ext}"):
                if file_path.is_file():
                    entries = self.process_file(file_path)
                    total_entries += entries
                    if entries > 0:
                        files_processed += 1

        return total_entries, files_processed

    def watch_directory(self, directory, interval=5):
        """Watch directory for new files and auto-import"""
        directory = Path(directory)
        directory.mkdir(exist_ok=True)

        print(f"👁️  Watching: {directory}")
        print(f"   Drop Claude exports here and they'll auto-import!")
        print(f"   Press Ctrl+C to stop")

        processed = set()

        try:
            while True:
                for ext in ['.pdf', '.txt', '.md']:
                    for file_path in directory.glob(f"*{ext}"):
                        if file_path not in processed:
                            self.process_file(file_path)
                            processed.add(file_path)

                time.sleep(interval)
        except KeyboardInterrupt:
            print("\n✅ Stopped watching")


def main():
    parser = argparse.ArgumentParser(description='Automated Claude Discussion Importer')
    parser.add_argument('--file', help='Process single file')
    parser.add_argument('--dir', default='claude_exports', help='Process all files in directory')
    parser.add_argument('--watch', action='store_true', help='Watch directory for new files')
    parser.add_argument('--title', help='Custom title for single file')
    parser.add_argument('--output', default='datasets', help='Output directory')
    parser.add_argument('--api-key', help='Claude API key (optional, for API method)')

    args = parser.parse_args()

    scraper = ClaudeDiscussionScraper(
        output_dir=args.output,
        api_key=args.api_key or os.getenv('ANTHROPIC_API_KEY')
    )

    if args.file:
        # Process single file
        scraper.process_file(args.file, args.title)
    elif args.watch:
        # Watch directory
        scraper.watch_directory(args.dir)
    else:
        # Process directory once
        total, files = scraper.process_directory(args.dir)
        print(f"\n✅ Processed {files} files, created {total} knowledge entries")
        print(f"\n📊 Next steps:")
        print(f"   1. Rebuild knowledge base: python3 knowledge-base.py")
        print(f"   2. Test search: python3 knowledge-base.py --search 'topic'")


if __name__ == '__main__':
    main()
