export interface ChannelAuth {
  name: string;
  isAuthenticated(dataDir: string): boolean;
  authenticate(dataDir: string, args: string[]): Promise<void>;
}

const registry = new Map<string, ChannelAuth>();

export function registerChannelAuth(auth: ChannelAuth): void {
  registry.set(auth.name, auth);
}

export function getChannelAuth(name: string): ChannelAuth | undefined {
  return registry.get(name);
}

export function listChannelAuths(): string[] {
  return [...registry.keys()];
}
