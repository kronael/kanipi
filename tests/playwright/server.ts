import http from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Point DATA_DIR to a temp dir so config.ts won't try to read a real .env
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanipi-play-'));
process.env.DATA_DIR = tmpDir;
process.env.NODE_ENV = 'test';
process.env.CONTAINER_IMAGE = 'test-agent:latest';
process.env.MAX_CONCURRENT_CONTAINERS = '3';

async function main() {
  const { _initTestDatabase, setGroupConfig, storeChatMetadata, createTask } =
    await import('../../src/db.js');
  _initTestDatabase();

  // Seed test data
  setGroupConfig({
    folder: 'root',
    name: 'Root',
    added_at: '2025-01-01T00:00:00.000Z',
  });
  setGroupConfig({
    folder: 'happy',
    name: 'Happy',
    added_at: '2025-06-01T00:00:00.000Z',
  });

  storeChatMetadata(
    'telegram:-123456',
    '2025-01-10T00:00:00.000Z',
    'Alice',
    'telegram',
  );
  storeChatMetadata(
    'telegram:789',
    '2025-02-20T00:00:00.000Z',
    'Bob',
    'telegram',
  );

  createTask({
    id: 'task-1',
    group_folder: 'root',
    chat_jid: 'telegram:-123456',
    prompt: 'daily summary',
    command: null,
    schedule_type: 'cron',
    schedule_value: '0 9 * * *',
    context_mode: 'isolated',
    next_run: '2025-01-11T09:00:00.000Z',
    status: 'active',
    created_at: '2025-01-01T00:00:00.000Z',
  });

  const { handleDashRequest } = await import('../../src/dashboards/index.js');

  const ctx = {
    queue: {
      getStatus: () => [
        {
          jid: 'telegram:-123456',
          active: true,
          idleWaiting: false,
          pendingMessages: 2,
          pendingTasks: 0,
          failures: 0,
          groupFolder: 'root',
          containerName: 'nanoclaw-root-111',
        },
        {
          jid: 'telegram:789',
          active: false,
          idleWaiting: true,
          pendingMessages: 0,
          pendingTasks: 1,
          failures: 3,
          groupFolder: 'happy',
          containerName: null,
        },
      ],
    },
    channels: [{ name: 'telegram' }, { name: 'whatsapp' }, { name: 'discord' }],
  };

  const server = http.createServer((req, res) => {
    handleDashRequest(req, res, ctx as any);
  });

  const port = parseInt(process.env.TEST_PORT || '9876', 10);
  server.listen(port, () => {
    console.log(`http://localhost:${port}`);
  });

  process.on('SIGTERM', () => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  process.on('SIGINT', () => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
}

main();
