# Contributing to USCCB:free-Guard

Thanks for helping out. Keep it simple and readable.

## Ground rules

- **Author / maintainer:** Adam Eyd.
- Match the existing style: no boilerplate, keep it readable, use named
  sections with `// ── ... ──` dividers.
- Do **not** commit secrets, `.env`, `data/`, or `logs/`.
- Keep security changes conservative — the data layer is AES-256-GCM
  encrypted for a reason. Wire through `src/encryption.js`, never plaintext.

## Bugs & features

1. Fork the repo and create a branch:
   `git checkout -b feat/my-thing`
2. Make focused changes. Add a short comment where intent is non-obvious.
3. Verify nothing is broken:
   ```bash
   npm run check
   ```
4. Commit with a clear message and open a pull request.

## Suggested areas

- Moderation rules in `src/moderator.js`
- New slash commands in `index.js`
- Dashboard API in `dashboard-server.js` and UI in `dashboard/`
- Tests / CI hooks