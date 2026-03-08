import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('./config.js', () => ({
  GROUPS_DIR: '/tmp/test-groups',
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn() },
}));

import { readDiaryEntries, formatDiaryXml } from './diary.js';

describe('diary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('readDiaryEntries', () => {
    it('returns empty when diary dir does not exist', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      expect(readDiaryEntries('main')).toEqual([]);
    });

    it('reads entries with YAML frontmatter summaries', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([
        '20260307.md' as any,
        '20260308.md' as any,
      ]);
      vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
        if (String(p).includes('20260308'))
          return '---\nsummary: did stuff\n---\nbody';
        return '---\nsummary: earlier work\n---\nbody';
      });

      const entries = readDiaryEntries('main', 5);
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        date: '2026-03-08',
        summary: 'did stuff',
      });
      expect(entries[1]).toEqual({
        date: '2026-03-07',
        summary: 'earlier work',
      });
    });

    it('skips entries without frontmatter summary', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['20260308.md' as any]);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('no frontmatter here');

      expect(readDiaryEntries('main')).toEqual([]);
    });

    it('limits to max entries (default 2)', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([
        '20260306.md' as any,
        '20260307.md' as any,
        '20260308.md' as any,
      ]);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('---\nsummary: work\n---\n');

      const entries = readDiaryEntries('main');
      expect(entries).toHaveLength(2);
      expect(entries[0].date).toBe('2026-03-08');
      expect(entries[1].date).toBe('2026-03-07');
    });

    it('ignores non-diary files', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([
        'notes.md' as any,
        'README.md' as any,
        '20260308.md' as any,
      ]);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('---\nsummary: work\n---\n');

      expect(readDiaryEntries('main')).toHaveLength(1);
    });

    it('handles read errors gracefully', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['20260308.md' as any]);
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('permission denied');
      });

      expect(readDiaryEntries('main')).toEqual([]);
    });
  });

  describe('formatDiaryXml', () => {
    it('returns empty string for no entries', () => {
      expect(formatDiaryXml([])).toBe('');
    });

    it('formats entries as XML knowledge block', () => {
      const xml = formatDiaryXml([
        { date: '2026-03-08', summary: 'shipped v1.0.15' },
      ]);
      expect(xml).toContain('<knowledge layer="diary" count="1">');
      expect(xml).toContain('key="20260308"');
      expect(xml).toContain('shipped v1.0.15');
      expect(xml).toContain('</knowledge>');
    });

    it('includes age label', () => {
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, '0');
      const d = String(today.getDate()).padStart(2, '0');
      const xml = formatDiaryXml([
        { date: `${y}-${m}-${d}`, summary: 'today work' },
      ]);
      expect(xml).toContain('age="today"');
    });
  });
});
