# TODO

## Phase 3 — kanipi v1.x

- [x] paths: hostPath() elimination (HOST\_\* exports done)
- [x] session-recovery: diary recovery entries on error/crash
- [x] diary: stop hook nudge, precompact cleanup, 14-entry injection, CLAUDE.md updates
- [x] errored chat flag: skip errored chats until new message
- [x] legacy IPC removal: drainLegacyMessages / drainLegacyTasks gone
- [x] nested IPC groups: scanGroupFolders recurse fix (atlas/support now watched)
- [x] tier auth: send_message/send_file allow tier-2 agents in same world
- [x] chat-bound-sessions: IDLE_TIMEOUT=0, send_reply action, chatJid on ActionContext (3/L)
- [x] orphan cleanup: kill nanoclaw-\* on gateway startup
- [x] permissions: tier 0-3 gaps closed (grants.ts, send_message/send_file scoped)
- [x] think-blocks: stripThinkBlocks() in agent-runner:137 (3/M)
- [x] status-messages: extractStatusBlocks() in agent-runner:122 (3/N)
- [x] escalation impl: escalateGroup in actions/groups.ts (3/5-permissions)
- [x] jid-format: consistent platform:id URIs throughout (3/H)
- [x] dash-status: dashboard portal with containers/queues/state (src/dashboards/)
- [x] memory-episodic: compact-memories skill + episode.ts gateway injection (4/B)
- [x] sse: stream endpoint auth — /\_sloth/stream requires session cookie for private groups
- [x] autotesting: IPC drain + voice roundtrip (3/2)
- [x] platform-permissions: action grants system — deriveRules, checkAction, set/get_grants IPC (4/V)
- [x] dashboards: memory+facts dashboard at /dash/memory/ (facts, episodes, MEMORY.md)
- [x] researcher: shipped as /facts skill (research + verify cycle); background cron below
- [x] support: shipped as Marinade Atlas (specs/3/3-code-research.md)
- [x] codebase-trim: dead code removal ~900 lines (3/G)
- [x] dashboards: long-running web services for operator tools (4/4)

## Container tooling

Already in container: git, bun, go, rust, python+uv, chromium, ffmpeg, ripgrep, fd,
fzf, bat, jq, shellcheck, pandoc, imagemagick, yt-dlp, tesseract, optipng, jpegoptim,
marp-cli, biome, prettier, ruff, pyright, pandas, matplotlib, plotly, numpy, scipy,
python-pptx, openpyxl, weasyprint.

### Code hosting / VCS

- [ ] `gh` — GitHub CLI: issues, PRs, releases, gists, Actions

### Data / query

- [ ] `sqlite3` — explicit CLI (query local DBs, not just via Python)
- [ ] `duckdb` — in-process analytics on CSV/JSON/parquet, no server needed
- [ ] `psql` — Postgres client (pg_dump, query remote DBs)
- [ ] `redis-cli` — query Redis instances
- [ ] `xsv` — fast CSV slicing/sorting/joining (Rust, single binary)
- [ ] `yq` — YAML processor (jq for YAML; configs, k8s, CI files)
- [ ] `jless` — interactive JSON browser in terminal
- [ ] `miller` — stream CSV/JSON/TSV like awk (complements xsv)

### HTTP / API / network

- [ ] `xh` — modern curl alternative (Rust httpie; cleaner API testing output)
- [ ] `websocat` — WebSocket client/server for testing WS endpoints
- [ ] `grpcurl` — gRPC reflection + call testing
- [ ] `hurl` — file-based HTTP test sequences (CI-friendly)
- [ ] `socat` — bidirectional data relay; Unix socket debugging

### Git / diff

- [ ] `delta` — syntax-highlighted git diffs (agent-readable output)
- [ ] `glow` — render markdown in terminal (for reading docs/READMEs)
- [ ] `shfmt` — shell script formatter (pair with shellcheck)

### Linting / static analysis

- [ ] `hadolint` — Dockerfile linter
- [ ] `sqlfluff` — SQL formatter and linter
- [ ] `semgrep` — multi-language static analysis / secret scanning
- [ ] `yamllint` — YAML strict linter (catches tab issues, duplicates)
- [ ] `vale` — prose linter (docs, changelogs, READMEs)

### Build / task runners

- [ ] `just` — justfile task runner (simpler make; one per project)
- [ ] `watchexec` — re-run commands on file change (dev loops)
- [ ] `hyperfine` — command benchmarking with stats

### Load / perf testing

- [ ] `k6` — scriptable HTTP load testing (JS scripts)

### Diagrams / visualization

- [ ] `graphviz` — dot → SVG/PNG (architecture, dependency graphs)
- [ ] `gnuplot` — terminal/file plotting from data
- [ ] `typst` — modern typesetting (PDF reports, whitepapers; lighter than LaTeX)

### Media / documents

- [ ] `ghostscript` — PDF merge/split/compress
- [ ] `exiftool` — read/write media metadata
- [ ] `sox` — audio format conversion and processing
- [ ] `mediainfo` — detailed media file inspection
- [ ] `qrencode` — generate QR codes from CLI

### Security / secrets

- [ ] `age` — modern file encryption (replaces GPG for most cases)
- [ ] `sops` — encrypted secrets files (YAML/JSON/env with age/GPG keys)

### Infrastructure

- [ ] `kubectl` — Kubernetes cluster management
- [ ] `opentofu` — IaC (open Terraform fork; provision cloud resources)
- [ ] `aws` CLI — S3, Lambda, ECR, CloudWatch from agent

### Blockchain / crypto

- [ ] `solana` CLI — keypairs, airdrop, deploy, account queries (Atlas/Marinade)
- [ ] `cast` (Foundry) — EVM: call contracts, send txs, decode data

### Runtime (one new language)

- [ ] `ruby` — scripting, Jekyll, occasional gem tooling

### Misc CLI

- [ ] `pv` — pipe viewer; progress on long pipes
- [ ] `parallel` — GNU parallel; fan-out batch operations
- [ ] `hexyl` — hex dump with ASCII sidebar (binary file inspection)
- [ ] `rsync` — efficient file sync (local and remote)
- [ ] `mkcert` — locally-trusted dev HTTPS certs
- [ ] `btm` (bottom) — resource monitor (CPU/mem/net per process)

## On-demand

- [ ] semantic search: embeddings MCP server (on demand)

## Arizuko — deferred to new instance

Requires architectural changes or new instance setup. Do not ship to marinade.

- [ ] unified home dir: groups/{folder} → /home/node, remove /workspace/group
- [x] dash-memory: diary/memory editor
- [ ] evangelist: community engagement agent (4/R)
- [x] gmail channel: dropped — generic IMAP email channel handles Gmail fine
- [ ] instance-repos: git-based config deployment (5/G)
- [ ] agent-pipeline: multi-hop routing, continuation payloads (5/2)
- [ ] ipc-mcp-proxy: unix socket replaces file IPC (5/A)
- [ ] workflows: multi-step workflow primitives (5/N)
- [ ] plugins: dynamic channel/feature loading (5/E)

## Dropped

- agent-routing (4/1): superseded by nested groups + routing rules (already shipped)
- stream-stall timeout: canceled
