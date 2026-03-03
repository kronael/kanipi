import crypto from 'crypto';

import type { OnInboundMessage, RegisteredGroup } from './types.js';

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
  group: (RegisteredGroup & { jid: string }) | undefined;
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
  const anonRpm =
    req.anonRpm ?? (parseInt(process.env.SLINK_ANON_RPM ?? '') || 10);
  const authRpm =
    req.authRpm ?? (parseInt(process.env.SLINK_AUTH_RPM ?? '') || 60);

  if (!group) return { status: 404, body: '{"error":"not found"}' };

  // Verify JWT signature when a Bearer token is present
  let jwt: { sub?: string; name?: string } | null = null;
  if (authHeader?.startsWith('Bearer ')) {
    const raw = authHeader.slice(7);
    if (authSecret) {
      const result = verifyJwt(raw, authSecret);
      if (result === 'invalid')
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
  try {
    const parsed = JSON.parse(body);
    text = String(parsed.text ?? '');
  } catch {
    return { status: 400, body: '{"error":"bad request"}' };
  }

  const jid = group.jid;
  onMessage(jid, {
    id: `slink-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    chat_jid: jid,
    sender,
    ...(senderName !== undefined && { sender_name: senderName }),
    content: text,
    timestamp: new Date().toISOString(),
  });

  return { status: 200, body: '{"ok":true}' };
}

export function generateSlinkToken(): string {
  return crypto.randomBytes(12).toString('base64url');
}

/** @internal - for tests only */
export function _resetRateLimitBuckets(): void {
  anonBuckets.clear();
  authBuckets.clear();
}
