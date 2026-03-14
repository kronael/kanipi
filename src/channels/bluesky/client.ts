import fs from 'fs';

import { AtpAgent, AtpSessionData } from '@atproto/api';

import { PlatformClient } from '../../actions/social.js';
import { logger } from '../../logger.js';

export interface BlueskyConfig {
  serviceUrl?: string;
  identifier: string;
  password: string;
  sessionPath?: string;
}

const NI = { error: 'not_implemented', platform: 'bluesky' } as const;

function parseAtUri(uri: string): { repo: string; rkey: string } {
  const m = uri.match(/^at:\/\/([^/]+)\/[^/]+\/([^/]+)$/);
  if (m) return { repo: m[1], rkey: m[2] };
  const parts = uri.split('/');
  return { repo: parts[2], rkey: parts[parts.length - 1] };
}

export class BlueskyClient implements PlatformClient {
  readonly agent: AtpAgent;
  private ready = false;
  private sessionPath?: string;
  private identifier: string;
  private password: string;

  constructor(cfg: BlueskyConfig) {
    this.sessionPath = cfg.sessionPath;
    this.identifier = cfg.identifier;
    this.password = cfg.password;
    this.agent = new AtpAgent({
      service: cfg.serviceUrl ?? 'https://bsky.social',
      persistSession: (_evt, sess) => {
        if (!this.sessionPath || !sess) return;
        try {
          fs.writeFileSync(this.sessionPath, JSON.stringify(sess));
        } catch (e) {
          logger.warn({ err: e }, 'bluesky: failed to persist session');
        }
      },
    });
  }

  get did(): string | undefined {
    return this.agent.session?.did;
  }

  async connect(): Promise<void> {
    if (this.sessionPath) {
      try {
        const raw = fs.readFileSync(this.sessionPath, 'utf-8');
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
      identifier: this.identifier,
      password: this.password,
    });
    this.ready = true;
  }

  private assertReady(): void {
    if (!this.ready) throw new Error('bluesky not connected');
  }

  async post(content: string, media?: string[]): Promise<unknown> {
    this.assertReady();
    let embed:
      | { $type: string; images: { image: unknown; alt: string }[] }
      | undefined;
    if (media && media.length > 0) {
      try {
        const images = await Promise.all(
          media.map(async (url) => {
            const res = await fetch(url);
            const encoding = res.headers.get('content-type') ?? 'image/jpeg';
            const buf = await res.arrayBuffer();
            const blob = new Uint8Array(buf);
            const uploaded = await this.agent.uploadBlob(blob, { encoding });
            return { image: uploaded.data.blob, alt: '' };
          }),
        );
        embed = { $type: 'app.bsky.embed.images', images };
      } catch (e) {
        logger.warn(
          { err: e },
          'bluesky: media upload failed, posting without media',
        );
      }
    }
    return this.agent.post({ text: content, ...(embed ? { embed } : {}) });
  }

  async reply(target: string, content: string): Promise<unknown> {
    this.assertReady();
    const p = await this.fetchPost(target);
    const root = p.root ?? { uri: target, cid: p.cid };
    return this.agent.post({
      text: content,
      reply: { root, parent: { uri: target, cid: p.cid } },
    });
  }

  async react(target: string, _reaction?: string): Promise<unknown> {
    this.assertReady();
    const p = await this.fetchPost(target);
    return this.agent.like(target, p.cid);
  }

  async repost(target: string): Promise<unknown> {
    this.assertReady();
    const p = await this.fetchPost(target);
    return this.agent.repost(target, p.cid);
  }

  async follow(target: string): Promise<unknown> {
    this.assertReady();
    return this.agent.follow(target);
  }

  async unfollow(target: string): Promise<unknown> {
    this.assertReady();
    return this.agent.deleteFollow(target);
  }

  async setProfile(name?: string, bio?: string): Promise<unknown> {
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

  private async fetchPost(
    uri: string,
  ): Promise<{ cid: string; root?: { uri: string; cid: string } }> {
    const { repo, rkey } = parseAtUri(uri);
    const res = await this.agent.getPost({ repo, rkey });
    const rec = res.value as {
      reply?: { root?: { uri: string; cid: string } };
    };
    return { cid: res.cid, root: rec.reply?.root };
  }
}

export function createClient(cfg: BlueskyConfig): BlueskyClient {
  return new BlueskyClient(cfg);
}
