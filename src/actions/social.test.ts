import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Platform } from '../types.js';
import {
  PlatformClient,
  registerClient,
  unregisterClient,
  post,
  reply,
  react,
  repost,
  follow,
  delete_post,
} from './social.js';

function mockClient(): PlatformClient {
  return {
    post: vi.fn(async () => ({ id: '1' })),
    reply: vi.fn(async () => ({ id: '2' })),
    react: vi.fn(async () => ({ ok: true })),
    repost: vi.fn(async () => ({ ok: true })),
    follow: vi.fn(async () => ({ ok: true })),
    unfollow: vi.fn(async () => ({ ok: true })),
    setProfile: vi.fn(async () => ({ ok: true })),
    deletePost: vi.fn(async () => ({ ok: true })),
    editPost: vi.fn(async () => ({ ok: true })),
    ban: vi.fn(async () => ({ ok: true })),
    unban: vi.fn(async () => ({ ok: true })),
    timeout: vi.fn(async () => ({ ok: true })),
    mute: vi.fn(async () => ({ ok: true })),
    block: vi.fn(async () => ({ ok: true })),
    pin: vi.fn(async () => ({ ok: true })),
    unpin: vi.fn(async () => ({ ok: true })),
    lock: vi.fn(async () => ({ ok: true })),
    unlock: vi.fn(async () => ({ ok: true })),
    hide: vi.fn(async () => ({ ok: true })),
    approve: vi.fn(async () => ({ ok: true })),
    setFlair: vi.fn(async () => ({ ok: true })),
    kick: vi.fn(async () => ({ ok: true })),
  };
}

describe('registerClient / unregisterClient lifecycle', () => {
  let c: PlatformClient;

  beforeEach(() => {
    c = mockClient();
  });
  afterEach(() => {
    unregisterClient(Platform.Twitter);
    unregisterClient(Platform.Reddit);
  });

  it('registered client is reachable via action', async () => {
    registerClient(Platform.Twitter, c);
    const r = await post.handler({ jid: 'twitter:123', content: 'hi' });
    expect(c.post).toHaveBeenCalledWith('hi', undefined);
    expect(r).toEqual({ id: '1' });
  });

  it('unregistered client returns error', async () => {
    registerClient(Platform.Twitter, c);
    unregisterClient(Platform.Twitter);
    const r = await post.handler({ jid: 'twitter:123', content: 'hi' });
    expect(r).toEqual({ error: 'not_implemented', platform: 'twitter' });
  });

  it('re-register overwrites previous client', async () => {
    const c2 = mockClient();
    registerClient(Platform.Twitter, c);
    registerClient(Platform.Twitter, c2);
    await post.handler({ jid: 'twitter:123', content: 'yo' });
    expect(c.post).not.toHaveBeenCalled();
    expect(c2.post).toHaveBeenCalledWith('yo', undefined);
  });
});

describe('getClient routing via platformFromJid', () => {
  let tw: PlatformClient;
  let rd: PlatformClient;

  beforeEach(() => {
    tw = mockClient();
    rd = mockClient();
    registerClient(Platform.Twitter, tw);
    registerClient(Platform.Reddit, rd);
  });
  afterEach(() => {
    unregisterClient(Platform.Twitter);
    unregisterClient(Platform.Reddit);
  });

  it('twitter:123 routes to twitter client', async () => {
    await react.handler({ jid: 'twitter:123', target: 't1' });
    expect(tw.react).toHaveBeenCalledWith('t1', undefined);
    expect(rd.react).not.toHaveBeenCalled();
  });

  it('reddit:user routes to reddit client', async () => {
    await react.handler({ jid: 'reddit:user', target: 't2' });
    expect(rd.react).toHaveBeenCalledWith('t2', undefined);
    expect(tw.react).not.toHaveBeenCalled();
  });

  it('unknown platform returns not_implemented', async () => {
    const r = await react.handler({
      jid: 'linkedin:x',
      target: 't3',
    });
    expect(r).toEqual({ error: 'not_implemented', platform: 'linkedin' });
  });
});

describe('targetAction dispatch', () => {
  let c: PlatformClient;

  beforeEach(() => {
    c = mockClient();
    registerClient(Platform.Twitter, c);
  });
  afterEach(() => unregisterClient(Platform.Twitter));

  it('repost action has correct name', () => {
    expect(repost.name).toBe('repost');
  });

  it('delete_post uses overridden name', () => {
    expect(delete_post.name).toBe('delete_post');
  });

  it('calls correct client method with target', async () => {
    await repost.handler({ jid: 'twitter:1', target: 'post123' });
    expect(c.repost).toHaveBeenCalledWith('post123');
  });

  it('follow calls client.follow', async () => {
    await follow.handler({ jid: 'twitter:1', target: '@user' });
    expect(c.follow).toHaveBeenCalledWith('@user');
  });

  it('returns error when no client registered', async () => {
    unregisterClient(Platform.Twitter);
    const r = await repost.handler({
      jid: 'twitter:1',
      target: 'x',
    });
    expect(r).toEqual({ error: 'not_implemented', platform: 'twitter' });
  });
});

describe('post action', () => {
  let c: PlatformClient;

  beforeEach(() => {
    c = mockClient();
    registerClient(Platform.Twitter, c);
  });
  afterEach(() => unregisterClient(Platform.Twitter));

  it('calls client.post with content and media', async () => {
    await post.handler({
      jid: 'twitter:1',
      content: 'hello',
      media: ['a.png', 'b.jpg'],
    });
    expect(c.post).toHaveBeenCalledWith('hello', ['a.png', 'b.jpg']);
  });

  it('handles missing media as undefined', async () => {
    await post.handler({ jid: 'twitter:1', content: 'text only' });
    expect(c.post).toHaveBeenCalledWith('text only', undefined);
  });
});

describe('reply action', () => {
  let c: PlatformClient;

  beforeEach(() => {
    c = mockClient();
    registerClient(Platform.Twitter, c);
  });
  afterEach(() => unregisterClient(Platform.Twitter));

  it('calls client.reply with target and content', async () => {
    await reply.handler({
      jid: 'twitter:1',
      target: 'post456',
      content: 'nice',
    });
    expect(c.reply).toHaveBeenCalledWith('post456', 'nice');
  });
});

describe('react action', () => {
  let c: PlatformClient;

  beforeEach(() => {
    c = mockClient();
    registerClient(Platform.Twitter, c);
  });
  afterEach(() => unregisterClient(Platform.Twitter));

  it('calls client.react with target and reaction', async () => {
    await react.handler({
      jid: 'twitter:1',
      target: 'post789',
      reaction: 'heart',
    });
    expect(c.react).toHaveBeenCalledWith('post789', 'heart');
  });

  it('reaction can be undefined (default like)', async () => {
    await react.handler({ jid: 'twitter:1', target: 'post789' });
    expect(c.react).toHaveBeenCalledWith('post789', undefined);
  });
});
