import { getOnboardingEntry, OnboardingEntry, upsertOnboarding } from './db.js';
import { logger } from './logger.js';
import { Channel, InboundEvent } from './types.js';
import { notify } from './commands/notify.js';

const RESERVED = new Set([
  'root',
  'local',
  'spawn',
  'guest',
  '_prototypes',
  'share',
  'media',
]);

export function isValidWorldName(name: string): boolean {
  return (
    /^[a-z0-9][a-z0-9-]*$/.test(name) &&
    name.length <= 63 &&
    !RESERVED.has(name)
  );
}

export async function handleOnboarding(
  chatJid: string,
  messages: InboundEvent[],
  channel: Channel,
): Promise<void> {
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return;

  const sender = lastMsg.sender_name ?? lastMsg.sender ?? 'unknown';
  const platform = chatJid.split(':')[0];

  let entry = getOnboardingEntry(chatJid);

  if (!entry) {
    upsertOnboarding(chatJid, { status: 'new', sender, channel: platform });
    await channel.sendMessage(
      chatJid,
      `Welcome! To get started, request your own workspace:\n/request <name>\n\nName must be lowercase letters, numbers, and hyphens only.`,
    );
    return;
  }

  switch (entry.status) {
    case 'new': {
      const text = lastMsg.content.trim();
      const m = text.match(/^\/request[\s\[\(]*([a-z0-9][a-z0-9-]*)?[\]\)]?/i);
      if (!m) {
        await channel.sendMessage(
          chatJid,
          'To request a workspace: /request [name]',
        );
        return;
      }
      const name = (m[1] ?? sender.replace(/^@/, '')).toLowerCase();
      if (!isValidWorldName(name)) {
        await channel.sendMessage(
          chatJid,
          'Invalid name — use lowercase letters, numbers, hyphens only (max 63 chars, no reserved names).',
        );
        return;
      }
      upsertOnboarding(chatJid, { status: 'pending', world_name: name });
      await notify(
        `New: ${sender} via ${platform} wants "${name}" — /approve ${chatJid}`,
      );
      await channel.sendMessage(
        chatJid,
        'Request received! Waiting for approval.',
      );
      logger.info({ chatJid, sender, name }, 'Onboarding request pending');
      return;
    }
    case 'pending':
      await channel.sendMessage(chatJid, 'Still waiting for approval.');
      return;
    case 'rejected':
      await channel.sendMessage(chatJid, 'Your request was not approved.');
      return;
    case 'approved':
      return;
    default:
      logger.warn(
        { chatJid, status: entry.status },
        'Unknown onboarding status',
      );
  }
}

export { getPendingOnboarding, OnboardingEntry } from './db.js';
export { upsertOnboarding };
