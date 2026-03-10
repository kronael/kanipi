import { createRestAPIClient, type mastodon } from 'masto';

import { PlatformClient } from '../../actions/social.js';

export interface MastodonConfig {
  instanceUrl: string; // e.g. https://mastodon.social
  accessToken: string;
}

const NI = { error: 'not_implemented', platform: 'mastodon' } as const;

export class MastodonClient implements PlatformClient {
  readonly api: mastodon.rest.Client;

  constructor(config: MastodonConfig) {
    this.api = createRestAPIClient({
      url: config.instanceUrl,
      accessToken: config.accessToken,
    });
  }

  async post(content: string, _media?: string[]): Promise<unknown> {
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

  async setProfile(
    name?: string,
    bio?: string,
    _avatar?: string,
  ): Promise<unknown> {
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

  async unban(_target: string): Promise<unknown> {
    return NI;
  }

  async timeout(_target: string, _duration: number): Promise<unknown> {
    return NI;
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

  async lock(_target: string): Promise<unknown> {
    return NI;
  }

  async unlock(_target: string): Promise<unknown> {
    return NI;
  }

  async hide(_target: string): Promise<unknown> {
    return NI;
  }

  async approve(target: string): Promise<unknown> {
    return this.api.v1.followRequests.$select(target).authorize();
  }

  async setFlair(_target: string, _flair: string): Promise<unknown> {
    return NI;
  }

  async kick(_target: string): Promise<unknown> {
    return NI;
  }
}

export function createClient(config: MastodonConfig): MastodonClient {
  return new MastodonClient(config);
}
