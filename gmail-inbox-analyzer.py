#!/usr/bin/env python3
"""
Van Kush Family - Gmail Inbox Analyzer

Connects to Gmail via IMAP to:
- Search for "Van Kush Family" mentions
- Extract quotes and context
- Create timeline of events
- Export to JSONL for knowledge base

Based on ITINERARY.md Phase 2 requirements.
"""

import os
import sys
import json
import re
import email
from datetime import datetime
from email.header import decode_header
import imaplib
from typing import List, Dict
import argparse

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("⚠️  python-dotenv not installed (optional)")


class GmailAnalyzer:
    """Analyze Gmail inbox for Van Kush Family mentions"""

    def __init__(self, username, password):
        self.username = username
        self.password = password
        self.mail = None
        self.mentions = []

    def connect(self):
        """Connect to Gmail via IMAP"""
        print("📧 Connecting to Gmail IMAP...")

        try:
            self.mail = imaplib.IMAP4_SSL('imap.gmail.com')
            self.mail.login(self.username, self.password)
            print("✅ Connected successfully!")
            return True
        except imaplib.IMAP4.error as e:
            print(f"❌ Login failed: {e}")
            print("\n💡 Tips:")
            print("   1. Enable 2FA in Google Account settings")
            print("   2. Generate App Password: https://myaccount.google.com/apppasswords")
            print("   3. Use App Password instead of regular password")
            return False
        except Exception as e:
            print(f"❌ Connection failed: {e}")
            return False

    def search_mentions(self, query="Van Kush Family", mailbox="INBOX", limit=100):
        """Search for mentions in inbox"""
        print(f"🔍 Searching for '{query}' in {mailbox}...")

        try:
            self.mail.select(mailbox)

            # Search for emails containing the query
            # IMAP search is limited, so we search in subject and body
            result, data = self.mail.search(None, f'(OR SUBJECT "{query}" BODY "{query}")')

            if result != 'OK':
                print("❌ Search failed")
                return []

            email_ids = data[0].split()
            total = len(email_ids)
            print(f"📬 Found {total} emails mentioning '{query}'")

            if total == 0:
                return []

            # Limit results
            email_ids = email_ids[-limit:] if limit else email_ids
            print(f"📥 Processing {len(email_ids)} emails...")

            for i, email_id in enumerate(email_ids, 1):
                if i % 10 == 0:
                    print(f"   Progress: {i}/{len(email_ids)}")

                mention = self.extract_mention(email_id, query)
                if mention:
                    self.mentions.append(mention)

            print(f"✅ Extracted {len(self.mentions)} mentions")
            return self.mentions

        except Exception as e:
            print(f"❌ Search error: {e}")
            return []

    def extract_mention(self, email_id, query):
        """Extract mention details from email"""
        try:
            result, data = self.mail.fetch(email_id, '(RFC822)')
            if result != 'OK':
                return None

            raw_email = data[0][1]
            msg = email.message_from_bytes(raw_email)

            # Decode subject
            subject = self.decode_header_value(msg.get('Subject', ''))
            from_ = self.decode_header_value(msg.get('From', ''))
            date_str = msg.get('Date', '')

            # Parse date
            try:
                date_tuple = email.utils.parsedate_tz(date_str)
                if date_tuple:
                    timestamp = email.utils.mktime_tz(date_tuple)
                    date = datetime.fromtimestamp(timestamp)
                else:
                    date = datetime.now()
            except:
                date = datetime.now()

            # Extract body
            body = self.get_email_body(msg)

            # Extract context around query
            context = self.extract_context(body, query)

            return {
                'id': email_id.decode() if isinstance(email_id, bytes) else email_id,
                'from': from_,
                'subject': subject,
                'date': date.isoformat(),
                'context': context,
                'body_preview': body[:500] if body else '',
                'has_mention': query.lower() in (subject + body).lower()
            }

        except Exception as e:
            print(f"⚠️  Error extracting email {email_id}: {e}")
            return None

    def decode_header_value(self, value):
        """Decode email header value"""
        if not value:
            return ''

        decoded_parts = []
        for part, encoding in decode_header(value):
            if isinstance(part, bytes):
                decoded_parts.append(part.decode(encoding or 'utf-8', errors='ignore'))
            else:
                decoded_parts.append(part)

        return ''.join(decoded_parts)

    def get_email_body(self, msg):
        """Extract email body (prefer plain text)"""
        body = ''

        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                if content_type == 'text/plain':
                    try:
                        body = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                        break
                    except:
                        pass
        else:
            try:
                body = msg.get_payload(decode=True).decode('utf-8', errors='ignore')
            except:
                pass

        return body

    def extract_context(self, text, query, context_chars=300):
        """Extract context around query mention"""
        if not text:
            return ''

        # Find all occurrences
        pattern = re.compile(re.escape(query), re.IGNORECASE)
        matches = list(pattern.finditer(text))

        if not matches:
            return ''

        # Get context around first match
        match = matches[0]
        start = max(0, match.start() - context_chars)
        end = min(len(text), match.end() + context_chars)

        context = text[start:end].strip()

        # Add ellipsis if truncated
        if start > 0:
            context = '...' + context
        if end < len(text):
            context = context + '...'

        return context

    def create_timeline(self):
        """Create chronological timeline"""
        sorted_mentions = sorted(self.mentions, key=lambda x: x['date'])

        print("\n📅 Timeline of Van Kush Family Mentions:")
        print("=" * 60)

        for mention in sorted_mentions:
            date = mention['date'][:10]  # Just the date
            from_ = mention['from'][:40]  # Truncate long emails
            subject = mention['subject'][:50]

            print(f"\n{date} | From: {from_}")
            print(f"   Subject: {subject}")
            if mention['context']:
                context_preview = mention['context'][:100].replace('\n', ' ')
                print(f"   Context: {context_preview}...")

        return sorted_mentions

    def export_to_jsonl(self, filename='datasets/van_kush_emails.jsonl'):
        """Export mentions to JSONL for knowledge base"""
        os.makedirs(os.path.dirname(filename), exist_ok=True)

        print(f"\n💾 Exporting to {filename}...")

        with open(filename, 'w', encoding='utf-8') as f:
            for mention in self.mentions:
                # Format for knowledge base
                entry = {
                    'source': 'gmail',
                    'category': 'van-kush-mentions',
                    'title': f"Email: {mention['subject']}",
                    'content': f"From: {mention['from']}\nDate: {mention['date']}\n\n{mention['context']}",
                    'metadata': {
                        'email_id': mention['id'],
                        'from': mention['from'],
                        'date': mention['date']
                    },
                    'created_at': datetime.now().isoformat()
                }
                f.write(json.dumps(entry) + '\n')

        print(f"✅ Exported {len(self.mentions)} mentions")
        print(f"\n📊 Next steps:")
        print(f"   1. Import to knowledge base: python3 curate-knowledge.py --file {filename}")
        print(f"   2. Or restart KB API to auto-load")

    def disconnect(self):
        """Disconnect from Gmail"""
        if self.mail:
            try:
                self.mail.close()
                self.mail.logout()
                print("\n👋 Disconnected from Gmail")
            except:
                pass


def main():
    parser = argparse.ArgumentParser(description='Analyze Gmail for Van Kush Family mentions')
    parser.add_argument('--query', default='Van Kush Family', help='Search query')
    parser.add_argument('--mailbox', default='INBOX', help='Mailbox to search')
    parser.add_argument('--limit', type=int, default=100, help='Max emails to process')
    parser.add_argument('--output', default='datasets/van_kush_emails.jsonl', help='Output file')
    parser.add_argument('--username', help='Gmail username (or set GMAIL_USERNAME env var)')
    parser.add_argument('--password', help='Gmail app password (or set GMAIL_APP_PASSWORD env var)')

    args = parser.parse_args()

    # Get credentials
    username = args.username or os.getenv('GMAIL_USERNAME')
    password = args.password or os.getenv('GMAIL_APP_PASSWORD')

    if not username or not password:
        print("❌ Gmail credentials required!")
        print("\n📝 Setup:")
        print("   1. Option A: Set environment variables:")
        print("      export GMAIL_USERNAME='your@gmail.com'")
        print("      export GMAIL_APP_PASSWORD='your-app-password'")
        print("\n   2. Option B: Pass as arguments:")
        print("      --username your@gmail.com --password your-app-password")
        print("\n🔐 Security: Use App Password, not regular password!")
        print("   Generate at: https://myaccount.google.com/apppasswords")
        sys.exit(1)

    # Run analysis
    analyzer = GmailAnalyzer(username, password)

    if not analyzer.connect():
        sys.exit(1)

    try:
        mentions = analyzer.search_mentions(
            query=args.query,
            mailbox=args.mailbox,
            limit=args.limit
        )

        if mentions:
            analyzer.create_timeline()
            analyzer.export_to_jsonl(args.output)
        else:
            print(f"\n❌ No mentions of '{args.query}' found")

    finally:
        analyzer.disconnect()


if __name__ == '__main__':
    main()
