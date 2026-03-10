import { PlatformClient } from '../../actions/social.js';
import { logger } from '../../logger.js';

export interface FacebookConfig {
  pageId: string;
  pageAccessToken: string;
  graphApiVersion?: string; // default: v21.0
}

const NI = { error: 'not_implemented', platform: 'facebook' };

export class FacebookClient implements PlatformClient {
  private base: string;
  private token: string;
  private pageId: string;

  constructor(config: FacebookConfig) {
    const v = config.graphApiVersion ?? 'v21.0';
    this.base = `https://graph.facebook.com/${v}`;
    this.token = config.pageAccessToken;
    this.pageId = config.pageId;
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
      opts.headers = {
        ...opts.headers,
        'Content-Type': 'application/json',
      };
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

  async repost(_target: string): Promise<unknown> {
    return NI; // Facebook has share but no API for it
  }

  async follow(_target: string): Promise<unknown> {
    return NI;
  }

  async unfollow(_target: string): Promise<unknown> {
    return NI;
  }

  async setProfile(_name?: string, _bio?: string): Promise<unknown> {
    return NI;
  }

  async deletePost(target: string): Promise<unknown> {
    return this.api(`/${target}`, 'DELETE');
  }

  async editPost(target: string, content: string): Promise<unknown> {
    return this.api(`/${target}`, 'POST', { message: content });
  }

  async ban(
    target: string,
    _duration?: number,
    _reason?: string,
  ): Promise<unknown> {
    return this.api(`/${this.pageId}/blocked`, 'POST', { user: target });
  }

  async unban(target: string): Promise<unknown> {
    return this.api(`/${this.pageId}/blocked`, 'DELETE', { user: target });
  }

  async timeout(_target: string, _duration: number): Promise<unknown> {
    return NI;
  }

  async mute(_target: string): Promise<unknown> {
    return NI;
  }

  async block(target: string): Promise<unknown> {
    return this.ban(target);
  }

  async pin(_target: string): Promise<unknown> {
    return NI;
  }

  async unpin(_target: string): Promise<unknown> {
    return NI;
  }

  async lock(_target: string): Promise<unknown> {
    return NI;
  }

  async unlock(_target: string): Promise<unknown> {
    return NI;
  }

  async hide(target: string): Promise<unknown> {
    return this.api(`/${target}`, 'POST', { is_hidden: true });
  }

  async approve(_target: string): Promise<unknown> {
    return NI;
  }

  async setFlair(_target: string, _flair: string): Promise<unknown> {
    return NI;
  }

  async kick(_target: string): Promise<unknown> {
    return NI;
  }
}

export function createClient(config: FacebookConfig): FacebookClient {
  return new FacebookClient(config);
}
