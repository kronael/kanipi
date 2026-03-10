import { TwitterApi } from 'twitter-api-v2';

import { PlatformClient } from '../../actions/social.js';

export interface TwitterConfig {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
}

const NI = { error: 'not_implemented', platform: 'twitter' } as const;

export class TwitterClient implements PlatformClient {
  readonly api: TwitterApi;
  userId = '';

  constructor(cfg: TwitterConfig) {
    this.api = new TwitterApi({
      appKey: cfg.appKey,
      appSecret: cfg.appSecret,
      accessToken: cfg.accessToken,
      accessSecret: cfg.accessSecret,
    });
  }

  async verifyCredentials(): Promise<{ id: string; username: string }> {
    const me = await this.api.v2.me();
    this.userId = me.data.id;
    return { id: me.data.id, username: me.data.username };
  }

  async post(content: string, _media?: string[]): Promise<unknown> {
    return this.api.v2.tweet(content);
  }

  async reply(target: string, content: string): Promise<unknown> {
    return this.api.v2.reply(content, target);
  }

  async react(target: string, _reaction?: string): Promise<unknown> {
    return this.api.v2.like(this.userId, target);
  }

  async repost(target: string): Promise<unknown> {
    return this.api.v2.retweet(this.userId, target);
  }

  async follow(target: string): Promise<unknown> {
    return this.api.v2.follow(this.userId, target);
  }

  async unfollow(target: string): Promise<unknown> {
    return this.api.v2.unfollow(this.userId, target);
  }

  async setProfile(name?: string, bio?: string): Promise<unknown> {
    const params: Record<string, string> = {};
    if (name) params.name = name;
    if (bio) params.description = bio;
    return this.api.v1.updateAccountProfile(params);
  }

  async deletePost(target: string): Promise<unknown> {
    return this.api.v2.deleteTweet(target);
  }

  async editPost(): Promise<unknown> {
    return NI;
  }
  async ban(): Promise<unknown> {
    return NI;
  }
  async unban(): Promise<unknown> {
    return NI;
  }
  async timeout(): Promise<unknown> {
    return NI;
  }
  async mute(): Promise<unknown> {
    return NI;
  }
  async block(): Promise<unknown> {
    return NI;
  }
  async pin(): Promise<unknown> {
    return NI;
  }
  async unpin(): Promise<unknown> {
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
  async approve(): Promise<unknown> {
    return NI;
  }
  async setFlair(): Promise<unknown> {
    return NI;
  }
  async kick(): Promise<unknown> {
    return NI;
  }
}

export function createClient(cfg: TwitterConfig): TwitterClient {
  return new TwitterClient(cfg);
}
