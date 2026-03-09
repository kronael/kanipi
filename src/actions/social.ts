import { z } from 'zod';

import { Action } from '../action-registry.js';
import { platformFromJid } from '../router.js';
import { Platform } from '../types.js';

// PlatformClient interface — each social channel implements this
export interface PlatformClient {
  post(content: string, media?: string[]): Promise<unknown>;
  reply(target: string, content: string): Promise<unknown>;
  react(target: string, reaction?: string): Promise<unknown>;
  repost(target: string): Promise<unknown>;
  follow(target: string): Promise<unknown>;
  unfollow(target: string): Promise<unknown>;
  setProfile(name?: string, bio?: string, avatar?: string): Promise<unknown>;
  deletePost(target: string): Promise<unknown>;
  editPost(target: string, content: string): Promise<unknown>;
  ban(target: string, duration?: number, reason?: string): Promise<unknown>;
  unban(target: string): Promise<unknown>;
  timeout(target: string, duration: number): Promise<unknown>;
  mute(target: string): Promise<unknown>;
  block(target: string): Promise<unknown>;
  pin(target: string): Promise<unknown>;
  unpin(target: string): Promise<unknown>;
  lock(target: string): Promise<unknown>;
  unlock(target: string): Promise<unknown>;
  hide(target: string): Promise<unknown>;
  approve(target: string): Promise<unknown>;
  setFlair(target: string, flair: string): Promise<unknown>;
  kick(target: string): Promise<unknown>;
}

const clients = new Map<Platform, PlatformClient>();

export function registerClient(
  platform: Platform,
  client: PlatformClient,
): void {
  clients.set(platform, client);
}

export function unregisterClient(platform: Platform): void {
  clients.delete(platform);
}

function getClient(
  jid: string,
):
  | { platform: Platform; client: PlatformClient }
  | { error: string; platform: string } {
  const platform = platformFromJid(jid);
  const client = clients.get(platform);
  if (!client) return { error: 'not_implemented', platform };
  return { platform, client };
}

// --- Schemas ---

const JidTarget = z.object({ jid: z.string(), target: z.string() });

// --- Actions ---

export const post: Action = {
  name: 'post',
  description: 'Create new content on a social platform',
  platforms: [
    'reddit',
    'twitter',
    'mastodon',
    'bluesky',
    'facebook',
    'threads',
  ],
  input: z.object({
    jid: z.string(),
    content: z.string(),
    media: z.array(z.string()).optional(),
  }),
  async handler(raw) {
    const input = (post.input as z.ZodObject<z.ZodRawShape>).parse(raw) as {
      jid: string;
      content: string;
      media?: string[];
    };
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.post(input.content, input.media);
  },
};

export const reply: Action = {
  name: 'reply',
  description: 'Reply to existing content on a social platform',
  platforms: [
    'reddit',
    'twitter',
    'mastodon',
    'bluesky',
    'facebook',
    'threads',
    'discord',
    'twitch',
    'youtube',
    'instagram',
    'linkedin',
  ],
  input: z.object({
    jid: z.string(),
    target: z.string(),
    content: z.string(),
  }),
  async handler(raw) {
    const input = (reply.input as z.ZodObject<z.ZodRawShape>).parse(raw) as {
      jid: string;
      target: string;
      content: string;
    };
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.reply(input.target, input.content);
  },
};

export const react: Action = {
  name: 'react',
  description: 'Like, upvote, or favourite content on a social platform',
  platforms: [
    'reddit',
    'twitter',
    'mastodon',
    'bluesky',
    'facebook',
    'threads',
    'discord',
    'twitch',
    'youtube',
    'instagram',
    'linkedin',
  ],
  input: z.object({
    jid: z.string(),
    target: z.string(),
    reaction: z.string().optional(),
  }),
  async handler(raw) {
    const input = (react.input as z.ZodObject<z.ZodRawShape>).parse(raw) as {
      jid: string;
      target: string;
      reaction?: string;
    };
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.react(input.target, input.reaction);
  },
};

export const repost: Action = {
  name: 'repost',
  description: 'Share, boost, or retweet content',
  platforms: ['twitter', 'mastodon', 'bluesky'],
  input: JidTarget,
  async handler(raw) {
    const input = JidTarget.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.repost(input.target);
  },
};

export const follow: Action = {
  name: 'follow',
  description: 'Follow a user or community on a social platform',
  platforms: ['reddit', 'twitter', 'mastodon', 'bluesky'],
  input: JidTarget,
  async handler(raw) {
    const input = JidTarget.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.follow(input.target);
  },
};

export const unfollow: Action = {
  name: 'unfollow',
  description: 'Unfollow a user or community on a social platform',
  platforms: ['reddit', 'twitter', 'mastodon', 'bluesky'],
  input: JidTarget,
  async handler(raw) {
    const input = JidTarget.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.unfollow(input.target);
  },
};

export const set_profile: Action = {
  name: 'set_profile',
  description: 'Update display name, bio, or avatar on a social platform',
  platforms: ['mastodon', 'bluesky', 'reddit'],
  input: z.object({
    jid: z.string(),
    name: z.string().optional(),
    bio: z.string().optional(),
    avatar: z.string().optional(),
  }),
  async handler(raw) {
    const input = (set_profile.input as z.ZodObject<z.ZodRawShape>).parse(
      raw,
    ) as {
      jid: string;
      name?: string;
      bio?: string;
      avatar?: string;
    };
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.setProfile(input.name, input.bio, input.avatar);
  },
};

export const delete_post: Action = {
  name: 'delete_post',
  description: 'Delete content on a social platform',
  platforms: [
    'reddit',
    'twitter',
    'mastodon',
    'bluesky',
    'facebook',
    'threads',
    'discord',
    'twitch',
    'youtube',
    'instagram',
    'linkedin',
  ],
  input: JidTarget,
  async handler(raw) {
    const input = JidTarget.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.deletePost(input.target);
  },
};

export const edit_post: Action = {
  name: 'edit_post',
  description: 'Edit existing content on a social platform',
  platforms: ['reddit', 'mastodon', 'facebook'],
  input: z.object({
    jid: z.string(),
    target: z.string(),
    content: z.string().optional(),
  }),
  async handler(raw) {
    const input = (edit_post.input as z.ZodObject<z.ZodRawShape>).parse(
      raw,
    ) as { jid: string; target: string; content?: string };
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.editPost(input.target, input.content ?? '');
  },
};

const GroupInput = z.object({ group: z.string() });

export const close: Action = {
  name: 'close',
  description: 'Mark a thread group closed (no new messages)',
  input: GroupInput,
  async handler(raw, ctx) {
    const input = GroupInput.parse(raw);
    void ctx;
    void input;
    // Gateway-side: mark group closed in DB (future implementation)
    return { ok: true, action: 'close', group: input.group };
  },
};

export const delete_group: Action = {
  name: 'delete',
  description: 'Remove a thread group entirely',
  input: GroupInput,
  async handler(raw, ctx) {
    const input = GroupInput.parse(raw);
    void ctx;
    return { ok: true, action: 'delete', group: input.group };
  },
};

const BanInput = z.object({
  jid: z.string(),
  target: z.string(),
  duration: z.number().optional(),
  reason: z.string().optional(),
});

export const ban: Action = {
  name: 'ban',
  description: 'Ban a user from a community',
  platforms: ['reddit', 'discord', 'twitch', 'youtube', 'mastodon'],
  input: BanInput,
  async handler(raw) {
    const input = BanInput.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.ban(input.target, input.duration, input.reason);
  },
};

export const unban: Action = {
  name: 'unban',
  description: 'Unban a user from a community',
  platforms: ['reddit', 'discord', 'twitch', 'mastodon'],
  input: JidTarget,
  async handler(raw) {
    const input = JidTarget.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.unban(input.target);
  },
};

const TimeoutInput = z.object({
  jid: z.string(),
  target: z.string(),
  duration: z.number(),
});

export const timeout: Action = {
  name: 'timeout',
  description: 'Temporarily mute a user (seconds)',
  platforms: ['discord', 'twitch', 'youtube'],
  input: TimeoutInput,
  async handler(raw) {
    const input = TimeoutInput.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.timeout(input.target, input.duration);
  },
};

export const mute: Action = {
  name: 'mute',
  description: 'Mute an account at the account level',
  platforms: ['reddit', 'twitter', 'mastodon', 'bluesky'],
  input: JidTarget,
  async handler(raw) {
    const input = JidTarget.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.mute(input.target);
  },
};

export const block: Action = {
  name: 'block',
  description: 'Block an account',
  platforms: ['twitter', 'mastodon', 'bluesky', 'twitch'],
  input: JidTarget,
  async handler(raw) {
    const input = JidTarget.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.block(input.target);
  },
};

export const pin: Action = {
  name: 'pin',
  description: 'Pin content to the top of a feed or channel',
  platforms: ['reddit', 'mastodon', 'discord'],
  input: JidTarget,
  async handler(raw) {
    const input = JidTarget.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.pin(input.target);
  },
};

export const unpin: Action = {
  name: 'unpin',
  description: 'Unpin previously pinned content',
  platforms: ['reddit', 'mastodon', 'discord'],
  input: JidTarget,
  async handler(raw) {
    const input = JidTarget.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.unpin(input.target);
  },
};

export const lock: Action = {
  name: 'lock',
  description: 'Lock a post to prevent new replies',
  platforms: ['reddit', 'discord'],
  input: JidTarget,
  async handler(raw) {
    const input = JidTarget.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.lock(input.target);
  },
};

export const unlock: Action = {
  name: 'unlock',
  description: 'Unlock a previously locked post',
  platforms: ['reddit', 'discord'],
  input: JidTarget,
  async handler(raw) {
    const input = JidTarget.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.unlock(input.target);
  },
};

export const hide: Action = {
  name: 'hide',
  description: 'Suppress content without deleting it',
  platforms: ['youtube', 'facebook', 'instagram'],
  input: JidTarget,
  async handler(raw) {
    const input = JidTarget.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.hide(input.target);
  },
};

export const approve: Action = {
  name: 'approve',
  description: 'Release content from moderation queue',
  platforms: ['reddit', 'youtube', 'mastodon'],
  input: JidTarget,
  async handler(raw) {
    const input = JidTarget.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.approve(input.target);
  },
};

const FlairInput = z.object({
  jid: z.string(),
  target: z.string(),
  flair: z.string(),
});

export const set_flair: Action = {
  name: 'set_flair',
  description: 'Tag content or user with a flair',
  platforms: ['reddit'],
  input: FlairInput,
  async handler(raw) {
    const input = FlairInput.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.setFlair(input.target, input.flair);
  },
};

export const kick: Action = {
  name: 'kick',
  description: 'Kick a user from a Discord server',
  platforms: ['discord'],
  input: JidTarget,
  async handler(raw) {
    const input = JidTarget.parse(raw);
    const r = getClient(input.jid);
    if ('error' in r) return r;
    return r.client.kick(input.target);
  },
};

export const allSocialActions: Action[] = [
  post,
  reply,
  react,
  repost,
  follow,
  unfollow,
  set_profile,
  delete_post,
  edit_post,
  close,
  delete_group,
  ban,
  unban,
  timeout,
  mute,
  block,
  pin,
  unpin,
  lock,
  unlock,
  hide,
  approve,
  set_flair,
  kick,
];
