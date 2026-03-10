import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';

import {
  Action,
  registerAction,
  getAction,
  getAllActions,
  getManifest,
  unregisterAction,
} from './action-registry.js';

function makeAction(name: string, opts?: Partial<Action>): Action {
  return {
    name,
    description: `test action ${name}`,
    input: z.object({ text: z.string() }),
    handler: async () => ({ done: true }),
    ...opts,
  };
}

// Registry is global state shared across tests. Use unique names.
let seq = 0;
function uid(): string {
  return `test_action_${++seq}_${Date.now()}`;
}

describe('registerAction + getAction', () => {
  it('roundtrips a registered action', () => {
    const name = uid();
    const a = makeAction(name);
    registerAction(a);
    expect(getAction(name)).toBe(a);
  });

  it('returns undefined for unknown action', () => {
    expect(getAction('nonexistent_action_xyz')).toBeUndefined();
  });

  it('overwrites existing action with same name', () => {
    const name = uid();
    const a1 = makeAction(name, { description: 'first' });
    const a2 = makeAction(name, { description: 'second' });
    registerAction(a1);
    registerAction(a2);
    expect(getAction(name)!.description).toBe('second');
  });
});

describe('getAllActions', () => {
  it('returns all registered actions', () => {
    const name = uid();
    registerAction(makeAction(name));
    const all = getAllActions();
    expect(all.find((a) => a.name === name)).toBeDefined();
  });
});

describe('getManifest', () => {
  it('includes actions with mcp unset or true', () => {
    const n1 = uid();
    const n2 = uid();
    registerAction(makeAction(n1));
    registerAction(makeAction(n2, { mcp: true }));
    const manifest = getManifest('root', { tier: 0, platforms: [] });
    expect(manifest.find((m) => m.name === n1)).toBeDefined();
    expect(manifest.find((m) => m.name === n2)).toBeDefined();
  });

  it('excludes actions with mcp: false', () => {
    const name = uid();
    registerAction(makeAction(name, { mcp: false }));
    const manifest = getManifest('root', { tier: 0, platforms: [] });
    expect(manifest.find((m) => m.name === name)).toBeUndefined();
  });

  it('returns JSON schema for input', () => {
    const name = uid();
    registerAction(makeAction(name));
    const manifest = getManifest('root', { tier: 0, platforms: [] });
    const entry = manifest.find((m) => m.name === name)!;
    expect(entry.input).toBeDefined();
    expect(entry.description).toBe(`test action ${name}`);
    // z.toJSONSchema produces an object with type/properties
    const schema = entry.input as Record<string, unknown>;
    expect(schema.type).toBe('object');
  });
});

describe('platform filtering', () => {
  it('action with matching platform appears', () => {
    const name = uid();
    registerAction(makeAction(name, { platforms: ['reddit'] }));
    const manifest = getManifest('root', { tier: 0, platforms: ['reddit'] });
    expect(manifest.find((m) => m.name === name)).toBeDefined();
  });

  it('action with non-matching platform is excluded', () => {
    const name = uid();
    registerAction(makeAction(name, { platforms: ['reddit'] }));
    const manifest = getManifest('root', { tier: 0, platforms: ['mastodon'] });
    expect(manifest.find((m) => m.name === name)).toBeUndefined();
  });

  it('action with no platforms field always appears', () => {
    const name = uid();
    registerAction(makeAction(name));
    const manifest = getManifest('root', {
      tier: 0,
      platforms: ['mastodon'],
    });
    expect(manifest.find((m) => m.name === name)).toBeDefined();
  });

  it('action with empty platforms array always appears', () => {
    const name = uid();
    registerAction(makeAction(name, { platforms: [] }));
    const manifest = getManifest('root', {
      tier: 0,
      platforms: ['mastodon'],
    });
    expect(manifest.find((m) => m.name === name)).toBeDefined();
  });

  it('multi-platform action matches any platform in list', () => {
    const name = uid();
    registerAction(makeAction(name, { platforms: ['reddit', 'twitter'] }));
    const manifest = getManifest('root', { tier: 0, platforms: ['twitter'] });
    expect(manifest.find((m) => m.name === name)).toBeDefined();
  });
});
