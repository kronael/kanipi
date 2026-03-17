import { getAllRoutes, getDatabase } from './db.js';
import { permissionTier } from './config.js';
import { worldOf } from './permissions.js';

export type Rule = string;

interface ParsedRule {
  deny: boolean;
  action: string;
  params: Map<string, string>;
}

// Social actions that tier 1/2 get per-platform
const SOCIAL_ACTIONS = [
  'post',
  'reply',
  'react',
  'repost',
  'follow',
  'unfollow',
  'set_profile',
  'delete_post',
  'edit_post',
  'ban',
  'unban',
  'timeout',
  'mute',
  'block',
  'pin',
  'unpin',
  'lock',
  'unlock',
  'hide',
  'approve',
  'set_flair',
  'kick',
];

// Messaging actions for tier 2
const MESSAGING_ACTIONS = ['send_message', 'send_file'];

export function parseRule(r: string): ParsedRule {
  let s = r.trim();
  const deny = s.startsWith('!');
  if (deny) s = s.slice(1);

  // Split name from params: name[(params)]
  const parenIdx = s.indexOf('(');
  let action: string;
  const params = new Map<string, string>();

  if (parenIdx === -1) {
    action = s;
  } else {
    action = s.slice(0, parenIdx);
    const close = s.lastIndexOf(')');
    const inner =
      close > parenIdx ? s.slice(parenIdx + 1, close) : s.slice(parenIdx + 1);
    if (inner.length > 0) {
      for (const part of inner.split(',')) {
        const t = part.trim();
        if (!t) continue;
        const eq = t.indexOf('=');
        if (eq === -1) {
          // !param form — param must NOT be present
          params.set(t, '');
        } else {
          params.set(t.slice(0, eq).trim(), t.slice(eq + 1).trim());
        }
      }
    }
  }

  return { deny, action, params };
}

function globToRegex(pattern: string, charClass: string): RegExp {
  let re = '';
  for (const ch of pattern) {
    if (ch === '*') {
      re += charClass;
    } else {
      re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

function matchAction(pattern: string, action: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === action;
  return globToRegex(pattern, '[a-zA-Z0-9_]*').test(action);
}

function matchParam(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === value;
  return globToRegex(pattern, '[^,)]*').test(value);
}

function ruleMatches(
  parsed: ParsedRule,
  action: string,
  params: Record<string, string>,
): boolean {
  if (!matchAction(parsed.action, action)) return false;
  for (const [k, v] of parsed.params) {
    if (v === '') {
      // !param — param must NOT be present
      if (k.startsWith('!')) {
        const realKey = k.slice(1);
        if (realKey in params) return false;
      }
    } else {
      // param=glob — param must match
      if (!(k in params)) return false;
      if (!matchParam(v, params[k])) return false;
    }
  }
  return true;
}

export function checkAction(
  rules: Rule[],
  action: string,
  params: Record<string, string>,
): boolean {
  let result = false; // default deny
  for (const r of rules) {
    const parsed = parseRule(r);
    if (ruleMatches(parsed, action, params)) {
      result = !parsed.deny;
    }
  }
  return result;
}

export function matchingRules(rules: Rule[], action: string): Rule[] | null {
  // Check if action is allowed (with empty params for the check)
  // Then collect all non-deny rules that match this action name
  const matching: Rule[] = [];
  let anyAllow = false;
  let lastResult = false;

  for (const r of rules) {
    const parsed = parseRule(r);
    if (matchAction(parsed.action, action)) {
      if (parsed.deny) {
        lastResult = false;
      } else {
        lastResult = true;
        anyAllow = true;
        matching.push(r);
      }
    }
  }

  // If the last matching rule was a deny, or no allows at all
  if (!anyAllow || !lastResult) return null;
  return matching;
}

export function narrowRules(parent: Rule[], child: Rule[]): Rule[] {
  return [...parent, ...child];
}

function platformsFromRoutes(folder: string, tier: number): string[] {
  const routes = getAllRoutes();
  const world = worldOf(folder);
  const jids = new Set<string>();

  for (const r of routes) {
    const target = r.target.includes('{')
      ? r.target.slice(0, r.target.lastIndexOf('/'))
      : r.target;

    if (tier <= 1) {
      // World root: all platforms with routes anywhere in the world
      if (worldOf(target) === world) {
        jids.add(r.jid);
      }
    } else {
      // Tier 2: platforms routed to self or children
      if (target === folder || target.startsWith(folder + '/')) {
        jids.add(r.jid);
      }
    }
  }

  const platforms = new Set<string>();
  for (const jid of jids) {
    const p = jid.split(':')[0];
    if (p && !p.includes('@')) platforms.add(p);
  }
  return [...platforms];
}

export function deriveRules(folder: string, tier?: number): Rule[] {
  const t = tier ?? permissionTier(folder);

  if (t === 0) return ['*'];

  if (t >= 3) return ['send_reply'];

  const platforms = platformsFromRoutes(folder, t);

  const rules: Rule[] = [];

  if (t === 1) {
    // World root: full social + messaging on all world platforms
    for (const p of platforms) {
      for (const a of SOCIAL_ACTIONS) {
        rules.push(`${a}(jid=${p}:*)`);
      }
      rules.push(`send_message(jid=${p}:*)`);
      rules.push(`send_file(jid=${p}:*)`);
    }
    // Non-platform actions available to tier 1
    rules.push('send_reply');
    rules.push('schedule_task');
    rules.push('register_group');
    rules.push('delegate_group');
    rules.push('escalate_group');
    rules.push('get_routes');
    rules.push('add_route');
    rules.push('delete_route');
    rules.push('refresh_groups');
    rules.push('reset_session');
    rules.push('inject_message');
  } else {
    // Tier 2: messaging + social on own platforms
    rules.push('send_reply');
    for (const p of platforms) {
      rules.push(`send_message(jid=${p}:*)`);
      rules.push(`send_file(jid=${p}:*)`);
      for (const a of SOCIAL_ACTIONS) {
        rules.push(`${a}(jid=${p}:*)`);
      }
    }
    rules.push('schedule_task');
    rules.push('delegate_group');
    rules.push('escalate_group');
    rules.push('reset_session');
    rules.push('inject_message');
  }

  return rules;
}

// --- DB operations for grant overrides ---

export function getGrantOverrides(folder: string): Rule[] | null {
  const row = getDatabase()
    .prepare('SELECT rules FROM grants WHERE folder = ?')
    .get(folder) as { rules: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.rules) as Rule[];
  } catch {
    return null;
  }
}

export function setGrantOverrides(folder: string, rules: Rule[]): void {
  getDatabase()
    .prepare(`INSERT OR REPLACE INTO grants (folder, rules) VALUES (?, ?)`)
    .run(folder, JSON.stringify(rules));
}

export function deleteGrantOverrides(folder: string): void {
  getDatabase().prepare('DELETE FROM grants WHERE folder = ?').run(folder);
}
