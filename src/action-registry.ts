import { z } from 'zod';

import { AvailableGroup } from './container-runner.js';
import { GroupConfig } from './db.js';
import { SendOpts } from './types.js';

export interface ActionContext {
  sourceGroup: string;
  chatJid?: string;
  messageId?: string;
  isRoot: boolean;
  tier: 0 | 1 | 2 | 3;
  sendMessage(
    jid: string,
    text: string,
    opts?: SendOpts,
  ): Promise<string | undefined>;
  sendDocument(jid: string, path: string, name?: string): Promise<void>;
  getHubForJid(jid: string): string | null;
  getRoutedJids(): string[];
  getGroupConfig(folder: string): GroupConfig | undefined;
  getDirectChildGroupCount(parentFolder: string): number;
  registerGroup(jid: string, group: GroupConfig): void;
  syncGroupMetadata(force: boolean): Promise<void>;
  getAvailableGroups(): AvailableGroup[];
  writeGroupsSnapshot(
    folder: string,
    groups: AvailableGroup[],
    jids: Set<string>,
  ): void;
  clearSession(folder: string): void;
  delegateToChild(
    childFolder: string,
    prompt: string,
    originJid: string,
    depth: number,
    messageId?: string,
  ): Promise<void>;
  delegateToParent(
    parentFolder: string,
    prompt: string,
    originJid: string,
    depth: number,
    messageId?: string,
    escalationOrigin?: { jid: string; messageId?: string },
  ): Promise<void>;
}

export interface Action {
  name: string;
  description: string;
  input: z.ZodType;
  handler(input: unknown, ctx: ActionContext): Promise<unknown>;
  command?: string;
  mcp?: boolean; // default true
  maxTier?: number;
  platforms?: string[];
}

const actions = new Map<string, Action>();

export function registerAction(a: Action): void {
  actions.set(a.name, a);
}

export function getAction(name: string): Action | undefined {
  return actions.get(name);
}

export function getAllActions(): Action[] {
  return [...actions.values()];
}

export function unregisterAction(name: string): void {
  actions.delete(name);
}

export function getManifest(
  sourceGroup = '',
  opts: { tier: number; platforms: string[] } = { tier: 0, platforms: [] },
): Array<{
  name: string;
  description: string;
  input: unknown;
}> {
  return [...actions.values()]
    .filter((a) => a.mcp !== false)
    .filter((a) => {
      if (a.maxTier !== undefined && opts.tier > a.maxTier) return false;
      if (
        a.platforms?.length &&
        !a.platforms.some((p) => opts.platforms.includes(p))
      )
        return false;
      return true;
    })
    .map((a) => ({
      name: a.name,
      description: a.description,
      input: z.toJSONSchema(a.input),
    }));
}
