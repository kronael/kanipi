import { z } from 'zod';

import { AvailableGroup } from './container-runner.js';
import { RegisteredGroup } from './types.js';

export interface ActionContext {
  sourceGroup: string;
  isRoot: boolean;
  tier: 0 | 1 | 2 | 3;
  sendMessage(jid: string, text: string): Promise<void>;
  sendDocument(jid: string, path: string, name?: string): Promise<void>;
  registeredGroups(): Record<string, RegisteredGroup>;
  registerGroup(jid: string, group: RegisteredGroup): void;
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
  ): Promise<void>;
}

export interface Action {
  name: string;
  description: string;
  input: z.ZodType;
  handler(input: unknown, ctx: ActionContext): Promise<unknown>;
  command?: string;
  mcp?: boolean; // default true
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

export function getManifest(): Array<{
  name: string;
  description: string;
  input: unknown;
}> {
  return [...actions.values()]
    .filter((a) => a.mcp !== false)
    .map((a) => ({
      name: a.name,
      description: a.description,
      input: z.toJSONSchema(a.input),
    }));
}
