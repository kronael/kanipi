# Channel Actions — Dynamic Registration and Filtered Manifest

**Status**: open

Each social channel registers its outbound actions on connect.
The gateway filters the manifest per group so agents only see
tools they can use. Agent-runner becomes a generic proxy.

See `1/0-actions.md` for action registry and manifest protocol.
See `T-social-actions.md` for social action catalog.

## Problem

Agent-runner (`ipc-mcp-stdio.ts`) hardcodes 13 MCP tools with
duplicated schemas, descriptions, and validation. Adding 25+
social actions this way is untenable. The manifest protocol is
specced in `0-actions.md` but not implemented.

Additionally, all tools are registered for all agents. A
telegram-only group sees reddit moderation tools — context
pollution that degrades agent performance.

## Channel structure

Each social channel is a directory under `src/channels/`:

```
src/channels/mastodon/
  client.ts    — API client (auth, reconnect, rate limit)
  watcher.ts   — Channel interface (inbound events)
  actions.ts   — Action[] (outbound operations)
  index.ts     — exports Channel + Action[]
```

The client is shared between watcher and actions. One instance
per channel, created on connect.

### client.ts

Platform API wrapper. Handles auth, reconnect, rate limiting.
Stateful (holds auth tokens, websocket connections). Shared
between watcher (reads) and actions (writes).

```typescript
// Each channel exports a client class or factory
export function createClient(config: MastodonConfig): MastodonClient;
```

### watcher.ts

Implements the existing `Channel` interface (`src/types.ts`).
Polls or streams inbound events, converts to `InboundEvent`
(see `S-social-events.md`).

### actions.ts

Exports an array of `Action` objects using the standard
`Action` interface from `action-registry.ts`. Each action
uses the shared client:

```typescript
export function mastodonActions(client: MastodonClient): Action[] {
  return [
    {
      name: 'mastodon_post',
      description: 'Create a new Mastodon status',
      input: z.object({
        jid: z.string(),
        content: z.string(),
        media: z.array(z.string()).optional(),
      }),
      async handler(raw, ctx) {
        const input = PostInput.parse(raw);
        assertAuthorized(input.jid, ctx);
        return client.post(input.content, input.media);
      },
    },
    // ... react, repost, follow, ban, pin, etc.
  ];
}
```

## MCP tool naming

Tools are named `{platform}_{verb}` for platform-specific
actions:

```
mastodon_post, mastodon_react, mastodon_ban
reddit_post, reddit_set_flair, reddit_approve
discord_timeout, discord_pin
```

Generic actions that work identically across platforms can
use a single name if the handler switches on JID prefix:

```
social_reply    — all platforms
social_delete   — all platforms
social_follow   — reddit, twitter, mastodon, bluesky
```

The split is pragmatic: if the schema and behavior are
identical, share. If platform-specific fields exist (flair,
shield mode, visibility), separate.

## Dynamic action registration

Channels register actions on `connect()`, unregister on
`disconnect()`. The action registry already supports this:

```typescript
// src/channels/mastodon/index.ts
export class MastodonChannel implements Channel {
  private client: MastodonClient;
  private actions: Action[] = [];

  async connect() {
    this.client = createClient(this.config);
    await this.client.connect();
    this.actions = mastodonActions(this.client);
    for (const a of this.actions) registerAction(a);
  }

  async disconnect() {
    for (const a of this.actions) unregisterAction(a.name);
    await this.client.disconnect();
  }
}
```

Requires adding `unregisterAction()` to the registry:

```typescript
// action-registry.ts — one new function
export function unregisterAction(name: string): void {
  actions.delete(name);
}
```

## Filtered manifest

`getManifest()` gains a `sourceGroup` parameter. The gateway
passes group context so the manifest only includes actions
the agent can actually use.

```typescript
export function getManifest(sourceGroup: string): ManifestEntry[] {
  const tier = permissionTier(sourceGroup);
  const groupJids = jidsForGroup(sourceGroup);
  const platforms = groupJids.map(platformFromJid).filter(Boolean);

  return [...actions.values()]
    .filter((a) => a.mcp !== false)
    .filter((a) => actionAvailable(a, tier, platforms))
    .map((a) => ({
      name: a.name,
      description: a.description,
      input: z.toJSONSchema(a.input),
    }));
}
```

### Filter rules

```typescript
function actionAvailable(
  action: Action,
  tier: number,
  platforms: Platform[],
): boolean {
  // tier filter — action declares minimum tier
  if (action.minTier !== undefined && tier > action.minTier) return false;

  // platform filter — action declares required platform
  if (action.platform && !platforms.includes(action.platform)) return false;

  return true;
}
```

New optional fields on `Action`:

```typescript
interface Action {
  name: string;
  description: string;
  input: z.ZodType;
  handler(input: unknown, ctx: ActionContext): Promise<unknown>;
  command?: string;
  mcp?: boolean;
  minTier?: number; // NEW: hide from agents above this tier
  platform?: Platform; // NEW: only show when platform is active
}
```

### What gets filtered

| Action            | minTier | platform | Visible to                  |
| ----------------- | ------- | -------- | --------------------------- |
| `send_message`    | —       | —        | all agents                  |
| `delegate_group`  | —       | —        | all agents                  |
| `register_group`  | 1       | —        | root, world                 |
| `refresh_groups`  | 0       | —        | root only                   |
| `inject_message`  | 1       | —        | root, world                 |
| `mastodon_post`   | —       | mastodon | agents with mastodon JID    |
| `reddit_ban`      | —       | reddit   | agents with reddit JID      |
| `social_reply`    | —       | —        | all agents (multi-platform) |
| `discord_timeout` | —       | discord  | agents with discord JID     |

Multi-platform actions (like `social_reply`) have no platform
filter — they appear for all agents. The handler checks JID
prefix at runtime and returns an error if the platform doesn't
support the operation.

## Agent-runner: generic proxy

Replace hardcoded tools with manifest-driven registration.
The agent-runner becomes ~50 lines of generic proxy code:

```typescript
// Fetch manifest from gateway
const id = `${Date.now()}-${rand()}`;
writeRequest({ id, type: 'list_actions' });
const manifest = await waitForReply(id);

// Register MCP tools from manifest
for (const action of manifest.result) {
  server.tool(action.name, action.description, action.input, async (args) =>
    callAction(action.name, { ...args, chatJid }),
  );
}
```

### Special cases

Two tools need client-side logic beyond the generic proxy:

1. **`list_tasks`** — reads `current_tasks.json` locally
   (no IPC round-trip). Keep as special case in agent-runner.

2. **`schedule_task`** — client-side cron validation before
   IPC call. Move validation to gateway handler instead.
   Agent-runner becomes generic.

After migration, `ipc-mcp-stdio.ts` shrinks from ~400 lines
to ~80 lines (IPC plumbing + manifest fetch + generic loop +
list_tasks special case).

### Manifest timing

The manifest is fetched once at MCP server startup. Tools
don't change during a container's lifetime — the container
is tied to one group, and channels don't hot-swap.

If the container starts before the gateway has processed
the request (race), the agent-runner retries `list_actions`
3 times with 500ms backoff before falling back to an empty
tool set.

## Migration

### Phase 1: filtered manifest (gateway-side only)

1. Add `minTier`, `platform` to `Action` interface
2. Add `unregisterAction()` to registry
3. Change `getManifest()` → `getManifest(sourceGroup)`
4. Update `drainRequests` to pass sourceGroup to getManifest
5. Annotate existing actions with `minTier` where applicable

No agent-runner changes. Existing hardcoded tools still work.

### Phase 2: generic proxy (agent-runner)

1. Agent-runner fetches manifest on startup
2. Registers tools from manifest
3. Remove hardcoded tool definitions
4. Keep `list_tasks` as special case
5. Move `schedule_task` cron validation to gateway handler

### Phase 3: channel actions

1. Social channels export `Action[]` from `actions.ts`
2. Register on `connect()`, unregister on `disconnect()`
3. Actions include `platform` field for manifest filtering
4. Agent sees only tools for its group's active platforms

## ActionContext extension

Social actions need platform client access. Extend
`ActionContext` or use closure (channel passes client
to action factory). Closure is simpler — no interface
change:

```typescript
// mastodon actions close over the client
function mastodonActions(client: MastodonClient): Action[] {
  return [{
    name: 'mastodon_post',
    handler(raw, ctx) {
      // ctx for authorization, client for API calls
      assertAuthorized(input.jid, ctx);
      return client.post(...);
    },
  }];
}
```

No change to `ActionContext`. The client is a closure
variable, not a dependency injection.

## Open

- Multi-platform actions (`social_reply`) — single handler
  with JID switch, or register per-platform and alias?
- Rate limit errors — return structured error so agent can
  retry with backoff?
- Media upload — presigned URL flow or stream through gateway?
- Action versioning — manifest includes version for schema
  evolution?
