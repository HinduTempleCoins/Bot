# Van Kush Bot - Security Guidelines

**⚠️ CRITICAL: NEVER commit private keys or sensitive credentials to GitHub!**

---

## 🔐 What Should NEVER Be Shared

### Blockchain Keys (HIGHEST RISK)
- **HIVE_ACTIVE_KEY** - Can transfer funds, execute trades
- **HIVE_POSTING_KEY** - Can post content, vote
- **HIVE_OWNER_KEY** - Full account control (NEVER use in bots)
- **BLURT keys** - Same risk as HIVE
- **STEEM keys** - Same risk as HIVE

### API Keys & Tokens
- **DISCORD_TOKEN** - Full bot control
- **GOOGLE_API_KEY** - Gemini AI access
- **Discord webhook URLs** - Can spam your channels

### Consequences of Exposure
- **Blockchain keys**: Stolen funds, account takeover, irreversible transactions
- **API keys**: Unauthorized usage, banned accounts, data breaches
- **Webhook URLs**: Channel spam, reputation damage

---

## ✅ Proper Key Management

### 1. Environment Variables (.env)
All sensitive values go in `.env` file:

```env
# ✅ CORRECT - In .env file (ignored by git)
HIVE_ACTIVE_KEY=5JxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxK
DISCORD_TOKEN=MTxxxxxxxxxxxxxxxxxxxx.yyyyyy.zzzzzzzzzzzzzzzzzzzz
GOOGLE_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 2. Example Template (.env.example)
Public repository includes template with placeholders:

```env
# ✅ CORRECT - In .env.example (safe to commit)
HIVE_ACTIVE_KEY=your_hive_active_key
DISCORD_TOKEN=your_discord_bot_token
GOOGLE_API_KEY=your_gemini_api_key
```

### 3. .gitignore Protection
Verify `.env` is excluded:

```bash
# Check .gitignore includes:
.env
*.env
!.env.example
```

### 4. Before Every Commit
**Always check what you're committing:**

```bash
git diff  # Review changes
git status  # Verify no .env files staged
git log -1 --stat  # Check last commit
```

---

## 🚨 Emergency Response: Key Exposed

### If You Accidentally Commit Keys:

**1. Immediate Action (DO THIS FIRST)**
```bash
# Change ALL compromised keys IMMEDIATELY
# For HIVE: Use Hive Keychain or hive.blog to generate new keys
# For Discord: Reset bot token in Discord Developer Portal
# For Gemini: Revoke and create new API key
```

**2. Git History Cleanup** (Do this even if you force-pushed)
```bash
# WARNING: This rewrites git history - coordinate with team
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env" \
  --prune-empty --tag-name-filter cat -- --all

# Force push (ONLY after changing keys)
git push origin --force --all
```

**3. Verify Cleanup**
```bash
# Search entire git history for leaked keys
git log --all --full-history --source -- .env
```

**4. Post-Incident**
- Monitor accounts for unauthorized activity
- Check blockchain transaction history
- Review API usage logs
- Update documentation

---

## 🛡️ Best Practices

### Development
- ✅ Use `.env` for all secrets
- ✅ Use `.env.example` with placeholders
- ✅ Test with fake/placeholder credentials first
- ✅ Use dry run modes before live trading
- ✅ Never log sensitive values (`console.log(key)` ❌)

### Key Generation
- ✅ Generate keys on secure, offline device when possible
- ✅ Use HIVE Keychain or official wallet tools
- ✅ Store backups in encrypted password manager (1Password, Bitwarden)
- ❌ Never email/message keys in plaintext
- ❌ Never screenshot keys
- ❌ Never share Owner Keys with bots

### Permission Levels
Use least-privilege principle:

| Key Type | Use For | Risk Level |
|----------|---------|------------|
| **Owner Key** | Account recovery ONLY | 🔴 CRITICAL - Never use in bots |
| **Active Key** | Transfers, trading | 🟠 HIGH - Use for trading bots only |
| **Posting Key** | Content, voting | 🟡 MEDIUM - Use for content bots |
| **Memo Key** | Encrypted messages | 🟢 LOW - Rarely needed |

### Trading Bot Specific
- ✅ Start with **small test amounts**
- ✅ Enable **dry run mode** initially (`DRY_RUN=true`)
- ✅ Set **max position limits** to prevent over-trading
- ✅ Use **stop-loss limits** to prevent catastrophic losses
- ✅ Monitor transactions via blockchain explorers
- ✅ Keep separate trading account from main holdings

---

## 📋 Security Checklist

Before deploying any bot:

- [ ] All keys stored in `.env` file
- [ ] `.env` in `.gitignore`
- [ ] `.env.example` uses placeholders only
- [ ] Tested with fake credentials first
- [ ] Dry run mode works correctly
- [ ] Stop-loss and position limits configured
- [ ] Discord webhooks tested
- [ ] API rate limits understood
- [ ] Emergency stop procedure documented
- [ ] Team members know NOT to commit keys

---

## 🔍 Code Review Guidelines

When reviewing pull requests:

1. **Search for sensitive patterns:**
   ```bash
   # Search for potential keys
   git diff | grep -i "key\|token\|secret\|password"

   # Search for HIVE keys (start with 5)
   git diff | grep "5[HJK][1-9A-HJ-NP-Za-km-z]\{49\}"

   # Search for Discord tokens
   git diff | grep "MTxxxxxxxxxxxxxxxxxx"
   ```

2. **Verify no hardcoded credentials:**
   - Check for `=` followed by long alphanumeric strings
   - Look for base64-encoded values
   - Verify environment variables are used

3. **Reject PRs immediately if:**
   - Any `.env` file (except `.env.example`)
   - Any hardcoded keys or tokens
   - Any files with `secret` or `private` in name

---

## 📚 Additional Resources

### HIVE Security
- **Hive Keychain**: Browser extension for secure key management
- **HiveAuth**: Secure authentication without exposing keys
- **HIVE.blog**: Web wallet with key management

### General Security
- **1Password** / **Bitwarden**: Password managers for key storage
- **git-secrets**: Tool to prevent committing secrets
- **truffleHog**: Scans git repos for secrets
- **GitHub Secret Scanning**: Automatic detection (enable in repo settings)

---

## 👥 Team Communication

If you discover a security issue:

1. **DO NOT** discuss in public channels
2. **DO** notify team leads immediately via secure channel
3. **DO** follow incident response procedures
4. **DO** document lessons learned (after resolution)

---

## 📝 Version History

- **v1.0** (2026-01-09): Initial security guidelines
  - Key management best practices
  - Emergency response procedures
  - Code review guidelines
  - Team communication protocols

---

**Remember: Security is everyone's responsibility. When in doubt, ask before committing!**

**The Van Kush Family's funds and reputation depend on proper security practices.**
