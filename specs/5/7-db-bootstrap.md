---
status: shipped
---

# DB bootstrap spec — shipped

## Problem

CLI `group add` on a fresh instance fails because the database doesn't exist
yet — only `initDatabase()` in the gateway creates it. The bash workaround
duplicates schema DDL inline. The existing `try/catch ALTER TABLE` pattern
has no version tracking.

## Design

- Numbered `.sql` files in `src/migrations/`, plain SQL, no conditionals
- `migrations` table tracks applied versions (integer PK + ISO-8601 timestamp)
- `ensureDatabase(dbPath)` — single entrypoint shared by gateway, CLI, and tests
- Runner applies each migration sequentially, exactly once, on every startup (no-op at latest)
- All code paths use the same runner — no special test-only schema setup

## Out of scope

- Rollback/down migrations
- ORM
- Transactional DDL (SQLite limitation)
