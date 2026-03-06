import { z } from 'zod';

import { Action } from '../action-registry.js';
import { logger } from '../logger.js';

export const resetSession: Action = {
  name: 'reset_session',
  description: 'Clear the current session',
  input: z.object({}),
  async handler(_input, ctx) {
    ctx.clearSession(ctx.sourceGroup);
    logger.info({ sourceGroup: ctx.sourceGroup }, 'session reset via action');
    return { reset: true };
  },
};
