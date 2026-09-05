# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.1.0] — 2026-09-05

### Added
- **Appeal self-serve flow** — banned users receive an **"Appeal this ban"**
  button in the ban DM; clicking it opens a modal form. Submitted appeals
  appear immediately in the dashboard **Appeals** tab.
- **Approve = unban + invite back** — approving an appeal now lifts the ban
  early (previously only cleared strikes), resets the strike record, and
  DM's the member a fresh one-time invite link to rejoin.
- **Dashboard role management** — member drawer shows current roles (removable)
  and an "Assign" dropdown for adding roles.
- **Dashboard DMs** — send a message directly to a member from the drawer.
- **Bots in Members tab** — bots are now listed, tagged with a `Bot` badge.
- **Live member data** — role + roles list included in the member detail API.

### Changed
- Dashboard redesigned to a glass-style console (sidebar + topbar), light/dark
  themes, instant tab loads via parallel data warm-up + client cache.
- Token/user-info cache TTL raised to 10 minutes; all GET responses cached on
  the client for instant tab switches.
- `DASHBOARD_PORT` default moved to `3002` to avoid clashing with common
  Node services on `3001`.

### Fixed
- Mixed `403`/`500` on guild stats (auth cached properly + API rate-limit
  bursts eliminated).
- Members list `opcode 8 rate limited` — now server-cache first, REST fallback.
- Appeal form submit racing the interaction time window (acknowledge-first).

## [2.0.0] — 2026-08

- Initial v2 release: voice moderation, runtime config, appeal system.
- Dashboard v1 with OAuth login and per-guild stats.