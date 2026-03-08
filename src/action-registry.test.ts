import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';

import {
  Action,
  registerAction,
  getAction,
  getAllActions,
  getManifest,
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
    const manifest = getManifest();
    expect(manifest.find((m) => m.name === n1)).toBeDefined();
    expect(manifest.find((m) => m.name === n2)).toBeDefined();
  });

  it('excludes actions with mcp: false', () => {
    const name = uid();
    registerAction(makeAction(name, { mcp: false }));
    const manifest = getManifest();
    expect(manifest.find((m) => m.name === name)).toBeUndefined();
  });

  it('returns JSON schema for input', () => {
    const name = uid();
    registerAction(makeAction(name));
    const manifest = getManifest();
    const entry = manifest.find((m) => m.name === name)!;
    expect(entry.input).toBeDefined();
    expect(entry.description).toBe(`test action ${name}`);
    // z.toJSONSchema produces an object with type/properties
    const schema = entry.input as Record<string, unknown>;
    expect(schema.type).toBe('object');
  });
});
