import { z } from 'zod';

import { Action } from '../action-registry.js';
import { getGrantOverrides, setGrantOverrides } from '../grants.js';

export const getGrants: Action = {
  name: 'get_grants',
  description: 'Get grant overrides for a group folder',
  input: z.object({ folder: z.string().min(1) }),
  async handler(raw, ctx) {
    const { folder } = z.object({ folder: z.string().min(1) }).parse(raw);
    const rules = getGrantOverrides(folder);
    return { rules: rules ?? [] };
  },
};

export const setGrants: Action = {
  name: 'set_grants',
  description: 'Set grant overrides for a group folder',
  input: z.object({
    folder: z.string().min(1),
    rules: z.array(z.string()),
  }),
  async handler(raw, ctx) {
    if (ctx.tier !== 0) throw new Error('unauthorized');
    const { folder, rules } = z
      .object({ folder: z.string().min(1), rules: z.array(z.string()) })
      .parse(raw);
    setGrantOverrides(folder, rules);
    return { ok: true };
  },
};
