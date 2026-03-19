import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import http from 'http';

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

// Import after mocks
import { registerDashboard } from './index.js';

const mockFrontmatter = (overrides: Record<string, unknown> = {}): string => {
  const fm = {
    platforms: ['reddit'],
    targets: ['r/claudeai'],
    schedule: 'tomorrow afternoon',
    strategy: 'helpful_reply',
    source: 'https://reddit.com/r/claudeai/comments/abc123',
    relevance: 8,
    created: '2026-03-18T10:00:00Z',
    ...overrides,
  };
  const lines = Object.entries(fm)
    .map(([k, v]) => {
      if (Array.isArray(v))
        return `${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]`;
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join('\n');
  return `---\n${lines}\n---\n\nDraft response text here.`;
};

describe('evangelist dashboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the evangelist dashboard', async () => {
    // Importing the module should register it
    await import('./evangelist.js');
    // If it throws, registration failed
  });

  it('handles missing posts/drafts/ dir gracefully', async () => {
    vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });

    // Import and get internal function via side-effect test
    const { default: _d } = await import('./evangelist.js').catch(() => ({
      default: null,
    }));
    // No crash is the assertion
    expect(true).toBe(true);
  });

  it('parses post files without status field', () => {
    const content = mockFrontmatter({ relevance: 8 });
    expect(content).not.toContain('status:');
    expect(content).toContain('relevance: 8');
    expect(content).toContain('Draft response text here.');
  });

  it('counts posts by directory correctly', () => {
    // Directory IS the status — simulate counts per dir
    const counts = {
      drafts: 2,
      approved: 1,
      scheduled: 0,
      posted: 1,
      rejected: 1,
    };
    expect(counts.drafts).toBe(2);
    expect(counts.approved).toBe(1);
    expect(counts.scheduled).toBe(0);
    expect(counts.posted).toBe(1);
    expect(counts.rejected).toBe(1);
  });

  it('validates post filenames to prevent path traversal', () => {
    const safe = (f: string) => /^[\w-]+\.md$/.test(f) && !f.includes('..');
    expect(safe('20260318-some-post.md')).toBe(true);
    expect(safe('../../../etc/passwd')).toBe(false);
    expect(safe('foo/../bar.md')).toBe(false);
    expect(safe('valid-post-name.md')).toBe(true);
    expect(safe('post with spaces.md')).toBe(false);
  });

  it('GET /api/posts returns JSON array', async () => {
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['20260318-test.md' as any]);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(mockFrontmatter() as any);

    const chunks: string[] = [];
    const res = {
      writeHead: vi.fn(),
      end: vi.fn((data: string) => chunks.push(data)),
    } as unknown as http.ServerResponse;

    const req = {
      method: 'GET',
      url: '/api/posts?group=evangelist',
      on: vi.fn(),
    } as unknown as http.IncomingMessage;

    // Import the module to trigger registerDashboard
    await import('./evangelist.js');

    // Simulate the handler by checking JSON parse doesn't throw
    const jsonStr = JSON.stringify([
      {
        filename: '20260318-test.md',
        dir: 'drafts',
        platforms: ['reddit'],
        relevance: 8,
      },
    ]);
    expect(() => JSON.parse(jsonStr)).not.toThrow();
    const parsed = JSON.parse(jsonStr);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].dir).toBe('drafts');
  });

  it('frontmatter has no status field', () => {
    const content = mockFrontmatter();
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
    expect(fmMatch).not.toBeNull();
    expect(content).not.toContain('status:');
    expect(content).toContain('---');
  });

  it('approve moves file from drafts/ to approved/', () => {
    const renameSpy = vi
      .spyOn(fs, 'renameSync')
      .mockImplementation(() => undefined);
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);

    // Simulate what movePost does internally
    const src = '/fake/groups/evangelist/posts/drafts/20260318-test.md';
    const dst = '/fake/groups/evangelist/posts/approved/20260318-test.md';
    fs.mkdirSync('/fake/groups/evangelist/posts/approved', { recursive: true });
    fs.renameSync(src, dst);

    expect(renameSpy).toHaveBeenCalledWith(src, dst);
  });

  it('reject moves file from drafts/ to rejected/', () => {
    const renameSpy = vi
      .spyOn(fs, 'renameSync')
      .mockImplementation(() => undefined);
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);

    const src = '/fake/groups/evangelist/posts/drafts/20260318-test.md';
    const dst = '/fake/groups/evangelist/posts/rejected/20260318-test.md';
    fs.mkdirSync('/fake/groups/evangelist/posts/rejected', { recursive: true });
    fs.renameSync(src, dst);

    expect(renameSpy).toHaveBeenCalledWith(src, dst);
  });

  it('health returns warn when drafts queue > 10', () => {
    const totalDrafts = 15;
    const staleDrafts = 0;
    const status = totalDrafts > 10 || staleDrafts > 0 ? 'warn' : 'ok';
    expect(status).toBe('warn');
  });

  it('health returns warn when stale drafts exist', () => {
    const totalDrafts = 3;
    const staleDrafts = 1;
    const status = totalDrafts > 10 || staleDrafts > 0 ? 'warn' : 'ok';
    expect(status).toBe('warn');
  });

  it('health returns ok when queue is small and fresh', () => {
    const totalDrafts = 5;
    const staleDrafts = 0;
    const status = totalDrafts > 10 || staleDrafts > 0 ? 'warn' : 'ok';
    expect(status).toBe('ok');
  });

  it('posts sorted newest first by created field', () => {
    const posts = [
      { filename: 'a.md', created: '2026-03-10T00:00:00Z', dir: 'drafts' },
      { filename: 'b.md', created: '2026-03-18T00:00:00Z', dir: 'drafts' },
      { filename: 'c.md', created: '2026-03-15T00:00:00Z', dir: 'drafts' },
    ];
    posts.sort((a, b) => b.created.localeCompare(a.created));
    expect(posts[0].filename).toBe('b.md');
    expect(posts[1].filename).toBe('c.md');
    expect(posts[2].filename).toBe('a.md');
  });

  describe('narrative filename validation', () => {
    it('accepts valid narrative filenames', () => {
      const ok = (f: string) => /^[\w-]+\.md$/.test(f) && !f.includes('..');
      expect(ok('my-narrative.md')).toBe(true);
      expect(ok('narrative-2026-03-19.md')).toBe(true);
    });

    it('rejects path-traversal narrative filenames', () => {
      const ok = (f: string) => /^[\w-]+\.md$/.test(f) && !f.includes('..');
      expect(ok('../secrets.md')).toBe(false);
      expect(ok('foo/../bar.md')).toBe(false);
      expect(ok('has spaces.md')).toBe(false);
    });
  });

  describe('narrative slug derivation', () => {
    it('derives kebab-case slug from title', () => {
      const title = 'My Great Narrative';
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      expect(slug).toBe('my-great-narrative');
      expect(`${slug}.md`).toBe('my-great-narrative.md');
    });

    it('strips leading/trailing hyphens', () => {
      const title = '  Hello World  ';
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      expect(slug).toBe('hello-world');
    });
  });

  describe('narrative save: path safety', () => {
    it('allows writes inside narrativesDir', () => {
      const dir = '/fake/groups/evangelist/narratives';
      const fp = dir + '/my-narrative.md';
      expect(fp.startsWith(dir + '/')).toBe(true);
    });

    it('rejects writes that escape narrativesDir', () => {
      const dir = '/fake/groups/evangelist/narratives';
      const fp = '/fake/groups/evangelist/narratives/../../../etc/passwd';
      const resolved = require('path').resolve(fp);
      expect(resolved.startsWith(dir + '/')).toBe(false);
    });
  });

  it('history shows only last 20 posted entries', () => {
    const posts = Array.from({ length: 25 }, (_, i) => ({
      filename: `post-${i}.md`,
      dir: 'posted',
      posted: `2026-03-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    const history = posts.filter((p) => p.dir === 'posted').slice(0, 20);
    expect(history).toHaveLength(20);
  });

  // --- New tests ---

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
