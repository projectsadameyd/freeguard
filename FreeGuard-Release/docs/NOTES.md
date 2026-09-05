# USCCB:free-Guard — Developer Notes

Modestified release architecture notes for maintainers and contributors.
Author: Adam Eyd.

## Where each thing lives

| Concern | Path |
|---------|------|
| Bot entrypoint, slash commands, events | `index.js` |
| Dashboard API server (Express, OAuth)| `dashboard-server.js` |
| Static dashboard UI | `dashboard/` (`index.html`, `style.css`, `app.js`) |
| Moderation engine (text/image/reaction) | `src/moderator.js` |
| Voice chat pipeline | `src/voiceModerator.js` |
| Strikes, appeals, bans, stats | `src/strikeManager.js` |
| Runtime per-guild configuration | `src/config.js` |
| Structured + AES-256-GCM encrypted logger | `src/logger.js` |
| Encryption helpers (PBKDF2 / HMAC) | `src/encryption.js` |
| Process manager + health endpoints | `keepalive.js` |
| CLI log reader | `readlog.js` |

## Layout

```
FreeGuard/
├── index.js              # bot entrypoint
├── dashboard-server.js   # dashboard API + static serving
├── keepalive.js          # health/ping supervisor
├── readlog.js            # CLI log reader
├── package.json / lock   # deps + scripts
├── .env.example          # template only — real .env is gitignored
├── src/                  # core modules (validator-safe)
├── dashboard/            # static UI (no API, no secrets incl.)
├── install/              # headless install scripts
├── scripts/              # dev helpers
├── docs/                 # extended guides
├── data/                 # encrypted user records (gitignored)
└── logs/                 # encrypted logs (gitignored)
```

## Appeal flow at a glance

Ban DM -> user presses button -> modal (`index.js`) -> `submitAppeal`
-> dashboard `GET /api/guilds/:gid/appeals` -> Approve/Deny
-> `resolveAppeal` (+ unban + invite-back DM on approve).

## Publishing a release

Bump `version` in `package.json`, then tag: `git tag vX.Y.Z`.
Keep `.env.example` in sync with every new config key.