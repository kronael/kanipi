# Plugin Specification — open

**Status**: not implemented. The IPC `plugin-propose` command, pending
dir, deploy hook, and audit log are all unbuilt. Skills and gateway
patches currently require operator shell access to deploy.

## Overview

Plugins let the main group extend kanipi's behaviour — adding new skills,
modifying gateway source, and shipping changes — without requiring operator
shell access. The main group is the only group with write access to the
gateway source (`/workspace/self` is read-only for all other groups).

Security model: **agent proposes, operator approves**. No plugin can ship
without a human reviewing a diff and confirming the deploy.

---

## Trust Boundary

| Actor         | Can propose | Can approve | Can deploy |
| ------------- | ----------- | ----------- | ---------- |
| Agent (main)  | yes         | no          | no         |
| Operator      | no          | yes         | yes        |
| Agent (other) | no          | no          | no         |

The main group agent writes changes to a staging area. The operator
reviews, approves, and triggers the deploy manually (or via a confirmed
IPC command).

---

## Plugin Types

### 1. Skills

A skill is a directory under `container/skills/<name>/` containing at
minimum a `SKILL.md` with YAML frontmatter.

```
container/skills/<name>/
  SKILL.md        # frontmatter: name, description, trigger patterns
  *.md            # additional reference files
  *.sh / *.ts     # executable helpers (optional)
```

Skills are seeded into agent containers on first spawn. The `/migrate`
skill propagates updates to all running groups.

**Agent action**: write files to `/workspace/group/plugins/<name>/`,
emit an IPC `plugin-propose` command with `type=skill`.

### 2. Gateway patches

Patches to `src/` TypeScript source. Applied as git commits on the
gateway host after operator review.

**Agent action**: write a unified diff to
`/workspace/group/plugins/<patch-name>.patch`, emit
`plugin-propose` with `type=patch`.

### 3. Config extensions

New `.env` keys or changes to `config.ts` exports. Always paired with
a gateway patch.

---

## IPC Protocol

Agent emits to `/workspace/ipc/commands/`:

```json
{
  "type": "plugin-propose",
  "plugin": "skill-name or patch-name",
  "kind": "skill | patch | config",
  "description": "one-line summary",
  "path": "/workspace/group/plugins/<name>"
}
```

Gateway receives the command, copies the proposal to
`/srv/data/kanipi_<instance>/plugins/pending/<name>/`, and sends
the operator a message:

```
[plugin] proposal: <name> (<kind>)
<description>
Reply "approve <name>" or "reject <name>" to decide.
```

---

## Approval Flow

```
Agent writes proposal
  → IPC plugin-propose
    → Gateway notifies operator
      → Operator replies "approve <name>"
        → Gateway runs deploy hook
          → Operator confirms result
```

**Approve**: gateway runs `deploy-plugin.sh <name>` (see below).
**Reject**: proposal deleted, agent notified via stdin on next run.

---

## Deploy Hook

`deploy-plugin.sh` (gateway host, not in container):

```bash
#!/bin/bash
set -euo pipefail
NAME=$1
DIR=/srv/data/kanipi_${INSTANCE}/plugins/pending/${NAME}

case $(cat "$DIR/kind") in
  skill)
    cp -r "$DIR/files/" /path/to/kanipi/container/skills/${NAME}/
    ;;
  patch)
    git -C /path/to/kanipi apply "$DIR/files/${NAME}.patch"
    make -C /path/to/kanipi lint
    ;;
esac

rm -rf "$DIR"
echo "deployed: $NAME"
```

Operator must rebuild and restart the gateway after a patch deploy:

```bash
make image && docker restart kanipi_<instance>
```

Skill-only deploys take effect on next agent spawn (no restart needed
if the agent seeds from `/workspace/self/container/skills/` at runtime).

---

## Security Controls

**Containment**: agent cannot write outside `/workspace/group/` and
`/workspace/ipc/`. Proposal files never execute inside the container.

**No auto-deploy**: gateway only moves proposals to `pending/`. Nothing
runs until the operator explicitly approves.

**Patch validation**: `deploy-plugin.sh` runs `make lint` before
accepting a patch. Patches that break the typecheck are rejected.

**Allowlist check**: gateway validates that the proposed skill name does
not shadow a built-in skill (same name under `container/skills/`). If it
does, operator is warned before approval.

**Audit trail**: all proposals and approvals logged to
`/srv/data/kanipi_<instance>/plugins/log.jsonl`:

```json
{"ts": "2026-03-04T10:00:00Z", "event": "proposed", "name": "foo", "kind": "skill"}
{"ts": "2026-03-04T10:05:00Z", "event": "approved", "name": "foo", "operator": "tg:123"}
{"ts": "2026-03-04T10:05:02Z", "event": "deployed", "name": "foo"}
```

---

## Skill Authoring Guide (for agents)

1. Write `SKILL.md` with YAML frontmatter (`name`, `description`).
2. Keep skills self-contained — no network calls, no hardcoded paths.
3. Use `/workspace/self`, `/workspace/group`, `/workspace/ipc` only.
4. Write files to `/workspace/group/plugins/<name>/`.
5. Emit `plugin-propose` IPC command.
6. Wait for operator approval before assuming the skill is live.

---

## Gateway Patch Guide (for agents)

1. Make changes in a temp working copy inside `/workspace/group/`.
2. Generate a unified diff: `diff -u original new > <name>.patch`.
3. Patch must apply cleanly to current `src/` HEAD.
4. Write patch to `/workspace/group/plugins/<name>.patch`.
5. Emit `plugin-propose` with `kind=patch`.
6. Include a one-line description of the change and why.

Patches that touch `mount-security.ts`, `ipc.ts` deploy logic, or auth
are flagged as high-risk. Operator receives an extra warning.
