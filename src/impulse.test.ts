import { describe, it, expect, vi } from 'vitest';
import { InboundEvent, OnInboundMessage } from './types.js';
import {
  accumulate,
  checkTimeout,
  createImpulseFilter,
  defaultConfig,
  emptyState,
  ImpulseConfig,
  ImpulseState,
} from './impulse.js';

function msg(overrides: Partial<InboundEvent> = {}): InboundEvent {
  return {
    id: '1',
    chat_jid: 'chat@test',
    sender: 'user@test',
    content: 'hello',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('accumulate', () => {
  it('message (weight 100) flushes immediately with default config', () => {
    const config = defaultConfig();
    const state = emptyState();
    const r = accumulate(state, msg(), config);
    expect(r.flush).not.toBeNull();
    expect(r.flush!.events).toHaveLength(1);
    expect(r.flush!.immediate).toHaveLength(1);
    expect(r.flush!.batched).toHaveLength(0);
    expect(r.state.pending).toHaveLength(0);
    expect(r.state.impulse).toBe(0);
  });

  it('low weight event does not flush on single event', () => {
    const config: ImpulseConfig = {
      ...defaultConfig(),
      weights: { react: 5 },
    };
    const state = emptyState();
    const r = accumulate(state, msg({ verb: 'react' }), config);
    expect(r.flush).toBeNull();
    expect(r.state.pending).toHaveLength(1);
    expect(r.state.impulse).toBe(5);
  });

  it('multiple low-weight events accumulate until threshold', () => {
    const config: ImpulseConfig = {
      ...defaultConfig(),
      weights: { react: 25 },
    };
    let state = emptyState();

    for (let i = 0; i < 3; i++) {
      const r = accumulate(
        state,
        msg({ id: String(i), verb: 'react' }),
        config,
      );
      expect(r.flush).toBeNull();
      state = r.state;
    }
    expect(state.impulse).toBe(75);

    // 4th pushes to 100 = threshold
    const r = accumulate(state, msg({ id: '3', verb: 'react' }), config);
    expect(r.flush).not.toBeNull();
    expect(r.flush!.events).toHaveLength(4);
    expect(r.flush!.batched).toHaveLength(4);
    expect(r.flush!.immediate).toHaveLength(0);
  });

  it('weight 0 events are dropped', () => {
    const config = defaultConfig(); // join=0
    const state = emptyState();
    const r = accumulate(state, msg({ verb: 'join' }), config);
    expect(r.flush).toBeNull();
    expect(r.state.pending).toHaveLength(0);
    expect(r.state.impulse).toBe(0);
  });
});

describe('checkTimeout', () => {
  it('flushes when max_hold_ms exceeded', () => {
    const config: ImpulseConfig = { ...defaultConfig(), max_hold_ms: 1000 };
    const state: ImpulseState = {
      pending: [msg()],
      impulse: 10,
      last_flush: Date.now() - 2000,
    };
    const r = checkTimeout(state, config);
    expect(r).not.toBeNull();
    expect(r!.events).toHaveLength(1);
  });

  it('returns null when pending is empty', () => {
    const config = defaultConfig();
    const state: ImpulseState = {
      pending: [],
      impulse: 0,
      last_flush: Date.now() - 999_999,
    };
    expect(checkTimeout(state, config)).toBeNull();
  });

  it('returns null when within timeout', () => {
    const config = defaultConfig();
    const state: ImpulseState = {
      pending: [msg()],
      impulse: 10,
      last_flush: Date.now(),
    };
    expect(checkTimeout(state, config)).toBeNull();
  });
});

describe('createImpulseFilter', () => {
  it('buffers events below threshold — onMsg not called', () => {
    const received: InboundEvent[] = [];
    const onMsg: OnInboundMessage = (_jid, ev) => received.push(ev);
    const config: ImpulseConfig = {
      ...defaultConfig(),
      weights: { react: 25 },
    };
    const filter = createImpulseFilter(onMsg, config);

    filter.onMsg('chat@test', msg({ id: '1', verb: 'react' }));
    filter.onMsg('chat@test', msg({ id: '2', verb: 'react' }));
    filter.onMsg('chat@test', msg({ id: '3', verb: 'react' }));
    expect(received).toHaveLength(0);
  });

  it('threshold triggers flush — onMsg called with all buffered events', () => {
    const received: InboundEvent[] = [];
    const onMsg: OnInboundMessage = (_jid, ev) => received.push(ev);
    const config: ImpulseConfig = {
      ...defaultConfig(),
      weights: { react: 25 },
    };
    const filter = createImpulseFilter(onMsg, config);

    filter.onMsg('chat@test', msg({ id: '1', verb: 'react' }));
    filter.onMsg('chat@test', msg({ id: '2', verb: 'react' }));
    filter.onMsg('chat@test', msg({ id: '3', verb: 'react' }));
    expect(received).toHaveLength(0);

    filter.onMsg('chat@test', msg({ id: '4', verb: 'react' }));
    expect(received).toHaveLength(4);
    expect(received.map((e) => e.id)).toEqual(['1', '2', '3', '4']);
  });

  it('default config: single message triggers immediate flush', () => {
    const received: InboundEvent[] = [];
    const onMsg: OnInboundMessage = (_jid, ev) => received.push(ev);
    const filter = createImpulseFilter(onMsg);

    filter.onMsg('chat@test', msg({ id: 'x' }));
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe('x');
  });

  it('flush() drains timed-out state — onMsg called after max_hold_ms', () => {
    const received: InboundEvent[] = [];
    const onMsg: OnInboundMessage = (_jid, ev) => received.push(ev);
    const config: ImpulseConfig = {
      ...defaultConfig(),
      weights: { react: 25 },
      max_hold_ms: 0,
    };
    const filter = createImpulseFilter(onMsg, config);

    filter.onMsg('chat@test', msg({ id: '1', verb: 'react' }));
    expect(received).toHaveLength(0);

    filter.flush();
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe('1');
  });

  it('flush() does not fire onMsg when within max_hold_ms', () => {
    const received: InboundEvent[] = [];
    const onMsg: OnInboundMessage = (_jid, ev) => received.push(ev);
    const config: ImpulseConfig = {
      ...defaultConfig(),
      weights: { react: 25 },
    };
    const filter = createImpulseFilter(onMsg, config);

    filter.onMsg('chat@test', msg({ id: '1', verb: 'react' }));
    filter.flush();
    expect(received).toHaveLength(0);
  });

  it('tracks separate jids independently', () => {
    const received: InboundEvent[] = [];
    const onMsg: OnInboundMessage = (_jid, ev) => received.push(ev);
    const filter = createImpulseFilter(onMsg);

    filter.onMsg('a@test', msg({ id: 'a1', chat_jid: 'a@test' }));
    filter.onMsg('b@test', msg({ id: 'b1', chat_jid: 'b@test' }));
    expect(received).toHaveLength(2);
    expect(received.map((e) => e.id)).toEqual(['a1', 'b1']);
  });
});

describe('FlushResult separation', () => {
  it('separates immediate vs batched by threshold', () => {
    const config: ImpulseConfig = {
      threshold: 100,
      weights: { react: 10 },
      max_hold_ms: 300_000,
    };
    // Accumulate a react (w=10), then a message (w=100, default) to hit threshold
    let state = emptyState();
    const r1 = accumulate(state, msg({ id: 'r', verb: 'react' }), config);
    expect(r1.flush).toBeNull();
    state = r1.state;

    const r2 = accumulate(state, msg({ id: 'm' }), config);
    expect(r2.flush).not.toBeNull();
    expect(r2.flush!.events).toHaveLength(2);
    expect(r2.flush!.immediate).toHaveLength(1);
    expect(r2.flush!.immediate[0].id).toBe('m');
    expect(r2.flush!.batched).toHaveLength(1);
    expect(r2.flush!.batched[0].id).toBe('r');
  });
});
