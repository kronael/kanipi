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
const TOKEN_MARGIN_MS = 60_000; // refresh 1min early

export class RedditClient implements PlatformClient {
  private token = '';
  private tokenExpiresAt = 0;

  constructor(private config: RedditConfig) {}

  async authenticate(): Promise<void> {
    const creds = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
    ).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'password',
      username: this.config.username,
      password: this.config.password,
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.config.userAgent,
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
  ): Promise<unknown> {
    await this.ensureToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'User-Agent': this.config.userAgent,
    };
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const res = await fetch(`${API}${path}`, { method, headers, body });
    if (res.status === 429) {
      const retry = Number(res.headers.get('Retry-After') || '5');
      logger.warn({ retry }, 'reddit rate limited');
      await new Promise((r) => setTimeout(r, retry * 1000));
      return this.api(path, method, body);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`reddit ${method} ${path}: ${res.status} ${text}`);
    }
    return res.json();
  }

  // --- PlatformClient ---

  async post(content: string, _media?: string[]): Promise<unknown> {
    // self post to user profile
    return this.api(
      '/api/submit',
      'POST',
      new URLSearchParams({
        kind: 'self',
        sr: `u_${this.config.username}`,
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
        sr: `u_${this.config.username}`,
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

  // --- Not implemented ---

  private ni(): Promise<unknown> {
    return Promise.resolve({ error: 'not_implemented', platform: 'reddit' });
  }

  async setProfile(): Promise<unknown> {
    return this.ni();
  }
  async ban(): Promise<unknown> {
    return this.ni();
  }
  async unban(): Promise<unknown> {
    return this.ni();
  }
  async timeout(): Promise<unknown> {
    return this.ni();
  }
  async mute(): Promise<unknown> {
    return this.ni();
  }
  async block(): Promise<unknown> {
    return this.ni();
  }
  async pin(): Promise<unknown> {
    return this.ni();
  }
  async unpin(): Promise<unknown> {
    return this.ni();
  }
  async lock(): Promise<unknown> {
    return this.ni();
  }
  async unlock(): Promise<unknown> {
    return this.ni();
  }
  async hide(): Promise<unknown> {
    return this.ni();
  }
  async approve(): Promise<unknown> {
    return this.ni();
  }
  async setFlair(): Promise<unknown> {
    return this.ni();
  }
  async kick(): Promise<unknown> {
    return this.ni();
  }

  // Exposed for watcher
  async fetchJson(path: string): Promise<unknown> {
    return this.api(path);
  }
}
