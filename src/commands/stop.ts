import { logger } from '../logger.js';
import { CommandHandler } from './index.js';

export interface StopDeps {
  closeStdin: (groupJid: string) => void;
}

let deps: StopDeps | null = null;

export function setStopDeps(d: StopDeps): void {
  deps = d;
}

const stopCommand: CommandHandler = {
  name: 'stop',
  description: 'Stop the running agent',
  usage: '/stop',
  async handle(ctx) {
    const { group, groupJid, channel } = ctx;

    if (!deps) {
      await channel.sendMessage(groupJid, 'stop not available');
      return;
    }

    deps.closeStdin(groupJid);
    await channel.sendMessage(groupJid, 'stopping agent\u2026');
    logger.info({ group: group.name }, '/stop: container close requested');
  },
};

export default stopCommand;
