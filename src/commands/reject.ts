import {
  getOnboardingEntry,
  getPendingOnboarding,
  upsertOnboarding,
} from '../db.js';
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

    const pending = getPendingOnboarding();
    const raw = args.trim();
    let jid: string | undefined;
    if (!raw) {
      if (pending.length === 0) {
        await channel.sendMessage(groupJid, 'No pending requests.');
        return;
      }
      if (pending.length > 1) {
        const list = pending
          .map((e, i) => `${i + 1}. ${e.sender ?? e.jid} → ${e.world_name}`)
          .join('\n');
        await channel.sendMessage(
          groupJid,
          `Pending (${pending.length}):\n${list}`,
        );
        return;
      }
      jid = pending[0].jid;
    } else if (/^\d+$/.test(raw)) {
      jid = pending[Number(raw) - 1]?.jid;
      if (!jid) {
        await channel.sendMessage(groupJid, `No pending request #${raw}.`);
        return;
      }
    } else {
      jid = raw;
    }
    if (!jid) {
      await channel.sendMessage(groupJid, 'No pending requests.');
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
