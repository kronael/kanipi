import fs from 'fs';

import { AtpAgent, AtpSessionData } from '@atproto/api';

import { PlatformClient } from '../../actions/social.js';
import { logger } from '../../logger.js';

export interface BlueskyConfig {
  serviceUrl?: string; // default: https://bsky.social
  identifier: string; // handle or DID
  password: string; // app password
  sessionPath?: string; // path to persist session JSON
}

// AT-URI format: at://did:plc:xxx/app.bsky.feed.post/rkey
function parseAtUri(uri: string): { repo: string; rkey: string } {
  const m = uri.match(/^at:\/\/([^/]+)\/[^/]+\/([^/]+)$/);
  if (m) return { repo: m[1], rkey: m[2] };
  const parts = uri.split('/');
  return { repo: parts[2], rkey: parts[parts.length - 1] };
}

export class BlueskyClient implements PlatformClient {
  private agent: AtpAgent;
  private ready = false;

  constructor(private config: BlueskyConfig) {
    const svc = config.serviceUrl ?? 'https://bsky.social';
    this.agent = new AtpAgent({
      service: svc,
      persistSession: (_evt, sess) => {
        if (!config.sessionPath || !sess) return;
        try {
          fs.writeFileSync(config.sessionPath, JSON.stringify(sess));
        } catch (e) {
          logger.warn({ err: e }, 'bluesky: failed to persist session');
        }
      },
    });
  }

  get did(): string | undefined {
    return this.agent.session?.did;
  }

  get atpAgent(): AtpAgent {
    return this.agent;
  }

  async connect(): Promise<void> {
    // Try resuming saved session first
    if (this.config.sessionPath) {
      try {
        const raw = fs.readFileSync(this.config.sessionPath, 'utf-8');
        const sess: AtpSessionData = JSON.parse(raw);
        await this.agent.resumeSession(sess);
        this.ready = true;
        logger.info('bluesky: resumed saved session');
        return;
      } catch {
        // fall through to login
      }
    }
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
    // Walk reply chain: if target is already a reply, use its root
    const root = post.root ?? { uri: target, cid: post.cid };
    return this.agent.post({
      text: content,
      reply: {
        root,
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

  private async _fetchPost(
    uri: string,
  ): Promise<{ cid: string; root?: { uri: string; cid: string } }> {
    const { repo, rkey } = parseAtUri(uri);
    const res = await this.agent.getPost({ repo, rkey });
    const record = res.value as {
      reply?: { root?: { uri: string; cid: string } };
    };
    return { cid: res.cid, root: record.reply?.root };
  }
}

export function createClient(config: BlueskyConfig): BlueskyClient {
  return new BlueskyClient(config);
}
