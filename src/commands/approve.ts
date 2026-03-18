import fs from 'fs';
import path from 'path';

import {
  enqueueSystemMessage,
  getOnboardingEntry,
  GroupConfig,
  upsertOnboarding,
} from '../db.js';
import { logger } from '../logger.js';
import { resolveGroupFolderPath } from '../group-folder.js';
import { permissionTier } from '../config.js';
import { notify } from './notify.js';
import { CommandHandler } from './index.js';

export interface ApproveDeps {
  registerGroup: (jid: string, group: GroupConfig) => void;
}

let deps: ApproveDeps | null = null;

export function setApproveDeps(d: ApproveDeps): void {
  deps = d;
}

function copyDirRecursive(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

const approveCommand: CommandHandler = {
  name: 'approve',
  description: 'Approve an onboarding request',
  usage: '/approve <jid>',
  async handle(ctx) {
    const { group, groupJid, channel, args, message } = ctx;

    if (permissionTier(group.folder) !== 0) {
      await channel.sendMessage(groupJid, 'approve: root-only command');
      return;
    }

    const jid = args.trim();
    if (!jid) {
      await channel.sendMessage(groupJid, 'Usage: /approve <jid>');
      return;
    }

    const entry = getOnboardingEntry(jid);
    if (!entry) {
      await channel.sendMessage(groupJid, `No onboarding entry for ${jid}`);
      return;
    }
    if (!entry.world_name) {
      await channel.sendMessage(groupJid, `No world name for ${jid}`);
      return;
    }

    const worldName = entry.world_name;

    // Copy root's prototype/ → groups/<world_name>/
    const rootPath = resolveGroupFolderPath('root');
    const prototypePath = path.join(rootPath, 'prototype');
    if (!fs.existsSync(prototypePath)) {
      await channel.sendMessage(
        groupJid,
        `No prototype dir at groups/root/prototype — cannot approve`,
      );
      logger.warn({ worldName }, 'approve: no root prototype dir');
      return;
    }

    const worldPath = resolveGroupFolderPath(worldName);
    if (!fs.existsSync(worldPath)) {
      copyDirRecursive(prototypePath, worldPath);
      fs.mkdirSync(path.join(worldPath, 'logs'), { recursive: true });
    }

    const newGroup: GroupConfig = {
      name: worldName,
      folder: worldName,
      added_at: new Date().toISOString(),
      parent: undefined,
    };

    deps?.registerGroup(jid, newGroup);

    // Welcome system message
    const userId = message.sender ?? jid;
    const userName = entry.sender ?? userId;
    enqueueSystemMessage(worldName, {
      origin: 'gateway',
      event: 'onboarding',
      body: `<user id="${userId}" jid="${jid}" name="${userName}" />\n<group folder="${worldName}" tier="1" />\n<instructions>\nThis is a new user's first interaction.\n1. Run /hello to welcome the user.\n2. Run /howto to build a getting-started web page for them.\n</instructions>`,
    });

    upsertOnboarding(jid, { status: 'approved' });

    await notify(`Approved: ${userName} → ${worldName}/`);
    await channel.sendMessage(groupJid, `Approved: ${jid} → ${worldName}/`);

    logger.info({ jid, worldName }, 'Onboarding approved');
  },
};

export default approveCommand;
