import fs from 'fs';
import path from 'path';

import {
  enqueueSystemMessage,
  getOnboardingEntry,
  getPendingOnboarding,
  GroupConfig,
  seedDefaultTasks,
  upsertOnboarding,
} from '../db.js';
import { logger } from '../logger.js';
import { copyDirRecursive, resolveGroupFolderPath } from '../group-folder.js';
import { permissionTier } from '../config.js';
import { worldOf } from '../permissions.js';
import { notify } from './notify.js';
import { CommandHandler } from './index.js';

export interface ApproveDeps {
  registerGroup: (jid: string, group: GroupConfig) => void;
  getGroup: (folder: string) => GroupConfig | undefined;
}

let deps: ApproveDeps | null = null;

export function setApproveDeps(d: ApproveDeps): void {
  deps = d;
}

const approveCommand: CommandHandler = {
  name: 'approve',
  description: 'Approve an onboarding request',
  usage: '/approve [jid|#] [target-group]',
  async handle(ctx) {
    const { group, groupJid, channel, args, message } = ctx;

    const tier = permissionTier(group.folder);
    if (tier > 1) {
      await channel.sendMessage(groupJid, 'approve: world admin or root only');
      return;
    }

    const pending = getPendingOnboarding();
    const parts = args.trim().split(/\s+/);
    const jidArg = parts[0] ?? '';
    const targetArg = parts[1] ?? '';

    let jid: string | undefined;
    if (!jidArg) {
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
    } else if (/^\d+$/.test(jidArg)) {
      jid = pending[Number(jidArg) - 1]?.jid;
      if (!jid) {
        await channel.sendMessage(groupJid, `No pending request #${jidArg}.`);
        return;
      }
    } else {
      jid = jidArg;
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

    // Determine target group folder
    let targetFolder: string;
    if (targetArg) {
      targetFolder = targetArg;
      // Tier 1 world admins can only approve into their own world
      if (tier === 1 && worldOf(targetFolder) !== worldOf(group.folder)) {
        await channel.sendMessage(
          groupJid,
          `approve: can only admit into your own world (${worldOf(group.folder)})`,
        );
        return;
      }
    } else if (tier === 0) {
      // Root: create new world from onboarding request
      if (!entry.world_name) {
        await channel.sendMessage(groupJid, `No world name for ${jid}`);
        return;
      }
      targetFolder = entry.world_name;
    } else {
      // World admin: admit into own world
      targetFolder = worldOf(group.folder);
    }

    const existingGroup = deps?.getGroup(targetFolder);

    if (!existingGroup) {
      // New world — copy prototype and register
      const rootPath = resolveGroupFolderPath('root');
      const prototypePath = path.join(rootPath, 'prototype');
      if (!fs.existsSync(prototypePath)) {
        await channel.sendMessage(
          groupJid,
          `No prototype dir at groups/root/prototype — cannot approve`,
        );
        logger.warn({ targetFolder }, 'approve: no root prototype dir');
        return;
      }

      const worldPath = resolveGroupFolderPath(targetFolder);
      if (!fs.existsSync(worldPath)) {
        copyDirRecursive(prototypePath, worldPath);
        fs.mkdirSync(path.join(worldPath, 'logs'), { recursive: true });
      }

      const newGroup: GroupConfig = {
        name: targetFolder,
        folder: targetFolder,
        added_at: new Date().toISOString(),
        parent: undefined,
      };

      deps?.registerGroup(jid, newGroup);
      seedDefaultTasks(targetFolder, jid);
    } else {
      // Existing group — just add the route
      deps?.registerGroup(jid, existingGroup);
    }

    // Welcome system message
    const userId = message.sender ?? jid;
    const userName = entry.sender ?? userId;
    enqueueSystemMessage(targetFolder, {
      origin: 'gateway',
      event: 'onboarding',
      body: `<user id="${userId}" jid="${jid}" name="${userName}" />\n<group folder="${targetFolder}" tier="${tier === 0 && !existingGroup ? '1' : '2'}" />\n<instructions>\nThis is a new user's first interaction.\n1. Run /hello to welcome the user.\n2. Run /howto to build a getting-started web page for them.\n</instructions>`,
    });

    upsertOnboarding(jid, { status: 'approved' });

    await notify(`Approved: ${userName} → ${targetFolder}/`);
    await channel.sendMessage(groupJid, `Approved: ${jid} → ${targetFolder}/`);

    logger.info({ jid, targetFolder }, 'Onboarding approved');
  },
};

export default approveCommand;
