import { InboundEvent, OnInboundMessage } from './types.js';

export interface ImpulseConfig {
  threshold: number;
  weights: Partial<Record<string, number>>;
  max_hold_ms: number;
}

export interface ImpulseState {
  pending: InboundEvent[];
  impulse: number;
  last_flush: number;
}

export interface FlushResult {
  events: InboundEvent[];
  immediate: InboundEvent[];
  batched: InboundEvent[];
}

export function defaultConfig(): ImpulseConfig {
  return {
    threshold: 100,
    weights: {
      join: 0,
      edit: 0,
      delete: 0,
    },
    max_hold_ms: 300_000,
  };
}

export function emptyState(): ImpulseState {
  return { pending: [], impulse: 0, last_flush: Date.now() };
}

function weightFor(verb: string, config: ImpulseConfig): number {
  if (verb in config.weights) return config.weights[verb]!;
  return 100;
}

export function accumulate(
  state: ImpulseState,
  event: InboundEvent,
  config: ImpulseConfig,
): { state: ImpulseState; flush: FlushResult | null } {
  const verb = event.verb ?? 'message';
  const w = weightFor(verb, config);

  // weight 0 = drop
  if (w === 0) return { state, flush: null };

  const next: ImpulseState = {
    pending: [...state.pending, event],
    impulse: state.impulse + w,
    last_flush: state.last_flush,
  };

  if (next.impulse >= config.threshold) {
    const flush = buildFlush(next.pending, config);
    return {
      state: { pending: [], impulse: 0, last_flush: Date.now() },
      flush,
    };
  }

  return { state: next, flush: null };
}

export function checkTimeout(
  state: ImpulseState,
  config: ImpulseConfig,
): FlushResult | null {
  if (state.pending.length === 0) return null;
  if (Date.now() - state.last_flush < config.max_hold_ms) return null;
  return buildFlush(state.pending, config);
}

export function createImpulseFilter(
  onMsg: OnInboundMessage,
  config?: ImpulseConfig,
): { onMsg: OnInboundMessage; flush: () => void } {
  const cfg = config ?? defaultConfig();
  const states = new Map<string, ImpulseState>();

  function fireFlush(result: FlushResult): void {
    for (const event of result.events) {
      onMsg(event.chat_jid, event);
    }
  }

  const wrappedOnMsg: OnInboundMessage = (chatJid, message) => {
    const state = states.get(chatJid) ?? emptyState();
    const { state: next, flush } = accumulate(state, message, cfg);
    states.set(chatJid, next);
    if (flush) fireFlush(flush);
  };

  const flushAll = (): void => {
    for (const [jid, state] of states) {
      const result = checkTimeout(state, cfg);
      if (result) {
        states.set(jid, { pending: [], impulse: 0, last_flush: Date.now() });
        fireFlush(result);
      }
    }
  };

  return { onMsg: wrappedOnMsg, flush: flushAll };
}

function buildFlush(
  events: InboundEvent[],
  config: ImpulseConfig,
): FlushResult {
  const immediate: InboundEvent[] = [];
  const batched: InboundEvent[] = [];
  for (const e of events) {
    const w = weightFor(e.verb ?? 'message', config);
    if (w >= config.threshold) {
      immediate.push(e);
    } else {
      batched.push(e);
    }
  }
  return { events, immediate, batched };
}
