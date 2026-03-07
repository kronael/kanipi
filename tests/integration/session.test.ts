/**
 * Session persistence integration tests using testcontainers.
 *
 * Tests that session data persists across container runs via mounted volumes.
 *
 * Prerequisites:
 * - Docker must be accessible (user in docker group or use sudo)
 * - Agent image must be built: `make agent-image`
 *
 * Run with: make integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer } from 'testcontainers';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'fs';
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
  console.warn(
    'Docker not accessible, session integration tests will be skipped',
  );
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
  sessionId?: string,
): string {
  return JSON.stringify({
    prompt,
    groupFolder,
    chatJid: 'test@g.us',
    assistantName: 'TestBot',
    sessionId,
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
    tmpDir = mkdtempSync(join(tmpdir(), 'kanipi-session-integration-'));
  }
});

afterAll(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe.skipIf(!dockerAvailable)('session persistence integration', () => {
  it(
    'files written by container persist after container stops',
    async () => {
      const dirs = createTestDirs();
      const input = buildContainerInput('write something');

      await runContainer('session-persist', input, dirs);

      // Container stopped, check file still exists on host
      const markerPath = join(dirs.groupDir, '.session-marker');
      expect(existsSync(markerPath)).toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    'pre-existing files are readable by container',
    async () => {
      const dirs = createTestDirs();

      // Write a file before container starts
      const preExistingFile = join(dirs.groupDir, 'pre-existing.txt');
      writeFileSync(preExistingFile, 'hello from host');

      const container = await new GenericContainer(AGENT_IMAGE)
        .withEnvironment({ NANOCLAW_SCENARIO: 'echo' })
        .withBindMounts([
          { source: dirs.groupDir, target: '/workspace/group', mode: 'rw' },
          { source: dirs.ipcDir, target: '/workspace/ipc', mode: 'rw' },
          { source: dirs.claudeDir, target: '/home/node/.claude', mode: 'rw' },
        ])
        .withStartupTimeout(30000)
        .start();

      // Read file from inside container
      const catResult = await container.exec([
        'cat',
        '/workspace/group/pre-existing.txt',
      ]);
      expect(catResult.output).toContain('hello from host');

      await container.stop();
    },
    TEST_TIMEOUT,
  );

  it(
    'diary directory persists across runs',
    async () => {
      const dirs = createTestDirs();
      mkdirSync(join(dirs.groupDir, 'diary'), { recursive: true });

      // First run: write to diary
      const container1 = await new GenericContainer(AGENT_IMAGE)
        .withEnvironment({ NANOCLAW_SCENARIO: 'echo' })
        .withBindMounts([
          { source: dirs.groupDir, target: '/workspace/group', mode: 'rw' },
          { source: dirs.ipcDir, target: '/workspace/ipc', mode: 'rw' },
          { source: dirs.claudeDir, target: '/home/node/.claude', mode: 'rw' },
        ])
        .withStartupTimeout(30000)
        .start();

      await container1.exec([
        'sh',
        '-c',
        'echo "Entry from run 1" > /workspace/group/diary/20240101.md',
      ]);
      await container1.stop();

      // Second run: verify file exists
      const container2 = await new GenericContainer(AGENT_IMAGE)
        .withEnvironment({ NANOCLAW_SCENARIO: 'echo' })
        .withBindMounts([
          { source: dirs.groupDir, target: '/workspace/group', mode: 'rw' },
          { source: dirs.ipcDir, target: '/workspace/ipc', mode: 'rw' },
          { source: dirs.claudeDir, target: '/home/node/.claude', mode: 'rw' },
        ])
        .withStartupTimeout(30000)
        .start();

      const catResult = await container2.exec([
        'cat',
        '/workspace/group/diary/20240101.md',
      ]);
      expect(catResult.output).toContain('Entry from run 1');
      await container2.stop();

      // Verify on host
      const diaryPath = join(dirs.groupDir, 'diary', '20240101.md');
      expect(existsSync(diaryPath)).toBe(true);
      expect(readFileSync(diaryPath, 'utf-8')).toContain('Entry from run 1');
    },
    TEST_TIMEOUT,
  );
});
