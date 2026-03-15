import fs from 'fs';
import path from 'path';

import { parse as parseYaml } from 'yaml';

import { GROUPS_DIR } from './config.js';
import { logger } from './logger.js';

interface EpisodeEntry {
  key: string;
  type: string;
  summary: string;
}

const PATTERNS: [RegExp, string][] = [
  [/^\d{8}\.md$/, 'day'],
  [/^\d{4}-W\d{2}\.md$/, 'week'],
  [/^\d{4}-\d{2}\.md$/, 'month'],
];

function classifyFile(name: string): { key: string; type: string } | null {
  for (const [re, type] of PATTERNS) {
    if (re.test(name)) return { key: name.replace(/\.md$/, ''), type };
  }
  return null;
}

function parseFrontmatter(content: string): {
  summary?: string;
  type?: string;
} {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  try {
    const fm = parseYaml(m[1]);
    return {
      summary: typeof fm?.summary === 'string' ? fm.summary.trim() : undefined,
      type: typeof fm?.type === 'string' ? fm.type : undefined,
    };
  } catch {
    return {};
  }
}

export function readEpisodeEntries(groupFolder: string): EpisodeEntry[] {
  const dir = path.join(GROUPS_DIR, groupFolder, 'episodes');
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));

  const byType: Record<string, { key: string; type: string; file: string }[]> =
    {};
  for (const f of files) {
    const cls = classifyFile(f);
    if (!cls) continue;
    (byType[cls.type] ??= []).push({ ...cls, file: f });
  }

  const entries: EpisodeEntry[] = [];
  for (const type of ['day', 'week', 'month']) {
    const group = byType[type];
    if (!group) continue;
    group.sort((a, b) => b.key.localeCompare(a.key));
    const best = group[0];
    try {
      const content = fs.readFileSync(path.join(dir, best.file), 'utf-8');
      const fm = parseFrontmatter(content);
      if (fm.summary) {
        entries.push({
          key: best.key,
          type: fm.type || best.type,
          summary: fm.summary,
        });
      }
    } catch (err) {
      logger.debug({ file: best.file, err }, 'episode read failed');
    }
  }
  return entries;
}

export function formatEpisodeXml(entries: EpisodeEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map(
    (e) => `  <entry key="${e.key}" type="${e.type}">${e.summary}</entry>`,
  );
  return `<episodes count="${entries.length}">\n${lines.join('\n')}\n</episodes>`;
}
