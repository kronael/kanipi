/**
 * Smoke tests for social channels.
 * These require real API credentials — skip in CI.
 * Run: MASTODON_ACCESS_TOKEN=... npx vitest run tests/smoke/social-channels.test.ts
 */
import { describe, it, expect } from 'vitest';

const TIMEOUT = 15_000;

describe.skipIf(!process.env.MASTODON_ACCESS_TOKEN)('mastodon smoke', () => {
  it(
    'posts and deletes a status',
    async () => {
      const { createRestAPIClient } = await import('masto');
      const api = createRestAPIClient({
        url: process.env.MASTODON_INSTANCE_URL ?? 'https://mastodon.social',
        accessToken: process.env.MASTODON_ACCESS_TOKEN!,
      });
      const status = await api.v1.statuses.create({
        status: `kanipi smoke test ${Date.now()}`,
        visibility: 'direct', // don't pollute timelines
      });
      expect(status.id).toBeTruthy();
      await api.v1.statuses.$select(status.id).remove();
    },
    TIMEOUT,
  );
});

describe.skipIf(!process.env.BLUESKY_IDENTIFIER)('bluesky smoke', () => {
  it(
    'posts and deletes',
    async () => {
      const { AtpAgent } = await import('@atproto/api');
      const agent = new AtpAgent({
        service: process.env.BLUESKY_SERVICE_URL ?? 'https://bsky.social',
      });
      await agent.login({
        identifier: process.env.BLUESKY_IDENTIFIER!,
        password: process.env.BLUESKY_PASSWORD!,
      });
      const res = await agent.post({
        text: `kanipi smoke test ${Date.now()}`,
      });
      expect(res.uri).toBeTruthy();
      await agent.deletePost(res.uri);
    },
    TIMEOUT,
  );
});

describe.skipIf(!process.env.REDDIT_CLIENT_ID)('reddit smoke', () => {
  it(
    'authenticates and reads inbox',
    async () => {
      const creds = Buffer.from(
        `${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`,
      ).toString('base64');
      const body = new URLSearchParams({
        grant_type: 'password',
        username: process.env.REDDIT_USERNAME!,
        password: process.env.REDDIT_PASSWORD!,
      });
      const auth = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${creds}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'kanipi-smoke/1.0',
        },
        body,
      });
      expect(auth.ok).toBe(true);
      const token = ((await auth.json()) as { access_token: string })
        .access_token;

      const me = await fetch('https://oauth.reddit.com/api/v1/me', {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'kanipi-smoke/1.0',
        },
      });
      expect(me.ok).toBe(true);
    },
    TIMEOUT,
  );
});

describe.skipIf(!process.env.TWITTER_APP_KEY)('twitter smoke', () => {
  it(
    'verifies credentials',
    async () => {
      const { TwitterApi } = await import('twitter-api-v2');
      const client = new TwitterApi({
        appKey: process.env.TWITTER_APP_KEY!,
        appSecret: process.env.TWITTER_APP_SECRET!,
        accessToken: process.env.TWITTER_ACCESS_TOKEN!,
        accessSecret: process.env.TWITTER_ACCESS_SECRET!,
      });
      const me = await client.v2.me();
      expect(me.data.id).toBeTruthy();
    },
    TIMEOUT,
  );
});

describe.skipIf(!process.env.FACEBOOK_PAGE_ACCESS_TOKEN)(
  'facebook smoke',
  () => {
    it(
      'reads page info',
      async () => {
        const pageId = process.env.FACEBOOK_PAGE_ID!;
        const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN!;
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${pageId}?fields=name,id&access_token=${token}`,
        );
        expect(res.ok).toBe(true);
        const data = (await res.json()) as { id: string; name: string };
        expect(data.id).toBe(pageId);
      },
      TIMEOUT,
    );
  },
);
