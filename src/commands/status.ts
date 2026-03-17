import { CommandHandler } from './index.js';

const statusCommand: CommandHandler = {
  name: 'status',
  description: 'Gateway health summary',
  usage: '/status',
  async handle(ctx) {
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    await ctx.channel.sendMessage(
      ctx.groupJid,
      `Gateway up ${h}h${m}m, pid ${process.pid}`,
    );
  },
};

export default statusCommand;
