import { deleteSession, enqueueSystemMessage } from '../db.js';
import { logger } from '../logger.js';
import { CommandHandler } from './index.js';

export let pendingCommandArgs: Map<string, string> = new Map();

const newCommand: CommandHandler = {
  name: 'new',
  description: 'Start a fresh session',
  usage: '/new [#topic|message]',
  async handle(ctx) {
    const { groupJid, channel, args, group } = ctx;

    const topicMatch = args.trim().match(/^#(\w[\w-]*)$/);
    if (topicMatch) {
      const topicName = topicMatch[1];
      deleteSession(group.folder, topicName);
      await channel.sendMessage(
        groupJid,
        `Starting fresh session for #${topicName}\u2026`,
      );
      logger.info(
        { group: group.name, topicName },
        '/new #topic: topic session cleared',
      );
      return;
    }

    await channel.sendMessage(
      groupJid,
      `Starting fresh session for ${group.name}\u2026`,
    );

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
