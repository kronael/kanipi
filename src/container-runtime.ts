import { execFileSync } from 'child_process';

import { logger } from './logger.js';

export const CONTAINER_RUNTIME_BIN = 'docker';

export function readonlyMountArgs(
  hostPath: string,
  containerPath: string,
): string[] {
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

export function stopContainerArgs(name: string): string[] {
  return ['stop', name];
}

export function ensureContainerRuntimeRunning(): void {
  try {
    execFileSync(CONTAINER_RUNTIME_BIN, ['info'], {
      stdio: 'pipe',
      timeout: 10000,
    });
    logger.debug('Container runtime already running');
  } catch (err) {
    logger.error({ err }, 'Failed to reach container runtime');
    console.error(
      '\n╔════════════════════════════════════════════════════════════════╗',
    );
    console.error(
      '║  FATAL: Container runtime failed to start                      ║',
    );
    console.error(
      '║                                                                ║',
    );
    console.error(
      '║  Agents cannot run without a container runtime. To fix:        ║',
    );
    console.error(
      '║  1. Ensure Docker is installed and running                     ║',
    );
    console.error(
      '║  2. Run: docker info                                           ║',
    );
    console.error(
      '║  3. Restart NanoClaw                                           ║',
    );
    console.error(
      '╚════════════════════════════════════════════════════════════════╝\n',
    );
    throw new Error('Container runtime is required but failed to start');
  }
}

export function cleanupOrphans(containerImage?: string): void {
  const filter = containerImage
    ? `ancestor=${containerImage}`
    : 'name=nanoclaw-';
  const orphans: string[] = [];
  try {
    const out = execFileSync(
      CONTAINER_RUNTIME_BIN,
      ['ps', `--filter=${filter}`, '--format', '{{.Names}}'],
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
    );
    for (const name of out.trim().split('\n').filter(Boolean)) {
      orphans.push(name);
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to list containers for cleanup');
  }
  for (const name of orphans) {
    try {
      execFileSync(CONTAINER_RUNTIME_BIN, stopContainerArgs(name), {
        stdio: 'pipe',
      });
    } catch {}
  }
  if (orphans.length > 0) {
    logger.info(
      { count: orphans.length, names: orphans },
      'Stopped orphaned containers',
    );
  }
}
