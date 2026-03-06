import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../config.js';
import { Channel, NewMessage, RegisteredGroup } from '../types.js';

export interface CommandContext {
  group: RegisteredGroup;
  groupJid: string;
  message: NewMessage;
  channel: Channel;
  args: string;
  clearSession: (groupFolder: string) => void;
}

export interface CommandHandler {
  name: string;
  description: string;
  usage?: string;
  handle(ctx: CommandContext): Promise<void>;
}

const registry: CommandHandler[] = [];

export function registerCommand(handler: CommandHandler): void {
  registry.push(handler);
}

export function findCommand(name: string): CommandHandler | undefined {
  return registry.find((h) => h.name === name);
}

export function writeCommandsXml(groupFolder: string): void {
  const dir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    '<commands>',
    ...registry.map(
      (h) =>
        `  <command name="${h.name}" description="${h.description}"` +
        (h.usage ? ` usage="${h.usage}"` : '') +
        ' />',
    ),
    '</commands>',
  ];
  fs.writeFileSync(path.join(dir, 'commands.xml'), lines.join('\n') + '\n');
}
