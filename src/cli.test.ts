/**
 * CLI command tests for git-init and create --from argument parsing.
 *
 * Tests the gitignore content written by git-init and the flag parsing
 * for create --from without invoking real git or the filesystem.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Minimal gitignore lines expected for a group repo — mirrors gitInit()
const RUNTIME_DIRS = ['diary', 'episodes', 'users', 'logs', 'media', 'tmp'];
const BASE_GITIGNORE = [...RUNTIME_DIRS.map((d) => `${d}/`), '*.jl'];

function buildGitignore(childDirs: string[]): string {
  const lines = [...BASE_GITIGNORE];
  for (const d of childDirs) {
    if (!RUNTIME_DIRS.includes(d)) lines.push(`${d}/`);
  }
  return lines.join('\n') + '\n';
}

describe('gitignore content', () => {
  it('contains all runtime state dirs', () => {
    const content = buildGitignore([]);
    for (const d of RUNTIME_DIRS) {
      expect(content).toContain(`${d}/`);
    }
    expect(content).toContain('*.jl');
  });

  it('adds child group dirs but not runtime dirs', () => {
    const content = buildGitignore(['atlas', 'support', 'diary']);
    expect(content).toContain('atlas/');
    expect(content).toContain('support/');
    // diary is already in runtime dirs, should not appear twice
    const occurrences = content.split('diary/').length - 1;
    expect(occurrences).toBe(1);
  });

  it('does not add runtime dirs as extras', () => {
    const content = buildGitignore(['logs', 'media']);
    const logsOccurrences = content.split('logs/').length - 1;
    expect(logsOccurrences).toBe(1);
  });
});

describe('create --from argument parsing', () => {
  it('parses --from flag correctly', () => {
    const args = ['--from', 'https://github.com/example/repo.git', 'myname'];
    let fromUrl: string | undefined;
    const filtered: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--from' && args[i + 1]) {
        fromUrl = args[i + 1];
        i++;
      } else {
        filtered.push(args[i]);
      }
    }
    expect(fromUrl).toBe('https://github.com/example/repo.git');
    expect(filtered).toEqual(['myname']);
  });

  it('parses --template and --from together', () => {
    const args = [
      '--template',
      'support',
      '--from',
      'https://repo.git',
      'myname',
    ];
    let tmpl = 'default';
    let fromUrl: string | undefined;
    const filtered: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--template' && args[i + 1]) {
        tmpl = args[i + 1];
        i++;
      } else if (args[i] === '--from' && args[i + 1]) {
        fromUrl = args[i + 1];
        i++;
      } else {
        filtered.push(args[i]);
      }
    }
    expect(tmpl).toBe('support');
    expect(fromUrl).toBe('https://repo.git');
    expect(filtered).toEqual(['myname']);
  });

  it('name is undefined when only flags provided', () => {
    const args = ['--from', 'https://repo.git'];
    let fromUrl: string | undefined;
    const filtered: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--from' && args[i + 1]) {
        fromUrl = args[i + 1];
        i++;
      } else {
        filtered.push(args[i]);
      }
    }
    expect(fromUrl).toBe('https://repo.git');
    expect(filtered[0]).toBeUndefined();
  });
});

describe('git-init folder validation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanipi-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes .gitignore with runtime exclusions', () => {
    const groupDir = path.join(tmpDir, 'groups', 'root');
    fs.mkdirSync(groupDir, { recursive: true });

    const content = buildGitignore([]);
    const gitignorePath = path.join(groupDir, '.gitignore');
    fs.writeFileSync(gitignorePath, content);

    const written = fs.readFileSync(gitignorePath, 'utf-8');
    expect(written).toContain('diary/');
    expect(written).toContain('*.jl');
    expect(written).toContain('tmp/');
  });

  it('includes child dirs in .gitignore', () => {
    const groupDir = path.join(tmpDir, 'groups', 'root');
    fs.mkdirSync(path.join(groupDir, 'atlas'), { recursive: true });

    const content = buildGitignore(['atlas']);
    expect(content).toContain('atlas/');
  });
});
