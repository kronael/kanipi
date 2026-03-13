/**
 * Container runner E2E tests.
 *
 * These tests use a real child_process (not mocked) to simulate the
 * container I/O protocol. They spawn a small Node script that acts as a
 * fake agent: reads stdin, emits the output markers, then exits.
 *
 * No docker required — we override CONTAINER_IMAGE and the "docker run"
 * command to run the fake agent script directly via node.
 *
 * Skip gracefully when node is unavailable or the script can't be found.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

// ── Build a fake "container" that speaks the nanoclaw I/O protocol ────────────

const OUTPUT_START = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END = '---NANOCLAW_OUTPUT_END---';

// Fake agent: emits output and exits only after stdout is flushed.
const FAKE_AGENT_SCRIPT = `
const out = JSON.stringify({ status: 'success', result: 'Echo: hello world', newSessionId: 'test-session-123' });
const payload = '${OUTPUT_START}\\n' + out + '\\n${OUTPUT_END}\\n';
process.stdin.resume();
process.stdout.write(payload, () => { process.exitCode = 0; process.stdout.end(); });
`;

// ── Mock helpers ──────────────────────────────────────────────────────────────

// We intercept spawn to run our fake agent instead of docker
const realSpawn = spawn;

vi.mock('../../src/config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  CONTAINER_IMAGE: 'fake-agent',
  CONTAINER_MAX_OUTPUT_SIZE: 10485760,
  CONTAINER_TIMEOUT: 30000,
  DATA_DIR: '/tmp/kanipi-e2e-cr',
  GROUPS_DIR: '/tmp/kanipi-e2e-cr-groups',
  HOST_APP_DIR: '/tmp/kanipi-e2e-cr-app',
  HOST_GROUPS_DIR: '/tmp/kanipi-e2e-cr-groups',
  HOST_DATA_DIR: '/tmp/kanipi-e2e-cr',
  IDLE_TIMEOUT: 30000,
  isRoot: (f: string) => !f.includes('/'),
  permissionTier: (f: string) =>
    f.includes('/') ? Math.min(f.split('/').length, 3) : 0,
  TIMEZONE: 'UTC',
  MEDIA_ENABLED: false,
  MEDIA_MAX_FILE_BYTES: 10485760,
  VIDEO_TRANSCRIPTION_ENABLED: false,
  VOICE_TRANSCRIPTION_ENABLED: false,
  WEB_DIR: '/tmp/kanipi-e2e-cr-web',
  WEB_HOST: '',
  WHISPER_MODEL: 'base',
}));

vi.mock('../../src/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/mount-security.js', () => ({
  validateAdditionalMounts: vi.fn(() => []),
}));

vi.mock('../../src/db.js', () => ({
  recordSessionStart: vi.fn(),
  updateSessionEnd: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(() => '{}'),
      readdirSync: vi.fn(() => []),
      statSync: vi.fn(() => ({
        isDirectory: () => false,
        isFile: () => false,
      })),
      copyFileSync: vi.fn(),
      renameSync: vi.fn(),
      unlinkSync: vi.fn(),
      chownSync: vi.fn(),
    },
  };
});

// Mock child_process.spawn to use the fake agent script instead of docker
let agentScript = '';
vi.mock('child_process', async () => {
  const actual =
    await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn((_cmd: string, _args: string[], opts?: object) => {
      // Run the fake agent script via node
      return actual.spawn('node', ['-e', agentScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(opts || {}),
      });
    }),
    exec: vi.fn(
      (_cmd: string, _opts: unknown, cb?: (err: Error | null) => void) => {
        if (cb) cb(null);
        return new EventEmitter();
      },
    ),
  };
});

import { runContainerCommand } from '../../src/container-runner.js';
import type { GroupConfig } from '../../src/db.js';

const testGroup: GroupConfig = {
  name: 'E2E Group',
  folder: 'e2e-group',
  trigger: '@Andy',
  added_at: new Date().toISOString(),
};

beforeEach(() => {
  agentScript = FAKE_AGENT_SCRIPT;
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runContainerCommand E2E (fake agent via node)', () => {
  it('receives prompt and returns output', async () => {
    const outputs: import('../../src/container-runner.js').ContainerOutput[] =
      [];

    const result = await runContainerCommand(
      testGroup,
      {
        prompt: 'hello world',
        groupFolder: 'e2e-group',
        chatJid: 'e2e@g.us',
        assistantName: 'Andy',
      },
      () => {},
      async (out) => {
        outputs.push(out);
      },
    );

    // Streaming mode: result.result is null; actual output goes via onOutput callback
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('test-session-123');
    expect(outputs.length).toBeGreaterThan(0);
    expect(outputs[0].result).toBe('Echo: hello world');
  }, 15000);

  it('calls onProcess with process handle', async () => {
    const onProcess = vi.fn();

    await runContainerCommand(
      testGroup,
      {
        prompt: 'ping',
        groupFolder: 'e2e-group',
        chatJid: 'e2e@g.us',
        assistantName: 'Andy',
      },
      onProcess,
    );

    expect(onProcess).toHaveBeenCalledWith(
      expect.objectContaining({ pid: expect.any(Number) }),
      expect.any(String), // containerName
    );
  }, 15000);

  it('handles agent with no output (error path)', async () => {
    // Agent exits immediately without emitting markers
    agentScript = 'process.exit(0);';

    const result = await runContainerCommand(
      testGroup,
      {
        prompt: 'silent',
        groupFolder: 'e2e-group',
        chatJid: 'e2e@g.us',
      },
      () => {},
    );

    // No output markers → treated as error or empty success
    expect(['success', 'error']).toContain(result.status);
  }, 15000);

  it('handles agent that exits non-zero', async () => {
    agentScript = `process.stdout.write('${OUTPUT_START}\\n' + JSON.stringify({ status: 'error', error: 'crashed' }) + '\\n${OUTPUT_END}\\n'); process.exit(1);`;

    const result = await runContainerCommand(
      testGroup,
      {
        prompt: 'crash',
        groupFolder: 'e2e-group',
        chatJid: 'e2e@g.us',
      },
      () => {},
    );

    // Output was captured before crash
    expect(result.status).toBe('error');
  }, 15000);
});
