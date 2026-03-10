import crypto from 'crypto';

import { SLINK_ANON_RPM, SLINK_AUTH_RPM } from './config.js';
import type {
  AttachmentDownloader,
  AttachmentType,
  RawAttachment,
} from './mime.js';
import type { GroupConfig } from './db.js';
import type { OnInboundMessage } from './types.js';

type Bucket = [count: number, resetAt: number];

// In-memory rate limit buckets (anon: per slink token, auth: per JWT sub)
const anonBuckets = new Map<string, Bucket>();
const authBuckets = new Map<string, Bucket>();

function allowed(
  buckets: Map<string, Bucket>,
  key: string,
  rpm: number,
): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b[1]) {
    buckets.set(key, [1, now + 60_000]);
    return true;
  }
  if (b[0] >= rpm) return false;
  b[0]++;
  return true;
}

function parseJwt(header: string): { sub?: string; name?: string } | null {
  if (!header.startsWith('Bearer ')) return null;
  const parts = header.slice(7).split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// Returns parsed claims on valid sig, null on expired/invalid, 'invalid' on bad sig
function verifyJwt(
  token: string,
  secret: string,
): { sub?: string; name?: string } | null | 'invalid' {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return 'invalid';
    const [header, payload, sig] = parts;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    if (expected !== sig) return 'invalid';
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { sub?: string; name?: string; exp?: number };
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return 'invalid';
  }
}

function anonSender(ip: string): string {
  const h = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 8);
  return `anon_${h}`;
}

export interface SlinkRequest {
  token: string;
  body: string;
  ip: string;
  authHeader?: string;
  authSecret?: string;
  group: (GroupConfig & { jid: string }) | undefined;
  onMessage: OnInboundMessage;
  anonRpm?: number;
  authRpm?: number;
}

export interface SlinkResponse {
  status: number;
  body: string;
}

export function handleSlinkPost(req: SlinkRequest): SlinkResponse {
  const { token, group, ip, authHeader, authSecret, body, onMessage } = req;
  const anonRpm = req.anonRpm ?? SLINK_ANON_RPM;
  const authRpm = req.authRpm ?? SLINK_AUTH_RPM;

  if (!group) return { status: 404, body: '{"error":"not found"}' };

  // Verify JWT signature when a Bearer token is present
  let jwt: { sub?: string; name?: string } | null = null;
  if (authHeader?.startsWith('Bearer ')) {
    const raw = authHeader.slice(7);
    if (authSecret) {
      const result = verifyJwt(raw, authSecret);
      if (result === 'invalid' || result === null)
        return { status: 401, body: '{"error":"unauthorized"}' };
      jwt = result;
    } else {
      jwt = parseJwt(authHeader);
    }
  }
  const sender = jwt?.sub ?? anonSender(ip);
  const senderName = jwt?.name;

  if (jwt?.sub) {
    if (!allowed(authBuckets, jwt.sub, authRpm))
      return { status: 429, body: '{"error":"rate limited"}' };
  } else {
    if (!allowed(anonBuckets, token, anonRpm))
      return { status: 429, body: '{"error":"rate limited"}' };
  }

  let text: string;
  let mediaUrl: string | undefined;
  try {
    const parsed = JSON.parse(body);
    text = String(parsed.text ?? '');
    if (parsed.media_url && typeof parsed.media_url === 'string') {
      mediaUrl = parsed.media_url;
    }
  } catch {
    return { status: 400, body: '{"error":"bad request"}' };
  }

  const jid = group.jid;
  const msgId = `slink-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let attachments: RawAttachment[] | undefined;
  let download: AttachmentDownloader | undefined;
  if (mediaUrl) {
    const type: AttachmentType = guessType(mediaUrl);
    attachments = [{ type, source: { kind: 'discord', url: mediaUrl } }];
    download = async (_a, maxBytes) => {
      const res = await fetch(mediaUrl as string);
      if (!res.ok) throw new Error(`slink media fetch HTTP ${res.status}`);
      const contentLength = parseInt(
        res.headers.get('content-length') || '0',
        10,
      );
      if (contentLength > maxBytes)
        throw new Error(`file too large: ${contentLength} > ${maxBytes}`);
      return Buffer.from(await res.arrayBuffer());
    };
  }

  onMessage(
    jid,
    {
      id: msgId,
      chat_jid: jid,
      sender,
      ...(senderName !== undefined && { sender_name: senderName }),
      content: text,
      timestamp: new Date().toISOString(),
    },
    attachments,
    download,
  );

  return { status: 200, body: '{"ok":true}' };
}

function guessType(url: string): AttachmentType {
  const lower = url.split('?')[0].toLowerCase();
  if (/\.(mp4|mov|webm|mkv|avi)$/.test(lower)) return 'video';
  if (/\.(mp3|ogg|wav|flac|m4a)$/.test(lower)) return 'audio';
  if (/\.(jpg|jpeg|png|gif|webp|avif|bmp)$/.test(lower)) return 'image';
  return 'document';
}

export function generateSlinkToken(): string {
  return crypto.randomBytes(12).toString('base64url');
}

/** @internal - for tests only */
export function _resetRateLimitBuckets(): void {
  anonBuckets.clear();
  authBuckets.clear();
}
