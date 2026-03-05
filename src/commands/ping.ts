import { ASSISTANT_NAME } from '../config.js';
import { CommandHandler } from './index.js';

const pingCommand: CommandHandler = {
  name: 'ping',
  description: 'Check bot status',
  usage: '/ping',
  async handle(ctx) {
    await ctx.channel.sendMessage(ctx.groupJid, `${ASSISTANT_NAME} online`);
  },
};

export default pingCommand;
