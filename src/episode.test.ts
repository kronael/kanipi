import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('./config.js', () => ({
  GROUPS_DIR: '/tmp/test-groups',
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn() },
}));

import { readEpisodeEntries, formatEpisodeXml } from './episode.js';

describe('episode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('readEpisodeEntries', () => {
    it('returns empty when episodes/ dir does not exist', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      expect(readEpisodeEntries('root')).toEqual([]);
    });

    it('returns most recent day/week/month', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([
        '20260310.md' as any,
        '20260311.md' as any,
        '2026-W11.md' as any,
        '2026-W12.md' as any,
        '2026-02.md' as any,
        '2026-03.md' as any,
      ]);
      vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
        const s = String(p);
        if (s.includes('20260311')) return '---\nsummary: latest day\n---\n';
        if (s.includes('2026-W12')) return '---\nsummary: latest week\n---\n';
        if (s.includes('2026-03')) return '---\nsummary: latest month\n---\n';
        return '---\nsummary: older\n---\n';
      });

      const entries = readEpisodeEntries('root');
      expect(entries).toHaveLength(3);
      expect(entries[0]).toEqual({
        key: '20260311',
        type: 'day',
        summary: 'latest day',
      });
      expect(entries[1]).toEqual({
        key: '2026-W12',
        type: 'week',
        summary: 'latest week',
      });
      expect(entries[2]).toEqual({
        key: '2026-03',
        type: 'month',
        summary: 'latest month',
      });
    });

    it('skips files with missing summary in frontmatter', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['20260310.md' as any]);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(
        '---\ntitle: no summary here\n---\nbody',
      );

      expect(readEpisodeEntries('root')).toEqual([]);
    });

    it('ignores non-matching filenames', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([
        'notes.md' as any,
        'README.md' as any,
        '2026.md' as any,
        '20260310.md' as any,
      ]);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(
        '---\nsummary: valid\n---\n',
      );

      const entries = readEpisodeEntries('root');
      expect(entries).toHaveLength(1);
      expect(entries[0].key).toBe('20260310');
    });

    it('picks most recent of each type when multiple exist', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([
        '20260308.md' as any,
        '20260309.md' as any,
        '20260310.md' as any,
      ]);
      vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
        const s = String(p);
        if (s.includes('20260310')) return '---\nsummary: march 10\n---\n';
        if (s.includes('20260309')) return '---\nsummary: march 9\n---\n';
        return '---\nsummary: march 8\n---\n';
      });

      const entries = readEpisodeEntries('root');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual({
        key: '20260310',
        type: 'day',
        summary: 'march 10',
      });
    });

    it('uses frontmatter type override when present', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['20260310.md' as any]);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(
        '---\nsummary: entry\ntype: custom\n---\n',
      );

      const entries = readEpisodeEntries('root');
      expect(entries[0].type).toBe('custom');
    });

    it('handles read errors gracefully', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['20260310.md' as any]);
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('permission denied');
      });

      expect(readEpisodeEntries('root')).toEqual([]);
    });
  });

  describe('formatEpisodeXml', () => {
    it('returns empty string for no entries', () => {
      expect(formatEpisodeXml([])).toBe('');
    });

    it('produces correct XML with key and type attributes', () => {
      const xml = formatEpisodeXml([
        { key: '20260310', type: 'day', summary: 'shipped v2' },
        { key: '2026-W11', type: 'week', summary: 'week work' },
      ]);
      expect(xml).toContain('<episodes count="2">');
      expect(xml).toContain('key="20260310"');
      expect(xml).toContain('type="day"');
      expect(xml).toContain('shipped v2');
      expect(xml).toContain('key="2026-W11"');
      expect(xml).toContain('type="week"');
      expect(xml).toContain('week work');
      expect(xml).toContain('</episodes>');
    });
  });
});
