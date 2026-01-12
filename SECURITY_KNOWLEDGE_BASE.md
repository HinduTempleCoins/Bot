# Knowledge Base Security Guide

**IMPORTANT: Protecting your API keys and private information**

---

## 🔒 What's Safe vs What's NOT

### ✅ SAFE (already protected):

1. **.env file**: Contains your actual HIVE keys
   - **Protected by**: `.gitignore`
   - **Never pushed** to GitHub
   - **Never imported** into knowledge base

2. **datasets/ folder**: Your imported conversations
   - **Protected by**: `.gitignore` (as of this update)
   - **Stays LOCAL** on your machine and Google VM
   - **Never pushed** to GitHub

3. **Knowledge base API**: When you run `--serve`
   - **Only accessible** on localhost (127.0.0.1)
   - **Not exposed** to internet (unless you configure port forwarding)
   - **No authentication** needed for local queries

### ⚠️ POTENTIALLY UNSAFE:

1. **Imported Claude conversations**: Might contain keys in TEXT
   - Example: "Here's the HIVE_ACTIVE_KEY: 5Jxxx..."
   - **Solution**: Sanitize before importing (see below)

2. **Knowledge base API on public server**: If exposed
   - **Never run** the API server with `--host 0.0.0.0` on public internet
   - **Always use** localhost only: `--host 127.0.0.1` (default)

3. **Git commits**: If you accidentally commit datasets/
   - **Protected by**: `.gitignore` now includes `datasets/`
   - **Check before pushing**: `git status` should NOT show `datasets/`

---

## 🛡️ Security Best Practices

### 1. Before Importing Conversations

**ALWAYS sanitize conversations that mention keys:**

```bash
# Create sanitized version
cat conversation.txt | \
  sed 's/5J[A-Za-z0-9]\{50\}/5J***REDACTED***/g' | \
  sed 's/HIVE_ACTIVE_KEY=.*/HIVE_ACTIVE_KEY=***REDACTED***/g' | \
  sed 's/HIVE_POSTING_KEY=.*/HIVE_POSTING_KEY=***REDACTED***/g' \
  > conversation-sanitized.txt

# Import the sanitized version
python3 web-scraper.py --source archive \
  --file "conversation-sanitized.txt" \
  --title "Safe Import"
```

### 2. Check What Gets Imported

```bash
# Before importing, search for potential keys
grep -E "5J[A-Za-z0-9]{50}" conversation.txt
grep -i "ACTIVE_KEY" conversation.txt
grep -i "POSTING_KEY" conversation.txt

# If any found, sanitize first!
```

### 3. Verify .gitignore Works

```bash
# Check git status
git status

# Should NOT see:
# - .env
# - datasets/
# - *.jsonl files

# If you see them, they're NOT protected!
```

### 4. API Server Security

```bash
# ✅ SAFE (localhost only)
python3 knowledge-base.py --serve --port 8765
# Accessible only from: http://localhost:8765

# ❌ DANGEROUS (exposes to internet)
python3 knowledge-base.py --serve --port 8765 --host 0.0.0.0
# DON'T DO THIS unless you add authentication!
```

---

## 🔍 What Data Contains What

### .env file (NEVER share):
```env
HIVE_USERNAME=angelicalist
HIVE_ACTIVE_KEY=5Jiry4HonWcA9JGDraVX7FzUeqrMFT3kpgoZiW29G1v5qSSgtX2  # PRIVATE!
HIVE_POSTING_KEY=5JvcfuzD48YQadVVA45v3MUk4DCZXkQXr2o4Z9dTPEa7RGhtrK6  # PRIVATE!
```

### datasets/vkbt_cure_knowledge.jsonl (safe to share):
```json
{"title": "What is VKBT", "content": "VKBT is a token on HIVE-Engine..."}
```
✅ **Safe**: Contains only public information, no keys

### datasets/claude_archives_dataset.jsonl (check before sharing):
```json
{"title": "Trading Discussion", "content": "We discussed HIVE_ACTIVE_KEY=5Jxxx..."}
```
⚠️ **Potentially unsafe**: Might contain keys mentioned in conversations

---

## 🚨 What If You Accidentally Pushed Keys?

### If you pushed datasets/ with keys:

1. **Remove from git history**:
   ```bash
   # Remove datasets/ from all commits
   git filter-branch --force --index-filter \
     "git rm -rf --cached --ignore-unmatch datasets/" \
     --prune-empty --tag-name-filter cat -- --all

   # Force push (DANGEROUS - only if you control the repo)
   git push origin --force --all
   ```

2. **Rotate your keys immediately**:
   - Generate new HIVE active/posting keys
   - Update .env with new keys
   - Never use the exposed keys again

3. **Check GitHub for exposed secrets**:
   - GitHub will scan and alert you if keys detected
   - Follow their remediation steps

---

## ✅ Recommended Workflow

### Safe Import Process:

```bash
# 1. Copy your Claude conversation
# (from Claude.ai interface)

# 2. Create file and paste
cat > raw-conversation.txt
# Paste here
# Ctrl+D

# 3. Check for sensitive data
grep -E "5J[A-Za-z0-9]{50}" raw-conversation.txt

# 4a. If no keys found:
python3 web-scraper.py --source archive \
  --file "raw-conversation.txt" \
  --title "My Discussion"

# 4b. If keys found, sanitize first:
cat raw-conversation.txt | \
  sed 's/5J[A-Za-z0-9]\{50\}/5J***REDACTED***/g' \
  > safe-conversation.txt

python3 web-scraper.py --source archive \
  --file "safe-conversation.txt" \
  --title "My Discussion (Sanitized)"

# 5. Verify it's not in git
git status  # Should NOT show datasets/
```

---

## 🌐 Knowledge Base API Security

### Local Use (Safe):

```bash
# On your computer
python3 knowledge-base.py --serve --port 8765

# Discord bot connects
const response = await axios.get('http://localhost:8765/query?q=VKBT');
```

✅ **Safe**: Only accessible from same machine

### Google VM Use (Needs Firewall):

```bash
# On Google VM
python3 knowledge-base.py --serve --port 8765

# Add firewall rule to block external access
sudo ufw deny 8765/tcp

# Or only allow from specific IP (your home IP)
sudo ufw allow from YOUR_HOME_IP to any port 8765
```

### Public API (Advanced - Needs Authentication):

**DON'T expose without authentication!**

If you want public API:
1. Add API key authentication
2. Use HTTPS (not HTTP)
3. Rate limiting
4. Input validation

```python
# Example: Add authentication to knowledge-base.py
@app.before_request
def check_api_key():
    api_key = request.headers.get('X-API-Key')
    if api_key != os.getenv('KNOWLEDGE_BASE_API_KEY'):
        return jsonify({'error': 'Unauthorized'}), 401
```

---

## 📊 Current Security Status

### ✅ Protected Files:
- `.env` (never committed, in .gitignore)
- `datasets/` (now in .gitignore)
- `*.jsonl` (now in .gitignore)

### ✅ Safe to Commit:
- All Python scripts (web-scraper.py, etc.)
- Documentation (*.md files)
- Configuration (scraping-targets.json)
- Bot code (*.cjs files)

### ⚠️ Check Before Committing:
- Any new files you create
- Run `git status` and verify no sensitive files listed

---

## 🎯 Quick Security Checklist

Before each git push:

- [ ] `git status` shows no `.env` file
- [ ] `git status` shows no `datasets/` folder
- [ ] `git status` shows no `*.jsonl` files
- [ ] Knowledge base API only runs on localhost
- [ ] No keys hardcoded in committed files
- [ ] Imported conversations are sanitized

---

## 🆘 Emergency: Key Exposure

**If you think you exposed a key:**

1. **Stop immediately** - don't push more
2. **Generate new HIVE keys** at wallet.hive.blog
3. **Update .env** with new keys
4. **Remove from git history** (see above)
5. **Check account** for unauthorized transactions

**Prevention is better than cure - sanitize first!**

---

## 📝 Summary

**What the import command does:**

```bash
python3 web-scraper.py --source archive \
  --file "conversation.txt" \
  --title "My Chat"
```

1. ✅ Reads text from local file
2. ✅ Saves to `datasets/claude_archives_dataset.jsonl` (LOCAL only)
3. ✅ NOT pushed to GitHub (protected by .gitignore)
4. ✅ Only accessible via local API or direct file read
5. ⚠️ **But** might contain keys if they were in the conversation text

**Safe to share:**
- vkbt_cure_knowledge.jsonl (curated info, no keys)
- crypto news (public data)
- mythology texts (public domain)

**Never share:**
- .env (actual keys)
- Raw Claude conversations (might mention keys)
- API on public internet (no auth)

**You're safe if:**
- You sanitize conversations before importing
- You keep datasets/ folder local (not pushed)
- You run API server on localhost only

---

**Security is a process, not a one-time thing. Stay vigilant!** 🔒
