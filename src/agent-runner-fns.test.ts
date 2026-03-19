import { describe, it, expect } from 'vitest';

// These functions are copied from container/agent-runner/src/index.ts
// for unit testing. The agent-runner has no vitest setup.

function extractStatusBlocks(text: string): {
  cleaned: string;
  statuses: string[];
} {
  const statuses: string[] = [];
  const cleaned = text.replace(
    /<status>([\s\S]*?)<\/status>/g,
    (_match, content) => {
      const trimmed = (content as string).trim();
      if (trimmed) statuses.push(trimmed);
      return '';
    },
  );
  return { cleaned: cleaned.trim(), statuses };
}

function stripThinkBlocks(text: string): string {
  let result = '';
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('<think>', i)) {
      depth++;
      i += 7;
    } else if (text.startsWith('</think>', i) && depth > 0) {
      depth--;
      i += 8;
    } else if (depth === 0) {
      result += text[i];
      i++;
    } else {
      i++;
    }
  }
  return result.trim();
}

// --- stripThinkBlocks ---

describe('stripThinkBlocks', () => {
  it('strips a simple think block', () => {
    expect(stripThinkBlocks('before<think>hidden</think>after')).toBe(
      'beforeafter',
    );
  });

  it('strips nested think blocks', () => {
    expect(
      stripThinkBlocks('a<think>outer<think>inner</think>still outer</think>b'),
    ).toBe('ab');
  });

  it('strips unclosed think block (hides everything after)', () => {
    expect(stripThinkBlocks('visible<think>hidden forever')).toBe('visible');
  });

  it('strips multiple think blocks', () => {
    expect(stripThinkBlocks('a<think>x</think>b<think>y</think>c')).toBe('abc');
  });

  it('handles mixed think and status blocks', () => {
    const input = '<think>reasoning</think><status>working</status>The answer.';
    expect(stripThinkBlocks(input)).toBe('<status>working</status>The answer.');
  });

  it('returns text unchanged when no think blocks', () => {
    expect(stripThinkBlocks('just plain text')).toBe('just plain text');
  });
});

// --- extractStatusBlocks ---

describe('extractStatusBlocks', () => {
  it('extracts a single status block', () => {
    const r = extractStatusBlocks('before<status>loading</status>after');
    expect(r.statuses).toEqual(['loading']);
    expect(r.cleaned).toBe('beforeafter');
  });

  it('extracts multiple status blocks', () => {
    const r = extractStatusBlocks(
      '<status>step 1</status>mid<status>step 2</status>end',
    );
    expect(r.statuses).toEqual(['step 1', 'step 2']);
    expect(r.cleaned).toBe('midend');
  });

  it('filters out empty status blocks', () => {
    const r = extractStatusBlocks('<status></status>text');
    expect(r.statuses).toEqual([]);
    expect(r.cleaned).toBe('text');
  });

  it('filters out whitespace-only status blocks', () => {
    const r = extractStatusBlocks('<status>   </status>text');
    expect(r.statuses).toEqual([]);
    expect(r.cleaned).toBe('text');
  });

  it('handles multiline status content', () => {
    const r = extractStatusBlocks('<status>line1\nline2</status>done');
    expect(r.statuses).toEqual(['line1\nline2']);
    expect(r.cleaned).toBe('done');
  });

  it('handles unclosed status block (no extraction)', () => {
    const r = extractStatusBlocks('text<status>unclosed');
    // regex won't match unclosed, so nothing extracted
    expect(r.statuses).toEqual([]);
    expect(r.cleaned).toBe('text<status>unclosed');
  });
});
