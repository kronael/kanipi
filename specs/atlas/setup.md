# Marinade Atlas on Kanipi

Migration from ElizaOS (eliza_atlas_marinade) to kanipi_marinade.

## Instance

```
Service:  kanipi_marinade
Data dir: /srv/data/kanipi_marinade/
Bot:      @mnde_atlas_bot (token: 8122465866:...)
Chat ID:  telegram:-5174030672
Port:     49180 (web proxy)
```

## What changed

ElizaOS ran as a monolithic Bun process with embedded plugins
(evangelist, claude-code, ollama). Kanipi runs the same bot token
but routes messages to containerized Claude agents with:

- Full Claude Code SDK (not the limited claude-code plugin)
- Access to facts and codebase via mounted directories
- Skills system (diary, migrate, etc.)
- No more Ollama dependency for embeddings

## Data layout

```
/srv/data/kanipi_marinade/
├── .env                    # config (bot token, oauth, ports)
├── store/messages.db       # SQLite (groups, messages, state)
├── groups/main/
│   ├── CLAUDE.md           # agent personality + instructions
│   ├── character.json      # ElizaOS-style identity (bio, topics, style)
│   ├── facts/              # copied from eliza_atlas_marinade/facts/
│   │   ├── *.md            # 50+ YAML knowledge files
│   │   ├── marinade-validators/
│   │   └── research/
│   ├── refs/
│   │   └── codebase/       # symlink → /srv/data/eliza_atlas_marinade/codebase/
│   └── logs/
├── data/                   # IPC, sessions
└── web/                    # vite web app
```

## Codebase access

Marinade repos are symlinked from the old eliza data dir:

```
/srv/data/kanipi_marinade/groups/main/refs/codebase/
  → /srv/data/eliza_atlas_marinade/codebase/
```

Contains: liquid-staking-program, marinade-ts-sdk, validator-bonds,
psr-dashboard, ds-sam, ds-sam-pipeline, delegation-strategy-2, ssr

Docker resolves the symlink at mount time, so the agent sees
real files at `/workspace/group/refs/codebase/`.

## Facts

Copied verbatim from eliza_atlas_marinade. 50+ markdown files
covering validator bonds, SAM auctions, delegation strategy,
APIs, CLI commands, and historical decisions.

Agent CLAUDE.md tells it to check facts/ first when answering
questions, then fall back to codebase search.

## Agent behavior

Read-only codebase guide. The CLAUDE.md enforces:

- Evidence-based answers only (file:line citations)
- No guessing — admit gaps, search first
- High energy style matching the original Marinade Atlas personality

## Previous system

```
Service:  eliza_atlas_marinade (disabled)
Image:    eliza-atlas
Runtime:  Bun + ElizaOS monorepo
Plugins:  evangelist, claude-code, ollama, telegram
Config:   /cfg/hel1v5/eliza_atlas_marinade.toml + character.json
Data:     /srv/data/eliza_atlas_marinade/ (preserved, not deleted)
```

## Reference repos (in /home/onvos/app/refs/)

### eliza-atlas (5.7 GB)

The ElizaOS fork. Monolithic Bun runtime with plugin architecture.
Study for: how the character.json + plugin system worked, template
patterns that we might replicate as skills.

Key files:

- `cfg/hel1v5/eliza_atlas_marinade.character.json` — full character config
- `cfg/hel1v5/eliza_atlas_marinade.toml` — server config
- `cfg/hel1v5/eliza_mnde_bot.toml` — bot tokens + API keys

### eliza-plugin-evangelist (317 MB)

The facts/research/codebase service plugin. Primary reference for
kanipi v2 memory and research features.

Key files to study:

- `src/services/factsService.ts` — YAML facts loading, similarity search
- `src/services/researchService.ts` — deep research (clone, search, verify)
- `src/services/codebaseService.ts` — repo indexing, grep across clones
- `src/providers/knowledgeContext.ts` — fact injection into agent context
- `src/actions/researchNeeded.ts` — triggers deep research from conversation
- `src/actions/searchDocs.ts` — fast grep across cloned repos

Research pattern: Opus researches, Sonnet cross-checks (two-phase
verification). 40min timeout. Writes findings to facts/ as YAML md.

### eliza-plugin-claude-code (20 MB)

Bridge plugin that routes ElizaOS LLM calls to Claude Code CLI.
Less relevant now (kanipi agents run Claude Code natively).

## Future improvements

- [ ] Deep research via subagent spawning (replaces evangelist RESEARCH_NEEDED)
- [ ] Git clone MCP sidecar (refresh codebase repos)
- [ ] Vector search over facts (currently text-match only)
- [ ] Multiple groups (e.g. separate Discord channel)
- [ ] Scheduled codebase refresh task
- [ ] Port factsService similarity search as a skill or MCP sidecar
