/**
 * IPC integration tests using testcontainers.
 *
 * Tests the IPC file-based communication between container and gateway.
 * Uses scenario mode to write IPC request files, then verifies they exist.
 *
 * Prerequisites:
 * - Docker must be accessible (user in docker group or use sudo)
 * - Agent image must be built: `make agent-image`
 *
 * Run with: make integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer } from 'testcontainers';
import { mkdtempSync, rmSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

const AGENT_IMAGE = process.env.AGENT_IMAGE || 'kanipi-agent:latest';
const TEST_TIMEOUT = 60000;

// Check if docker is accessible
let dockerAvailable = false;
try {
  execSync('docker ps', { stdio: 'ignore' });
  dockerAvailable = true;
} catch {
  console.warn('Docker not accessible, IPC integration tests will be skipped');
}

let tmpDir: string;
let testCounter = 0;

function createTestDirs(): {
  groupDir: string;
  ipcDir: string;
  claudeDir: string;
} {
  testCounter++;
  const groupDir = join(tmpDir, `group-${testCounter}`);
  const ipcDir = join(tmpDir, `ipc-${testCounter}`);
  const claudeDir = join(tmpDir, `.claude-${testCounter}`);
  mkdirSync(groupDir, { recursive: true });
  mkdirSync(join(ipcDir, 'input'), { recursive: true });
  mkdirSync(join(ipcDir, 'requests'), { recursive: true });
  mkdirSync(join(ipcDir, 'replies'), { recursive: true });
  mkdirSync(claudeDir, { recursive: true });
  return { groupDir, ipcDir, claudeDir };
}

function buildContainerInput(
  prompt: string,
  groupFolder = 'test-group',
): string {
  return JSON.stringify({
    prompt,
    groupFolder,
    chatJid: 'test@g.us',
    assistantName: 'TestBot',
  });
}

async function runContainer(
  scenario: string,
  input: string,
  dirs: { groupDir: string; ipcDir: string; claudeDir: string },
): Promise<{ stdout: string; exitCode: number }> {
  const container = await new GenericContainer(AGENT_IMAGE)
    .withEnvironment({ NANOCLAW_SCENARIO: scenario })
    .withBindMounts([
      { source: dirs.groupDir, target: '/workspace/group', mode: 'rw' },
      { source: dirs.ipcDir, target: '/workspace/ipc', mode: 'rw' },
      { source: dirs.claudeDir, target: '/home/node/.claude', mode: 'rw' },
    ])
    .withStartupTimeout(30000)
    .start();

  const escapedInput = input.replace(/'/g, "'\\''");
  const execResult = await container.exec([
    'sh',
    '-c',
    `echo '${escapedInput}' | node /tmp/dist/index.js`,
  ]);

  await container.stop();

  return { stdout: execResult.output, exitCode: execResult.exitCode };
}

beforeAll(() => {
  if (dockerAvailable) {
    tmpDir = mkdtempSync(join(tmpdir(), 'kanipi-ipc-integration-'));
  }
});

afterAll(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe.skipIf(!dockerAvailable)('IPC integration — request files', () => {
  it(
    'ipc-send scenario writes request file to ipc/requests/',
    async () => {
      const dirs = createTestDirs();
      const input = buildContainerInput('send ipc request');

      const result = await runContainer('ipc-send', input, dirs);

      expect(result.stdout).toContain('ipc-request-sent');

      const requestsDir = join(dirs.ipcDir, 'requests');
      const files = readdirSync(requestsDir).filter((f) => f.endsWith('.json'));
      expect(files.length).toBeGreaterThan(0);

      const reqContent = JSON.parse(
        readFileSync(join(requestsDir, files[0]), 'utf-8'),
      );
      expect(reqContent.action).toBe('ping');
    },
    TEST_TIMEOUT,
  );
});

describe.skipIf(!dockerAvailable)(
  'IPC integration — directory structure',
  () => {
    it(
      'container has access to mounted ipc directories',
      async () => {
        const dirs = createTestDirs();

        const container = await new GenericContainer(AGENT_IMAGE)
          .withEnvironment({ NANOCLAW_SCENARIO: 'echo' })
          .withBindMounts([
            { source: dirs.groupDir, target: '/workspace/group', mode: 'rw' },
            { source: dirs.ipcDir, target: '/workspace/ipc', mode: 'rw' },
            {
              source: dirs.claudeDir,
              target: '/home/node/.claude',
              mode: 'rw',
            },
          ])
          .withStartupTimeout(30000)
          .start();

        // Check directory exists in container
        const lsResult = await container.exec(['ls', '-la', '/workspace/ipc']);
        expect(lsResult.output).toContain('input');
        expect(lsResult.output).toContain('requests');
        expect(lsResult.output).toContain('replies');

        await container.stop();
      },
      TEST_TIMEOUT,
    );
  },
);
