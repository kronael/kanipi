import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { addSseListener, removeSseListener, WebChannel } from './web.js';
import type { ServerResponse } from 'http';

function fakeRes(): ServerResponse & { written: string[]; destroyed: boolean } {
  const res = {
    written: [] as string[],
    destroyed: false,
    write(chunk: string) {
      this.written.push(chunk);
    },
  } as unknown as ServerResponse & { written: string[]; destroyed: boolean };
  return res;
}

function fakeErrRes(): ServerResponse {
  const res = {
    write() {
      throw new Error('broken pipe');
    },
  } as unknown as ServerResponse;
  return res;
}

beforeEach(async () => {
  // Reset module-level listeners map by removing any lingering state
  // addSseListener/removeSseListener are stateful; clear between tests
  // by adding and removing a sentinel to flush nothing.
  // (The map persists across tests since modules are cached.)
});

describe('addSseListener / removeSseListener lifecycle', () => {
  it('adds and removes a listener', async () => {
    const ch = new WebChannel();
    const res = fakeRes();
    addSseListener('lifecycle-group', res);
    await ch.sendMessage('web:lifecycle-group', 'hello');
    expect(res.written.length).toBe(1);
    removeSseListener('lifecycle-group', res);
    await ch.sendMessage('web:lifecycle-group', 'after remove');
    expect(res.written.length).toBe(1); // no new writes
  });
});

describe('sendMessage', () => {
  it('delivers text to active SSE stream', async () => {
    const ch = new WebChannel();
    const res = fakeRes();
    addSseListener('deliver-group', res);
    await ch.sendMessage('web:deliver-group', 'test message');
    removeSseListener('deliver-group', res);
    expect(res.written[0]).toContain('test message');
    expect(res.written[0]).toMatch(/^data: /);
  });

  it('is a noop when no listeners present', async () => {
    const ch = new WebChannel();
    // Should not throw
    await expect(
      ch.sendMessage('web:empty-group', 'hi'),
    ).resolves.toBeUndefined();
  });

  it('removes broken stream on write error', async () => {
    const ch = new WebChannel();
    const bad = fakeErrRes();
    const good = fakeRes();
    addSseListener('err-group', bad);
    addSseListener('err-group', good);
    await ch.sendMessage('web:err-group', 'ping');
    removeSseListener('err-group', good);
    // bad was removed by error handler; good received the write
    expect((good as ReturnType<typeof fakeRes>).written.length).toBe(1);
    // Second send should not reach bad (already removed)
    addSseListener('err-group', good);
    await ch.sendMessage('web:err-group', 'ping2');
    removeSseListener('err-group', good);
    expect((good as ReturnType<typeof fakeRes>).written.length).toBe(2);
  });

  it('isolates writes between different groups', async () => {
    const ch = new WebChannel();
    const resA = fakeRes();
    const resB = fakeRes();
    addSseListener('iso-group-a', resA);
    addSseListener('iso-group-b', resB);
    await ch.sendMessage('web:iso-group-a', 'only-a');
    removeSseListener('iso-group-a', resA);
    removeSseListener('iso-group-b', resB);
    expect(resA.written.length).toBe(1);
    expect(resB.written.length).toBe(0);
  });

  it('delivers to all listeners on same group', async () => {
    const ch = new WebChannel();
    const res1 = fakeRes();
    const res2 = fakeRes();
    addSseListener('multi-group', res1);
    addSseListener('multi-group', res2);
    await ch.sendMessage('web:multi-group', 'broadcast');
    removeSseListener('multi-group', res1);
    removeSseListener('multi-group', res2);
    expect(res1.written.length).toBe(1);
    expect(res2.written.length).toBe(1);
    expect(res1.written[0]).toBe(res2.written[0]);
  });
});
