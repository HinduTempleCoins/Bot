#!/usr/bin/env python3
"""
Van Kush Family - Knowledge Base System

Centralized knowledge base that all bots can query.
Saves tokens by storing information instead of dumping into context.

Features:
- Load JSONL datasets
- Full-text search
- Category filtering
- Query API for bots
- Export subsets for fine-tuning
"""

import os
import json
import re
from datetime import datetime
from typing import List, Dict, Optional
import argparse


class KnowledgeBase:
    """Searchable knowledge base for all Van Kush Family bots"""

    def __init__(self, datasets_dir: str = "datasets"):
        self.datasets_dir = datasets_dir
        self.documents: List[Dict] = []
        self.index = {}  # Simple keyword index

    def load_jsonl(self, filename: str):
        """Load a JSONL dataset"""
        filepath = os.path.join(self.datasets_dir, filename)

        if not os.path.exists(filepath):
            print(f"⚠️  File not found: {filepath}")
            return 0

        count = 0
        with open(filepath, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    doc = json.loads(line)
                    self.documents.append(doc)
                    self._index_document(doc, len(self.documents) - 1)
                    count += 1

        print(f"✅ Loaded {count} documents from {filename}")
        return count

    def load_json(self, filename: str):
        """Load a JSON file (list or single object)"""
        filepath = os.path.join(self.datasets_dir, filename)

        if not os.path.exists(filepath):
            print(f"⚠️  File not found: {filepath}")
            return 0

        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        if isinstance(data, list):
            for doc in data:
                self.documents.append(doc)
                self._index_document(doc, len(self.documents) - 1)
            count = len(data)
        else:
            self.documents.append(data)
            self._index_document(data, len(self.documents) - 1)
            count = 1

        print(f"✅ Loaded {count} documents from {filename}")
        return count

    def load_all_datasets(self):
        """Load all available datasets"""
        if not os.path.exists(self.datasets_dir):
            print(f"⚠️  Datasets directory not found: {self.datasets_dir}")
            return

        total = 0

        for filename in os.listdir(self.datasets_dir):
            if filename.endswith('.jsonl'):
                total += self.load_jsonl(filename)
            elif filename.endswith('.json') and not filename.endswith('_stats.json'):
                total += self.load_json(filename)

        print(f"\n📚 Total documents loaded: {total}")

    def _index_document(self, doc: Dict, doc_id: int):
        """Build simple keyword index"""
        text = ""

        # Extract searchable text from document
        if 'content' in doc:
            text += doc['content'] + " "
        if 'title' in doc:
            text += doc['title'] + " "
        if 'category' in doc:
            text += doc['category'] + " "

        # Normalize and tokenize
        text = text.lower()
        words = re.findall(r'\w+', text)

        # Index keywords
        for word in words:
            if len(word) > 2:  # Skip very short words
                if word not in self.index:
                    self.index[word] = set()
                self.index[word].add(doc_id)

    def search(self, query: str, category: Optional[str] = None, limit: int = 10) -> List[Dict]:
        """Search knowledge base"""
        # Normalize query
        query = query.lower()
        query_words = re.findall(r'\w+', query)

        # Find documents matching keywords
        matching_docs = None

        for word in query_words:
            if word in self.index:
                word_docs = self.index[word]
                if matching_docs is None:
                    matching_docs = word_docs.copy()
                else:
                    matching_docs &= word_docs  # Intersection (AND logic)

        if matching_docs is None:
            return []

        # Get actual documents
        results = [self.documents[doc_id] for doc_id in matching_docs]

        # Filter by category if specified
        if category:
            results = [r for r in results if r.get('category') == category]

        # Sort by relevance (number of keyword matches)
        def relevance_score(doc):
            text = (doc.get('content', '') + ' ' + doc.get('title', '')).lower()
            return sum(1 for word in query_words if word in text)

        results.sort(key=relevance_score, reverse=True)

        return results[:limit]

    def get_by_category(self, category: str, limit: int = 100) -> List[Dict]:
        """Get all documents in a category"""
        results = [doc for doc in self.documents if doc.get('category') == category]
        return results[:limit]

    def get_categories(self) -> List[str]:
        """Get all available categories"""
        categories = set()
        for doc in self.documents:
            if 'category' in doc:
                categories.add(doc['category'])
        return sorted(list(categories))

    def get_stats(self) -> Dict:
        """Get knowledge base statistics"""
        categories = {}
        sources = {}

        for doc in self.documents:
            cat = doc.get('category', 'unknown')
            src = doc.get('source', 'unknown')

            categories[cat] = categories.get(cat, 0) + 1
            sources[src] = sources.get(src, 0) + 1

        return {
            'total_documents': len(self.documents),
            'total_keywords': len(self.index),
            'categories': categories,
            'sources': sources,
            'last_updated': datetime.now().isoformat()
        }

    def export_for_fine_tuning(self, output_file: str = 'fine_tuning_dataset.jsonl',
                                 category: Optional[str] = None):
        """Export in format suitable for AI fine-tuning"""
        docs_to_export = self.documents

        if category:
            docs_to_export = [d for d in docs_to_export if d.get('category') == category]

        filepath = os.path.join(self.datasets_dir, output_file)

        with open(filepath, 'w', encoding='utf-8') as f:
            for doc in docs_to_export:
                # Format for fine-tuning: {"prompt": "...", "completion": "..."}
                prompt = f"Question about {doc.get('category', 'general knowledge')}: {doc.get('title', 'Unknown')}"
                completion = doc.get('content', '')[:2000]  # Limit length

                training_example = {
                    'prompt': prompt,
                    'completion': completion
                }

                f.write(json.dumps(training_example) + '\n')

        print(f"✅ Exported {len(docs_to_export)} documents to {filepath}")

    def query_for_bot(self, query: str, context_limit: int = 2000) -> str:
        """Query knowledge base and return formatted response for bots"""
        results = self.search(query, limit=3)

        if not results:
            return f"No information found for: {query}"

        response = f"Found {len(results)} relevant documents:\n\n"

        for i, doc in enumerate(results, 1):
            title = doc.get('title', 'Unknown')
            content = doc.get('content', '')[:500]  # First 500 chars
            source = doc.get('source', 'unknown')

            response += f"{i}. {title} (from {source})\n"
            response += f"   {content}...\n\n"

            if len(response) > context_limit:
                break

        return response


class KnowledgeBaseAPI:
    """Simple HTTP API for knowledge base (for Discord bot integration)"""

    def __init__(self, kb: KnowledgeBase, port: int = 8765):
        self.kb = kb
        self.port = port

    def start_server(self):
        """Start HTTP server for bot queries"""
        try:
            from flask import Flask, request, jsonify
        except ImportError:
            print("Installing Flask...")
            os.system("pip3 install -q flask")
            from flask import Flask, request, jsonify

        app = Flask(__name__)

        @app.route('/search', methods=['GET'])
        def search():
            query = request.args.get('q', '')
            category = request.args.get('category')
            limit = int(request.args.get('limit', 10))

            results = self.kb.search(query, category=category, limit=limit)
            return jsonify({
                'query': query,
                'results': results,
                'count': len(results)
            })

        @app.route('/query', methods=['GET'])
        def query():
            """Bot-friendly query endpoint"""
            q = request.args.get('q', '')
            response = self.kb.query_for_bot(q)
            return jsonify({'response': response})

        @app.route('/categories', methods=['GET'])
        def categories():
            cats = self.kb.get_categories()
            return jsonify({'categories': cats})

        @app.route('/stats', methods=['GET'])
        def stats():
            return jsonify(self.kb.get_stats())

        print(f"\n🌐 Knowledge Base API starting on http://localhost:{self.port}")
        print(f"   Search: http://localhost:{self.port}/search?q=VKBT")
        print(f"   Query: http://localhost:{self.port}/query?q=what+is+VKBT")
        print(f"   Stats: http://localhost:{self.port}/stats")

        app.run(host='0.0.0.0', port=self.port)


def main():
    parser = argparse.ArgumentParser(description='Van Kush Family Knowledge Base')
    parser.add_argument('--datasets-dir', default='datasets', help='Datasets directory')
    parser.add_argument('--search', help='Search query')
    parser.add_argument('--category', help='Filter by category')
    parser.add_argument('--stats', action='store_true', help='Show statistics')
    parser.add_argument('--categories', action='store_true', help='List categories')
    parser.add_argument('--export', help='Export for fine-tuning (specify output file)')
    parser.add_argument('--serve', action='store_true', help='Start HTTP API server')
    parser.add_argument('--port', type=int, default=8765, help='API server port')

    args = parser.parse_args()

    kb = KnowledgeBase(datasets_dir=args.datasets_dir)

    print("📚 Loading knowledge base...")
    kb.load_all_datasets()

    if args.stats:
        print("\n📊 Knowledge Base Statistics:")
        stats = kb.get_stats()
        print(json.dumps(stats, indent=2))

    elif args.categories:
        print("\n📂 Categories:")
        for cat in kb.get_categories():
            count = len(kb.get_by_category(cat))
            print(f"  - {cat}: {count} documents")

    elif args.search:
        print(f"\n🔍 Searching for: {args.search}")
        results = kb.search(args.search, category=args.category, limit=10)

        for i, doc in enumerate(results, 1):
            print(f"\n{i}. {doc.get('title', 'Unknown')}")
            print(f"   Source: {doc.get('source', 'unknown')}")
            print(f"   Category: {doc.get('category', 'unknown')}")
            print(f"   Content preview: {doc.get('content', '')[:200]}...")

    elif args.export:
        kb.export_for_fine_tuning(args.export, category=args.category)

    elif args.serve:
        api = KnowledgeBaseAPI(kb, port=args.port)
        api.start_server()

    else:
        print("\n✅ Knowledge base loaded successfully!")
        print("   Use --search to search, --stats for statistics, --serve to start API")


if __name__ == '__main__':
    main()
