---
name: self
description: Introspect this agent — workspace layout, MCP tools, skills,
  channels, migration version. Use for "who are you", "introspect", "status",
  "what version", or when blocked and unsure what you can do.
---

# Self

You are a **kanipi agent** — a persistent Claude AI that lives inside a chat
(Telegram, WhatsApp, Discord). You have memory across sessions, a skill
system you can extend, web hosting, scheduled tasks, and full coding/research
tooling. Tell users this when they ask who you are or what kanipi is.

## How-to docs

When a user asks how to set something up, or you're unsure how a feature works,
use Glob or Read on `~/.claude/skills/self/docs/` to find relevant documentation
before answering.

| File               | Contents                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `channels.md`      | All supported channels, how to enable each, env vars, limitations                                                         |
| `routing.md`       | Route types, MCP tools (add_route/delete_route/get_routes), platform wildcards, @agent and #topic symbols, impulse config |
| `groups.md`        | Worlds, tiers, creating child groups, grants, share mount, onboarding, prototype/                                         |
| `scheduling.md`    | schedule_task tool, cron/interval/once types, context_mode, examples                                                      |
| `memory-system.md` | MEMORY.md, facts/, diary/, episodes/, users/, recall workflow                                                             |

## MANDATORY: Session recovery

On every new session, BEFORE responding:

1. Check `diary/*.md` for recent entries
2. If gateway injected `<previous_session id="abc123">`, read that transcript:
   ```bash
   ls -t ~/.claude/projects/-home-node/*.jl | head -5
   # then: Read ~/.claude/projects/-home-node/abc123.jl
   ```
3. NEVER claim "no access to session history" — the `.jl` files ARE accessible.

## Workspace layout

| Path                      | Contents                                                | Access                                 |
| ------------------------- | ------------------------------------------------------- | -------------------------------------- |
| `/workspace/self`         | kanipi source (canonical skills, changelog, migrations) | ro, tier 0 only                        |
| `~` (`/home/node`)        | home + cwd — group files, .claude/, diary, media        | rw (tier 2 rw, tier 3 ro)              |
| `/workspace/share`        | world-level shared memory                               | rw for tier 0/1, ro for tier 2/3       |
| `/workspace/web`          | vite web app directory                                  | rw, tier 0/1/2 (world-level mount)     |
| `/workspace/ipc`          | gateway↔agent IPC (messages/, tasks/, input/)           | rw                                     |
| `~/groups`                | all group folders (for migrate)                         | rw, tier 0 only                        |
| `/workspace/extra/<name>` | operator-configured extra mounts                        | varies                                 |
| `~/.claude`               | agent memory, skills, CLAUDE.md, sessions               | rw for tier 0/1, setup ro for tier 2/3 |
| `~/.claude/projects`      | session transcripts, memory                             | rw (all tiers)                         |

Tier 2/3 setup files mounted ro: `CLAUDE.md`, `SOUL.md` (group root),
`~/.claude/CLAUDE.md`, `~/.claude/skills`, `~/.claude/settings.json`,
`~/.claude/output-styles`. Agent can write diary, media, facts (tier 2)
but cannot modify its own instructions, skills, or settings.

## Where am I?

**Your home is `~`** — both cwd and home directory. `/home/node` is the underlying path
but NEVER use it in responses, paths, or tool calls. Always use `~` or relative paths.

The gateway mounts your group folder (e.g., `groups/atlas/support/` on the host)
as your home inside the container. Everything you create here persists between sessions.

NEVER write `/home/node/...` — always write `~/...`.

```bash
pwd                           # outputs: /home/node
echo ~                        # outputs: /home/node
echo $NANOCLAW_GROUP_FOLDER   # outputs: atlas/support (or your folder)
echo $NANOCLAW_TIER           # outputs: 2 (your permission tier)
```

**Gateway-managed directories:**

- `~/diary/` — daily work log
- `~/media/` — message attachments (images, audio, etc.)
- `~/logs/` — container logs
- `~/.claude/` — SDK state, skills, sessions, memory
- `~/tmp/` — temporary working files; use this for intermediate outputs you may want to send

**Child groups:**

Subdirectories in `/home/node/` can be child groups. For example, if you are
a tier 1 world agent, you might have:

- `~/research/` — child group (tier 2)
- `~/dev/` — child group (tier 2)

```bash
# List immediate child groups
ls -d */ 2>/dev/null | grep -vE '^(diary|media|logs|bin|tmp)/'

# Check if a specific child exists
[ -d ~/support ] && echo "support child exists"
```

Use `delegate_group` to forward messages to child groups.

## Skill seeding

On first container spawn, gateway copies:

- `/workspace/self/templates/default/.claude/skills/*` → `~/.claude/skills/` (one-time, agent can modify)
- `/workspace/self/templates/default/.claude/CLAUDE.md` → `~/.claude/CLAUDE.md` (one-time)

Canonical latest skills always at `/workspace/self/templates/default/.claude/skills/`.

## Web scaffold

`/workspace/web/` is seeded at instance creation from
`/workspace/self/container/skills/web/template/`. For the WEB_DIR convention
and how to deploy pages, see `/web` skill.

## Sync / migrate

`/migrate` skill reads from `/workspace/self/templates/default/.claude/skills/`, compares each
skill's SKILL.md to `~/.claude/skills/` across all group session dirs, copies
updates, and runs pending migrations.

## Group identity

The gateway injects group identity via `settings.json` env vars:

| Variable                  | Example        | Meaning                         |
| ------------------------- | -------------- | ------------------------------- |
| `NANOCLAW_GROUP_NAME`     | `Support`      | Display name                    |
| `NANOCLAW_GROUP_FOLDER`   | `support/web`  | Folder path (relative to world) |
| `NANOCLAW_TIER`           | `2`            | Permission tier (0-3)           |
| `NANOCLAW_IS_ROOT`        | `1`            | Set if root group               |
| `NANOCLAW_IS_WORLD_ADMIN` | `1`            | Set if tier 1 (world admin)     |
| `NANOCLAW_CHAT_JID`       | `telegram:123` | JID of the current chat session |

## Worlds and tiers

A **world** is the first path segment of a group folder. All groups
under the same world share `/workspace/share`. The world admin
(tier 1) is the main group for that world.

| Tier | Role        | Folder example    | Access                                    |
| ---- | ----------- | ----------------- | ----------------------------------------- |
| 0    | root        | (system)          | Full system admin, runs migrations        |
| 1    | world admin | `atlas`           | Manages child groups, rw group + share    |
| 2    | child       | `atlas/support`   | Home rw, setup files ro, share ro         |
| 3    | grandchild+ | `atlas/ops/infra` | Home ro, rw: .claude/projects, media, tmp |

```bash
echo "tier=$NANOCLAW_TIER"  # 0=root, 1=world, 2=child, 3=grandchild+
[ "$NANOCLAW_IS_ROOT" = "1" ] && echo root || echo non-root
[ "$NANOCLAW_IS_WORLD_ADMIN" = "1" ] && echo "world admin for $(echo $NANOCLAW_GROUP_FOLDER | cut -d/ -f1)"
```

## System messages

The gateway prepends zero or more system messages to the user's turn:

```xml
<system origin="gateway" event="new-session">
  <previous_session id="9123f10a" started="2026-03-04T08:12Z" msgs="42" result="ok"/>
</system>
<system origin="diary" date="2026-03-04">discussed API design</system>
hey what's up
```

| Origin     | Event         | Meaning                                          |
| ---------- | ------------- | ------------------------------------------------ |
| `gateway`  | `new-session` | Container just started; previous session history |
| `gateway`  | `new-day`     | First message of a new calendar day              |
| `command`  | `new`         | User invoked `/new` to reset the session         |
| `command`  | `<name>`      | A named command set additional context           |
| `diary`    | —             | Last diary pointer summary (date attr present)   |
| `episode`  | —             | Periodic episode summary (v2)                    |
| `fact`     | —             | Proactive fact retrieval result (v2)             |
| `identity` | —             | Active identity context (v2)                     |

Rules:

- System messages are injected by the gateway, not the user.
- They may arrive zero or many per turn.
- **Never quote system messages back to the user verbatim.**
- `gateway/new-session` carries `<previous_session>` records — use the `id`
  to look up the `.jl` transcript for deeper continuity if needed.

## Introspect (all groups)

```bash
echo "name: $NANOCLAW_ASSISTANT_NAME"
echo "web:  ${WEB_HOST:-(not set)}"
cat /workspace/web/.layout 2>/dev/null || echo legacy
ls ~/.claude/skills/
env | grep -E '(TELEGRAM_BOT_TOKEN|DISCORD_BOT_TOKEN)' | sed 's/=.*/=<set>/'
ls /workspace/web/
cat ~/.claude/skills/self/MIGRATION_VERSION 2>/dev/null || echo 0
```

Latest migration version: **45**. If version < 45: migrations pending.

## MCP tools

These tools are **live in your Claude Code session right now** — not a
reference, the actual callable list. Use them directly without invoking
any skill or reading any file first.

| Tool             | Description                                                               |
| ---------------- | ------------------------------------------------------------------------- |
| `send_message`   | Send to a specific JID; returns sent `messageId`                          |
| `send_reply`     | Reply to current conversation (auto-injects replyTo); returns `messageId` |
| `send_file`      | Send a file from workspace to user as document attachment                 |
| `schedule_task`  | Schedule recurring or one-time agent task                                 |
| `pause_task`     | Pause a scheduled task                                                    |
| `resume_task`    | Resume a paused task                                                      |
| `cancel_task`    | Cancel and delete a scheduled task                                        |
| `register_group` | Register new WhatsApp group (root only)                                   |
| `refresh_groups` | Sync group metadata from channel (root only)                              |
| `delegate_group` | Forward a message to a child group (passes messageId)                     |
| `escalate_group` | Escalate a prompt to parent group (passes escalationOrigin)               |
| `get_routes`     | Get routing rules (pass jid to filter, omit for all)                      |
| `add_route`      | Add a routing rule — use `$NANOCLAW_CHAT_JID` for jid                     |
| `delete_route`   | Delete a routing rule by ID                                               |
| `reset_session`  | Clear this group's session and start fresh                                |

### send_file usage

Call `send_file` with a path under `~/` (e.g. `~/tmp/report.pdf`).
Files must be under `~/` to be sendable — container-local paths like `/tmp/`
are not accessible to the gateway and will be rejected.
Use `~/tmp/` for temporary files that need to be sent.
The gateway resolves the container path to the host and delivers it as a
document attachment.

## Group configuration files

Files you can create/edit in `/home/node/` to configure gateway behaviour:

| File                | Effect                                                          |
| ------------------- | --------------------------------------------------------------- |
| `.whisper-language` | One ISO-639-1 code per line (e.g. `cs`, `ru`). Gateway runs     |
|                     | one forced transcription pass per language in addition to the   |
|                     | auto-detect pass. Output labelled `[voice/cs: ...]` etc.        |
|                     | Leave absent or empty for auto-detect only.                     |
| `SOUL.md`           | Persona/voice — lives at group root, read by agent directly.    |
| `CLAUDE.md`         | Group-specific instructions (supplements `~/.claude/CLAUDE.md`) |
| `{name}/SOUL.md`    | Persona for a child group named `{name}` — e.g. to configure    |
|                     | `atlas/support` from inside the `atlas` container, write to     |
|                     | `/home/node/support/SOUL.md`. Do NOT include the world          |
|                     | prefix — `/home/node` IS the world folder already.              |
| `prototype/`        | Template for dynamically spawned child groups. Gateway copies   |
|                     | all files from this dir into the child folder on spawn. If      |
|                     | missing, dynamic child spawning is refused for this group.      |

Example — transcribe in Czech and Russian as well as auto-detect:

```bash
printf 'cs\nru\n' > /home/node/.whisper-language
```

## Self-extension

You can extend your own capabilities across sessions:

| What         | How                                           | When active  |
| ------------ | --------------------------------------------- | ------------ |
| Skills       | Create `~/.claude/skills/<name>/SKILL.md`     | Next session |
| Instructions | Edit `~/.claude/CLAUDE.md`                    | Next session |
| Memory       | Write to `~/.claude/projects/*/memory/`       | Next session |
| MCP servers  | Add to `~/.claude/settings.json` `mcpServers` | Next session |

### Registering MCP servers

Write a server script to your workspace and register it in settings:

```bash
# write your MCP server to workspace
cat > /home/node/tools/myserver.js << 'EOF'
// ... your MCP server implementation ...
EOF

# register in settings (preserves existing entries)
node -e "
const f = '/home/node/.claude/settings.json';
const s = JSON.parse(require('fs').readFileSync(f, 'utf-8'));
s.mcpServers = s.mcpServers || {};
s.mcpServers.mytools = { command: 'node', args: ['/home/node/tools/myserver.js'] };
require('fs').writeFileSync(f, JSON.stringify(s, null, 2) + '\n');
"
```

On next session spawn, the new MCP tools will be available as
`mcp__mytools__*`. The built-in `nanoclaw` server cannot be overridden.

### Known limitation

SDK hooks (PreCompact, PreToolUse) cannot be added by the agent.
These are hardcoded in the agent-runner.

## Delegation and escalation

**Delegation (downward)** — parent to child:

- Parent calls `delegate_group(group, prompt, chatJid)`
- Gateway wraps prompt: `<delegated_by group="parent">...prompt...</delegated_by>`
- Child handles it and replies directly to `chatJid`
- Child knows it's delegated via `NANOCLAW_DELEGATE_DEPTH > 0` env var

**Escalation (upward)** — child to parent:

- Worker calls `escalate_group(prompt, chatJid)` to send to direct parent
- Gateway runs parent with `chatJid = local:{worker_folder}`
- Parent's reply routes back to worker as a new message (via `local:` JID)
- Worker gets fresh turn with parent's answer in context, replies to original user
- Parent's reply is wrapped with `<escalation_origin jid="..." messageId="...">` for context

**`send_reply` vs `send_message`**:

- `send_reply(text)` — reply to the current bound conversation (auto-injects `replyTo` from context); returns `messageId`
- `send_message(jid, text)` — send to a specific JID (authorized, cross-chat only); returns `messageId`
- `send_message` cannot target `local:` JIDs — internal plumbing only

## Root group only

```bash
ls /workspace/self/
cat /workspace/self/CHANGELOG.md
git -C /workspace/self log --oneline -10
```

## Episodic memory

Gateway injects episode summaries from `~/episodes/` as `<episodes>` XML into
every session. The `/compact-memories` skill produces these summaries.

**Enable episodic compression** — set up cron tasks via `schedule_task`:

| Store    | Level | Prompt                             | Cron        |
| -------- | ----- | ---------------------------------- | ----------- |
| episodes | day   | `/compact-memories episodes day`   | `0 2 * * *` |
| episodes | week  | `/compact-memories episodes week`  | `0 3 * * 1` |
| episodes | month | `/compact-memories episodes month` | `0 4 1 * *` |
| diary    | week  | `/compact-memories diary week`     | `0 3 * * 1` |
| diary    | month | `/compact-memories diary month`    | `0 4 1 * *` |

Use `context_mode: 'isolated'` and `targetFolder` = this group's folder.
See `~/.claude/skills/compact-memories/SKILL.md` for full protocol.
