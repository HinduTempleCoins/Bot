# Claude Discussion Import - NO MORE COPY/PASTE!

## The Problem
SSH console crashes when pasting large Claude discussions.

## The Solution
Automated file-based import!

---

## Method 1: Automatic Directory Processing (RECOMMENDED)

### Step 1: Export from Claude.ai
1. Open your Claude.ai conversation
2. Click the **⋮** (three dots) at top
3. Choose **"Export" → "Download as PDF"** or copy text to `.txt` file
4. Save to your computer

### Step 2: Upload to Server
Upload exported files to the `claude_exports/` directory:

```bash
# Using SCP (from your computer)
scp ~/Downloads/claude-discussion.pdf user@your-server:/home/user/Bot/claude_exports/

# Or using Google Cloud console upload button
# (don't paste text, upload the file!)
```

### Step 3: Run Automated Import
```bash
cd /home/user/Bot
python3 claude-discussion-scraper.py --dir claude_exports
```

Done! The scraper will:
- ✅ Find all PDFs and TXT files
- ✅ Extract conversations automatically
- ✅ Parse into structured data
- ✅ Save to knowledge base (datasets/claude_discussions.jsonl)
- ✅ No pasting required!

---

## Method 2: Auto-Watch (Set and Forget)

Run the scraper in watch mode - it monitors the folder and auto-imports new files:

```bash
python3 claude-discussion-scraper.py --watch
```

Now just upload files to `claude_exports/` and they import automatically!

Press Ctrl+C when done.

---

## Method 3: Single File Import

Process one file directly:

```bash
python3 claude-discussion-scraper.py --file /path/to/discussion.pdf --title "My Claude Discussion"
```

---

## After Import

Rebuild knowledge base to include new discussions:

```bash
# Check what was imported
ls -lh datasets/claude_discussions.jsonl

# Test search
python3 knowledge-base.py --search "topic from your discussion"

# Restart KB API if running
pkill -f knowledge-base.py
python3 knowledge-base.py --serve --port 8765 &
```

---

## For Discord Bot

The bot will now be able to query your Claude discussions!

Try in Discord:
```
/cryptology [topic from your Claude discussion]
```

The bot queries the knowledge base API which now includes all your imported discussions.

---

## Tips

1. **Name files descriptively**: `vkbt-trading-strategy.pdf` is better than `conversation.pdf`

2. **Organize by topic**: Create subdirectories in `claude_exports/`:
   - `claude_exports/trading/`
   - `claude_exports/temple-history/`
   - `claude_exports/technical/`

3. **Batch import**: Upload multiple files at once, run scraper once

4. **Check import**: After import, search for a unique phrase to verify it worked

---

## Troubleshooting

**"No files found"**
- Check files are in `claude_exports/` directory
- Use: `ls -la claude_exports/`

**"Failed to extract PDF"**
- Install PyPDF2: `pip3 install PyPDF2 --break-system-packages`
- Or save as .txt instead of PDF

**"Knowledge base not updating"**
- Restart KB API: `pkill -f knowledge-base.py && python3 knowledge-base.py --serve --port 8765 &`

**"Discord bot doesn't know about my discussions"**
- Check KB API is running: `curl localhost:8765/stats`
- Search manually: `python3 knowledge-base.py --search "your topic"`
- Make sure Discord bot is using new cryptology-kb-integration.js

---

## Next Steps

1. Import all your Claude discussions
2. Update Discord bot to use KB-backed Cryptology
3. Test in Discord
4. Never copy/paste again! 🎉
