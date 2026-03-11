# Instance Config as Git Repos

**Status**: open (v2)

Kanipi instance configs should ship as bare git repos with a known structure.
Like Helm charts for agent deployments.

## Repo structure

```
kanipi-<name>/
├── .env.example          # config template (tokens replaced with placeholders)
├── character.json        # agent identity (bio, topics, style)
├── groups/
│   └── main/
│       ├── CLAUDE.md     # agent instructions
│       ├── character.json  # per-group override (optional)
│       └── facts/        # knowledge files (YAML markdown)
└── README.md             # what this agent does, how to deploy
```

## CLI

```bash
# Create from repo
kanipi create <name> --from <repo-url>
kanipi create <name> --from /path/to/local/repo

# What it does:
# 1. Clone repo to tmp
# 2. mkdir /srv/data/kanipi_<name>/
# 3. Copy .env.example → .env (user fills secrets)
# 4. Copy groups/ → groups/
# 5. Copy character.json → groups/main/character.json (if not per-group)
# 6. Generate systemd unit
# 7. Register groups from repo structure

# Update from repo (pull new facts, CLAUDE.md changes)
kanipi update <name> --from <repo-url>
# Merges groups/ content, preserves .env and local state
```

## Refs management (decided: not a gateway feature)

Code references (git repos the agent searches) live inside the
group folder at `refs/<repo-name>/`. Since the group folder IS
the agent's home (`/home/node`), refs are automatically visible
at `/home/node/refs/` — no special mount config needed.

Management is manual: clone repos into the group's `refs/` dir,
chown to 1000:1000. Updates via cron or scheduled bash task
(see `specs/3/J-container-commands.md`). The gateway does not
auto-clone or manage refs — that's operator responsibility.

Parent groups can share dirs with children via the nested folder
structure (e.g. `atlas/refs/` is visible to `atlas/support/`
since support's home is inside atlas's tree).

No `refs.txt` file. No gateway-level refs sync. No CLI refs
subcommand. Keep it simple.

## Scope

This is a v2 feature. For now, instance setup is manual.
The repo structure is the target format — we can extract
kanipi-marinade as the first instance repo once the CLI
supports `--from`.
