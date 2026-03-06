import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import {
  FILE_DENY_GLOBS,
  FILE_MAX_DOWNLOAD_BYTES,
  FILE_MAX_UPLOAD_BYTES,
  FILE_TRANSFER_ENABLED,
  GROUPS_DIR,
} from '../config.js';
import { logger } from '../logger.js';
import { CommandHandler } from './index.js';

// --- Path safety ---

function normalizeRelPath(value: string): string | null {
  const trimmed = value.trim().replace(/^\/+/, '');
  if (!trimmed || trimmed === '.') return null;
  if (trimmed.startsWith('~')) return null;
  const parts = trimmed.split('/');
  for (const p of parts) {
    if (p === '..' || p === '.git') return null;
  }
  return path.normalize(trimmed);
}

function resolveWithinRoot(root: string, rel: string): string | null {
  const resolved = path.resolve(root, rel);
  if (!resolved.startsWith(root + '/') && resolved !== root) return null;
  return resolved;
}

// Simple glob matcher for deny_globs. Supports **, *, and literal segments.
function globToRegex(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += glob[i + 2] === '/' ? '(?:.+/)?' : '.*';
      i += glob[i + 2] === '/' ? 3 : 2;
    } else if (c === '*') {
      re += '[^/]*';
      i++;
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesGlob(rel: string, glob: string): boolean {
  return globToRegex(glob).test(rel);
}

function denyReason(rel: string, globs: string[]): string | null {
  const allGlobs = globs.includes('.git/**') ? globs : ['.git/**', ...globs];
  for (const g of allGlobs) {
    if (matchesGlob(rel, g)) {
      return `denied by glob: ${g}`;
    }
  }
  return null;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// --- Handlers ---

const USAGE = [
  'Usage:',
  '  /file put [path] — upload a file (attach document)',
  '  /file get <path> — download a file',
  '  /file list [path] — list files in directory',
].join('\n');

const fileCommand: CommandHandler = {
  name: 'file',
  description: 'File transfer between chat and workspace',
  usage: '/file put|get|list [path]',
  async handle(ctx) {
    if (!FILE_TRANSFER_ENABLED) {
      await ctx.channel.sendMessage(
        ctx.groupJid,
        'File transfer is disabled (FILE_TRANSFER_ENABLED=false)',
      );
      return;
    }

    const parts = ctx.args.trim().split(/\s+/);
    const sub = parts[0]?.toLowerCase();
    const rest = parts.slice(1).join(' ');

    if (sub === 'put') {
      await handlePut(ctx, rest);
    } else if (sub === 'get') {
      await handleGet(ctx, rest);
    } else if (sub === 'list' || sub === 'ls') {
      await handleList(ctx, rest);
    } else {
      await ctx.channel.sendMessage(ctx.groupJid, USAGE);
    }
  },
};

async function handlePut(
  ctx: import('./index.js').CommandContext,
  rawPath: string,
): Promise<void> {
  const { channel, groupJid, group, attachments, download } = ctx;
  const root = path.join(GROUPS_DIR, group.folder);

  if (!attachments?.length || !download) {
    await channel.sendMessage(
      groupJid,
      'Attach a document with caption "/file put [path]"',
    );
    return;
  }

  const att = attachments[0];
  const originalName = att.filename || 'file';

  // Parse path: if empty, use incoming/<filename>; if ends with /, treat as dir
  let relTarget: string;
  const stripped = rawPath.replace(/^--force\s*/, '').trim();
  const force = rawPath.includes('--force');

  if (!stripped) {
    relTarget = `incoming/${originalName}`;
  } else if (stripped.endsWith('/')) {
    relTarget = `${stripped}${originalName}`;
  } else {
    relTarget = stripped;
  }

  const rel = normalizeRelPath(relTarget);
  if (!rel) {
    await channel.sendMessage(groupJid, `Invalid path: ${relTarget}`);
    return;
  }

  const denied = denyReason(rel, FILE_DENY_GLOBS);
  if (denied) {
    await channel.sendMessage(groupJid, `Denied: ${denied}`);
    return;
  }

  const abs = resolveWithinRoot(root, rel);
  if (!abs) {
    await channel.sendMessage(groupJid, 'Path escapes workspace root');
    return;
  }

  // Size check before download
  if (att.sizeBytes && att.sizeBytes > FILE_MAX_UPLOAD_BYTES) {
    await channel.sendMessage(
      groupJid,
      `File too large: ${humanSize(att.sizeBytes)} (max ${humanSize(FILE_MAX_UPLOAD_BYTES)})`,
    );
    return;
  }

  // Check if file exists and --force not set
  if (fs.existsSync(abs) && !force) {
    await channel.sendMessage(
      groupJid,
      `File already exists: ${rel}\nUse --force to overwrite`,
    );
    return;
  }

  let buf: Buffer;
  try {
    buf = await download(att, FILE_MAX_UPLOAD_BYTES);
  } catch (err) {
    logger.error({ err }, '/file put: download failed');
    await channel.sendMessage(groupJid, 'Failed to download file');
    return;
  }

  if (buf.length > FILE_MAX_UPLOAD_BYTES) {
    await channel.sendMessage(
      groupJid,
      `File too large: ${humanSize(buf.length)} (max ${humanSize(FILE_MAX_UPLOAD_BYTES)})`,
    );
    return;
  }

  // Atomic write: tempfile + rename
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.kanipi-upload-${crypto.randomBytes(8).toString('hex')}`,
  );
  try {
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, abs);
  } catch (err) {
    // Clean up temp file on failure
    try {
      fs.unlinkSync(tmp);
    } catch {}
    logger.error({ err, path: abs }, '/file put: write failed');
    await channel.sendMessage(groupJid, 'Failed to write file');
    return;
  }

  await channel.sendMessage(
    groupJid,
    `saved \`${rel}\` (${humanSize(buf.length)})`,
  );
  logger.info({ group: group.name, path: rel, size: buf.length }, '/file put');
}

async function handleGet(
  ctx: import('./index.js').CommandContext,
  rawPath: string,
): Promise<void> {
  const { channel, groupJid, group } = ctx;
  const root = path.join(GROUPS_DIR, group.folder);

  if (!rawPath.trim()) {
    await channel.sendMessage(groupJid, 'Usage: /file get <path>');
    return;
  }

  if (!channel.sendDocument) {
    await channel.sendMessage(
      groupJid,
      'This channel does not support file downloads',
    );
    return;
  }

  const rel = normalizeRelPath(rawPath);
  if (!rel) {
    await channel.sendMessage(groupJid, `Invalid path: ${rawPath}`);
    return;
  }

  const denied = denyReason(rel, FILE_DENY_GLOBS);
  if (denied) {
    await channel.sendMessage(groupJid, `Denied: ${denied}`);
    return;
  }

  const abs = resolveWithinRoot(root, rel);
  if (!abs) {
    await channel.sendMessage(groupJid, 'Path escapes workspace root');
    return;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    await channel.sendMessage(groupJid, `Not found: ${rel}`);
    return;
  }

  if (stat.isDirectory()) {
    // TODO: zip directory support — needs archiver or child process zip
    await channel.sendMessage(
      groupJid,
      'Directory download not yet supported. Specify a file path.',
    );
    return;
  }

  if (stat.size > FILE_MAX_DOWNLOAD_BYTES) {
    await channel.sendMessage(
      groupJid,
      `File too large: ${humanSize(stat.size)} (max ${humanSize(FILE_MAX_DOWNLOAD_BYTES)})`,
    );
    return;
  }

  try {
    await channel.sendDocument(groupJid, abs, path.basename(abs));
    logger.info({ group: group.name, path: rel, size: stat.size }, '/file get');
  } catch (err) {
    logger.error({ err, path: abs }, '/file get: send failed');
    await channel.sendMessage(groupJid, 'Failed to send file');
  }
}

async function handleList(
  ctx: import('./index.js').CommandContext,
  rawPath: string,
): Promise<void> {
  const { channel, groupJid, group } = ctx;
  const root = path.join(GROUPS_DIR, group.folder);

  let abs: string;
  let rel: string;
  if (!rawPath.trim()) {
    abs = root;
    rel = '.';
  } else {
    const n = normalizeRelPath(rawPath);
    if (!n) {
      await channel.sendMessage(groupJid, `Invalid path: ${rawPath}`);
      return;
    }
    rel = n;

    const denied = denyReason(rel, FILE_DENY_GLOBS);
    if (denied) {
      await channel.sendMessage(groupJid, `Denied: ${denied}`);
      return;
    }

    const resolved = resolveWithinRoot(root, rel);
    if (!resolved) {
      await channel.sendMessage(groupJid, 'Path escapes workspace root');
      return;
    }
    abs = resolved;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    await channel.sendMessage(groupJid, `Not found or not a directory: ${rel}`);
    return;
  }

  // Filter out denied entries
  const visible = entries.filter((e) => {
    const entryRel = rel === '.' ? e.name : `${rel}/${e.name}`;
    return (
      !denyReason(entryRel, FILE_DENY_GLOBS) &&
      !e.name.startsWith('.kanipi-upload-')
    );
  });

  if (visible.length === 0) {
    await channel.sendMessage(groupJid, `${rel}: (empty)`);
    return;
  }

  const lines: string[] = [];
  for (const e of visible.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) {
      lines.push(`  ${e.name}/`);
    } else {
      try {
        const s = fs.statSync(path.join(abs, e.name));
        lines.push(`  ${e.name}  ${humanSize(s.size)}`);
      } catch {
        lines.push(`  ${e.name}`);
      }
    }
  }

  const header = rel === '.' ? 'workspace root' : rel;
  await channel.sendMessage(groupJid, `${header}:\n${lines.join('\n')}`);
}

export default fileCommand;

// Exported for testing
export { normalizeRelPath, resolveWithinRoot, denyReason, humanSize };
