import { getOnboardingEntry, upsertOnboarding } from '../db.js';
import { logger } from '../logger.js';
import { permissionTier } from '../config.js';
import { notify } from './notify.js';
import { CommandHandler } from './index.js';

const rejectCommand: CommandHandler = {
  name: 'reject',
  description: 'Reject an onboarding request',
  usage: '/reject <jid>',
  async handle(ctx) {
    const { group, groupJid, channel, args } = ctx;

    if (permissionTier(group.folder) !== 0) {
      await channel.sendMessage(groupJid, 'reject: root-only command');
      return;
    }

    const jid = args.trim();
    if (!jid) {
      await channel.sendMessage(groupJid, 'Usage: /reject <jid>');
      return;
    }

    const entry = getOnboardingEntry(jid);
    if (!entry) {
      await channel.sendMessage(groupJid, `No onboarding entry for ${jid}`);
      return;
    }

    upsertOnboarding(jid, { status: 'rejected' });
    await notify(`Rejected: ${jid}`);
    await channel.sendMessage(groupJid, `Rejected: ${jid}`);

    logger.info({ jid }, 'Onboarding rejected');
  },
};

export default rejectCommand;
