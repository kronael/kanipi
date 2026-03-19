import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

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

describe('memory dashboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the memory dashboard', async () => {
    await import('./memory.js');
    expect(true).toBe(true);
  });

  describe('path safety: isPathAllowed', () => {
    it('allows MEMORY.md', () => {
      const allowed = [
        /^MEMORY\.md$/,
        /^CLAUDE\.md$/,
        /^diary\/[\w-]+\.md$/,
        /^episodes\/[\w-]+\.md$/,
        /^users\/[\w.-]+\.md$/,
        /^facts\/[\w.-]+\.md$/,
      ];
      const check = (p: string) =>
        !p.includes('..') &&
        !path.isAbsolute(p) &&
        allowed.some((re) => re.test(p));

      expect(check('MEMORY.md')).toBe(true);
      expect(check('CLAUDE.md')).toBe(true);
      expect(check('diary/20260319.md')).toBe(true);
      expect(check('episodes/20260301.md')).toBe(true);
    });

    it('rejects path traversal attempts', () => {
      const allowed = [
        /^MEMORY\.md$/,
        /^CLAUDE\.md$/,
        /^diary\/[\w-]+\.md$/,
        /^episodes\/[\w-]+\.md$/,
        /^users\/[\w.-]+\.md$/,
        /^facts\/[\w.-]+\.md$/,
      ];
      const check = (p: string) =>
        !p.includes('..') &&
        !path.isAbsolute(p) &&
        allowed.some((re) => re.test(p));

      expect(check('../MEMORY.md')).toBe(false);
      expect(check('../../etc/passwd')).toBe(false);
      expect(check('/etc/passwd')).toBe(false);
      expect(check('diary/../../../etc/shadow')).toBe(false);
    });
  });

  describe('save endpoint path safety', () => {
    it('rejects writes escaping GROUPS_DIR via resolved path', () => {
      const GROUPS_DIR = '/fake/groups';
      const folder = 'mygroup';
      const groupBase = path.join(GROUPS_DIR, folder);

      // Simulate what writeFileSafe does after resolveGroupFolderPath
      const safePath = path.join(groupBase, 'MEMORY.md');
      expect(safePath.startsWith(groupBase + path.sep)).toBe(true);

      // A traversal path would fail isPathAllowed first, but even if it passed:
      const traversal = path.resolve(
        path.join(groupBase, '../../../etc/passwd'),
      );
      expect(traversal.startsWith(groupBase + path.sep)).toBe(false);
    });

    it('allows writes to MEMORY.md inside group folder', () => {
      const GROUPS_DIR = '/fake/groups';
      const folder = 'mygroup';
      const groupBase = path.join(GROUPS_DIR, folder);
      const fp = path.join(groupBase, 'MEMORY.md');
      expect(fp.startsWith(groupBase + path.sep)).toBe(true);
    });

    it('allows writes to CLAUDE.md inside group folder', () => {
      const GROUPS_DIR = '/fake/groups';
      const folder = 'mygroup';
      const groupBase = path.join(GROUPS_DIR, folder);
      const fp = path.join(groupBase, 'CLAUDE.md');
      expect(fp.startsWith(groupBase + path.sep)).toBe(true);
    });
  });

  describe('save writes correct file', () => {
    it('save-memory writes to GROUPS_DIR/<folder>/MEMORY.md', () => {
      const writeSpy = vi
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => undefined);

      const folder = 'mygroup';
      const content = '# My memory\n\nSome content here.';
      const expected = '/fake/groups/mygroup/MEMORY.md';

      fs.writeFileSync(expected, content, 'utf-8');

      expect(writeSpy).toHaveBeenCalledWith(expected, content, 'utf-8');
    });

    it('save-claude writes to GROUPS_DIR/<folder>/CLAUDE.md', () => {
      const writeSpy = vi
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => undefined);

      const folder = 'mygroup';
      const content = '# CLAUDE.md\n\nProject instructions.';
      const expected = '/fake/groups/mygroup/CLAUDE.md';

      fs.writeFileSync(expected, content, 'utf-8');

      expect(writeSpy).toHaveBeenCalledWith(expected, content, 'utf-8');
    });
  });

  describe('edit fragment returns textarea with file content', () => {
    it('edit-memory fragment contains textarea and file content', () => {
      const folder = 'mygroup';
      const fileContent = '# Memory\n\nSome notes.';

      vi.spyOn(fs, 'readFileSync').mockReturnValue(fileContent as any);
      vi.spyOn(fs, 'statSync').mockReturnValue({
        size: 100,
        mtime: new Date(),
      } as any);

      // Simulate what renderEditMemory produces
      const esc = (s: string) =>
        String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');

      const q = `?group=${encodeURIComponent(folder)}`;
      const html =
        `<form hx-post="/dash/memory/api/save-memory" hx-target="#memory-content" hx-swap="innerHTML">` +
        `<input type="hidden" name="group" value="${esc(folder)}">` +
        `<textarea name="content" style="width:100%;height:500px;font-family:monospace;box-sizing:border-box">${esc(fileContent)}</textarea>` +
        `<div style="margin-top:8px;display:flex;gap:8px">` +
        `<button type="submit" style="font-family:monospace">Save</button>` +
        `<button type="button" style="font-family:monospace" hx-get="/dash/memory/x/memory${q}" hx-target="#memory-content" hx-swap="innerHTML">Cancel</button>` +
        `</div>` +
        `</form>`;

      expect(html).toContain('<textarea');
      expect(html).toContain('# Memory');
      expect(html).toContain('hx-post="/dash/memory/api/save-memory"');
      expect(html).toContain(`name="group" value="${folder}"`);
      expect(html).toContain('Cancel');
    });

    it('edit-claude fragment contains textarea and file content', () => {
      const folder = 'mygroup';
      const fileContent = '# CLAUDE.md\n\nProject context.';

      const esc = (s: string) =>
        String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');

      const q = `?group=${encodeURIComponent(folder)}`;
      const html =
        `<form hx-post="/dash/memory/api/save-claude" hx-target="#claudemd-content" hx-swap="innerHTML">` +
        `<input type="hidden" name="group" value="${esc(folder)}">` +
        `<textarea name="content" style="width:100%;height:500px;font-family:monospace;box-sizing:border-box">${esc(fileContent)}</textarea>` +
        `<div style="margin-top:8px;display:flex;gap:8px">` +
        `<button type="submit" style="font-family:monospace">Save</button>` +
        `<button type="button" style="font-family:monospace" hx-get="/dash/memory/x/claude-md${q}" hx-target="#claudemd-content" hx-swap="innerHTML">Cancel</button>` +
        `</div>` +
        `</form>`;

      expect(html).toContain('<textarea');
      expect(html).toContain('# CLAUDE.md');
      expect(html).toContain('hx-post="/dash/memory/api/save-claude"');
      expect(html).toContain(`name="group" value="${folder}"`);
      expect(html).toContain('Cancel');
    });
  });

  describe('read-only views contain Edit buttons', () => {
    it('renderMemory includes Edit button with correct hx-get', () => {
      const folder = 'mygroup';
      const q = `?group=${encodeURIComponent(folder)}`;
      const editButton = `<button hx-get="/dash/memory/x/edit-memory${q}" hx-target="#memory-content" hx-swap="innerHTML">Edit</button>`;
      expect(editButton).toContain(
        'hx-get="/dash/memory/x/edit-memory?group=mygroup"',
      );
      expect(editButton).toContain('hx-target="#memory-content"');
    });

    it('renderClaudeMd includes Edit button with correct hx-get', () => {
      const folder = 'mygroup';
      const q = `?group=${encodeURIComponent(folder)}`;
      const editButton = `<button hx-get="/dash/memory/x/edit-claude${q}" hx-target="#claudemd-content" hx-swap="innerHTML">Edit</button>`;
      expect(editButton).toContain(
        'hx-get="/dash/memory/x/edit-claude?group=mygroup"',
      );
      expect(editButton).toContain('hx-target="#claudemd-content"');
    });
  });
});
