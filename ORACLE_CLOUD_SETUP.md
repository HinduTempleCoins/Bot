# Oracle Cloud Free Tier Setup Guide

**Goal**: Set up a FREE FOREVER server with 24GB RAM to host all Van Kush projects

**What You'll Get**:
- 24GB RAM, 4 CPU cores (ARM)
- 200GB storage
- 10TB/month bandwidth
- Free FOREVER (not a trial)
- Can host: Discord bot, Telegram bot, website, local LLM, ChromaDB, n8n, databases

---

## Part 1: Create Oracle Cloud Account (5 minutes)

### Step 1: Sign Up

1. Go to: https://www.oracle.com/cloud/free/
2. Click **"Start for free"**
3. Fill in:
   - Email address
   - Country/Territory
   - Click "Verify my email"
4. Check your email for verification code
5. Enter code and continue

### Step 2: Account Details

1. Choose **"Individual"** (not company)
2. Fill in your name and address
3. **Credit card verification** (required but NEVER charged for free tier)
   - Oracle verifies identity with $1 temporary hold
   - This is immediately released
   - Free tier services are NEVER charged
4. Click "Add payment verification method"
5. Complete verification

### Step 3: Choose Region

**IMPORTANT**: Choose region closest to you for best performance

**Options**:
- **US East (Ashburn)** - East Coast USA
- **US West (Phoenix)** - West Coast USA
- **UK South (London)** - Europe
- **Germany Central (Frankfurt)** - Europe
- **Brazil East (Sao Paulo)** - South America
- **India West (Mumbai)** - Asia

**Cannot change region later!** Choose wisely.

### Step 4: Wait for Account Activation

- Takes 5-15 minutes
- You'll receive email when ready
- Dashboard will say "Account is being setup"

---

## Part 2: Create Free VM Instance (10 minutes)

### Step 1: Access Dashboard

1. Go to: https://cloud.oracle.com/
2. Log in with your Oracle account
3. You'll see the **Oracle Cloud Dashboard**

### Step 2: Create Compute Instance

1. Click hamburger menu (☰) in top left
2. Click **"Compute"** → **"Instances"**
3. Click **"Create Instance"** button

### Step 3: Configure Instance - CRITICAL SETTINGS!

**Name**: `vankush-main-server`

**Placement**: Leave as default (your chosen region)

**Image and Shape** - THIS IS CRITICAL!

1. Click **"Change Image"**
   - Select **"Canonical Ubuntu"**
   - Choose **"22.04"** (LTS version)
   - Click **"Select Image"**

2. Click **"Change Shape"**
   - Click **"Ampere"** (ARM-based)
   - Select **"VM.Standard.A1.Flex"**
   - Set **"Number of OCPUs"**: **4** (maximum free)
   - Set **"Amount of memory (GB)"**: **24** (maximum free)
   - Click **"Select Shape"**

**IMPORTANT**: VM.Standard.A1.Flex with 4 OCPU + 24GB RAM is FREE FOREVER

### Step 4: Networking

**Primary VNIC**:
- Leave **"Create new virtual cloud network"** selected
- Leave **"Assign a public IPv4 address"** CHECKED ✓

**DO NOT** uncheck public IP - you need this to connect!

### Step 5: SSH Key Setup

**CRITICAL - Save this key somewhere safe!**

1. Click **"Save private key"** button
2. Save file as: `oracle_ssh_key` (no extension)
3. **ALSO** click **"Save public key"** (backup)
4. Save both files somewhere you'll never lose them (e.g., Documents folder, Dropbox)

**Without this key, you can NEVER access your server!**

### Step 6: Boot Volume

- Leave default (200GB) - this is included in free tier

### Step 7: Create Instance

1. Click **"Create"** button at bottom
2. Wait 2-3 minutes for provisioning
3. Status will change from **"Provisioning"** → **"Running"** (green)

### Step 8: Note Your Server Details

Once running, you'll see:

**Public IP Address**: `xxx.xxx.xxx.xxx` (copy this!)
**Username**: `ubuntu` (default for Ubuntu images)

Write these down:
```
IP: ___.___.___.___
Username: ubuntu
SSH Key Location: /path/to/oracle_ssh_key
```

---

## Part 3: Open Firewall Ports (5 minutes)

By default, Oracle blocks most ports. You need to open them.

### Step 1: Configure Security List

1. Still in your instance page, scroll down to **"Primary VNIC"** section
2. Click the **"Subnet"** link (looks like `subnet-20250108-...`)
3. Click **"Default Security List"** in the left sidebar
4. Click **"Add Ingress Rules"** button

### Step 2: Add HTTP/HTTPS Rules

**Rule 1 - HTTP**:
- Source CIDR: `0.0.0.0/0`
- IP Protocol: `TCP`
- Destination Port Range: `80`
- Description: `HTTP for websites`
- Click **"Add Ingress Rule"**

**Rule 2 - HTTPS**:
- Source CIDR: `0.0.0.0/0`
- IP Protocol: `TCP`
- Destination Port Range: `443`
- Description: `HTTPS for websites`
- Click **"Add Ingress Rule"**

**Rule 3 - Custom Apps**:
- Source CIDR: `0.0.0.0/0`
- IP Protocol: `TCP`
- Destination Port Range: `3000-9000`
- Description: `Custom application ports`
- Click **"Add Ingress Rule"**

### Step 3: Configure Ubuntu Firewall

We'll do this after connecting in Part 4.

---

## Part 4: Connect to Your Server (Windows)

### Step 1: Install SSH Client (if needed)

**Windows 10/11**: SSH is built-in! Use PowerShell or Command Prompt.

**Older Windows**: Download PuTTY from https://www.putty.org/

### Step 2: Prepare SSH Key

**Option A: Using PowerShell/Command Prompt (Recommended)**

1. Move your SSH key to a safe location:
   ```
   mkdir C:\Users\YourName\.ssh
   move Downloads\oracle_ssh_key C:\Users\YourName\.ssh\
   ```

2. Set correct permissions (CRITICAL):
   - Right-click `oracle_ssh_key` file
   - Properties → Security tab
   - Click **"Advanced"**
   - Click **"Disable inheritance"** → **"Remove all inherited permissions"**
   - Click **"Add"** → **"Select a principal"**
   - Type your Windows username → **"Check Names"** → **"OK"**
   - Check **"Full control"**
   - Click **"OK"** on all dialogs

**Option B: Using PuTTY**

1. Open **PuTTYgen** (comes with PuTTY)
2. Click **"Load"**
3. Change file type to **"All Files (*.*)"**
4. Select your `oracle_ssh_key` file
5. Click **"Save private key"** (saves as `.ppk` format)
6. Save as `oracle_ssh_key.ppk`

### Step 3: Connect via SSH

**Option A: PowerShell/Command Prompt**

```powershell
ssh -i C:\Users\YourName\.ssh\oracle_ssh_key ubuntu@YOUR_IP_ADDRESS
```

Replace `YOUR_IP_ADDRESS` with the public IP from Oracle dashboard.

**First time connecting**: You'll see:
```
The authenticity of host 'xxx.xxx.xxx.xxx' can't be established.
Are you sure you want to continue connecting (yes/no)?
```
Type **`yes`** and press Enter.

**Option B: PuTTY**

1. Open **PuTTY**
2. **Host Name**: `ubuntu@YOUR_IP_ADDRESS`
3. **Port**: `22`
4. Left sidebar: **Connection** → **SSH** → **Auth** → **Credentials**
5. **Private key file**: Browse to `oracle_ssh_key.ppk`
6. Go back to **Session** (top of left sidebar)
7. **Saved Sessions**: Type `OracleVM`
8. Click **"Save"** (so you don't have to do this again)
9. Click **"Open"**

### Step 4: You're Connected!

You should see:
```
Welcome to Ubuntu 22.04.3 LTS
ubuntu@vankush-main-server:~$
```

**YOU'RE IN!** You now have a FREE 24GB RAM server! 🎉

---

## Part 5: Configure Ubuntu Firewall

Once connected via SSH:

```bash
# Allow SSH (so you don't lock yourself out!)
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow custom app ports
sudo ufw allow 3000:9000/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

You should see:
```
Status: active

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                     ALLOW       Anywhere
3000:9000/tcp              ALLOW       Anywhere
```

---

## Part 6: Install Essential Software

Still connected via SSH:

### Update System

```bash
sudo apt update && sudo apt upgrade -y
```

### Install Node.js 20 (for Discord bot)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # Should show v20.x.x
npm --version   # Should show 10.x.x
```

### Install Git

```bash
sudo apt install -y git
git --version
```

### Install PM2 (keeps apps running 24/7)

```bash
sudo npm install -g pm2
pm2 --version
```

### Install Python 3.11 (for local LLM)

```bash
sudo apt install -y python3.11 python3.11-venv python3-pip
python3 --version
```

### Install Docker (for running ChromaDB, databases, etc.)

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group (no need for sudo)
sudo usermod -aG docker ubuntu

# Log out and back in for group change to take effect
exit
```

**Reconnect via SSH** (same command as before)

```bash
# Verify Docker works
docker --version
docker run hello-world
```

---

## Part 7: Deploy Discord Bot to Oracle

### Step 1: Clone Repository

```bash
cd ~
git clone https://github.com/HinduTempleCoins/Bot.git
cd Bot
git checkout claude/update-todos-9iXhF
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Create Environment File

```bash
nano .env
```

**Paste this** (replace with YOUR keys):
```
DISCORD_TOKEN=your_discord_token_here
GEMINI_API_KEY=your_gemini_api_key_here
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

### Step 4: Start Bot with PM2

```bash
pm2 start index.js --name vankush-bot
pm2 save
pm2 startup
```

**Copy the command PM2 gives you** and run it (it starts with `sudo`).

### Step 5: Verify Bot is Running

```bash
pm2 status
```

Should show:
```
┌─────┬──────────────┬─────────┬─────────┬──────────┐
│ id  │ name         │ status  │ restart │ uptime   │
├─────┼──────────────┼─────────┼─────────┼──────────┤
│ 0   │ vankush-bot  │ online  │ 0       │ 10s      │
└─────┴──────────────┴─────────┴─────────┴──────────┘
```

### Step 6: Check Logs

```bash
pm2 logs vankush-bot
```

Look for:
```
✅ Logged in as VanKushFamilyMod#3991
🎮 Crypt-ology dialogue system loaded
```

**Done!** Your bot now runs 24/7 on Oracle Cloud FREE!

---

## Part 8: Monitor and Manage

### Useful PM2 Commands

```bash
pm2 status              # Check all apps
pm2 logs vankush-bot    # View logs
pm2 restart vankush-bot # Restart bot
pm2 stop vankush-bot    # Stop bot
pm2 delete vankush-bot  # Remove bot
pm2 monit               # Real-time monitoring
```

### Update Bot Code

```bash
cd ~/Bot
pm2 stop vankush-bot
git pull origin claude/update-todos-9iXhF
npm install  # Install any new dependencies
pm2 restart vankush-bot
pm2 logs vankush-bot  # Verify it started
```

### Check Server Resources

```bash
# RAM usage
free -h

# CPU usage
top

# Disk space
df -h

# Network usage
sudo apt install vnstat
vnstat
```

---

## What's Next?

Now that you have Oracle Cloud running:

1. ✅ Discord bot running 24/7
2. ⏳ Install Gemini CLI (next guide)
3. ⏳ Install DeepSeek Coder local LLM (next guide)
4. ⏳ Set up auto-push to GitHub
5. ⏳ Deploy Telegram bot
6. ⏳ Deploy website
7. ⏳ Install ChromaDB for book memory

**Your server can handle ALL of these on the same machine!**

---

## Troubleshooting

### Can't SSH Connect

**Error**: `Connection refused`
- Check instance is **"Running"** in Oracle dashboard
- Verify public IP is correct
- Check security list has port 22 open

**Error**: `Permission denied (publickey)`
- Check SSH key file permissions (should be readable only by you)
- Make sure you're using correct key file
- Try: `ssh -v -i /path/to/key ubuntu@IP` (verbose mode shows errors)

### Bot Not Starting

```bash
# Check logs for errors
pm2 logs vankush-bot --lines 100

# Common issues:
# 1. Missing environment variables
cat .env  # Verify DISCORD_TOKEN and GEMINI_API_KEY exist

# 2. Port already in use
sudo lsof -i :3000  # Check what's using port

# 3. Node modules missing
cd ~/Bot && npm install
```

### Out of RAM

```bash
# Check RAM usage
free -h

# Kill memory hogs
pm2 delete app-name

# Or restart server
sudo reboot
```

Wait 2 minutes, then reconnect via SSH.

---

## Cost Breakdown

**Oracle Cloud Free Tier**:
- VM Instance (4 OCPU, 24GB RAM): **$0/month** ✅
- 200GB Block Storage: **$0/month** ✅
- 10TB Outbound Transfer: **$0/month** ✅
- Public IP: **$0/month** ✅

**Total Cost**: **$0/month FOREVER** 🎉

Compare to Railway: $5-30/month for much less resources.

---

## Security Best Practices

1. **Never share your SSH key** - treat it like a password
2. **Keep system updated**: `sudo apt update && sudo apt upgrade` weekly
3. **Don't disable firewall**: `sudo ufw status` should show "active"
4. **Use environment variables** for secrets (never commit to Git)
5. **Regular backups**: PM2 saves configs, but backup your `.env` files manually

---

## Next Guides

1. **GEMINI_CLI_SETUP.md** - Install Google Gemini CLI for free AI coding
2. **DEEPSEEK_CODER_SETUP.md** - Install local LLM for offline coding
3. **AUTO_PUSH_GITHUB.md** - Configure automatic git commits
4. **REMOTE_CODING_SETUP.md** - Set up Claude Code via Slack, Telegram, SMS

All guides are designed to work on your new Oracle Cloud server!
