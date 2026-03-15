import fs from 'fs';
import path from 'path';

import { parse as parseYaml } from 'yaml';

import { GROUPS_DIR } from './config.js';
import { logger } from './logger.js';
import { escapeXml } from './router.js';

interface DiaryEntry {
  date: string;
  summary: string;
}

function ageLabel(date: string, now: Date): string {
  // Calendar-day diff: avoid sub-24h bugs by comparing date-only strings
  const todayStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const days = Math.round(
    (new Date(todayStr + 'T00:00:00').getTime() -
      new Date(date + 'T00:00:00').getTime()) /
      86_400_000,
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  const weeks = Math.floor(days / 7);
  return `${weeks} weeks ago`;
}

function parseFrontmatter(content: string): string | null {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  try {
    const fm = parseYaml(m[1]);
    if (fm && typeof fm.summary === 'string') return fm.summary.trim();
  } catch {}
  return null;
}

export function readDiaryEntries(groupFolder: string, max = 14): DiaryEntry[] {
  const diaryDir = path.join(GROUPS_DIR, groupFolder, 'diary');
  if (!fs.existsSync(diaryDir)) return [];

  const files = fs
    .readdirSync(diaryDir)
    .filter((f) => /^\d{8}\.md$/.test(f))
    .sort()
    .reverse()
    .slice(0, max);

  const entries: DiaryEntry[] = [];
  for (const f of files) {
    const date = `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`;
    try {
      const content = fs.readFileSync(path.join(diaryDir, f), 'utf-8');
      const summary = parseFrontmatter(content);
      if (summary) entries.push({ date, summary });
    } catch (err) {
      logger.debug({ file: f, err }, 'diary read failed');
    }
  }
  return entries;
}

export function writeRecoveryEntry(
  groupFolder: string,
  reason: string,
  error?: string,
): void {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');

  const diaryDir = path.join(GROUPS_DIR, groupFolder, 'diary');
  fs.mkdirSync(diaryDir, { recursive: true });

  const file = path.join(diaryDir, `${y}${m}${d}.md`);
  const exists = fs.existsSync(file);

  const entry =
    (exists ? '\n' : `---\nsummary: "session ended: ${reason}"\n---\n`) +
    `## Recovery (${hh}:${mm})\n` +
    `Reason: ${reason}\n` +
    `Error: ${error || 'none'}\n`;

  fs.appendFileSync(file, entry);
  logger.info({ groupFolder, reason }, 'wrote recovery diary entry');
}

export function formatDiaryXml(entries: DiaryEntry[]): string {
  if (entries.length === 0) return '';
  const now = new Date();
  const lines = entries.map(
    (e) =>
      `  <entry key="${e.date.replace(/-/g, '')}" age="${ageLabel(e.date, now)}">${escapeXml(e.summary)}</entry>`,
  );
  return `<diary count="${entries.length}">\n${lines.join('\n')}\n</diary>`;
}
