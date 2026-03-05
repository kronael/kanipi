# DB bootstrap spec — open

## Problem

CLI `group add` on a fresh instance fails because the database doesn't exist
yet — only `initDatabase()` in the gateway creates it. The bash workaround
duplicates schema DDL inline.

The existing `try/catch ALTER TABLE` pattern has no version tracking: applied
migrations are not recorded, failures are silently swallowed.

## Current pattern

`db.ts:initDatabase()`:

1. `fs.mkdirSync` for store dir
2. `new Database(dbPath)` — creates file
3. `createSchema(db)` — idempotent `CREATE TABLE IF NOT EXISTS`
4. `ALTER TABLE` migrations (try/catch, no version tracking)

DB path: `store/messages.db` (relative to cwd).

## Proposed

### Migration files

Each migration is a `.sql` file in `migrations/` at the project root:

```
migrations/
  0001-slink-token.sql
  0002-context-mode.sql
  0003-is-bot-message.sql
  0004-chat-channel.sql
```

Plain SQL — no conditionals, no procedures. The runner handles sequencing.

### Migrations table

```sql
CREATE TABLE IF NOT EXISTS migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

`applied_at` is ISO-8601 UTC (SQLite has no timestamp type).

### `src/migrations.ts`

Single module shared by gateway and CLI. Reads `.sql` files from
`./migrations/` (cwd-relative, matching project layout).

```typescript
export function ensureDatabase(dbPath: string): Database.Database;
```

Internally: mkdir → open → baseline `CREATE TABLE IF NOT EXISTS` →
`runMigrations(db)`.

Runner logic — applies each migration if it is exactly `max(version) + 1`:

```typescript
function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const files = fs
    .readdirSync('./migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const maxVersion =
    (db.prepare('SELECT max(version) AS v FROM migrations').get() as any)?.v ??
    0;
  for (const file of files) {
    const version = parseInt(file, 10);
    if (version === maxVersion + 1) {
      const sql = fs.readFileSync(path.join('./migrations', file), 'utf-8');
      db.transaction(() => {
        db.exec(sql);
        db.prepare(
          'INSERT INTO migrations (version, applied_at) VALUES (?, ?)',
        ).run(version, new Date().toISOString());
      })();
    }
  }
}
```

Runs on every gateway start; no-op when already at latest version.
Existing databases start at version 0 (no rows in `migrations`).

### Migration file format

Plain SQL executed as-is. No conditionals — the runner guarantees each file
runs exactly once. Backfills that need the current `ASSISTANT_NAME` value
are handled by passing it in as a parameter if needed, or using a
`UPDATE ... WHERE content LIKE 'Andy:%'` with a fixed default acceptable
for the backfill case.

### Replacing `initDatabase()`

`ensureDatabase(dbPath)` replaces `initDatabase()` in `db.ts` and is
importable by the CLI `group add` command — no more inline DDL in bash.

## Bash interim

Until `src/migrations.ts` ships, bash `group add` continues with inline DDL
for `chats` and `registered_groups` only. Gateway `initDatabase` is idempotent
and adds missing tables/columns on first start.
