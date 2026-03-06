# Instance Config as Git Repos

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
├── refs.txt              # git URLs of codebase repos to clone
└── README.md             # what this agent does, how to deploy
```

## refs.txt

One git URL per line. `kanipi create` clones each into
`groups/main/refs/<repo-name>/`. Supports shallow clones.

```
https://github.com/marinade-finance/liquid-staking-program
https://github.com/marinade-finance/validator-bonds
https://github.com/marinade-finance/psr-dashboard
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
# 6. Clone each URL in refs.txt → groups/main/refs/<name>/
# 7. Generate systemd unit
# 8. Register groups from repo structure

# Update from repo (pull new facts, CLAUDE.md changes)
kanipi update <name> --from <repo-url>
# Merges groups/ content, preserves .env and local state
```

## Example: kanipi-marinade

```
kanipi-marinade/
├── .env.example
│   ASSISTANT_NAME=marinade
│   TELEGRAM_BOT_TOKEN=<your-token>
│   CONTAINER_IMAGE=kanipi-agent:latest
│   CLAUDE_CODE_OAUTH_TOKEN=<your-oauth>
│   MAX_CONCURRENT_CONTAINERS=2
│   MEDIA_ENABLED=true
│   VOICE_TRANSCRIPTION_ENABLED=true
│   WHISPER_BASE_URL=http://localhost:8178
├── character.json        # Marinade Atlas identity
├── groups/
│   └── main/
│       ├── CLAUDE.md     # Marinade codebase guide instructions
│       └── facts/        # 50+ institutional knowledge files
│           ├── sam-*.md
│           ├── validator-bonds-*.md
│           └── ...
├── refs.txt
│   https://github.com/marinade-finance/liquid-staking-program
│   https://github.com/marinade-finance/validator-bonds
│   https://github.com/marinade-finance/marinade-ts-sdk
│   https://github.com/marinade-finance/psr-dashboard
│   https://github.com/marinade-finance/ds-sam
└── README.md
```

## Scope

This is a v2 feature. For now, instance setup is manual
(as documented in specs/atlas/setup.md). The repo structure
is the target format — we can extract kanipi-marinade as the
first instance repo once the CLI supports `--from`.
