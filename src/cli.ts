#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';

import { hashSync } from '@node-rs/argon2';
import Database from 'better-sqlite3';

import { ensureDatabase } from './migrations.js';

// --- Utility functions ---

const PREFIX = process.env.PREFIX || '/srv';

function getDataDir(instance: string): string {
  return `${PREFIX}/data/kanipi_${instance}`;
}

function getDbPath(instance: string): string {
  return path.join(getDataDir(instance), 'store', 'messages.db');
}

function readEnvValue(envPath: string, key: string): string | undefined {
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const k = trimmed.slice(0, eqIdx).trim();
      if (k !== key) continue;
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return value || undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// --- group commands ---

interface GroupRow {
  folder: string;
  name: string;
}

interface RouteRow {
  jid: string;
  target: string;
}

interface ChatRow {
  jid: string;
  name: string;
  channel: string;
}

function groupList(instance: string): void {
  const dbPath = getDbPath(instance);
  if (!fs.existsSync(dbPath)) {
    console.error(`no db: ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true });
  const groupRows = db
    .prepare('SELECT folder, name FROM groups')
    .all() as GroupRow[];
  const routeRows = db
    .prepare("SELECT jid, target FROM routes WHERE type = 'default'")
    .all() as RouteRow[];
  const chats = db
    .prepare('SELECT jid, name, channel FROM chats WHERE is_group = 1')
    .all() as ChatRow[];
  db.close();

  // Build folder -> JIDs map
  const folderJids = new Map<string, string[]>();
  for (const r of routeRows) {
    const arr = folderJids.get(r.target) || [];
    arr.push(r.jid);
    folderJids.set(r.target, arr);
  }

  const routedJids = new Set(routeRows.map((r) => r.jid));

  console.log('groups:');
  if (!groupRows.length) console.log('  (none)');
  for (const g of groupRows) {
    const jids = folderJids.get(g.folder) || [];
    const jidStr = jids.length > 0 ? jids.join(', ') : '(no routes)';
    console.log(`  ${g.folder}  ${g.name}  [${jidStr}]`);
  }

  const discovered = chats.filter((c) => !routedJids.has(c.jid));
  if (discovered.length) {
    console.log('discovered:');
    for (const c of discovered) {
      console.log(`  ${c.jid}  ${c.channel || ''}  ${c.name || ''}`);
    }
  }
}

function groupAdd(instance: string, folder?: string): void {
  const dataDir = getDataDir(instance);
  const dbPath = getDbPath(instance);

  // Ensure DB exists with schema
  const db = ensureDatabase(dbPath);

  const envPath = path.join(dataDir, '.env');
  const assistant = readEnvValue(envPath, 'ASSISTANT_NAME') || instance;

  const groupCount = (
    db.prepare('SELECT COUNT(*) as n FROM groups').get() as { n: number }
  ).n;
  const finalFolder = folder || (groupCount === 0 ? 'root' : '');

  if (!finalFolder) {
    console.error('usage: kanipi config <instance> group add <folder>');
    db.close();
    process.exit(1);
  }

  const rt = groupCount === 0 ? 0 : 1;
  const trigger = rt ? `@${assistant}` : '';
  const now = new Date().toISOString();

  const existingGroup = db
    .prepare('SELECT folder FROM groups WHERE folder = ?')
    .get(finalFolder);

  if (!existingGroup) {
    db.prepare(
      `INSERT INTO groups
       (folder, name, added_at, container_config, parent, trigger_pattern, requires_trigger, slink_token, max_children)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(finalFolder, finalFolder, now, null, null, trigger, rt, null, 50);
  }

  db.close();

  fs.mkdirSync(path.join(dataDir, 'groups', finalFolder, 'logs'), {
    recursive: true,
  });

  console.log(`added: ${finalFolder}`);
}

function groupRm(instance: string, folder: string): void {
  if (!folder) {
    console.error('usage: kanipi config <instance> group rm <folder>');
    process.exit(1);
  }

  const dbPath = getDbPath(instance);
  if (!fs.existsSync(dbPath)) {
    console.error(`no db: ${dbPath}`);
    process.exit(1);
  }

  if (folder === 'root') {
    console.error('refused: cannot remove root group');
    process.exit(1);
  }

  const db = new Database(dbPath);

  const existing = db
    .prepare('SELECT folder FROM groups WHERE folder = ?')
    .get(folder);

  if (!existing) {
    console.error(`not found: ${folder}`);
    db.close();
    process.exit(1);
  }

  db.prepare('DELETE FROM routes WHERE target = ?').run(folder);
  db.prepare('DELETE FROM groups WHERE folder = ?').run(folder);
  db.close();

  console.log(`removed: ${folder} (folder kept: groups/${folder})`);
}

// --- mount commands ---

interface MountEntry {
  hostPath: string;
  containerPath?: string;
  readonly?: boolean;
}

interface ContainerConfig {
  additionalMounts?: MountEntry[];
}

function mountList(instance: string): void {
  const dbPath = getDbPath(instance);
  if (!fs.existsSync(dbPath)) {
    console.error(`error: db not found: ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true });
  const rows = db
    .prepare(
      'SELECT folder, container_config FROM groups WHERE container_config IS NOT NULL',
    )
    .all() as Array<{ folder: string; container_config: string }>;
  db.close();

  let any = false;
  for (const r of rows) {
    try {
      const cfg = JSON.parse(r.container_config) as ContainerConfig;
      if (cfg.additionalMounts && cfg.additionalMounts.length) {
        for (const m of cfg.additionalMounts) {
          any = true;
          const ro = m.readonly !== false ? 'ro' : 'rw';
          const cname = m.containerPath || path.basename(m.hostPath);
          console.log(
            `${r.folder}  ${m.hostPath}  -> /workspace/extra/${cname}  ${ro}`,
          );
        }
      }
    } catch {
      /* invalid JSON */
    }
  }
  if (!any) console.log('(no mounts)');
}

function mountAdd(
  instance: string,
  folder: string,
  hostPath: string,
  containerName?: string,
  rw?: string,
): void {
  if (!folder || !hostPath) {
    console.error(
      'usage: kanipi config <instance> mount add <folder> <host-path> [container-name] [rw]',
    );
    process.exit(1);
  }

  const dbPath = getDbPath(instance);
  if (!fs.existsSync(dbPath)) {
    console.error(`error: db not found: ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath);
  const row = db
    .prepare('SELECT container_config FROM groups WHERE folder = ?')
    .get(folder) as { container_config: string | null } | undefined;

  if (!row) {
    console.error(`group not found: ${folder}`);
    db.close();
    process.exit(1);
  }

  const cfg: ContainerConfig = row.container_config
    ? (JSON.parse(row.container_config) as ContainerConfig)
    : {};
  cfg.additionalMounts = cfg.additionalMounts || [];

  const cname = containerName || path.basename(hostPath);
  const dup = cfg.additionalMounts.find(
    (m) => (m.containerPath || path.basename(m.hostPath)) === cname,
  );

  if (dup) {
    console.error(`mount already exists: ${cname}`);
    db.close();
    process.exit(1);
  }

  const readonly = rw !== 'rw';
  cfg.additionalMounts.push({ hostPath, containerPath: cname, readonly });

  db.prepare('UPDATE groups SET container_config = ? WHERE folder = ?').run(
    JSON.stringify(cfg),
    folder,
  );
  db.close();

  console.log(
    `added: ${hostPath} -> /workspace/extra/${cname}  ${readonly ? 'ro' : 'rw'}`,
  );
}

function mountRm(
  instance: string,
  folder: string,
  containerName: string,
): void {
  if (!folder || !containerName) {
    console.error(
      'usage: kanipi config <instance> mount rm <folder> <container-name>',
    );
    process.exit(1);
  }

  const dbPath = getDbPath(instance);
  if (!fs.existsSync(dbPath)) {
    console.error(`error: db not found: ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath);
  const row = db
    .prepare('SELECT container_config FROM groups WHERE folder = ?')
    .get(folder) as { container_config: string | null } | undefined;

  if (!row) {
    console.error(`group not found: ${folder}`);
    db.close();
    process.exit(1);
  }

  const cfg: ContainerConfig = row.container_config
    ? (JSON.parse(row.container_config) as ContainerConfig)
    : {};

  if (!cfg.additionalMounts || !cfg.additionalMounts.length) {
    console.error('no mounts');
    db.close();
    process.exit(1);
  }

  const before = cfg.additionalMounts.length;
  cfg.additionalMounts = cfg.additionalMounts.filter(
    (m) => (m.containerPath || path.basename(m.hostPath)) !== containerName,
  );

  if (cfg.additionalMounts.length === before) {
    console.error(`mount not found: ${containerName}`);
    db.close();
    process.exit(1);
  }

  const val = cfg.additionalMounts.length ? JSON.stringify(cfg) : null;
  db.prepare('UPDATE groups SET container_config = ? WHERE folder = ?').run(
    val,
    folder,
  );
  db.close();

  console.log(`removed: ${containerName}`);
}

// --- user commands ---

interface AuthUserRow {
  sub: string;
  username: string;
  name: string;
  created_at: string;
}

function userList(instance: string): void {
  const dbPath = getDbPath(instance);
  if (!fs.existsSync(dbPath)) {
    console.error(`error: db not found: ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true });
  let rows: AuthUserRow[];
  try {
    rows = db
      .prepare('SELECT sub, username, name, created_at FROM auth_users')
      .all() as AuthUserRow[];
  } catch {
    rows = [];
  }
  db.close();

  if (!rows.length) {
    console.log('(no users)');
    return;
  }

  for (const r of rows) {
    console.log(`${r.sub}  ${r.username}  ${r.name}  ${r.created_at}`);
  }
}

function userAdd(instance: string, username: string, password: string): void {
  if (!username || !password) {
    console.error(
      'usage: kanipi config <instance> user add <username> <password>',
    );
    process.exit(1);
  }

  const dbPath = getDbPath(instance);
  const db = ensureDatabase(dbPath);

  const sub = `local:${crypto.randomUUID()}`;
  const hash = hashSync(password);
  const now = new Date().toISOString();

  try {
    db.prepare(
      'INSERT INTO auth_users (sub, username, hash, name, created_at) VALUES (?,?,?,?,?)',
    ).run(sub, username, hash, username, now);
    console.log(`added: ${username} (${sub})`);
  } catch (err) {
    console.error(`failed to add user: ${err}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

function userRm(instance: string, username: string): void {
  if (!username) {
    console.error('usage: kanipi config <instance> user rm <username>');
    process.exit(1);
  }

  const dbPath = getDbPath(instance);
  if (!fs.existsSync(dbPath)) {
    console.error(`error: db not found: ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath);
  try {
    const r = db
      .prepare('DELETE FROM auth_users WHERE username = ?')
      .run(username);
    console.log(r.changes ? `removed: ${username}` : `not found: ${username}`);
  } finally {
    db.close();
  }
}

function userPasswd(
  instance: string,
  username: string,
  password: string,
): void {
  if (!username || !password) {
    console.error(
      'usage: kanipi config <instance> user passwd <username> <password>',
    );
    process.exit(1);
  }

  const dbPath = getDbPath(instance);
  if (!fs.existsSync(dbPath)) {
    console.error(`error: db not found: ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath);
  const hash = hashSync(password);

  try {
    const r = db
      .prepare('UPDATE auth_users SET hash = ? WHERE username = ?')
      .run(hash, username);
    console.log(r.changes ? `updated: ${username}` : `not found: ${username}`);
  } finally {
    db.close();
  }
}

// --- create command ---

function create(name: string): void {
  if (!name) {
    console.error('usage: kanipi create <name>');
    process.exit(1);
  }

  const dataDir = getDataDir(name);
  if (fs.existsSync(dataDir)) {
    console.error(`exists: ${dataDir}`);
    process.exit(1);
  }

  // Create directories
  fs.mkdirSync(path.join(dataDir, 'groups', 'root', 'logs'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(dataDir, 'store'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'web'), { recursive: true });
  fs.mkdirSync(`${PREFIX}/run/kanipi_${name}`, { recursive: true });

  // chown to uid/gid 1000 (node)
  fs.chownSync(path.join(dataDir, 'groups'), 1000, 1000);
  fs.chownSync(path.join(dataDir, 'groups', 'root'), 1000, 1000);
  fs.chownSync(path.join(dataDir, 'groups', 'root', 'logs'), 1000, 1000);
  fs.chownSync(path.join(dataDir, 'data'), 1000, 1000);

  // Find prototype dir (was template/; check prototype/ first for compat)
  const appDir = process.env.APP_DIR || '';
  const srcDir = path.dirname(new URL(import.meta.url).pathname);
  let templateDir =
    (appDir && fs.existsSync(path.join(appDir, 'prototype'))
      ? path.join(appDir, 'prototype')
      : appDir && fs.existsSync(path.join(appDir, 'template'))
        ? path.join(appDir, 'template')
        : '') ||
    (fs.existsSync(path.resolve(srcDir, '..', 'prototype'))
      ? path.resolve(srcDir, '..', 'prototype')
      : path.resolve(srcDir, '..', 'template'));

  // Copy and configure .env
  const envSrc = path.join(templateDir, 'env.example');
  const envDst = path.join(dataDir, '.env');
  if (fs.existsSync(envSrc)) {
    let envContent = fs.readFileSync(envSrc, 'utf-8');
    envContent = envContent.replace(
      /^ASSISTANT_NAME=.*/m,
      `ASSISTANT_NAME=${name}`,
    );
    const slothPass = crypto.randomBytes(8).toString('hex');
    envContent = envContent.replace(
      /^SLOTH_USERS=.*/m,
      `SLOTH_USERS=admin:${slothPass}`,
    );
    fs.writeFileSync(envDst, envContent);
    console.log(`created: ${envDst}`);
  }

  // Seed web template
  const webTemplateSrc = path.join(templateDir, 'web');
  const webDst = path.join(dataDir, 'web');
  if (fs.existsSync(webTemplateSrc)) {
    copyDirRecursive(webTemplateSrc, webDst);
  }

  // Generate systemd unit
  const servicePath = path.join(dataDir, `kanipi_${name}.service`);
  const serviceContent = `[Unit]
Description=kanipi ${name}
After=docker.service
Requires=docker.service

[Service]
StartLimitInterval=0
StartLimitBurst=100
RestartSec=1
TimeoutStartSec=infinity
Restart=always

ExecStartPre=-/usr/bin/docker stop %n
ExecStartPre=-/usr/bin/docker rm -f %n
ExecStop=/usr/bin/docker rm -f %n
ExecStart=/usr/bin/docker run -i --rm --name %n \\
    --network=host \\
    -v ${dataDir}:/srv/app/home \\
    -v ${PREFIX}/run/kanipi_${name}:${PREFIX}/run/kanipi_${name} \\
    -v /var/run/docker.sock:/var/run/docker.sock \\
    -e DATA_DIR=/srv/app/home \\
    -e HOST_DATA_DIR=${dataDir} \\
    -e HOST_APP_DIR=${dataDir}/self \\
    kanipi \\
    ./kanipi ${name}

SyslogIdentifier=kanipi_${name}
SyslogFacility=local3

[Install]
WantedBy=default.target
`;

  fs.writeFileSync(servicePath, serviceContent);
  console.log(`generated: ${servicePath}`);
  console.log('');
  console.log('next:');
  console.log(`  1. edit ${envDst}  (TELEGRAM_BOT_TOKEN)`);
  console.log('  2. make image && make agent-image');
}

function copyDirRecursive(src: string, dst: string): void {
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(dst, { recursive: true });
  }
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else if (!fs.existsSync(dstPath)) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// --- run command (instance runner) ---

function runInstance(instance: string): void {
  const dataDir = '/srv/app/home';
  const hostDataDir = process.env.HOST_DATA_DIR || getDataDir(instance);
  const envPath = path.join(dataDir, '.env');

  if (!fs.existsSync(envPath)) {
    console.error(`no .env in ${dataDir}`);
    process.exit(1);
  }

  // Copy container and template assets
  fs.mkdirSync(path.join(dataDir, 'self'), { recursive: true });
  copyDirRecursive(
    '/srv/app/container',
    path.join(dataDir, 'self', 'container'),
  );
  const protoSrc = fs.existsSync('/srv/app/prototype')
    ? '/srv/app/prototype'
    : '/srv/app/template';
  copyDirRecursive(protoSrc, path.join(dataDir, 'self', 'prototype'));

  // Set environment variables
  process.env.DATA_DIR = dataDir;
  process.env.HOST_DATA_DIR = hostDataDir;
  process.env.HOST_APP_DIR = path.join(hostDataDir, 'self');

  // Read web config
  let webPort = readEnvValue(envPath, 'WEB_PORT');
  if (!webPort) {
    webPort = readEnvValue(envPath, 'VITE_PORT');
  }
  const webHost = readEnvValue(envPath, 'WEB_HOST');
  if (webHost) {
    process.env.WEB_HOST = webHost;
  }

  let vitePortInternal: number | undefined;
  if (webPort) {
    const suffix = parseInt(webPort, 10) % 1000;
    vitePortInternal = 48000 + suffix;
    process.env.VITE_PORT_INTERNAL = vitePortInternal.toString();
  }

  // Install web deps if missing
  const webDir = path.join(dataDir, 'web');
  if (
    webPort &&
    fs.existsSync(webDir) &&
    !fs.existsSync(path.join(webDir, 'node_modules'))
  ) {
    const npm = spawn('npm', ['install', '--silent'], {
      cwd: webDir,
      stdio: 'inherit',
    });
    npm.on('close', () => startServices(webPort, vitePortInternal, webDir));
  } else {
    startServices(webPort, vitePortInternal, webDir);
  }
}

function startServices(
  webPort: string | undefined,
  vitePortInternal: number | undefined,
  webDir: string,
): void {
  // Start gateway
  const gateway = spawn('node', ['/srv/app/dist/index.js'], {
    stdio: 'inherit',
    env: process.env,
  });

  let vite: ChildProcess | undefined;

  // Start vite if configured
  if (webPort && fs.existsSync(webDir) && vitePortInternal) {
    fs.mkdirSync('/srv/app/tmp', { recursive: true });

    const startVite = () => {
      const v = spawn(
        'npx',
        ['vite', '--host', '127.0.0.1', '--port', vitePortInternal.toString()],
        {
          cwd: webDir,
          stdio: 'inherit',
          env: process.env,
        },
      );
      fs.writeFileSync('/srv/app/tmp/vite.pid', v.pid?.toString() || '');
      v.on('close', () => {
        setTimeout(startVite, 1000);
      });
      return v;
    };
    vite = startVite();
  }

  // Handle signals
  const cleanup = () => {
    gateway.kill();
    if (vite) vite.kill();
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  gateway.on('close', (code) => {
    if (vite) vite.kill();
    process.exit(code || 0);
  });
}

// --- CLI dispatch ---

function printUsage(): void {
  console.log('usage: kanipi <instance>');
  console.log('       kanipi create <name>');
  console.log('       kanipi config <instance> group list');
  console.log('       kanipi config <instance> user {list|add|rm|passwd} ...');
  console.log('       kanipi config <instance> mount {list|add|rm} ...');
}

function handleConfig(args: string[]): void {
  const instance = args[0];
  const resource = args[1];
  const action = args[2];

  if (!instance) {
    console.error('usage: kanipi config <instance> {group|user|mount} ...');
    process.exit(1);
  }

  switch (resource) {
    case 'group':
      switch (action) {
        case 'list':
          groupList(instance);
          break;
        case 'add':
          groupAdd(instance, args[3]);
          break;
        case 'rm':
          groupRm(instance, args[3]);
          break;
        default:
          console.error(
            'usage: kanipi config <instance> group {list|add|rm} ...',
          );
          process.exit(1);
      }
      break;
    case 'user':
      switch (action) {
        case 'list':
          userList(instance);
          break;
        case 'add':
          userAdd(instance, args[3], args[4]);
          break;
        case 'rm':
          userRm(instance, args[3]);
          break;
        case 'passwd':
          userPasswd(instance, args[3], args[4]);
          break;
        default:
          console.error(
            'usage: kanipi config <instance> user {list|add|rm|passwd} ...',
          );
          process.exit(1);
      }
      break;
    case 'mount':
      switch (action) {
        case 'list':
          mountList(instance);
          break;
        case 'add':
          mountAdd(instance, args[3], args[4], args[5], args[6]);
          break;
        case 'rm':
          mountRm(instance, args[3], args[4]);
          break;
        default:
          console.error(
            'usage: kanipi config <instance> mount {list|add|rm} ...',
          );
          process.exit(1);
      }
      break;
    default:
      console.error('usage: kanipi config <instance> {group|user|mount} ...');
      process.exit(1);
  }
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  if (args[0] === '--version' || args[0] === '-V') {
    console.log('1.0.6');
    process.exit(0);
  }

  const cmd = args[0];

  switch (cmd) {
    case 'config':
      handleConfig(args.slice(1));
      break;
    case 'create':
      create(args[1]);
      break;
    default:
      // Legacy: kanipi <instance> group ... (shorthand for config <instance> group)
      if (args[1] === 'group') {
        const instance = args[0];
        const action = args[2];
        switch (action) {
          case 'list':
            groupList(instance);
            break;
          case 'add':
            groupAdd(instance, args[3]);
            break;
          case 'rm':
            groupRm(instance, args[3]);
            break;
          default:
            console.error('usage: kanipi <instance> group {list|add|rm} ...');
            process.exit(1);
        }
      } else {
        // Run instance
        runInstance(cmd);
      }
  }
}

main();
