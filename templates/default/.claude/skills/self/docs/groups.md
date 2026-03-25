# Groups

A group = one agent with a folder, a JID route, and a permission tier.

## Worlds and tiers

A **world** is the first path segment of a group folder. All groups under the same world share `/workspace/share`.

| Tier | Role        | Folder example    | Home | Share | Web | Groups dir |
| ---- | ----------- | ----------------- | ---- | ----- | --- | ---------- |
| 0    | root        | `root`            | rw   | rw    | rw  | rw (all)   |
| 1    | world admin | `atlas`           | rw   | rw    | rw  | —          |
| 2    | child       | `atlas/support`   | rw   | ro    | rw  | —          |
| 3    | grandchild+ | `atlas/ops/infra` | ro\* | —     | —   | —          |

\*Tier 3 ro home: overlays give rw to `.claude/projects`, `media`, `tmp`.

Tier 2/3 setup files are locked ro: `CLAUDE.md`, `SOUL.md`, `.claude/skills`, `settings.json`, `output-styles`. The agent can still write `diary/`, `facts/`, `users/` (tier 2), and session transcripts (all tiers).

Check your tier:

```bash
echo $NANOCLAW_TIER           # 0=root, 1=world, 2=child, 3=grandchild
echo $NANOCLAW_IS_WORLD_ADMIN # set if tier 1
```

## Registering groups

Via CLI (operator, on host):

```bash
kanipi config <instance> group add <jid> <folder>
kanipi config <instance> group list
kanipi config <instance> group rm  <jid>
```

First group added defaults to folder `root` (tier 0). Subsequent groups need an explicit folder.

## Child groups

Child groups are subdirectories of the world folder. A tier 1 agent's home is the world folder; its children are subdirs:

```bash
ls -d ~/*/   # list child group folders
```

The `NANOCLAW_GROUP_FOLDER` env var tells you your own folder path.

Delegate to a child with the `delegate_group` MCP tool. Escalate to parent with `escalate_group`.

## Creating child groups

Two ways:

**Manual via CLI** (operator on host):

```bash
kanipi config <instance> group add telegram:-123 atlas/support
```

**Dynamic via prototype/** — when a group has `prototype/` in its folder, the gateway can spawn children automatically. On spawn, the gateway copies all files from `prototype/` into the new child folder (CLAUDE.md, SOUL.md, skills, etc.).

Auto-threading (`{sender}` route target) uses this mechanism:

```
groups/atlas/prototype/CLAUDE.md → copied to groups/atlas/alice/ on first message from alice
```

## Grants

Grants control what MCP actions each group can perform. Defaults by tier:

| Tier | Defaults                                                     |
| ---- | ------------------------------------------------------------ |
| 0    | `*` (everything)                                             |
| 1    | world-scoped social+messaging, `share_mount(readonly=false)` |
| 2    | own-platform social+messaging, `share_mount(readonly=true)`  |
| 3    | `send_reply` only, no share mount                            |

Grants are checked in `ipc.ts` before dispatching MCP actions. Root can override per-group in the `grants` table.

## /workspace/share

Shared memory for the world. All groups under the same world see the same `/workspace/share`.

- Tier 0/1: read-write
- Tier 2: read-only (by default; grant override possible)
- Tier 3: not mounted

Use for cross-group shared state: knowledge bases, config, shared facts.

## Onboarding

When `ONBOARDING_PLATFORMS=telegram,whatsapp` is set in `.env`, unrouted JIDs on those platforms get an interactive onboarding flow:

1. User sends any message → gateway responds with welcome prompt
2. User sends `/request <name>` → notifies root, status set to pending
3. Root sends `/approve <jid>` → world created from `groups/root/prototype/`, route added
4. Root sends `/reject <jid>` → suppressed

The `ONBOARDING_PLATFORMS` value is a comma-separated list of platform names (e.g. `telegram`, `whatsapp`). Discord is not included by default (userbot; different trust model).

On approval:

- New tier 1 world created from `groups/root/prototype/`
- Gateway enqueues welcome system message → agent runs `/hello` + `/howto`

Config in `.env`:

```env
ONBOARDING_PLATFORMS=telegram,whatsapp
```

Note: `ONBOARDING_ENABLED` is derived automatically — it's true when `ONBOARDING_PLATFORMS` is non-empty.
