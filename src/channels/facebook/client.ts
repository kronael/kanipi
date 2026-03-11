import { PlatformClient } from '../../actions/social.js';
import { logger } from '../../logger.js';

export interface FacebookConfig {
  pageId: string;
  pageAccessToken: string;
  graphApiVersion?: string;
}

const NI = { error: 'not_implemented', platform: 'facebook' } as const;

export class FacebookClient implements PlatformClient {
  private base: string;
  private token: string;
  private pageId: string;

  constructor(cfg: FacebookConfig) {
    const v = cfg.graphApiVersion ?? 'v21.0';
    this.base = `https://graph.facebook.com/${v}`;
    this.token = cfg.pageAccessToken;
    this.pageId = cfg.pageId;
  }

  private async api(
    path: string,
    method = 'GET',
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const url = new URL(`${this.base}${path}`);
    const opts: RequestInit = {
      method,
      headers: { Authorization: `Bearer ${this.token}` },
    };
    if (body && method !== 'GET') {
      opts.headers = { ...opts.headers, 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.text();
      logger.warn({ path, status: res.status, err }, 'facebook api error');
      throw new Error(`facebook ${res.status}: ${err}`);
    }
    return res.json();
  }

  async post(content: string, _media?: string[]): Promise<unknown> {
    return this.api(`/${this.pageId}/feed`, 'POST', { message: content });
  }

  async reply(target: string, content: string): Promise<unknown> {
    return this.api(`/${target}/comments`, 'POST', { message: content });
  }

  async react(target: string, reaction?: string): Promise<unknown> {
    const type = reaction?.toUpperCase() ?? 'LIKE';
    return this.api(`/${target}/reactions`, 'POST', { type });
  }

  async deletePost(target: string): Promise<unknown> {
    return this.api(`/${target}`, 'DELETE');
  }

  async editPost(target: string, content: string): Promise<unknown> {
    return this.api(`/${target}`, 'POST', { message: content });
  }

  async ban(target: string): Promise<unknown> {
    return this.api(`/${this.pageId}/blocked`, 'POST', { user: target });
  }

  async unban(target: string): Promise<unknown> {
    return this.api(
      `/${this.pageId}/blocked?uid=${encodeURIComponent(target)}`,
      'DELETE',
    );
  }

  async block(target: string): Promise<unknown> {
    return this.ban(target);
  }

  async hide(target: string): Promise<unknown> {
    return this.api(`/${target}`, 'POST', { is_hidden: true });
  }

  async repost(): Promise<unknown> {
    return NI;
  }
  async follow(): Promise<unknown> {
    return NI;
  }
  async unfollow(): Promise<unknown> {
    return NI;
  }
  async setProfile(): Promise<unknown> {
    return NI;
  }
  async timeout(): Promise<unknown> {
    return NI;
  }
  async mute(): Promise<unknown> {
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

export function createClient(cfg: FacebookConfig): FacebookClient {
  return new FacebookClient(cfg);
}
