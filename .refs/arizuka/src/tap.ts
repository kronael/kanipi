import { lookupCredential } from './credentials.js';
import { logger } from './logger.js';
import { Middleware, Route, ToolCall, TapContext } from './types.js';
import { RawRoute } from './config.js';

// --- Glob matching ---

export function matchGlob(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*') && !pattern.startsWith('*')) {
    return value.startsWith(pattern.slice(0, -1));
  }
  if (pattern.startsWith('*') && !pattern.endsWith('*')) {
    return value.endsWith(pattern.slice(1));
  }
  return pattern === value;
}

// --- Middleware factories ---

export function createInjectCredentialMiddleware(
  credentialName: string,
  as: 'env' | 'header',
  envName?: string,
  header?: string,
): Middleware {
  return (call, _ctx) => {
    const value = lookupCredential(credentialName);
    if (!value) {
      logger.warn({ credentialName }, 'Credential not found for injection');
      return call;
    }
    if (as === 'env' && envName) {
      return {
        ...call,
        input: {
          ...call.input,
          _env: {
            ...((call.input._env as Record<string, string>) ?? {}),
            [envName]: value,
          },
        },
      };
    }
    if (as === 'header' && header) {
      return {
        ...call,
        input: {
          ...call.input,
          _headers: {
            ...((call.input._headers as Record<string, string>) ?? {}),
            [header]: value,
          },
        },
      };
    }
    return call;
  };
}

export function createRejectMiddleware(reason: string): Middleware {
  return (_call, _ctx) => null;
}

// --- Route parsing ---

export function parseRoutes(rawRoutes: RawRoute[]): Route[] {
  const routes: Route[] = [];
  for (const raw of rawRoutes) {
    if (!raw.match?.tool) {
      logger.warn({ route: raw }, 'Invalid route: missing match.tool');
      continue;
    }
    const middlewares: Middleware[] = [];
    for (const mw of raw.middleware ?? []) {
      switch (mw.type) {
        case 'inject-credential':
          middlewares.push(
            createInjectCredentialMiddleware(
              mw.credential ?? '',
              (mw.as as 'env' | 'header') ?? 'env',
              mw.envName,
              mw.header,
            ),
          );
          break;
        case 'inject-header':
          middlewares.push(
            createInjectCredentialMiddleware(
              mw.credential ?? '',
              'header',
              undefined,
              mw.header,
            ),
          );
          break;
        case 'reject':
          middlewares.push(createRejectMiddleware(mw.reason ?? 'Blocked by policy'));
          break;
        default:
          logger.warn({ type: mw.type }, 'Unknown middleware type');
      }
    }
    routes.push({
      match: { tool: raw.match.tool, agent: raw.match.agent },
      middlewares,
    });
  }
  return routes;
}

// --- Pipeline execution ---

function matchRoute(route: Route, call: ToolCall, ctx: TapContext): boolean {
  if (route.match.agent && route.match.agent !== ctx.agentId) return false;
  return matchGlob(route.match.tool, call.name);
}

export function executePipeline(
  routes: Route[],
  call: ToolCall,
  ctx: TapContext,
): ToolCall | { rejected: true; reason: string } {
  const matched = routes.filter((r) => matchRoute(r, call, ctx));
  let current: ToolCall = { ...call, input: { ...call.input } };

  for (const route of matched) {
    for (const mw of route.middlewares) {
      const result = mw(current, ctx);
      if (result === null) {
        return {
          rejected: true,
          reason: `Blocked by middleware on route matching "${route.match.tool}"`,
        };
      }
      current = result;
    }
  }

  return current;
}
