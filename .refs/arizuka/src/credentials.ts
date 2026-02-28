import { logger } from './logger.js';
import { CredentialConfig } from './types.js';

const store = new Map<string, string>();

export function initCredentials(
  credentials: Record<string, CredentialConfig>,
): void {
  for (const [name, config] of Object.entries(credentials)) {
    if (config.source === 'env') {
      const value = process.env[config.envVar];
      if (value) {
        store.set(name, value);
        logger.info({ name, envVar: config.envVar }, 'Credential loaded');
      } else {
        logger.warn({ name, envVar: config.envVar }, 'Credential env var not set');
      }
    }
  }
}

export function lookupCredential(name: string): string | undefined {
  return store.get(name);
}

export function hasCredential(name: string): boolean {
  return store.has(name);
}
