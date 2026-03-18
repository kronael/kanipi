import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('../config.js', () => ({
  CONTAINER_IMAGE: 'kanipi-agent:latest',
  MAX_CONCURRENT_CONTAINERS: 5,
  GROUPS_DIR: '/fake/groups',
}));

vi.mock('../db.js', () => ({
  getAllGroupConfigs: vi.fn(),
  getAllChats: vi.fn(() => []),
  getAllTasks: vi.fn(() => []),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
}));

import { readMemoryState } from './index.js';
import { getAllGroupConfigs } from '../db.js';

const mockGetAllGroupConfigs = getAllGroupConfigs as ReturnType<typeof vi.fn>;

describe('memory dashboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty state when no groups exist', () => {
    mockGetAllGroupConfigs.mockReturnValue({});
    const state = readMemoryState();
    expect(state.facts).toEqual([]);
    expect(state.episodes).toEqual([]);
    expect(state.memories).toEqual([]);
  });

  it('reads facts from facts/ dir', () => {
    mockGetAllGroupConfigs.mockReturnValue({
      root: { folder: 'root', name: 'Root', added_at: '' },
    });
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      const s = String(p);
      return s.includes('facts') || s.includes('MEMORY');
    });
    vi.spyOn(fs, 'readdirSync').mockImplementation((p) => {
      if (String(p).includes('facts')) return ['solana-fees.md' as any];
      return [];
    });
    vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
      const s = String(p);
      if (s.includes('solana-fees')) {
        return [
          '---',
          'verified_at: 2026-03-10T12:00:00Z',
          'question: What are Solana fees?',
          'answer: Very low, ~0.000005 SOL per tx',
          '---',
          'Full content here.',
        ].join('\n');
      }
      if (s.includes('MEMORY')) return '# prefs\n- likes concise replies';
      return '';
    });

    const state = readMemoryState();
    expect(state.facts).toHaveLength(1);
    expect(state.facts[0].group).toBe('Root');
    expect(state.facts[0].filename).toBe('solana-fees.md');
    expect(state.facts[0].verified_at).toBe('2026-03-10T12:00:00Z');
    expect(state.facts[0].question).toBe('What are Solana fees?');
    expect(state.facts[0].answer).toContain('Very low');
  });

  it('reads episodes from episodes/ dir', () => {
    mockGetAllGroupConfigs.mockReturnValue({
      root: { folder: 'root', name: 'Root', added_at: '' },
    });
    vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
      String(p).includes('episodes'),
    );
    vi.spyOn(fs, 'readdirSync').mockReturnValue([
      '20260310.md' as any,
      '2026-W11.md' as any,
    ]);
    vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
      const s = String(p);
      if (s.includes('20260310'))
        return '---\nsummary: shipped memory dashboard\n---\n';
      if (s.includes('2026-W11'))
        return '---\nsummary: week of good work\n---\n';
      return '';
    });

    const state = readMemoryState();
    expect(state.episodes).toHaveLength(2);
    const day = state.episodes.find((e) => e.type === 'day');
    expect(day?.key).toBe('20260310');
    expect(day?.summary).toBe('shipped memory dashboard');
    const week = state.episodes.find((e) => e.type === 'week');
    expect(week?.summary).toBe('week of good work');
  });

  it('reads MEMORY.md content', () => {
    mockGetAllGroupConfigs.mockReturnValue({
      atlas: { folder: 'atlas', name: 'Atlas', added_at: '' },
    });
    vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
      String(p).includes('MEMORY'),
    );
    vi.spyOn(fs, 'readdirSync').mockReturnValue([]);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      '# Atlas Memory\n- key fact here',
    );

    const state = readMemoryState();
    expect(state.memories).toHaveLength(1);
    expect(state.memories[0].group).toBe('Atlas');
    expect(state.memories[0].content).toContain('key fact here');
  });

  it('handles missing dirs gracefully', () => {
    mockGetAllGroupConfigs.mockReturnValue({
      root: { folder: 'root', name: 'Root', added_at: '' },
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const state = readMemoryState();
    expect(state.facts).toEqual([]);
    expect(state.episodes).toEqual([]);
    expect(state.memories).toEqual([]);
  });

  it('sorts facts by verified_at descending', () => {
    mockGetAllGroupConfigs.mockReturnValue({
      root: { folder: 'root', name: 'Root', added_at: '' },
    });
    vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
      String(p).includes('facts'),
    );
    vi.spyOn(fs, 'readdirSync').mockReturnValue([
      'older.md' as any,
      'newer.md' as any,
    ]);
    vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
      const s = String(p);
      if (s.includes('older'))
        return '---\nverified_at: 2026-01-01T00:00:00Z\nquestion: old\nanswer: old answer\n---\n';
      if (s.includes('newer'))
        return '---\nverified_at: 2026-03-15T00:00:00Z\nquestion: new\nanswer: new answer\n---\n';
      return '';
    });

    const state = readMemoryState();
    expect(state.facts[0].verified_at).toBe('2026-03-15T00:00:00Z');
    expect(state.facts[1].verified_at).toBe('2026-01-01T00:00:00Z');
  });
});
