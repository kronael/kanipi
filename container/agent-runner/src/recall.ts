import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { parse as parseTOML } from 'smol-toml';
import { parse as parseYAML } from 'yaml';

interface Store { name: string; dir: string }
interface Config {
  db_dir: string;
  embed_url: string;
  embed_model: string;
  store: Store[];
}
interface Result { score: number; store: string; key: string; summary: string }

function parseArgs(): { limit: number; query: string | null } {
  const args = process.argv.slice(2);
  let limit = 5;
  let query: string | null = null;
  for (const a of args) {
    if (/^-\d+$/.test(a)) limit = parseInt(a.slice(1));
    else query = query ? `${query} ${a}` : a;
  }
  return { limit, query };
}

function loadConfig(): Config {
  const raw = fs.readFileSync(path.join(process.cwd(), '.recallrc'), 'utf8');
  return parseTOML(raw) as unknown as Config;
}

function initDB(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  sqliteVec.load(db);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL,
      summary TEXT,
      embedding BLOB,
      mtime INTEGER
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
      key, summary,
      content='entries', content_rowid='id'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS entries_vec USING vec0(
      id INTEGER PRIMARY KEY,
      embedding float[768] distance_metric=cosine
    );
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
      INSERT INTO entries_fts(rowid, key, summary)
        VALUES (new.id, new.key, new.summary);
      INSERT INTO entries_vec(id, embedding)
        VALUES (new.id, new.embedding);
    END;
    CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
      INSERT INTO entries_fts(entries_fts, rowid, key, summary)
        VALUES('delete', old.id, old.key, old.summary);
      DELETE FROM entries_vec WHERE id = old.id;
    END;
  `);
  return db;
}

function parseSummary(content: string): string {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return '';
  try {
    const fm = parseYAML(m[1]);
    return typeof fm?.summary === 'string' ? fm.summary : '';
  } catch { return ''; }
}

function walkMd(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile() && e.name.endsWith('.md')) {
      out.push(path.join(e.parentPath, e.name));
    }
  }
  return out;
}

async function embed(text: string, cfg: Config): Promise<Buffer> {
  const r = await fetch(cfg.embed_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cfg.embed_model, input: text }),
  });
  if (!r.ok) throw new Error(`embed failed: ${r.status}`);
  const data = await r.json() as { embeddings?: number[][]; embedding?: number[] };
  const vec = data.embeddings?.[0] ?? data.embedding;
  if (!vec) throw new Error('embed: no vector in response');
  const f32 = new Float32Array(vec);
  return Buffer.copyBytesFrom(f32);
}

async function syncStore(
  db: Database.Database, dir: string, cfg: Config
): Promise<void> {
  const files = walkMd(dir);
  const existing = new Map<string, number>();
  for (const row of db.prepare('SELECT path, mtime FROM entries').all() as
    { path: string; mtime: number }[]) {
    existing.set(row.path, row.mtime);
  }

  const onDisk = new Set(files);
  const del = db.prepare('DELETE FROM entries WHERE path = ?');
  for (const [p] of existing) {
    if (!onDisk.has(p)) del.run(p);
  }

  const ins = db.prepare(
    'INSERT INTO entries (key, path, summary, embedding, mtime) VALUES (?, ?, ?, ?, ?)'
  );
  const upsert = db.transaction(
    (key: string, fp: string, summary: string, emb: Buffer, mt: number) => {
      del.run(fp);
      ins.run(key, fp, summary, emb, mt);
    }
  );

  for (const fp of files) {
    const stat = fs.statSync(fp);
    const mt = Math.floor(stat.mtimeMs);
    if (existing.get(fp) === mt) continue;

    const content = fs.readFileSync(fp, 'utf8');
    const summary = parseSummary(content);
    const key = path.relative(dir, fp);
    const text = summary || key;

    let emb: Buffer;
    try {
      emb = await embed(text, cfg);
    } catch {
      continue; // skip — will retry next run (no mtime cached)
    }

    upsert(key, fp, summary, emb, mt);
  }
}

function ftsQuery(q: string): string {
  const words = q.split(/\s+/).filter(Boolean).map(w => w.replace(/"/g, ''));
  if (words.length === 0) return '""';
  return words.map(w => `"${w}"`).join(' OR ');
}

function search(
  db: Database.Database, query: string, embBuf: Buffer | null, limit: number
): Result[] {
  const n = limit * 3;
  const ftsRows = db.prepare(
    'SELECT rowid, rank FROM entries_fts WHERE entries_fts MATCH ? ORDER BY rank LIMIT ?'
  ).all(ftsQuery(query), n) as { rowid: number; rank: number }[];

  const vecRows = embBuf
    ? db.prepare(
        'SELECT id, distance FROM entries_vec WHERE embedding MATCH ? AND k = ?'
      ).all(embBuf, n) as { id: number; distance: number }[]
    : [];

  const scores = new Map<number, number>();
  const k = 60;
  for (let i = 0; i < ftsRows.length; i++) {
    const id = ftsRows[i].rowid;
    scores.set(id, (scores.get(id) ?? 0) + 0.3 / (k + i + 1));
  }
  for (let i = 0; i < vecRows.length; i++) {
    const id = vecRows[i].id;
    scores.set(id, (scores.get(id) ?? 0) + 0.7 / (k + i + 1));
  }

  const ids = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  if (ids.length === 0) return [];

  const get = db.prepare(
    'SELECT id, key, summary FROM entries WHERE id = ?'
  );
  const maxScore = ids[0][1];
  return ids.map(([id, score]) => {
    const row = get.get(id) as { id: number; key: string; summary: string };
    return {
      score: score / maxScore,
      store: '',
      key: row.key,
      summary: row.summary || '(no summary)',
    };
  });
}

function newest(db: Database.Database, limit: number): Result[] {
  const rows = db.prepare(
    'SELECT key, summary FROM entries ORDER BY mtime DESC LIMIT ?'
  ).all(limit) as { key: string; summary: string }[];
  return rows.map(r => ({
    score: 1.0,
    store: '',
    key: r.key,
    summary: r.summary || '(no summary)',
  }));
}

async function main() {
  const { limit, query } = parseArgs();
  const cfg = loadConfig();
  fs.mkdirSync(cfg.db_dir, { recursive: true });

  let embBuf: Buffer | null = null;
  if (query) {
    try {
      embBuf = await embed(query, cfg);
    } catch {
      // vector search unavailable, FTS only
    }
  }

  const all: Result[] = [];
  for (const store of cfg.store) {
    const dbPath = path.join(cfg.db_dir, `${store.name}.db`);
    const db = initDB(dbPath);
    await syncStore(db, store.dir, cfg);

    const results = query
      ? search(db, query, embBuf, limit)
      : newest(db, limit);

    for (const r of results) r.store = store.name;
    all.push(...results);
    db.close();
  }

  all.sort((a, b) => b.score - a.score);
  for (const r of all.slice(0, limit)) {
    console.log(`${r.score.toFixed(2)}  ${r.store}  ${r.key}`);
    console.log(`  ${r.summary}`);
    console.log();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
