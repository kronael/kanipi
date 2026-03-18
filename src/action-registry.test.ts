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

describe('unregisterAction', () => {
  it('removes a previously registered action', () => {
    const name = uid();
    registerAction(makeAction(name));
    expect(getAction(name)).toBeDefined();
    unregisterAction(name);
    expect(getAction(name)).toBeUndefined();
  });

  it('no-op for non-existent action', () => {
    // Should not throw
    unregisterAction('nonexistent_action_xyz_' + Date.now());
  });
});

describe('grants filtering in manifest', () => {
  it('denied action excluded from manifest', () => {
    const name = uid();
    registerAction(makeAction(name));
    const manifest = getManifest('root', {
      tier: 0,
      platforms: [],
      grants: [`!${name}`],
    });
    expect(manifest.find((m) => m.name === name)).toBeUndefined();
  });

  it('allowed action included with grants field', () => {
    const name = uid();
    registerAction(makeAction(name));
    const manifest = getManifest('root', {
      tier: 0,
      platforms: [],
      grants: [name],
    });
    const entry = manifest.find((m) => m.name === name);
    expect(entry).toBeDefined();
    expect(entry!.grants).toEqual([name]);
  });

  it('wildcard grant includes all actions with grants field', () => {
    const n1 = uid();
    const n2 = uid();
    registerAction(makeAction(n1));
    registerAction(makeAction(n2));
    const manifest = getManifest('root', {
      tier: 0,
      platforms: [],
      grants: ['*'],
    });
    const e1 = manifest.find((m) => m.name === n1);
    const e2 = manifest.find((m) => m.name === n2);
    expect(e1).toBeDefined();
    expect(e2).toBeDefined();
    expect(e1!.grants).toEqual(['*']);
    expect(e2!.grants).toEqual(['*']);
  });

  it('wildcard then deny excludes specific action', () => {
    const n1 = uid();
    const n2 = uid();
    registerAction(makeAction(n1));
    registerAction(makeAction(n2));
    const manifest = getManifest('root', {
      tier: 0,
      platforms: [],
      grants: ['*', `!${n1}`],
    });
    expect(manifest.find((m) => m.name === n1)).toBeUndefined();
    expect(manifest.find((m) => m.name === n2)).toBeDefined();
  });

  it('no grants field means no grants filtering', () => {
    const name = uid();
    registerAction(makeAction(name));
    const manifest = getManifest('root', { tier: 0, platforms: [] });
    const entry = manifest.find((m) => m.name === name);
    expect(entry).toBeDefined();
    expect(entry!.grants).toBeUndefined();
  });

  it('empty grants array excludes all actions', () => {
    const name = uid();
    registerAction(makeAction(name));
    const manifest = getManifest('root', {
      tier: 0,
      platforms: [],
      grants: [],
    });
    expect(manifest.find((m) => m.name === name)).toBeUndefined();
  });

  it('glob grant matches action names', () => {
    const name = `send_test_${++seq}`;
    registerAction(makeAction(name));
    const manifest = getManifest('root', {
      tier: 0,
      platforms: [],
      grants: ['send_*'],
    });
    const entry = manifest.find((m) => m.name === name);
    expect(entry).toBeDefined();
    expect(entry!.grants).toEqual(['send_*']);
  });

  it('parameterized grant rules attached to manifest entry', () => {
    const name = uid();
    registerAction(makeAction(name));
    const manifest = getManifest('root', {
      tier: 0,
      platforms: [],
      grants: [`${name}(jid=twitter:*)`, `${name}(jid=reddit:*)`],
    });
    const entry = manifest.find((m) => m.name === name);
    expect(entry).toBeDefined();
    expect(entry!.grants).toEqual([
      `${name}(jid=twitter:*)`,
      `${name}(jid=reddit:*)`,
    ]);
  });

  it('grants interact correctly with platform filter', () => {
    const name = uid();
    registerAction(makeAction(name, { platforms: ['reddit'] }));
    // platforms don't match → excluded before grants check
    const manifest = getManifest('root', {
      tier: 0,
      platforms: ['twitter'],
      grants: ['*'],
    });
    expect(manifest.find((m) => m.name === name)).toBeUndefined();
  });

  it('mcp:false excluded even with grants allowing', () => {
    const name = uid();
    registerAction(makeAction(name, { mcp: false }));
    const manifest = getManifest('root', {
      tier: 0,
      platforms: [],
      grants: ['*'],
    });
    expect(manifest.find((m) => m.name === name)).toBeUndefined();
  });

  it('re-allowed action after deny shows only allow rules', () => {
    const name = uid();
    registerAction(makeAction(name));
    const manifest = getManifest('root', {
      tier: 0,
      platforms: [],
      grants: ['*', `!${name}`, `${name}(jid=reddit:*)`],
    });
    const entry = manifest.find((m) => m.name === name);
    expect(entry).toBeDefined();
    // matchingRules collects allow rules: '*' and the specific one
    expect(entry!.grants).toEqual(['*', `${name}(jid=reddit:*)`]);
  });
});
