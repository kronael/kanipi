import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('../config.js', () => ({
  CONTAINER_IMAGE: 'kanipi-agent:latest',
  MAX_CONCURRENT_CONTAINERS: 5,
  GROUPS_DIR: '/fake/groups',
}));

vi.mock('../db.js', () => ({
  getAllGroupConfigs: vi.fn(() => ({})),
  getAllChats: vi.fn(() => []),
  getAllTasks: vi.fn(() => []),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
}));

describe('evangelist dashboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('validates post filenames to prevent path traversal', () => {
    const safe = (f: string) => /^[\w-]+\.md$/.test(f) && !f.includes('..');
    expect(safe('20260318-some-post.md')).toBe(true);
    expect(safe('../../../etc/passwd')).toBe(false);
    expect(safe('foo/../bar.md')).toBe(false);
    expect(safe('valid-post-name.md')).toBe(true);
    expect(safe('post with spaces.md')).toBe(false);
  });

  describe('findEvangelistGroups', () => {
    it('finds groups with .evangelist marker', async () => {
      const { findEvangelistGroups } = await import('./evangelist.js');

      vi.spyOn(fs, 'readdirSync').mockImplementation((p: any) => {
        if (p === '/fake/groups') return ['atlas', 'other'] as any;
        if (p === '/fake/groups/atlas') return ['evangelist'] as any;
        if (p === '/fake/groups/atlas/evangelist') return [] as any;
        if (p === '/fake/groups/other') return [] as any;
        return [] as any;
      });
      vi.spyOn(fs, 'statSync').mockImplementation((p: any) => {
        const dirs = [
          '/fake/groups/atlas',
          '/fake/groups/atlas/evangelist',
          '/fake/groups/other',
        ];
        return { isDirectory: () => dirs.includes(String(p)) } as any;
      });
      vi.spyOn(fs, 'existsSync').mockImplementation((p: any) => {
        return String(p) === '/fake/groups/atlas/evangelist/.evangelist';
      });

      const groups = findEvangelistGroups('/fake/groups');
      expect(groups).toHaveLength(1);
      expect(groups[0].folder).toBe('atlas/evangelist');
      expect(groups[0].dir).toBe('/fake/groups/atlas/evangelist');
    });

    it('ignores groups without .evangelist marker', async () => {
      const { findEvangelistGroups } = await import('./evangelist.js');

      vi.spyOn(fs, 'readdirSync').mockImplementation((p: any) => {
        if (p === '/fake/groups') return ['nomark'] as any;
        if (p === '/fake/groups/nomark') return [] as any;
        return [] as any;
      });
      vi.spyOn(fs, 'statSync').mockImplementation((p: any) => {
        return {
          isDirectory: () => String(p) === '/fake/groups/nomark',
        } as any;
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const groups = findEvangelistGroups('/fake/groups');
      expect(groups).toHaveLength(0);
    });
  });

  describe('isTweetMode', () => {
    it('detects tweet mode for twitter-only platforms', async () => {
      const { isTweetMode } = await import('./evangelist.js');
      const post = {
        filename: 'a.md',
        dir: 'drafts' as const,
        platforms: ['twitter'],
        targets: [],
        schedule: '',
        strategy: '',
        source: '',
        relevance: 5,
        created: '',
        posted: null,
        body: 'x'.repeat(400),
        content_id: '',
      };
      expect(isTweetMode(post)).toBe(true);
    });

    it('detects tweet mode for short content', async () => {
      const { isTweetMode } = await import('./evangelist.js');
      const post = {
        filename: 'a.md',
        dir: 'drafts' as const,
        platforms: ['reddit'],
        targets: [],
        schedule: '',
        strategy: '',
        source: '',
        relevance: 5,
        created: '',
        posted: null,
        body: 'short content',
        content_id: '',
      };
      expect(isTweetMode(post)).toBe(true);
    });

    it('uses post mode for long non-twitter content', async () => {
      const { isTweetMode } = await import('./evangelist.js');
      const post = {
        filename: 'a.md',
        dir: 'drafts' as const,
        platforms: ['reddit'],
        targets: [],
        schedule: '',
        strategy: '',
        source: '',
        relevance: 5,
        created: '',
        posted: null,
        body: 'x'.repeat(400),
        content_id: '',
      };
      expect(isTweetMode(post)).toBe(false);
    });
  });

  describe('groupByScheduleDate', () => {
    it('groups posts by ISO date from schedule field', async () => {
      const { groupByScheduleDate } = await import('./evangelist.js');
      const posts = [
        { schedule: '2026-03-20T10:00:00Z', filename: 'a.md' },
        { schedule: '2026-03-21T09:00:00Z', filename: 'b.md' },
        { schedule: '2026-03-20T15:00:00Z', filename: 'c.md' },
      ] as any[];

      const grouped = groupByScheduleDate(posts);
      expect(grouped.has('2026-03-20')).toBe(true);
      expect(grouped.has('2026-03-21')).toBe(true);
      expect(grouped.get('2026-03-20')).toHaveLength(2);
      expect(grouped.get('2026-03-21')).toHaveLength(1);
    });

    it('groups natural-language schedule under Unscheduled', async () => {
      const { groupByScheduleDate } = await import('./evangelist.js');
      const posts = [
        { schedule: 'tomorrow afternoon', filename: 'a.md' },
        { schedule: 'peak hours', filename: 'b.md' },
      ] as any[];

      const grouped = groupByScheduleDate(posts);
      expect(grouped.has('Unscheduled')).toBe(true);
      expect(grouped.get('Unscheduled')).toHaveLength(2);
    });

    it('sorts dated entries chronologically before Unscheduled', async () => {
      const { groupByScheduleDate } = await import('./evangelist.js');
      const posts = [
        { schedule: 'peak hours', filename: 'natural.md' },
        { schedule: '2026-03-22', filename: 'dated.md' },
      ] as any[];

      const grouped = groupByScheduleDate(posts);
      const keys = [...grouped.keys()];
      expect(keys[0]).toBe('2026-03-22');
      expect(keys[1]).toBe('Unscheduled');
    });
  });
});
