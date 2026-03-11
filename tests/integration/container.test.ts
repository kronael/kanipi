/**
 * Container integration tests using testcontainers.
 *
 * These tests spawn real docker containers with the kanipi-agent image and
 * verify the I/O protocol. Scenario mode in agent-runner skips real Claude SDK
 * calls, returning canned responses for fast, deterministic tests.
 *
 * Prerequisites:
 * - Docker must be accessible (user in docker group or use sudo)
 * - Agent image must be built: `make agent-image`
 *
 * Run with: make integration
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer } from 'testcontainers';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'fs';
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
  console.warn('Docker not accessible, integration tests will be skipped');
}

// Shared temp dir for all tests in this file
let tmpDir: string;
let testCounter = 0;

function createTestDirs(): {
  groupDir: string;
  ipcDir: string;
} {
  testCounter++;
  const groupDir = join(tmpDir, `group-${testCounter}`);
  const ipcDir = join(tmpDir, `ipc-${testCounter}`);
  mkdirSync(groupDir, { recursive: true });
  mkdirSync(join(groupDir, '.claude'), { recursive: true });
  mkdirSync(join(ipcDir, 'input'), { recursive: true });
  mkdirSync(join(ipcDir, 'requests'), { recursive: true });
  mkdirSync(join(ipcDir, 'replies'), { recursive: true });
  return { groupDir, ipcDir };
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

interface ContainerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runContainer(
  scenario: string,
  input: string,
  dirs: { groupDir: string; ipcDir: string },
): Promise<ContainerResult> {
  const container = await new GenericContainer(AGENT_IMAGE)
    .withEnvironment({ NANOCLAW_SCENARIO: scenario })
    .withBindMounts([
      { source: dirs.groupDir, target: '/home/node', mode: 'rw' },
      { source: dirs.ipcDir, target: '/workspace/ipc', mode: 'rw' },
    ])
    .withStartupTimeout(30000)
    .start();

  // Escape single quotes in input for shell
  const escapedInput = input.replace(/'/g, "'\\''");
  const execResult = await container.exec([
    'sh',
    '-c',
    `echo '${escapedInput}' | node /tmp/dist/index.js`,
  ]);

  const stdout = execResult.output;
  const exitCode = execResult.exitCode;

  await container.stop();

  return { stdout, stderr: '', exitCode };
}

beforeAll(() => {
  if (dockerAvailable) {
    tmpDir = mkdtempSync(join(tmpdir(), 'kanipi-integration-'));
  }
});

afterAll(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe.skipIf(!dockerAvailable)(
  'container integration — scenario mode',
  () => {
    it(
      'echo scenario returns prompt in result',
      async () => {
        const dirs = createTestDirs();
        const input = buildContainerInput('hello world');

        const result = await runContainer('echo', input, dirs);

        expect(result.stdout).toContain('---NANOCLAW_OUTPUT_START---');
        expect(result.stdout).toContain('---NANOCLAW_OUTPUT_END---');
        expect(result.stdout).toContain('Echo: hello world');
        expect(result.stdout).toContain('scenario-session-1');
      },
      TEST_TIMEOUT,
    );

    it(
      'error scenario returns error status',
      async () => {
        const dirs = createTestDirs();
        const input = buildContainerInput('fail please');

        const result = await runContainer('error', input, dirs);

        expect(result.stdout).toContain('---NANOCLAW_OUTPUT_START---');
        expect(result.stdout).toContain('"status":"error"');
        expect(result.stdout).toContain('Scenario error');
      },
      TEST_TIMEOUT,
    );

    it(
      'default scenario returns default response',
      async () => {
        const dirs = createTestDirs();
        const input = buildContainerInput('unknown command');

        const result = await runContainer('unknown-scenario', input, dirs);

        expect(result.stdout).toContain('default-scenario');
        expect(result.stdout).toContain('scenario-session-0');
      },
      TEST_TIMEOUT,
    );
  },
);

describe.skipIf(!dockerAvailable)(
  'container integration — volume mounts',
  () => {
    it(
      'session-persist writes to group directory',
      async () => {
        const dirs = createTestDirs();
        const input = buildContainerInput('persist session data');

        await runContainer('session-persist', input, dirs);

        const markerPath = join(dirs.groupDir, '.session-marker');
        expect(existsSync(markerPath)).toBe(true);
        const content = readFileSync(markerPath, 'utf-8');
        expect(content).toMatch(/^session-\d+$/);
      },
      TEST_TIMEOUT,
    );
  },
);
