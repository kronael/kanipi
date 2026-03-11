import { PlatformClient } from '../../actions/social.js';
import { logger } from '../../logger.js';

export interface RedditConfig {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  userAgent: string;
}

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API = 'https://oauth.reddit.com';
const TOKEN_MARGIN_MS = 60_000;
const NI = { error: 'not_implemented', platform: 'reddit' } as const;

export class RedditClient implements PlatformClient {
  private token = '';
  private tokenExpiresAt = 0;

  constructor(private cfg: RedditConfig) {}

  async authenticate(): Promise<void> {
    const creds = Buffer.from(
      `${this.cfg.clientId}:${this.cfg.clientSecret}`,
    ).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'password',
      username: this.cfg.username,
      password: this.cfg.password,
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.cfg.userAgent,
      },
      body,
    });
    if (!res.ok) throw new Error(`reddit auth failed: ${res.status}`);
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000 - TOKEN_MARGIN_MS;
  }

  private async ensureToken(): Promise<void> {
    if (Date.now() >= this.tokenExpiresAt) await this.authenticate();
  }

  private async api(
    path: string,
    method = 'GET',
    body?: URLSearchParams,
    retries = 0,
  ): Promise<unknown> {
    await this.ensureToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'User-Agent': this.cfg.userAgent,
    };
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const res = await fetch(`${API}${path}`, { method, headers, body });
    if (res.status === 429) {
      if (retries >= 3)
        throw new Error(`reddit ${path}: rate limited after 3 retries`);
      const retry = Number(res.headers.get('Retry-After') || '5');
      logger.warn({ retry, retries }, 'reddit rate limited');
      await new Promise((r) => setTimeout(r, retry * 1000));
      return this.api(path, method, body, retries + 1);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`reddit ${method} ${path}: ${res.status} ${text}`);
    }
    return res.json();
  }

  async post(content: string, _media?: string[]): Promise<unknown> {
    return this.api(
      '/api/submit',
      'POST',
      new URLSearchParams({
        kind: 'self',
        sr: `u_${this.cfg.username}`,
        title: content.slice(0, 300),
        text: content,
      }),
    );
  }

  async reply(target: string, content: string): Promise<unknown> {
    return this.api(
      '/api/comment',
      'POST',
      new URLSearchParams({ thing_id: target, text: content }),
    );
  }

  async react(target: string, reaction?: string): Promise<unknown> {
    const dir = reaction === 'down' ? '-1' : '1';
    return this.api(
      '/api/vote',
      'POST',
      new URLSearchParams({ id: target, dir }),
    );
  }

  async repost(target: string): Promise<unknown> {
    return this.api(
      '/api/submit',
      'POST',
      new URLSearchParams({
        kind: 'crosspost',
        sr: `u_${this.cfg.username}`,
        title: 'crosspost',
        crosspost_fullname: target,
      }),
    );
  }

  async follow(target: string): Promise<unknown> {
    return this.api(
      '/api/subscribe',
      'POST',
      new URLSearchParams({ action: 'sub', sr_name: target }),
    );
  }

  async unfollow(target: string): Promise<unknown> {
    return this.api(
      '/api/subscribe',
      'POST',
      new URLSearchParams({ action: 'unsub', sr_name: target }),
    );
  }

  async deletePost(target: string): Promise<unknown> {
    return this.api('/api/del', 'POST', new URLSearchParams({ id: target }));
  }

  async editPost(target: string, content: string): Promise<unknown> {
    return this.api(
      '/api/editusertext',
      'POST',
      new URLSearchParams({ thing_id: target, text: content }),
    );
  }

  async setProfile(): Promise<unknown> {
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

  async fetchJson(path: string): Promise<unknown> {
    return this.api(path);
  }
}
