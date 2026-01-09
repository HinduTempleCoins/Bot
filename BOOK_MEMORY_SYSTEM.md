# Van Kush AI - Book Memory System (RAG)
## Making AI Remember Entire Books

**Problem**: AI can only "see" ~150,000 words at once. Your 607-page book won't fit.

**Solution**: Retrieval-Augmented Generation (RAG) - AI's "long-term memory"

---

## How It Works (Simple Explanation)

Think of it like a library:

1. **Chunking**: Break book into small pieces (500-1000 words each)
2. **Embedding**: Convert each piece into a "fingerprint" (vector)
3. **Storage**: Save all fingerprints in a database (vector DB)
4. **Search**: When you ask a question, find relevant pieces
5. **Answer**: AI reads ONLY relevant pieces, not whole book

**Result**: AI can effectively "remember" unlimited text!

---

## Example Flow

**Your Question**: "What does the book say about Denisovan maritime networks?"

**What Happens**:
1. Your question gets converted to a fingerprint
2. System searches vector DB for similar fingerprints
3. Finds 3-5 most relevant chunks from the book
4. Feeds those chunks to AI (fits in context window!)
5. AI answers using those specific sections

**You get**: Accurate answer citing specific pages!

---

## Technical Architecture

### Components Needed:

1. **Vector Database**
   - **ChromaDB** (free, runs locally) ⭐ RECOMMENDED
   - Pinecone (free tier: 1 index, 1M vectors)
   - Weaviate (self-hosted free)
   - Qdrant (self-hosted free)

2. **Embedding Model**
   - **Gemini Embedding API** (free, 1,500/day) ⭐ RECOMMENDED
   - OpenAI ada-002 (paid, $0.0001 per 1K tokens)
   - sentence-transformers (free, local)

3. **Chunking Strategy**
   - Smart splitting (by paragraph/section)
   - 500-1000 words per chunk
   - Overlap between chunks (100 words)
   - Preserve context

4. **Retrieval System**
   - Semantic search (finds meaning, not just keywords)
   - Returns top 3-5 most relevant chunks
   - Includes source citations (page numbers)

---

## Implementation Options

### Option 1: Claude Code + ChromaDB (Easiest)
**What Claude Code Will Build**:

```python
# book_memory.py
import chromadb
from google import generativeai as genai

class BookMemory:
    def __init__(self, book_title):
        self.client = chromadb.Client()
        self.collection = self.client.create_collection(book_title)
        self.gemini = genai.Client(api_key=GEMINI_KEY)

    def ingest_book(self, book_path):
        """Read entire book, chunk it, embed it, store it"""
        with open(book_path) as f:
            full_text = f.read()

        # Smart chunking (by paragraph, ~500 words)
        chunks = self._smart_chunk(full_text)

        # Embed each chunk with Gemini
        for i, chunk in enumerate(chunks):
            embedding = self.gemini.embed(chunk)
            self.collection.add(
                embeddings=[embedding],
                documents=[chunk],
                ids=[f"chunk_{i}"],
                metadatas=[{"page": self._estimate_page(i)}]
            )

        print(f"✅ Ingested {len(chunks)} chunks from book")

    def ask(self, question):
        """Ask AI about the book"""
        # Find relevant chunks
        q_embedding = self.gemini.embed(question)
        results = self.collection.query(
            query_embeddings=[q_embedding],
            n_results=5
        )

        # Build context from relevant chunks
        context = "\n\n".join(results['documents'][0])

        # Ask Gemini with context
        prompt = f"""Based on this book excerpt:

{context}

Answer this question: {question}

Cite specific passages in your answer."""

        response = self.gemini.generate_content(prompt)
        return response.text

# Usage:
book = BookMemory("Van_Kush_Family_Book")
book.ingest_book("my_607_page_book.txt")
answer = book.ask("What does it say about Denisovan DNA?")
```

**What You Can Ask**:
- "Summarize chapter 5"
- "Find all mentions of Phoenicians"
- "What's the connection between X and Y?"
- "Quote the section about maritime trade"

**Claude Code Prompt**:
```
"Claude Code, build a RAG system using ChromaDB that:
1. Ingests my 607-page book
2. Chunks it intelligently
3. Uses Gemini Embedding API (free)
4. Stores in local ChromaDB
5. Lets me ask questions about the entire book
6. Cites specific page numbers in answers"
```

---

### Option 2: Discord Bot Integration
**Add to Van Kush Bot**:

```javascript
// Add to index.js

const { ChromaClient } = require('chromadb');
const chroma = new ChromaClient();

// Create collection for each book
const vkBook = await chroma.createCollection({name: "van_kush_book"});
const gutenberg1 = await chroma.createCollection({name: "gutenberg_36197"});
const gutenberg2 = await chroma.createCollection({name: "gutenberg_16044"});

// New command: /ask-book
if (command === 'ask-book') {
  const bookName = args[1];  // 'vk' or 'gutenberg1', etc.
  const question = args.slice(2).join(' ');

  const collection = chroma.getCollection({name: bookName});

  // Embed question
  const qEmbedding = await embedWithGemini(question);

  // Find relevant chunks
  const results = await collection.query({
    queryEmbeddings: [qEmbedding],
    nResults: 5
  });

  // Ask Gemini with context
  const context = results.documents.join('\n\n');
  const answer = await model.generateContent(
    `Book context:\n${context}\n\nQuestion: ${question}`
  );

  await message.reply(answer.response.text());
}
```

**Discord Usage**:
```
/ask-book vk What's the 75,000 year lineage?
/ask-book gutenberg1 Who is Tanit?
/ask-book gutenberg2 Summarize chapter 3
```

---

### Option 3: LangChain (Most Features)
**For Advanced Users**:

LangChain provides pre-built RAG components:
- Document loaders (PDF, EPUB, HTML)
- Text splitters (smart chunking)
- Vector stores (ChromaDB, Pinecone, etc.)
- Retrievers (semantic search)
- Memory (conversation history)

**Claude Code Prompt**:
```
"Claude Code, use LangChain to build a RAG system that:
1. Loads books from PDF/EPUB/HTML
2. Chunks intelligently
3. Stores in ChromaDB
4. Provides API for questions
5. Includes citation of sources"
```

---

## Handling Different Book Formats

### Plain Text (.txt)
- Easiest to process
- Just read and chunk

### PDF
```python
from pypdf import PdfReader

def extract_pdf(path):
    reader = PdfReader(path)
    text = ""
    for page in reader.pages:
        text += page.extract_text()
    return text
```

### EPUB
```python
import ebooklib
from ebooklib import epub

def extract_epub(path):
    book = epub.read_epub(path)
    text = ""
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_DOCUMENT:
            text += item.get_content().decode('utf-8')
    return text
```

### HTML (Project Gutenberg)
```python
from bs4 import BeautifulSoup
import requests

def extract_gutenberg(url):
    response = requests.get(url)
    soup = BeautifulSoup(response.text, 'html.parser')

    # Remove navigation, headers, footers
    for tag in soup(['nav', 'header', 'footer']):
        tag.decompose()

    # Get main text
    text = soup.get_text()
    return text
```

---

## Project Gutenberg Books You Shared

### Book 1: https://www.gutenberg.org/cache/epub/36197/pg36197-images.html
I can fetch this and prepare it for your system.

### Book 2: https://www.gutenberg.org/files/16044/16044-h/16044-h.htm
I can fetch this too.

**Claude Code Can**:
1. Download both books
2. Clean HTML
3. Chunk text
4. Embed with Gemini
5. Store in ChromaDB
6. Ready for questions in <10 minutes

---

## Your 607-Page Book

### Best Approach:

1. **Convert to Plain Text**
   - If in Word: Save as .txt
   - If in PDF: Use PDF extraction
   - If in Google Docs: Download as .txt

2. **Smart Chunking**
   - By chapter (if clearly marked)
   - By section/subsection
   - By paragraph (with 100-word overlap)
   - Preserve page numbers as metadata

3. **Ingest into ChromaDB**
   - ~1,200 chunks (500 words each)
   - Takes ~5 minutes with Gemini Embedding
   - Costs: $0 (free tier)

4. **Query Interface**
   - Command line: `python ask_book.py "question"`
   - Web UI: Simple Flask app
   - Discord bot: `/ask-book vk question`
   - API: For other tools

---

## Free Tier Limits

### Gemini Embedding API (FREE):
- 1,500 requests/day
- 15 RPM
- Good for: 750,000 words/day embedded

**Your 607-page book**:
- ~180,000 words
- ~360 chunks (500 words each)
- Embeds in: ~24 minutes (15 RPM)
- Cost: FREE
- Only need to do once!

**Then for questions**:
- 1 question = 1 embedding + 1 generation
- Can ask 750 questions/day (free tier)

---

## Implementation Timeline

### Day 1: Setup Infrastructure
- Install ChromaDB
- Configure Gemini Embedding API
- Test with small sample

### Day 2: Ingest First Book
- Fetch Gutenberg books
- Clean HTML
- Chunk and embed
- Store in ChromaDB
- Test queries

### Day 3: Ingest Your Book
- Convert your 607-page book to text
- Smart chunking with page numbers
- Embed and store
- Test complex queries

### Day 4: Discord Integration
- Add `/ask-book` command
- Multiple book collections
- Citation formatting
- User-friendly responses

### Day 5: Web Interface (Optional)
- Simple web UI
- Book selection dropdown
- Question input
- Pretty answers with citations

---

## Advanced Features (Future)

### Multi-Book Search
```
/ask-books vk gutenberg1 gutenberg2 "Compare perspectives on Tanit"
```

### Conversation Memory
```
/ask-book vk "Who is Ryan?"
/ask-book vk "Tell me more about his lineage"  ← Remembers context
```

### Automatic Summaries
```
/summarize-book vk chapter 5
/summarize-book gutenberg1 all
```

### Quote Extraction
```
/find-quote vk "75,000 years"  ← Returns exact passages
```

### Cross-Reference
```
/cross-ref vk gutenberg1 "Denisovan"  ← Finds mentions in both
```

---

## Cost Analysis

### Free Tier (Current Plan):
- ChromaDB: Free (local)
- Gemini Embedding: Free (1,500/day)
- Gemini Generation: Free (1,000/day)
- Storage: ~1 GB per 10 books
- **Total: $0/month**

### If Scaling Up:
- Pinecone: $0 (free: 1M vectors)
- Weaviate Cloud: $25/month (managed)
- OpenAI Embeddings: $1 per 1M tokens
- **Still very affordable**

---

## Comparison to Alternatives

### Why Not Just Use Claude Projects?
- Claude Projects: 200K context (not enough for 607 pages)
- RAG: Unlimited books!
- RAG: Faster search
- RAG: Exact citations

### Why Not Just Copy-Paste?
- Manual segmentation tedious
- Loses context between segments
- Can't search/find specific info
- RAG: Automatic and smart

### Why Not Fine-Tune?
- Fine-tuning: Changes model behavior
- RAG: Adds knowledge without training
- RAG: Instant updates (add new books anytime)
- RAG: Cheaper

---

## Next Steps

### To Add This to Itinerary:

**NEW PHASE 2.5: Book Memory System (Days 6-8)**

Before social media automation, after data extraction:

**Goals**:
1. Set up ChromaDB + Gemini Embedding
2. Ingest Project Gutenberg books
3. Ingest your 607-page book
4. Add `/ask-book` to Discord bot
5. Test with complex questions

**Deliverables**:
- Working RAG system
- 3+ books indexed
- Discord bot can answer book questions
- Python API for other uses

---

## Claude Code Prompt (Ready to Use)

```markdown
# Van Kush Book Memory System

Build a RAG (Retrieval-Augmented Generation) system that lets me ask questions about entire books:

## Requirements:
1. Use ChromaDB (local, free)
2. Use Gemini Embedding API (free tier)
3. Support multiple books in separate collections
4. Smart chunking (500 words, 100-word overlap)
5. Preserve metadata (page numbers, chapters)

## Books to Ingest:
1. https://www.gutenberg.org/cache/epub/36197/pg36197-images.html
2. https://www.gutenberg.org/files/16044/16044-h/16044-h.htm
3. My local file: my_book.txt (607 pages, ~180,000 words)

## Interface:
- Python CLI: `ask_book.py --book vk --question "..."`
- Return answers with page number citations
- Show which chunks were used

## Deliverables:
- book_memory.py (main system)
- ingest_book.py (add new books)
- ask_book.py (query interface)
- README with examples

Please implement this step-by-step.
```

---

## Want Me To Start This Now?

I can:
1. Fetch those two Gutenberg books right now
2. Analyze their structure
3. Create the initial RAG system code
4. Show you exactly how it works

Just say "fetch the books" and I'll begin!

---

**This solves your book memory problem completely.** No more manual chunking, no more lost context, AI can "read" unlimited books.
