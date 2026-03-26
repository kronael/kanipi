import fs from 'fs';
import path from 'path';

import { Scraper } from 'agent-twitter-client';

import { STORE_DIR } from '../../config.js';
import { logger } from '../../logger.js';
import { PlatformClient } from '../../actions/social.js';

export interface TwitterConfig {
  username: string;
  password: string;
  email: string;
}

const log = logger.child({ channel: 'twitter' });
const COOKIES_FILE = path.join(STORE_DIR, 'twitter-cookies.json');
const NI = { error: 'not_implemented', platform: 'twitter' } as const;

export class TwitterClient implements PlatformClient {
  readonly scraper: Scraper;
  private config: TwitterConfig;
  userId = '';
  username = '';

  constructor(cfg: TwitterConfig) {
    this.config = cfg;
    this.scraper = new Scraper();
  }

  async login(): Promise<void> {
    if (fs.existsSync(COOKIES_FILE)) {
      const raw = fs.readFileSync(COOKIES_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      // setCookies expects strings or Cookie instances — convert plain objects
      const cookieStrings = (parsed as unknown[]).map((c) => {
        if (typeof c === 'string') return c;
        const o = c as Record<string, unknown>;
        let s = `${o['key']}=${o['value']}`;
        if (o['domain']) s += `; Domain=${o['domain']}`;
        if (o['path']) s += `; Path=${o['path']}`;
        if (o['secure']) s += `; Secure`;
        if (o['httpOnly']) s += `; HttpOnly`;
        if (o['sameSite']) s += `; SameSite=${o['sameSite']}`;
        return s;
      });
      await this.scraper.setCookies(cookieStrings);
      const me = await this.scraper.me();
      if (me) {
        log.info('logged in via cached cookies');
        return;
      }
      // Cookies stale — do not fall through to fresh login (may be blocked)
      throw new Error('twitter cookies stale — update twitter-cookies.json');
    }

    // Fresh login (no cookie file)
    await this.scraper.login(
      this.config.username,
      this.config.password,
      this.config.email,
    );
    const cookies = await this.scraper.getCookies();
    fs.mkdirSync(path.dirname(COOKIES_FILE), { recursive: true });
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies));
    log.info('logged in and cached cookies');
  }

  async verifyCredentials(): Promise<{ id: string; username: string }> {
    await this.login();
    const me = await this.scraper.me();
    if (!me) throw new Error('failed to get current user');
    this.userId = me.userId ?? '';
    this.username = me.username ?? '';
    return { id: this.userId, username: this.username };
  }

  async post(content: string, _media?: string[]): Promise<unknown> {
    const r = await this.scraper.sendTweet(content);
    return r;
  }

  async reply(target: string, content: string): Promise<unknown> {
    const r = await this.scraper.sendTweet(content, target);
    return r;
  }

  async react(target: string, _reaction?: string): Promise<unknown> {
    await this.scraper.likeTweet(target);
    return { ok: true };
  }

  async repost(target: string): Promise<unknown> {
    await this.scraper.retweet(target);
    return { ok: true };
  }

  async follow(target: string): Promise<unknown> {
    await this.scraper.followUser(target);
    return { ok: true };
  }

  async unfollow(target: string): Promise<unknown> {
    // agent-twitter-client doesn't expose unfollow, return not implemented
    return NI;
  }

  async setProfile(_name?: string, _bio?: string): Promise<unknown> {
    return NI;
  }

  async deletePost(_target: string): Promise<unknown> {
    return NI;
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
