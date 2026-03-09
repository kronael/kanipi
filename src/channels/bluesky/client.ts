import { AtpAgent } from '@atproto/api';

import { PlatformClient } from '../../actions/social.js';

export interface BlueskyConfig {
  serviceUrl?: string; // default: https://bsky.social
  identifier: string; // handle or DID
  password: string; // app password
}

export class BlueskyClient implements PlatformClient {
  private agent: AtpAgent;
  private ready = false;

  constructor(private config: BlueskyConfig) {
    this.agent = new AtpAgent({
      service: config.serviceUrl ?? 'https://bsky.social',
    });
  }

  async connect(): Promise<void> {
    await this.agent.login({
      identifier: this.config.identifier,
      password: this.config.password,
    });
    this.ready = true;
  }

  private assertReady(): void {
    if (!this.ready) throw new Error('bluesky not connected');
  }

  async post(content: string, _media?: string[]): Promise<unknown> {
    this.assertReady();
    return this.agent.post({ text: content });
  }

  async reply(target: string, content: string): Promise<unknown> {
    this.assertReady();
    const post = await this._fetchPost(target);
    return this.agent.post({
      text: content,
      reply: {
        root: { uri: target, cid: post.cid },
        parent: { uri: target, cid: post.cid },
      },
    });
  }

  async react(target: string, _reaction?: string): Promise<unknown> {
    this.assertReady();
    const post = await this._fetchPost(target);
    return this.agent.like(target, post.cid);
  }

  async repost(target: string): Promise<unknown> {
    this.assertReady();
    const post = await this._fetchPost(target);
    return this.agent.repost(target, post.cid);
  }

  async follow(target: string): Promise<unknown> {
    this.assertReady();
    return this.agent.follow(target);
  }

  async unfollow(target: string): Promise<unknown> {
    this.assertReady();
    return this.agent.deleteFollow(target);
  }

  async setProfile(
    name?: string,
    bio?: string,
    _avatar?: string,
  ): Promise<unknown> {
    this.assertReady();
    return this.agent.upsertProfile((existing) => ({
      ...existing,
      displayName: name ?? existing?.displayName,
      description: bio ?? existing?.description,
    }));
  }

  async deletePost(target: string): Promise<unknown> {
    this.assertReady();
    return this.agent.deletePost(target);
  }

  async editPost(_target: string, _content: string): Promise<unknown> {
    // Bluesky does not support editing posts
    return {
      error: 'not_implemented',
      platform: 'bluesky',
      reason: 'editing not supported',
    };
  }

  async ban(
    _target: string,
    _duration?: number,
    _reason?: string,
  ): Promise<unknown> {
    return { error: 'not_implemented', platform: 'bluesky' };
  }

  async unban(_target: string): Promise<unknown> {
    return { error: 'not_implemented', platform: 'bluesky' };
  }

  async timeout(_target: string, _duration: number): Promise<unknown> {
    return { error: 'not_implemented', platform: 'bluesky' };
  }

  async mute(target: string): Promise<unknown> {
    this.assertReady();
    return this.agent.mute(target);
  }

  async block(target: string): Promise<unknown> {
    this.assertReady();
    return this.agent.app.bsky.graph.block.create(
      { repo: this.agent.accountDid! },
      { subject: target, createdAt: new Date().toISOString() },
    );
  }

  async pin(_target: string): Promise<unknown> {
    return { error: 'not_implemented', platform: 'bluesky' };
  }

  async unpin(_target: string): Promise<unknown> {
    return { error: 'not_implemented', platform: 'bluesky' };
  }

  async lock(_target: string): Promise<unknown> {
    return { error: 'not_implemented', platform: 'bluesky' };
  }

  async unlock(_target: string): Promise<unknown> {
    return { error: 'not_implemented', platform: 'bluesky' };
  }

  async hide(_target: string): Promise<unknown> {
    return { error: 'not_implemented', platform: 'bluesky' };
  }

  async approve(_target: string): Promise<unknown> {
    return { error: 'not_implemented', platform: 'bluesky' };
  }

  async setFlair(_target: string, _flair: string): Promise<unknown> {
    return { error: 'not_implemented', platform: 'bluesky' };
  }

  async kick(_target: string): Promise<unknown> {
    return { error: 'not_implemented', platform: 'bluesky' };
  }

  private async _fetchPost(uri: string): Promise<{ cid: string }> {
    const parts = uri.split('/');
    const rkey = parts[parts.length - 1];
    const repo = uri.includes('did:') ? uri.split('/')[2] : parts[2];
    const res = await this.agent.getPost({ repo, rkey });
    return { cid: res.cid };
  }
}

export function createClient(config: BlueskyConfig): BlueskyClient {
  return new BlueskyClient(config);
}
