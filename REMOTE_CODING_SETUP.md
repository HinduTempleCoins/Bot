# Remote Coding Setup Guide

**Goal**: Code from anywhere using Slack, Telegram, SMS, or mobile apps

**What You'll Get**:
- Code from your phone via Slack/Telegram
- Run commands on Oracle Cloud server remotely
- Get deployment notifications
- Monitor bot status on the go
- Never need to be at your computer

**Methods**:
1. **Claude Code + Slack** (official integration)
2. **SSH via Termux** (Android/iOS terminal)
3. **Telegram Bot** (custom command interface)
4. **SMS Gateway** (emergency access)
5. **Mobile SSH Apps** (full terminal access)

---

## Part 1: Claude Code + Slack Integration

**Official way to use Claude Code from Slack**

### Prerequisites

- Claude Pro or Team subscription ($20/month)
- Slack workspace (free)
- Oracle Cloud server set up

### Step 1: Create Slack Workspace (if needed)

1. Go to: https://slack.com/create
2. Sign in with Google/email
3. Create workspace: "Van Kush Dev"
4. Skip adding team members (solo workspace is fine)

### Step 2: Install Claude for Slack

1. Go to: https://www.anthropic.com/claude-in-slack
2. Click **"Add to Slack"**
3. Choose your workspace
4. Authorize Claude app

### Step 3: Invite Claude to Channel

In Slack:
```
/invite @Claude
```

### Step 4: Start Coding from Slack

**Example conversation**:

```
You: @Claude connect to my Oracle Cloud server and check if the Discord bot is running

Claude: I'll help you check the bot status. First, I need SSH access...
```

**Set up persistent SSH session**:

On your Oracle Cloud server:
```bash
# Install tmux for persistent sessions
sudo apt install tmux

# Create named session
tmux new-session -s coding

# Claude can now attach to this session remotely
```

**In Slack**:
```
@Claude SSH to my server and attach to tmux session 'coding', then check PM2 status
```

### Limitations

- Requires Claude Pro ($20/month)
- Not as seamless as desktop Claude Code
- Better for quick checks than heavy coding

---

## Part 2: SSH via Termux (Best Free Option)

**Run full terminal on your phone - best for serious mobile coding**

### For Android

#### Step 1: Install Termux

1. Download **Termux** from F-Droid (NOT Google Play - that version is outdated!)
2. F-Droid: https://f-droid.org/en/packages/com.termux/
3. Install F-Droid app first, then search "Termux"

#### Step 2: Set Up Termux

Open Termux:

```bash
# Update packages
pkg update && pkg upgrade -y

# Install OpenSSH
pkg install openssh -y

# Install essential tools
pkg install git nodejs python vim nano -y
```

#### Step 3: Copy SSH Key to Phone

**Option A: QR Code (Easiest)**

On your computer:
```bash
# Install qrencode
sudo apt install qrencode

# Generate QR code of SSH key
cat ~/.ssh/oracle_ssh_key | qrencode -t UTF8
```

**Scan with Termux**:
- In Termux, install: `pkg install zbar`
- Scan QR: `zbarcam` (phone's camera will open)

**Option B: Cloud Transfer**

1. Upload SSH key to Dropbox/Google Drive (TEMPORARILY!)
2. Download to phone
3. Move to Termux:
```bash
# In Termux
cd ~/.ssh
# Download your key file
# Then:
chmod 600 oracle_ssh_key
```

**Option C: USB Cable**

1. Connect phone to computer via USB
2. Copy `oracle_ssh_key` to phone storage
3. In Termux:
```bash
cp ~/storage/downloads/oracle_ssh_key ~/.ssh/
chmod 600 ~/.ssh/oracle_ssh_key
```

#### Step 4: Connect to Oracle Cloud

In Termux:
```bash
ssh -i ~/.ssh/oracle_ssh_key ubuntu@YOUR_ORACLE_IP
```

**You're now in your Oracle Cloud server from your phone!** 🎉

#### Step 5: Install Termux Widgets (Quick Actions)

1. Install **Termux:Widget** from F-Droid
2. Create shortcuts:

```bash
mkdir -p ~/.shortcuts
nano ~/.shortcuts/check-bot.sh
```

Paste:
```bash
#!/data/data/com.termux/files/usr/bin/bash
ssh -i ~/.ssh/oracle_ssh_key ubuntu@YOUR_ORACLE_IP 'pm2 status'
```

Save and:
```bash
chmod +x ~/.shortcuts/check-bot.sh
```

**Now add widget to home screen** → Tap to check bot status instantly!

### For iOS (iPhone/iPad)

#### Use Blink Shell (Best iOS SSH App)

1. Install **Blink Shell** from App Store ($20 one-time, or free trial)
2. Alternative: **Termius** (free tier available)

#### Set Up in Blink Shell

1. Open Blink Shell
2. Go to Settings → Keys
3. Import your SSH key:
   - Use iCloud Drive to transfer key
   - Or paste key content directly
4. Add Host:
   - Name: `Oracle`
   - Host: `YOUR_ORACLE_IP`
   - User: `ubuntu`
   - Key: Select your imported key

#### Quick Connect

In Blink Shell:
```
mosh Oracle  # Mosh is better for mobile (handles network changes)
```

Or regular SSH:
```
ssh Oracle
```

---

## Part 3: Custom Telegram Bot for Remote Commands

**Create your own Telegram bot to control your server**

### Step 1: Create Telegram Bot

1. Open Telegram
2. Search for **@BotFather**
3. Send: `/newbot`
4. Name: `Van Kush Server Manager`
5. Username: `vankush_server_bot` (must be unique)
6. **Copy the API token** (looks like `123456:ABC-DEF...`)

### Step 2: Create Telegram Control Script

On Oracle Cloud server:

```bash
nano ~/telegram-bot.py
```

**Paste this code**:
```python
#!/usr/bin/env python3
import os
import subprocess
import logging
from telegram import Update, ForceReply
from telegram.ext import Updater, CommandHandler, MessageHandler, Filters, CallbackContext

# Get token from environment
TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
ALLOWED_USER_ID = int(os.environ.get('TELEGRAM_USER_ID', '0'))

# Enable logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

def is_authorized(update: Update) -> bool:
    """Check if user is authorized"""
    return update.effective_user.id == ALLOWED_USER_ID

def start(update: Update, context: CallbackContext) -> None:
    """Start command"""
    if not is_authorized(update):
        update.message.reply_text("⛔ Unauthorized")
        return

    update.message.reply_text(
        "🤖 Van Kush Server Manager\n\n"
        "Commands:\n"
        "/status - Check bot status\n"
        "/logs - View bot logs\n"
        "/restart - Restart bot\n"
        "/deploy - Pull latest code and restart\n"
        "/shell <command> - Run shell command\n"
        "/ram - Check RAM usage\n"
        "/disk - Check disk space"
    )

def status(update: Update, context: CallbackContext) -> None:
    """Check PM2 status"""
    if not is_authorized(update):
        return

    try:
        result = subprocess.run(['pm2', 'status'], capture_output=True, text=True)
        update.message.reply_text(f"```\n{result.stdout}\n```", parse_mode='Markdown')
    except Exception as e:
        update.message.reply_text(f"❌ Error: {e}")

def logs(update: Update, context: CallbackContext) -> None:
    """View bot logs"""
    if not is_authorized(update):
        return

    try:
        result = subprocess.run(['pm2', 'logs', 'vankush-bot', '--lines', '20', '--nostream'],
                               capture_output=True, text=True)
        output = result.stdout[-4000:]  # Telegram message limit
        update.message.reply_text(f"```\n{output}\n```", parse_mode='Markdown')
    except Exception as e:
        update.message.reply_text(f"❌ Error: {e}")

def restart(update: Update, context: CallbackContext) -> None:
    """Restart bot"""
    if not is_authorized(update):
        return

    try:
        subprocess.run(['pm2', 'restart', 'vankush-bot'], check=True)
        update.message.reply_text("✅ Bot restarted")
    except Exception as e:
        update.message.reply_text(f"❌ Error: {e}")

def deploy(update: Update, context: CallbackContext) -> None:
    """Pull latest code and restart"""
    if not is_authorized(update):
        return

    update.message.reply_text("📥 Pulling latest code...")

    try:
        # Pull code
        subprocess.run(['git', '-C', '/home/ubuntu/Bot', 'pull'], check=True)

        # Install dependencies
        subprocess.run(['npm', 'install', '--prefix', '/home/ubuntu/Bot'], check=True)

        # Restart
        subprocess.run(['pm2', 'restart', 'vankush-bot'], check=True)

        update.message.reply_text("✅ Deployed and restarted")
    except Exception as e:
        update.message.reply_text(f"❌ Error: {e}")

def shell(update: Update, context: CallbackContext) -> None:
    """Run shell command"""
    if not is_authorized(update):
        return

    if not context.args:
        update.message.reply_text("Usage: /shell <command>")
        return

    command = ' '.join(context.args)

    try:
        result = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=30)
        output = result.stdout + result.stderr
        if len(output) > 4000:
            output = output[-4000:]
        update.message.reply_text(f"```\n{output}\n```", parse_mode='Markdown')
    except Exception as e:
        update.message.reply_text(f"❌ Error: {e}")

def ram(update: Update, context: CallbackContext) -> None:
    """Check RAM usage"""
    if not is_authorized(update):
        return

    try:
        result = subprocess.run(['free', '-h'], capture_output=True, text=True)
        update.message.reply_text(f"```\n{result.stdout}\n```", parse_mode='Markdown')
    except Exception as e:
        update.message.reply_text(f"❌ Error: {e}")

def disk(update: Update, context: CallbackContext) -> None:
    """Check disk space"""
    if not is_authorized(update):
        return

    try:
        result = subprocess.run(['df', '-h'], capture_output=True, text=True)
        update.message.reply_text(f"```\n{result.stdout}\n```", parse_mode='Markdown')
    except Exception as e:
        update.message.reply_text(f"❌ Error: {e}")

def main() -> None:
    """Start the bot"""
    if not TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN not set!")
        return

    if ALLOWED_USER_ID == 0:
        logger.error("TELEGRAM_USER_ID not set!")
        return

    # Create updater
    updater = Updater(TOKEN)

    # Get dispatcher
    dispatcher = updater.dispatcher

    # Register handlers
    dispatcher.add_handler(CommandHandler("start", start))
    dispatcher.add_handler(CommandHandler("status", status))
    dispatcher.add_handler(CommandHandler("logs", logs))
    dispatcher.add_handler(CommandHandler("restart", restart))
    dispatcher.add_handler(CommandHandler("deploy", deploy))
    dispatcher.add_handler(CommandHandler("shell", shell))
    dispatcher.add_handler(CommandHandler("ram", ram))
    dispatcher.add_handler(CommandHandler("disk", disk))

    # Start bot
    updater.start_polling()
    logger.info("Bot started")
    updater.idle()

if __name__ == '__main__':
    main()
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

### Step 3: Install Dependencies

```bash
pip3 install python-telegram-bot
```

### Step 4: Get Your Telegram User ID

1. In Telegram, search for **@userinfobot**
2. Send: `/start`
3. Bot will reply with your user ID (e.g., `123456789`)
4. **Copy this number**

### Step 5: Configure Environment Variables

```bash
nano ~/.bashrc
```

Add to end:
```bash
export TELEGRAM_BOT_TOKEN="your_bot_token_from_botfather"
export TELEGRAM_USER_ID="your_user_id_from_userinfobot"
```

**Save** and reload:
```bash
source ~/.bashrc
```

### Step 6: Start Telegram Bot with PM2

```bash
chmod +x ~/telegram-bot.py

pm2 start ~/telegram-bot.py --name telegram-server-bot --interpreter python3

pm2 save
```

### Step 7: Test from Telegram

1. Open Telegram
2. Search for your bot: `@vankush_server_bot`
3. Send: `/start`

You should see the menu!

**Try commands**:
```
/status
/logs
/ram
/shell uptime
```

**You can now control your server from your phone!** 📱

---

## Part 4: SMS Gateway (Emergency Access)

**For when you have no internet - just SMS**

### Using Twilio

#### Step 1: Create Twilio Account

1. Go to: https://www.twilio.com/try-twilio
2. Sign up (free trial: $15 credit)
3. Verify your phone number

#### Step 2: Get Phone Number

1. In Twilio Console: **Get a Twilio phone number**
2. Choose a number (free with trial)
3. **Copy the number**

#### Step 3: Create SMS Bot on Server

```bash
nano ~/sms-bot.py
```

```python
#!/usr/bin/env python3
from flask import Flask, request
from twilio.twiml.messaging_response import MessagingResponse
import subprocess
import os

app = Flask(__name__)

# Your phone number (verified in Twilio)
ALLOWED_NUMBER = os.environ.get('MY_PHONE_NUMBER')

@app.route("/sms", methods=['POST'])
def sms_reply():
    """Respond to incoming SMS"""
    from_number = request.form['From']
    body = request.form['Body'].strip().lower()

    resp = MessagingResponse()

    # Security check
    if from_number != ALLOWED_NUMBER:
        resp.message("⛔ Unauthorized")
        return str(resp)

    # Commands
    if body == 'status':
        result = subprocess.run(['pm2', 'status'], capture_output=True, text=True)
        resp.message(result.stdout[:1600])  # SMS limit

    elif body == 'restart':
        subprocess.run(['pm2', 'restart', 'vankush-bot'])
        resp.message("✅ Bot restarted")

    elif body.startswith('shell '):
        command = body[6:]
        result = subprocess.run(command, shell=True, capture_output=True, text=True)
        resp.message(result.stdout[:1600])

    else:
        resp.message("Commands: status, restart, shell <cmd>")

    return str(resp)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000)
```

**Save** and:

```bash
pip3 install flask twilio

# Add phone to environment
echo 'export MY_PHONE_NUMBER="+1234567890"' >> ~/.bashrc
source ~/.bashrc

# Start with PM2
pm2 start ~/sms-bot.py --name sms-bot --interpreter python3

# Expose port 5000
sudo ufw allow 5000/tcp
```

#### Step 4: Configure Twilio Webhook

1. In Twilio Console → Phone Numbers → Your number
2. **Messaging Configuration**
3. **A MESSAGE COMES IN**: `http://YOUR_ORACLE_IP:5000/sms`
4. **Save**

#### Step 5: Test via SMS

Text your Twilio number:
```
status
```

Should receive PM2 status via SMS!

**Emergency commands**:
```
restart
shell df -h
shell free -m
```

---

## Part 5: Mobile SSH Apps Comparison

| App | Platform | Price | Features | Best For |
|-----|----------|-------|----------|----------|
| **Termux** | Android | Free | Full Linux terminal | Power users |
| **Blink Shell** | iOS | $20 | Mosh support, great UX | iOS users |
| **Termius** | Both | Free/Premium | Beautiful UI, sync | Beginners |
| **JuiceSSH** | Android | Free | Lots of plugins | Android users |
| **Prompt 3** | iOS | $15 | Native feel | iOS power users |

**Recommendation**:
- **Android**: Termux (free, most powerful)
- **iOS**: Blink Shell (best UX, worth $20)
- **Both**: Termius (free tier is good enough)

---

## Part 6: Monitor Everything from Phone

### Uptime Robot (Free Website Monitoring)

1. Go to: https://uptimerobot.com/
2. Sign up (free)
3. Add Monitor:
   - Type: **HTTP(s)**
   - URL: Your Railway deployment URL or `http://YOUR_ORACLE_IP`
   - Monitoring Interval: 5 minutes
4. **Alert Contacts**: Add your email/phone
5. Get notified if bot goes down!

### Grafana + Prometheus (Advanced)

**For serious monitoring**:

```bash
# Install Docker if not already
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Run Grafana
docker run -d --name=grafana -p 3001:3000 grafana/grafana

# Run Prometheus
docker run -d --name=prometheus -p 9090:9090 prom/prometheus
```

Access from phone: `http://YOUR_ORACLE_IP:3001`

---

## Part 7: Workflow Examples

### Example 1: Fix Bug from Phone

**Scenario**: Bot crashes while you're out

1. **Get alert** via Telegram: "🚨 Bot offline"
2. **Open Termux/Blink Shell**
3. **SSH to server**: `ssh Oracle`
4. **Check logs**: `pm2 logs vankush-bot --lines 50`
5. **See error**: "TypeError: Cannot read property 'id' of undefined"
6. **Quick fix**: `nano ~/Bot/index.js` → Fix the bug
7. **Auto-commit**: Your auto-push script commits it
8. **Restart**: `pm2 restart vankush-bot`
9. **Verify**: `pm2 status`
10. **Done!** All from your phone 📱

### Example 2: Deploy Update from Beach

1. **Push code** from laptop before leaving
2. **At beach**: Open Telegram
3. Send to your bot: `/deploy`
4. Bot pulls latest code and restarts
5. Send: `/status` to verify
6. **Done!** Back to relaxing 🏖️

### Example 3: Check Bot Health

**Morning routine** (from bed):

1. Add Termux widget to home screen
2. Tap **"Check Bot"** widget
3. Instantly see PM2 status
4. If green: Good! ✅
5. If red: Open Termux and debug

---

## Part 8: Security Best Practices

### For SSH Access

1. ✅ **Use SSH keys** (not passwords)
2. ✅ **Disable password auth**:
```bash
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
sudo systemctl restart sshd
```
3. ✅ **Use non-standard port**: Change port 22 to 2222
4. ✅ **Install fail2ban**: Auto-blocks brute force attempts

### For Telegram Bot

1. ✅ **Store token in environment** (not code)
2. ✅ **Whitelist your user ID** (done in script above)
3. ✅ **Don't share bot username** publicly
4. ✅ **Revoke token** if compromised

### For SMS Gateway

1. ✅ **Verify phone numbers** in Twilio
2. ✅ **Limit commands** (no `rm -rf /`)
3. ✅ **Use HTTPS** for webhooks (not HTTP)
4. ✅ **Monitor costs** (SMS can get expensive)

---

## Part 9: Troubleshooting

### Can't SSH from Phone

**Error**: "Connection refused"

**Fix**:
1. Check Oracle firewall: `sudo ufw status`
2. Check Oracle Cloud security list (port 22 open?)
3. Verify server is running: Ping `YOUR_ORACLE_IP`

### Telegram Bot Not Responding

**Fixes**:
1. Check token: `echo $TELEGRAM_BOT_TOKEN`
2. Check bot is running: `pm2 status`
3. View logs: `pm2 logs telegram-server-bot`
4. Restart: `pm2 restart telegram-server-bot`

### SMS Not Working

**Fixes**:
1. Check Twilio webhook URL is correct
2. Check SMS bot is running on port 5000
3. Check firewall: `sudo ufw allow 5000/tcp`
4. View Flask logs: `pm2 logs sms-bot`

---

## Part 10: Cost Breakdown

| Service | Cost | Features |
|---------|------|----------|
| **Oracle Cloud** | **$0/month** | SSH access, always on |
| **Termux** (Android) | **Free** | Full terminal |
| **Blink Shell** (iOS) | $20 one-time | Best iOS SSH |
| **Telegram Bot** | **Free** | Unlimited messages |
| **Twilio SMS** | ~$1/month | 40 SMS/month |
| **Uptime Robot** | **Free** | 50 monitors |

**Total**: **$0-1/month** (after $20 one-time for iOS) 🎉

---

## Summary

You now have **complete remote access** to your infrastructure!

**What you built**:
- ✅ SSH from phone (Termux/Blink Shell)
- ✅ Telegram bot for quick commands
- ✅ SMS gateway for emergencies
- ✅ Monitoring alerts
- ✅ Full terminal access on mobile

**Your complete FREE infrastructure**:
1. ✅ Oracle Cloud server (24GB RAM)
2. ✅ Gemini CLI (1,000 req/day)
3. ✅ DeepSeek Coder (unlimited local LLM)
4. ✅ Auto-push to GitHub
5. ✅ Remote access from anywhere ✅

**Total cost**: **$0-1/month** 🎉

**You can now**:
- Code from your phone
- Fix bugs on the go
- Monitor bot 24/7
- Deploy from anywhere
- Never need to be at your computer

**Next**: Set up Fiverr gigs to start earning! 💰
