import { z } from 'zod';

import { Action } from '../action-registry.js';
import { getGrantOverrides, setGrantOverrides } from '../grants.js';

const GetGrantsInput = z.object({ folder: z.string().min(1) });
const SetGrantsInput = z.object({
  folder: z.string().min(1),
  rules: z.array(z.string()),
});

export const getGrants: Action = {
  name: 'get_grants',
  description: 'Get grant overrides for a group folder',
  input: GetGrantsInput,
  async handler(raw) {
    const { folder } = GetGrantsInput.parse(raw);
    const rules = getGrantOverrides(folder);
    return { rules: rules ?? [] };
  },
};

export const setGrants: Action = {
  name: 'set_grants',
  description: 'Set grant overrides for a group folder',
  input: SetGrantsInput,
  async handler(raw, ctx) {
    if (ctx.tier !== 0) throw new Error('unauthorized');
    const { folder, rules } = SetGrantsInput.parse(raw);
    setGrantOverrides(folder, rules);
    return { ok: true };
  },
};
