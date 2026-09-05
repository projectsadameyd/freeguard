<img width="1919" height="954" alt="image" src="https://github.com/user-attachments/assets/99e891bf-7dab-4df1-9291-2d2b98e4dea3" />
FreeGuard V3.0.0 - Latest

**AI-powered Discord moderation bot + web dashboard.**

> Maintained by **Adam Eyd**

free-Guard moderates text, images, reactions and voice in real time using free
AI models, tracks strikes, auto-bans repeat offenders, runs a full **appeal**
workflow (button + modal in DMs, review via dashboard), and ships an
OAuth-secured web dashboard for server staff.

All user data and logs are encrypted at rest with **AES-256-GCM**.

---

## Screenshots / demo

The dashboard follows a clean glass design with light/dark themes.
Add UI screenshots to [`docs/images/`](docs/images) and show them here.

---

## Features

| Area | Details |
|------|---------|
| **Text moderation** | 7-layer: regex patterns, spam, links, invites, caps, mentions, AI |
| **Image moderation** | NSFW detection via Hugging Face `Falconsai/nsfw_image_detection` |
| **Voice moderation** | Opus → ffmpeg → Whisper transcription → AI analysis |
| **Reaction moderation** | Flags harmful emoji / custom emoji names |
| **Strike system** | Configurable max strikes, auto-ban, auto-expiry, DM warnings |
| **Appeal workflow** | Ban DM → button → modal form → dashboard review → approve (**unban + invite-back DM**) or deny |
| **Welcome system** | Custom messages + auto-role assignment |
| **Audit / export** | Structured encrypted logs; CLI reader |
| **Web dashboard** | OAuth (Discord) login, per-guild, warn/DM/roles/kick/ban, live overview |
| **Encryption** | AES-256-GCM, PBKDF2 key derivation, HMAC file naming |
| **Health endpoints** | `/health`, `/metrics`, `/ping` |

---

## Table of contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
  - [Environment variables](#environment-variables)
  - [Discord bot setup](#discord-bot-setup)
- [Dashboard setup (optional, recommended)](#dashboard-setup)
- [Slash commands](#slash-commands)
- [Configuration](#configuration)
- [Project structure](#project-structure)
- [Security](#security)
- [Frequently asked questions](#frequently-asked-questions)
- [Credits & license](#credits--license)

---

## Requirements

- **Node.js ≥ 18**
- A Discord bot application + (for the dashboard) a Discord OAuth application
- Pubkeys / invites for image + voice modules: Hugging Face token, OpenRouter key

---

## Quick start

```bash
git clone https://github.com/adameyd/free-guard.git
cd free-guard
npm install
cp .env.example .env        # then edit
node keepalive.js           # or: npm start
```

### Environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `DISCORD_TOKEN` | ✅ | Bot token from [Discord Developer Portal](https://discord.com/developers/applications) |
| `OPENROUTER_API_KEY` | ✅ | Text moderation model (free tier) |
| `HUGGINGFACE_TOKEN` | ✅ | NSFW image + voice transcription (free tier) |
| `ENCRYPTION_SECRET` | ✅ | Long random string — encrypts user data |
| `HASH_SECRET` | ✅ | Different long random string — HMAC file names |
| `LOG_LEVEL` | ⬜ | `INFO` (default) · `DEBUG` · `WARN` · `ERROR` |
| Dashboard vars | see [below](#dashboard-setup) | `DISCORD_CLIENT_ID`, secret, base URL, allowed guilds |

Generate the two secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> **Never commit `.env`.** It is gitignored.

### Discord bot setup

1. Create an application at [discord.com/developers/applications](https://discord.com/developers/applications).
2. Add a **Bot** user and copy its token.
3. Under **Privileged Gateway Intents**, enable:
   - Server Members Intent
   - Message Content Intent
4. Invite the bot with permissions integer: `1099780079686`
   (Manage Messages, Kick, Ban, Send Messages, Read History, Manage Voice States).

---

## Dashboard setup

The dashboard is a separate **OAuth2 Discord application** (or a second app)
that issues login sessions; the bot itself performs moderation.

1. Create a second app → **OAuth2 → General**: copy **Client ID** and **Client Secret**.
2. Add the callback redirect:
   `{DASHBOARD_BASE_URL}/api/auth/callback`
   e.g. `https://your-tunnel.example/api/auth/callback`
3. Scopes: `identify`, `guilds`.

```ini
DISCORD_CLIENT_ID=your_oauth_client_id
DISCORD_CLIENT_SECRET=your_oauth_client_secret
DASHBOARD_BASE_URL=https://your-tunnel.example
ALLOWED_GUILD_IDS=                 # comma-separated, or empty to allow any staff server
DASHBOARD_PORT=3002
ENABLE_DASHBOARD=true
```

Start: `npm run dashboard` (the bot auto-starts it when `ENABLE_DASHBOARD != false`).

Deployment guide: see [`docs/freeguard-dashboard-setup.md`](docs/freeguard-dashboard-setup.md)
and the headless installer in [`install/install-dashboard.sh`](install/install-dashboard.sh).

> **Tip** — expose the dashboard publicly with a **Tailscale Funnel** or
> Cloudflare tunnel. Both work well and keep the API private on the wire.

---

## Slash commands

### Staff / moderator

| Command | Description |
|---------|-------------|
| `/guard-log @user` | Full encrypted strike log |
| `/guard-strikes @user` | Current strike count |
| `/guard-clear @user [reason]` | Clear all strikes |
| `/guard-status` | Bot status + uptime |
| `/guard-unban @user` | Unban + clear strikes |
| `/guard-stats` | Moderation statistics |
| `/guard-voice` | Voice activity monitor |
| `/guard-appeals` | List pending appeals |
| `/guard-resolve-appeal` | Approve / deny an appeal (approve → unban + invite DM) |
| `/guard-logs [date] [filter]` | Read encrypted logs |

### Config (admin)

| Command | Description |
|---------|-------------|
| `/guard-config view` | View current settings |
| `/guard-config set <key> <value>` | Change a setting |
| `/guard-config reset` | Reset to defaults |
| `/guard-config exempt-channel` | Toggle channel exemption |
| `/guard-config exempt-role` | Toggle role exemption |
| `/guard-config audit-log` | Set the audit log channel |

### Users

| Command | Description |
|---------|-------------|
| `/my-strikes` | Your strike count |
| `/my-log` | Your moderation history |
| `/appeal <reason>` | Submit an appeal |

---

## Configuration

Per-server settings (30+). Highlights:

| Key | Default | Description |
|-----|---------|-------------|
| `textModeration` | `true` | Enable text moderation |
| `imageModeration` | `true` | Enable image NSFW detection |
| `voiceModeration` | `true` | Enable voice chat moderation |
| `spamMessageLimit` | `5` | Messages per window before spam flag |
| `spamTimeWindowMs` | `5000` | Spam window (ms) |
| `capsPercentageThreshold` | `70` | Caps % before flag |
| `maxMentions` | `5` | Max mentions per message |
| `maxStrikes` | `3` | Strikes before auto-ban |
| `banDurationHours` | `24` | Ban length (auto-lifts) |
| `strikeExpiryDays` | `30` | Auto-expire strikes |
| `dmWarnings` | `true` | DM users on warn/ban |
| `deleteViolations` | `true` | Delete violating messages |
| `welcomeEnabled` | `false` | Welcome messages + auto-role |

Full table in `docs/NOTES.md`.

---

## Project structure

```
free-guard/
├── index.js              # Bot entrypoint — commands, events, moderation
├── dashboard-server.js   # Dashboard API + OAuth + static serving
├── keepalive.js          # Process manager + health/ping
├── readlog.js            # CLI log reader
├── package.json
├── .env.example          # Template only (real .env is gitignored)
├── src/                  # Core logic (pure, no server side-effects)
│   ├── moderator.js      # 7-layer moderation engine
│   ├── strikeManager.js  # Strikes, appeals, bans, stats
│   ├── voiceModerator.js # Voice pipeline
│   ├── config.js         # Per-guild runtime config
│   ├── logger.js         # Structured encrypted logging
│   └── encryption.js     # AES-256-GCM / PBKDF2 / HMAC helpers
├── dashboard/            # Static UI (html/css/js)
├── install/              # Headless deploy helpers
├── scripts/              # Dev utilities
└── docs/                 # Setup & developer notes
```

---

## Security

| Property | Implementation |
|----------|----------------|
| Data at rest | AES-256-GCM (authenticated) |
| Key derivation | PBKDF2 / SHA-512 / 310,000 iterations |
| File naming | HMAC-SHA256 of user IDs |
| Logs | Each line individually encrypted |
| Secret handling | Redacted from logs; only in gitignored `.env` |
| Dashboard access | Discord OAuth + `ALLOWED_GUILD_IDS` allow-list |

See [`SECURITY.md`](SECURITY.md) to report a vulnerability.

---

## Frequently asked questions

**Is anything stored in plain text?** No. User records and logs are encrypted
at rest; `.env` holds secrets but is gitignored and never committed.

**How do users appeal?** When banned they get a DM with an **Appeal this ban**
button. It opens a short form; the submission lands in the dashboard
**Appeals** tab where a moderator approves or denies. Approval unbans instantly
and DM's the user a fresh one-time invite back.

**Can I run it without AI APIs?** The heuristic layers still run, but AI text
and NSFW/voice analysis need the OpenRouter / Hugging Face keys.

**What hosts are supported?** Any Node.js ≥ 18 environment — VPS, Raspberry Pi,
a cloud function, or Replit.

---

## Credits & license

- **Author & Creator:** Adam Eyd.
- Built on Discord.js, Express, and @discordjs/voice.

Licensed under the [MIT License](LICENSE). © 2026 Adam Eyd.
