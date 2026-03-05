import { CommandHandler } from './index.js';

const chatidCommand: CommandHandler = {
  name: 'chatid',
  description: 'Reply with the channel JID for this chat',
  usage: '/chatid',
  async handle(ctx) {
    await ctx.channel.sendMessage(ctx.groupJid, `Chat JID: ${ctx.groupJid}`);
  },
};

export default chatidCommand;
