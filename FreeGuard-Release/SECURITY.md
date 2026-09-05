# Security Policy

**Project:** USCCB:free-Guard
**Author / maintainer:** Adam Eyd
**Contact:** via the project's GitHub issues (private reports preferred —
open an issue marked *security*).

## Reporting a vulnerability

- Do **not** open a public issue that exposes PII, tokens, or exploit detail.
- Report privately and include:
  - affected endpoint / file / command
  - impact summary
  - reproduction steps if available
- You should hear back within a few days. Please allow time before
  public disclosure.

## Things to know

- All user records and logs are encrypted at rest with AES-256-GCM
  (`src/encryption.js`). Never store plaintext moderation data.
- Secrets live only in `.env` (gitignored). Rotate any key that leaks.
- The dashboard API honors `ALLOWED_GUILD_IDS`; keep the OAuth redirect
  base `DASHBOARD_BASE_URL` pinned to your real public URL.

Never commit `.env`, `data/`, or `logs/`.