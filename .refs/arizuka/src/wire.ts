import { logger } from './logger.js';
import { Binding, RouteResult } from './types.js';

export interface RouteInput {
  channel: string;
  peerId: string;
  accountId?: string;
}

export function parseBindings(raw: unknown[]): Binding[] {
  const bindings: Binding[] = [];
  for (const item of raw) {
    const b = item as { match?: { channel?: string; peer?: string; account?: string }; agent?: string };
    if (!b.match?.channel || !b.agent) {
      logger.warn({ binding: item }, 'Invalid binding: missing match.channel or agent');
      continue;
    }
    bindings.push({
      match: {
        channel: b.match.channel,
        peer: b.match.peer,
        account: b.match.account,
      },
      agent: b.agent,
    });
  }
  return bindings;
}

export function resolveRoute(
  bindings: Binding[],
  input: RouteInput,
  defaultAgent: string,
): RouteResult {
  const channel = input.channel.trim().toLowerCase();
  const peerId = input.peerId.trim().toLowerCase();
  const accountId = (input.accountId ?? '').trim().toLowerCase();

  // Pre-filter: only bindings matching this channel
  const channelBindings = bindings.filter(
    (b) => b.match.channel.trim().toLowerCase() === channel,
  );

  // Tier 1: peer match
  const peerMatch = channelBindings.find(
    (b) => b.match.peer && b.match.peer.trim().toLowerCase() === peerId,
  );
  if (peerMatch) {
    return buildResult(peerMatch.agent, channel, peerId, accountId, 'peer');
  }

  // Tier 2: account match
  if (accountId) {
    const accountMatch = channelBindings.find(
      (b) =>
        !b.match.peer &&
        b.match.account &&
        b.match.account.trim().toLowerCase() === accountId,
    );
    if (accountMatch) {
      return buildResult(accountMatch.agent, channel, peerId, accountId, 'account');
    }
  }

  // Tier 3: channel-wide wildcard (no peer, no account)
  const channelMatch = channelBindings.find(
    (b) => !b.match.peer && !b.match.account,
  );
  if (channelMatch) {
    return buildResult(channelMatch.agent, channel, peerId, accountId, 'channel');
  }

  // Tier 4: default
  return buildResult(defaultAgent, channel, peerId, accountId, 'default');
}

function buildResult(
  agentId: string,
  channel: string,
  peerId: string,
  accountId: string,
  matchedBy: RouteResult['matchedBy'],
): RouteResult {
  const normalized = agentId.trim().toLowerCase();
  const sessionKey = `agent:${normalized}:${channel}:${peerId}`;
  return { agentId: normalized, channel, peerId, sessionKey, matchedBy };
}
