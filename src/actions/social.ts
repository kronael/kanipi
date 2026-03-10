import { z } from 'zod';

import { Action } from '../action-registry.js';
import { platformFromJid } from '../router.js';
import { Platform } from '../types.js';

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

export function registerClient(p: Platform, c: PlatformClient): void {
  clients.set(p, c);
}

export function unregisterClient(p: Platform): void {
  clients.delete(p);
}

type ClientResult =
  | { platform: Platform; client: PlatformClient }
  | { error: string; platform: string };

function getClient(jid: string): ClientResult {
  const platform = platformFromJid(jid);
  const client = clients.get(platform);
  if (!client) return { error: 'not_implemented', platform };
  return { platform, client };
}

const JidTarget = z.object({ jid: z.string(), target: z.string() });

const ALL_CONTENT: Platform[] = [
  Platform.Reddit,
  Platform.Twitter,
  Platform.Mastodon,
  Platform.Bluesky,
  Platform.Facebook,
  Platform.Threads,
  Platform.Discord,
  Platform.Twitch,
  Platform.YouTube,
  Platform.Instagram,
  Platform.LinkedIn,
];

function targetAction(
  method: keyof PlatformClient,
  description: string,
  platforms: Platform[],
  actionName?: string,
): Action {
  return {
    name: actionName ?? method,
    description,
    platforms,
    input: JidTarget,
    async handler(raw) {
      const { jid, target } = JidTarget.parse(raw);
      const r = getClient(jid);
      if ('error' in r) return r;
      return (r.client[method] as (t: string) => Promise<unknown>)(target);
    },
  };
}

const PostInput = z.object({
  jid: z.string(),
  content: z.string(),
  media: z.array(z.string()).optional(),
});

export const post: Action = {
  name: 'post',
  description: 'Create new content on a social platform',
  platforms: [
    Platform.Reddit,
    Platform.Twitter,
    Platform.Mastodon,
    Platform.Bluesky,
    Platform.Facebook,
    Platform.Threads,
  ],
  input: PostInput,
  async handler(raw) {
    const { jid, content, media } = PostInput.parse(raw);
    const r = getClient(jid);
    if ('error' in r) return r;
    return r.client.post(content, media);
  },
};

const ReplyInput = z.object({
  jid: z.string(),
  target: z.string(),
  content: z.string(),
});

export const reply: Action = {
  name: 'reply',
  description: 'Reply to existing content on a social platform',
  platforms: ALL_CONTENT,
  input: ReplyInput,
  async handler(raw) {
    const { jid, target, content } = ReplyInput.parse(raw);
    const r = getClient(jid);
    if ('error' in r) return r;
    return r.client.reply(target, content);
  },
};

const ReactInput = z.object({
  jid: z.string(),
  target: z.string(),
  reaction: z.string().optional(),
});

export const react: Action = {
  name: 'react',
  description: 'Like, upvote, or favourite content on a social platform',
  platforms: ALL_CONTENT,
  input: ReactInput,
  async handler(raw) {
    const { jid, target, reaction } = ReactInput.parse(raw);
    const r = getClient(jid);
    if ('error' in r) return r;
    return r.client.react(target, reaction);
  },
};

export const repost = targetAction(
  'repost',
  'Share, boost, or retweet content',
  [Platform.Twitter, Platform.Mastodon, Platform.Bluesky],
);

export const follow = targetAction(
  'follow',
  'Follow a user or community on a social platform',
  [Platform.Reddit, Platform.Twitter, Platform.Mastodon, Platform.Bluesky],
);

export const unfollow = targetAction(
  'unfollow',
  'Unfollow a user or community on a social platform',
  [Platform.Reddit, Platform.Twitter, Platform.Mastodon, Platform.Bluesky],
);

const ProfileInput = z.object({
  jid: z.string(),
  name: z.string().optional(),
  bio: z.string().optional(),
  avatar: z.string().optional(),
});

export const set_profile: Action = {
  name: 'set_profile',
  description: 'Update display name, bio, or avatar on a social platform',
  platforms: [Platform.Mastodon, Platform.Bluesky, Platform.Reddit],
  input: ProfileInput,
  async handler(raw) {
    const { jid, name, bio, avatar } = ProfileInput.parse(raw);
    const r = getClient(jid);
    if ('error' in r) return r;
    return r.client.setProfile(name, bio, avatar);
  },
};

export const delete_post = targetAction(
  'deletePost',
  'Delete content on a social platform',
  ALL_CONTENT,
  'delete_post',
);

const EditInput = z.object({
  jid: z.string(),
  target: z.string(),
  content: z.string(),
});

export const edit_post: Action = {
  name: 'edit_post',
  description: 'Edit existing content on a social platform',
  platforms: [Platform.Reddit, Platform.Mastodon, Platform.Facebook],
  input: EditInput,
  async handler(raw) {
    const { jid, target, content } = EditInput.parse(raw);
    const r = getClient(jid);
    if ('error' in r) return r;
    return r.client.editPost(target, content);
  },
};

const GroupInput = z.object({ group: z.string() });

export const close: Action = {
  name: 'close',
  description: 'Mark a thread group closed (no new messages)',
  input: GroupInput,
  async handler(raw) {
    const { group } = GroupInput.parse(raw);
    return { ok: true, action: 'close', group };
  },
};

export const delete_group: Action = {
  name: 'delete',
  description: 'Remove a thread group entirely',
  input: GroupInput,
  async handler(raw) {
    const { group } = GroupInput.parse(raw);
    return { ok: true, action: 'delete', group };
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
  platforms: [
    Platform.Reddit,
    Platform.Discord,
    Platform.Twitch,
    Platform.YouTube,
    Platform.Mastodon,
  ],
  input: BanInput,
  async handler(raw) {
    const { jid, target, duration, reason } = BanInput.parse(raw);
    const r = getClient(jid);
    if ('error' in r) return r;
    return r.client.ban(target, duration, reason);
  },
};

export const unban = targetAction('unban', 'Unban a user from a community', [
  Platform.Reddit,
  Platform.Discord,
  Platform.Twitch,
  Platform.Mastodon,
]);

const TimeoutInput = z.object({
  jid: z.string(),
  target: z.string(),
  duration: z.number(),
});

export const timeout: Action = {
  name: 'timeout',
  description: 'Temporarily mute a user (seconds)',
  platforms: [Platform.Discord, Platform.Twitch, Platform.YouTube],
  input: TimeoutInput,
  async handler(raw) {
    const { jid, target, duration } = TimeoutInput.parse(raw);
    const r = getClient(jid);
    if ('error' in r) return r;
    return r.client.timeout(target, duration);
  },
};

export const mute = targetAction(
  'mute',
  'Mute an account at the account level',
  [Platform.Reddit, Platform.Twitter, Platform.Mastodon, Platform.Bluesky],
);

export const block = targetAction('block', 'Block an account', [
  Platform.Twitter,
  Platform.Mastodon,
  Platform.Bluesky,
  Platform.Twitch,
]);

export const pin = targetAction(
  'pin',
  'Pin content to the top of a feed or channel',
  [Platform.Reddit, Platform.Mastodon, Platform.Discord],
);

export const unpin = targetAction('unpin', 'Unpin previously pinned content', [
  Platform.Reddit,
  Platform.Mastodon,
  Platform.Discord,
]);

export const lock = targetAction('lock', 'Lock a post to prevent new replies', [
  Platform.Reddit,
  Platform.Discord,
]);

export const unlock = targetAction(
  'unlock',
  'Unlock a previously locked post',
  [Platform.Reddit, Platform.Discord],
);

export const hide = targetAction(
  'hide',
  'Suppress content without deleting it',
  [Platform.YouTube, Platform.Facebook, Platform.Instagram],
);

export const approve = targetAction(
  'approve',
  'Release content from moderation queue',
  [Platform.Reddit, Platform.YouTube, Platform.Mastodon],
);

const FlairInput = z.object({
  jid: z.string(),
  target: z.string(),
  flair: z.string(),
});

export const set_flair: Action = {
  name: 'set_flair',
  description: 'Tag content or user with a flair',
  platforms: [Platform.Reddit],
  input: FlairInput,
  async handler(raw) {
    const { jid, target, flair } = FlairInput.parse(raw);
    const r = getClient(jid);
    if ('error' in r) return r;
    return r.client.setFlair(target, flair);
  },
};

export const kick = targetAction('kick', 'Kick a user from a Discord server', [
  Platform.Discord,
]);

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
