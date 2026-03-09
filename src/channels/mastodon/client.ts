import generator, { MegalodonInterface } from 'megalodon';

import { PlatformClient } from '../../actions/social.js';

export interface MastodonConfig {
  instanceUrl: string; // e.g. https://mastodon.social
  accessToken: string;
}

export class MastodonClient implements PlatformClient {
  private api: MegalodonInterface;

  constructor(private config: MastodonConfig) {
    this.api = generator('mastodon', config.instanceUrl, config.accessToken);
  }

  async post(content: string, _media?: string[]): Promise<unknown> {
    const res = await this.api.postStatus(content);
    return res.data;
  }

  async reply(target: string, content: string): Promise<unknown> {
    const res = await this.api.postStatus(content, { in_reply_to_id: target });
    return res.data;
  }

  async react(target: string, reaction?: string): Promise<unknown> {
    // Mastodon uses favourites for like; emoji reactions via pleroma extension
    if (reaction) {
      // Pleroma/Akkoma reaction — falls back to favourite on plain mastodon
      try {
        const res = await (
          this.api as unknown as {
            createEmojiReaction(id: string, emoji: string): Promise<unknown>;
          }
        ).createEmojiReaction(target, reaction);
        return res;
      } catch {
        // fallthrough to favourite
      }
    }
    const res = await this.api.favouriteStatus(target);
    return res.data;
  }

  async repost(target: string): Promise<unknown> {
    const res = await this.api.reblogStatus(target);
    return res.data;
  }

  async follow(target: string): Promise<unknown> {
    const res = await this.api.followAccount(target);
    return res.data;
  }

  async unfollow(target: string): Promise<unknown> {
    const res = await this.api.unfollowAccount(target);
    return res.data;
  }

  async setProfile(
    name?: string,
    bio?: string,
    _avatar?: string,
  ): Promise<unknown> {
    const res = await this.api.updateCredentials({
      display_name: name,
      note: bio,
    });
    return res.data;
  }

  async deletePost(target: string): Promise<unknown> {
    const res = await this.api.deleteStatus(target);
    return res.data;
  }

  async editPost(target: string, content: string): Promise<unknown> {
    const res = await this.api.editStatus(target, { status: content });
    return res.data;
  }

  async ban(
    target: string,
    _duration?: number,
    reason?: string,
  ): Promise<unknown> {
    // Mastodon admin API not available via megalodon — use report as proxy
    const res = await this.api.report(target, { comment: reason ?? '' });
    return res.data;
  }

  async unban(_target: string): Promise<unknown> {
    return { error: 'not_implemented', platform: 'mastodon' };
  }

  async timeout(_target: string, _duration: number): Promise<unknown> {
    return { error: 'not_implemented', platform: 'mastodon' };
  }

  async mute(target: string): Promise<unknown> {
    const res = await this.api.muteAccount(target, false);
    return res.data;
  }

  async block(target: string): Promise<unknown> {
    const res = await this.api.blockAccount(target);
    return res.data;
  }

  async pin(target: string): Promise<unknown> {
    const res = await this.api.pinStatus(target);
    return res.data;
  }

  async unpin(target: string): Promise<unknown> {
    const res = await this.api.unpinStatus(target);
    return res.data;
  }

  async lock(_target: string): Promise<unknown> {
    return { error: 'not_implemented', platform: 'mastodon' };
  }

  async unlock(_target: string): Promise<unknown> {
    return { error: 'not_implemented', platform: 'mastodon' };
  }

  async hide(_target: string): Promise<unknown> {
    return { error: 'not_implemented', platform: 'mastodon' };
  }

  async approve(target: string): Promise<unknown> {
    const res = await this.api.acceptFollowRequest(target);
    return res.data;
  }

  async setFlair(_target: string, _flair: string): Promise<unknown> {
    return { error: 'not_implemented', platform: 'mastodon' };
  }

  async kick(_target: string): Promise<unknown> {
    return { error: 'not_implemented', platform: 'mastodon' };
  }
}

export function createClient(config: MastodonConfig): MastodonClient {
  return new MastodonClient(config);
}
