import { createRestAPIClient, type mastodon } from 'masto';

import { PlatformClient } from '../../actions/social.js';
import { logger } from '../../logger.js';

export interface MastodonConfig {
  instanceUrl: string;
  accessToken: string;
}

const NI = { error: 'not_implemented', platform: 'mastodon' } as const;

export class MastodonClient implements PlatformClient {
  readonly api: mastodon.rest.Client;

  constructor(cfg: MastodonConfig) {
    this.api = createRestAPIClient({
      url: cfg.instanceUrl,
      accessToken: cfg.accessToken,
    });
  }

  async post(content: string, media?: string[]): Promise<unknown> {
    let mediaIds: string[] | undefined;
    if (media && media.length > 0) {
      try {
        mediaIds = await Promise.all(
          media.map(async (url) => {
            const res = await fetch(url);
            const blob = await res.blob();
            const attachment = await this.api.v2.media.create({ file: blob });
            return attachment.id;
          }),
        );
      } catch (e) {
        logger.warn(
          { err: e },
          'mastodon: media upload failed, posting without media',
        );
      }
    }
    if (mediaIds && mediaIds.length > 0) {
      return this.api.v1.statuses.create({ status: content, mediaIds });
    }
    return this.api.v1.statuses.create({ status: content });
  }

  async reply(target: string, content: string): Promise<unknown> {
    return this.api.v1.statuses.create({
      status: content,
      inReplyToId: target,
    });
  }

  async react(target: string, _reaction?: string): Promise<unknown> {
    return this.api.v1.statuses.$select(target).favourite();
  }

  async repost(target: string): Promise<unknown> {
    return this.api.v1.statuses.$select(target).reblog();
  }

  async follow(target: string): Promise<unknown> {
    return this.api.v1.accounts.$select(target).follow();
  }

  async unfollow(target: string): Promise<unknown> {
    return this.api.v1.accounts.$select(target).unfollow();
  }

  async setProfile(name?: string, bio?: string): Promise<unknown> {
    return this.api.v1.accounts.updateCredentials({
      displayName: name,
      note: bio,
    });
  }

  async deletePost(target: string): Promise<unknown> {
    return this.api.v1.statuses.$select(target).remove();
  }

  async editPost(target: string, content: string): Promise<unknown> {
    return this.api.v1.statuses.$select(target).update({ status: content });
  }

  async ban(
    target: string,
    _duration?: number,
    reason?: string,
  ): Promise<unknown> {
    return this.api.v1.reports.create({
      accountId: target,
      comment: reason ?? '',
    });
  }

  async mute(target: string): Promise<unknown> {
    return this.api.v1.accounts.$select(target).mute();
  }

  async block(target: string): Promise<unknown> {
    return this.api.v1.accounts.$select(target).block();
  }

  async pin(target: string): Promise<unknown> {
    return this.api.v1.statuses.$select(target).pin();
  }

  async unpin(target: string): Promise<unknown> {
    return this.api.v1.statuses.$select(target).unpin();
  }

  async approve(target: string): Promise<unknown> {
    return this.api.v1.followRequests.$select(target).authorize();
  }

  async unban(): Promise<unknown> {
    return NI;
  }
  async timeout(): Promise<unknown> {
    return NI;
  }
  async lock(): Promise<unknown> {
    return NI;
  }
  async unlock(): Promise<unknown> {
    return NI;
  }
  async hide(): Promise<unknown> {
    return NI;
  }
  async setFlair(): Promise<unknown> {
    return NI;
  }
  async kick(): Promise<unknown> {
    return NI;
  }
}

export function createClient(cfg: MastodonConfig): MastodonClient {
  return new MastodonClient(cfg);
}
