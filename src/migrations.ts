import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Run pending migrations on the database.
 * Migrations are numbered .sql files in src/migrations/.
 * Each migration runs exactly once, tracked by the migrations table.
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const maxVersion =
    (db.prepare('SELECT max(version) AS v FROM migrations').get() as any)?.v ??
    0;

  for (const file of files) {
    const version = parseInt(file, 10);
    if (isNaN(version)) continue;
    if (version <= maxVersion) continue;
    if (version !== maxVersion + 1) {
      throw new Error(
        `Migration gap: expected ${maxVersion + 1}, found ${version}`,
      );
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare(
        'INSERT INTO migrations (version, applied_at) VALUES (?, ?)',
      ).run(version, new Date().toISOString());
    })();
  }
}

/**
 * Open (or create) the database at dbPath and run all pending migrations.
 * Creates parent directories if needed.
 */
export function ensureDatabase(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  runMigrations(db);
  return db;
}

/**
 * Create an in-memory database with all migrations applied.
 * Used by tests.
 */
export function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}
