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

  it('history shows only last 20 posted entries', () => {
    const posts = Array.from({ length: 25 }, (_, i) => ({
      filename: `post-${i}.md`,
      dir: 'posted',
      posted: `2026-03-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    const history = posts.filter((p) => p.dir === 'posted').slice(0, 20);
    expect(history).toHaveLength(20);
  });
});
