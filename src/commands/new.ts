import { enqueueSystemMessage } from '../db.js';
import { logger } from '../logger.js';
import { CommandHandler } from './index.js';

export let pendingCommandArgs: Map<string, string> = new Map();

const newCommand: CommandHandler = {
  name: 'new',
  description: 'Start a fresh session',
  usage: '/new [message]',
  async handle(ctx) {
    const { group, groupJid, channel, args } = ctx;

    await channel.sendMessage(groupJid, 'Starting fresh session\u2026');

    ctx.clearSession(group.folder);

    enqueueSystemMessage(group.folder, {
      origin: 'command',
      event: 'new',
      body: 'user invoked /new',
    });

    if (args.trim()) {
      pendingCommandArgs.set(groupJid, args.trim());
    }

    logger.info({ group: group.name }, '/new: session cleared');
  },
};

export default newCommand;
