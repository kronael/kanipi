import { enqueueSystemMessage } from '../db.js';
import { logger } from '../logger.js';
import { CommandHandler } from './index.js';

export let pendingCommandArgs: Map<string, string> = new Map();

const newCommand: CommandHandler = {
  name: 'new',
  description: 'Start a fresh session',
  usage: '/new [@group] [message]',
  async handle(ctx) {
    const { groupJid, channel, args } = ctx;

    // /new @<folder> [message] — explicit group target
    const parts = args.trim().split(/\s+/);
    let targetGroup = ctx.group;
    let remainingArgs = args.trim();

    if (parts[0]?.startsWith('@')) {
      const folder = parts[0].slice(1);
      const resolved = ctx.getGroup(folder);
      if (resolved) {
        targetGroup = resolved;
        remainingArgs = parts.slice(1).join(' ');
      }
    }

    await channel.sendMessage(
      groupJid,
      `Starting fresh session for ${targetGroup.name}\u2026`,
    );

    ctx.clearSession(targetGroup.folder);

    enqueueSystemMessage(targetGroup.folder, {
      origin: 'command',
      event: 'new',
      body: 'user invoked /new',
    });

    if (remainingArgs) {
      pendingCommandArgs.set(groupJid, remainingArgs);
    }

    logger.info({ group: targetGroup.name }, '/new: session cleared');
  },
};

export default newCommand;
