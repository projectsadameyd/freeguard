# USCCB:free-Guard v2

### AI-Powered Discord Moderation Bot
**Made by EchoBastion Group** | ebsgroup.online

---

## Overview

USCCB:free-Guard v2 is an enterprise-grade AI moderation bot for Discord. It uses free AI models via OpenRouter and Hugging Face to moderate text, images, and voice chat in real-time. All user data is encrypted with AES-256-GCM.

**100% free to run** — no API costs, no credit card required.

---

## What's New in v2

- **Voice chat moderation** — real-time transcription + AI analysis via Whisper
- **Runtime configuration** — change settings via slash commands, no restart needed
- **7-layer text detection** — hard patterns, spam, links, invites, caps, mentions, AI
- **Reaction moderation** — catches harmful emoji reactions
- **Welcome system** — auto-role, custom messages
- **Appeal system** — users can appeal strikes, admins review
- **Audit log forwarding** — violations sent to a Discord channel in real-time
- **Structured logging** — encrypted logs with levels, categories, and search
- **Health server** — `/health`, `/metrics`, `/ping` endpoints for monitoring
- **Per-guild config** — every server gets its own settings
- **Strike expiry** — automatic cleanup after configurable days
- **Configurable thresholds** — max strikes, ban duration, spam limits, all adjustable

---

## Features

| Feature | Details |
|---------|---------|
| **Text Moderation** | 7-layer detection: regex patterns, spam, links, invites, caps, mentions, AI |
| **Image Moderation** | NSFW detection via Hugging Face Falconsai/nsfw_image_detection |
| **Voice Moderation** | Opus → ffmpeg → Whisper transcription → AI analysis |
| **Reaction Moderation** | Catches harmful custom emoji names |
| **Strike System** | Configurable max strikes, auto-ban, auto-expiry, DM warnings |
| **Appeal System** | Users submit appeals, admins approve/deny |
| **Welcome System** | Custom messages, auto-role assignment |
| **Encryption** | AES-256-GCM, PBKDF2 key derivation, HMAC file naming |
| **Health Server** | `/health`, `/metrics`, `/ping` for uptime monitoring |
| **Audit Logging** | Real-time violation forwarding to Discord channel |
| **Configurable** | 30+ settings via `/guard-config` slash commands |

---

## Setup

### 1. Upload & Install

Upload the zip to Replit (or any Node.js host) and run:

```bash
npm install
```

### 2. Set Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Source |
|----------|----------|--------|
| `DISCORD_TOKEN` | Yes | [Discord Developer Portal](https://discord.com/developers/applications) |
| `OPENROUTER_API_KEY` | Yes | [OpenRouter](https://openrouter.ai/keys) (free) |
| `HUGGINGFACE_TOKEN` | Yes | [Hugging Face](https://huggingface.co/settings/tokens) (free) |
| `ENCRYPTION_SECRET` | Yes | Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `HASH_SECRET` | Yes | Generate a different one |
| `LOG_LEVEL` | No | `INFO` (default), `DEBUG`, `WARN`, `ERROR` |

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 3. Discord Bot Setup

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Create application → Bot
3. Enable **Privileged Gateway Intents**:
   - Server Members Intent
   - Message Content Intent
4. Copy token to `.env`
5. Invite with permissions integer: `1099780079686`
6. Required permissions: Manage Messages, Kick, Ban, Send Messages, Read History, Manage Voice States

### 4. Run

```bash
node keepalive.js
```

### 5. Keep Alive (Replit)

Point [UptimeRobot](https://uptimerobot.com) to:
```
http://your-repl-url:3000/ping
```

---

## Slash Commands

### Admin Commands (Moderate Members)

| Command | Description |
|---------|-------------|
| `/guard-log @user` | View full encrypted strike log |
| `/guard-strikes @user` | View current strike count |
| `/guard-clear @user [reason]` | Clear all strikes |
| `/guard-status` | Bot status, uptime, stats |
| `/guard-unban @user` | Manual unban + strike clear |
| `/guard-stats` | Moderation statistics |
| `/guard-voice` | Voice activity monitor |
| `/guard-appeals` | View pending appeals |
| `/guard-resolve-appeal` | Approve/deny an appeal |
| `/guard-logs [date] [filter]` | Read encrypted logs |

### Admin Commands (Administrator)

| Command | Description |
|---------|-------------|
| `/guard-config view` | View all settings |
| `/guard-config set <key> <value>` | Change a setting |
| `/guard-config reset` | Reset to defaults |
| `/guard-config exempt-channel` | Toggle channel exemption |
| `/guard-config exempt-role` | Toggle role exemption |
| `/guard-config audit-log` | Set audit log channel |

### User Commands

| Command | Description |
|---------|-------------|
| `/my-strikes` | Check your strike count |
| `/my-log` | View your moderation history |
| `/appeal <reason>` | Submit an appeal |

---

## Configuration

All settings are configurable per-server via slash commands:

### Moderation Toggles
| Key | Default | Description |
|-----|---------|-------------|
| `textModeration` | `true` | Enable text moderation |
| `imageModeration` | `true` | Enable image NSFW detection |
| `voiceModeration` | `true` | Enable voice chat moderation |
| `reactionModeration` | `true` | Enable reaction moderation |
| `spamFilter` | `true` | Enable spam detection |
| `linkFilter` | `true` | Enable link filtering |
| `inviteFilter` | `true` | Enable Discord invite filtering |
| `capsFilter` | `true` | Enable caps lock filter |

### Thresholds
| Key | Default | Description |
|-----|---------|-------------|
| `spamMessageLimit` | `5` | Messages per time window before spam flag |
| `spamTimeWindowMs` | `5000` | Spam time window (ms) |
| `capsPercentageThreshold` | `70` | Caps % before flag |
| `capsMinLength` | `10` | Min message length for caps check |
| `maxMentions` | `5` | Max mentions per message |
| `maxStrikes` | `3` | Strikes before ban |
| `banDurationHours` | `24` | Ban duration in hours |
| `strikeExpiryDays` | `30` | Auto-expire strikes after N days |

### Voice
| Key | Default | Description |
|-----|---------|-------------|
| `voiceWarningBeforeDisconnect` | `true` | Warn before disconnecting |
| `voiceMaxRecordingSeconds` | `30` | Max recording duration |

### System
| Key | Default | Description |
|-----|---------|-------------|
| `dmWarnings` | `true` | Send DM warnings to users |
| `deleteViolations` | `true` | Delete violating messages |
| `welcomeEnabled` | `false` | Enable welcome messages |
| `welcomeMessage` | `Welcome...` | Custom welcome message |
| `welcomeRole` | `null` | Auto-role on join |

---

## Health Server

When using `keepalive.js`, the following endpoints are available:

| Endpoint | Description |
|----------|-------------|
| `GET /` | Full health status JSON |
| `GET /health` | Detailed health + uptime |
| `GET /metrics` | Process metrics |
| `GET /ping` | Simple liveness check |

Example response:

```json
{
  "status": "healthy",
  "service": "USCCB:free-Guard",
  "version": "2.0.0",
  "uptime": "2h 30m 15s",
  "bot": { "pid": 12345, "alive": true, "restarts": 0 }
}
```

---

## Log Reader

```bash
node readlog.js                           # Today's logs
node readlog.js 2025-01-15                # Specific date
node readlog.js --level WARN              # Filter by level
node readlog.js --search spam             # Search filter
node readlog.js --category VIOLATION      # Filter by category
node readlog.js --files                   # List log files
node readlog.js --export 2025-01-15       # Export as JSON
```

---

## File Structure

```
freeguard/
├── index.js              # Main bot (commands, events, moderation)
├── keepalive.js          # Process manager + health server
├── readlog.js            # CLI log reader
├── package.json
├── .env.example          # Environment template
├── .replit               # Replit config
├── src/
│   ├── config.js         # Runtime configuration manager
│   ├── encryption.js     # AES-256-GCM encryption engine
│   ├── logger.js         # Encrypted structured logging
│   ├── moderator.js      # 7-layer moderation engine
│   ├── strikeManager.js  # Strike system + appeals + bans
│   └── voiceModerator.js # Voice chat moderation pipeline
├── data/                 # Encrypted user records (auto-created)
└── logs/                 # Encrypted log files (auto-created)
```

---

## Security

| Feature | Implementation |
|---------|----------------|
| Data encryption | AES-256-GCM (authenticated) |
| Key derivation | PBKDF2 / SHA-512 / 310,000 iterations |
| File naming | HMAC-SHA256 hashed user IDs |
| Log encryption | Each line individually encrypted |
| Secret redaction | API keys/tokens auto-redacted from logs |
| Key versioning | Supports key rotation via version byte |

---

## License

Built and owned by **EchoBastion Group** | ebsgroup.online
License #555870690505 — Approved by the Legal EBS Group Creation Licensing Department
