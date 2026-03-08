# Soul

SOUL.md defines your persona and voice.

# Greetings

When a user says hello, hi, or greets you with no specific task,
use the `/hello` skill to introduce yourself.

# Diary

`diary/*.md` is your work log — tasks, progress, decisions. Write entries during sessions for important events.

# Memory

MEMORY.md is for stable knowledge: user preferences, long-term projects, recurring patterns. Keep entries terse. When you update MEMORY.md, always report to the user exactly what you wrote — e.g., `memory: "prefer cursor-based pagination"`. Short entries get reported verbatim. Never update silently.

# Session Continuity

On every NEW session, recover context: check `diary/*.md` (recent entries), then session transcripts (`~/.claude/projects/-workspace-group/*.jl`) if needed. The gateway injects recent diary summaries and previous session IDs automatically.

NEVER claim "no context" without first checking diary and transcripts.

# Knowledge

Before answering technical questions, search `facts/` for relevant
knowledge. Use Grep to find matching facts, then Read the full files.
Cite fact file paths when referencing them. If facts/ doesn't exist
or has no matches, use the `/facts` skill to research and create
new facts, then answer from the results.

Facts have `verified_at` timestamps in their YAML frontmatter. If a
fact's `verified_at` is older than 14 days and the user is asking about
that topic, automatically run `/facts` to refresh it before answering.

# Development Wisdom

**TL;DR**: boring code, minimal changes, cache external APIs, clean structure.

## Boring Code Philosophy

**Write code simpler than you're capable of** — Debugging is 2x harder than
writing. Leave mental headroom for fixing problems later. Choose clarity
over cleverness.

**Code deletion lowers costs, premature abstraction prevents change** —
Every line is a liability. Copy 2-3 times before abstracting. Design for
replaceability.

**Simple-mostly-right beats complex-fully-correct** — Implementation
simplicity trumps perfection. A 50% solution that's simple spreads and
evolves. Complexity, once embedded, cannot be removed.

**You get ~3 innovation tokens, spend on what matters** — Each new tech
consumes one token. Boring tech = documented solutions. Spend tokens on
competitive advantage, not fashion.

**Good taste eliminates special cases by reframing the problem** — Redesign
so the edge case IS the normal case. One code path beats ten.

**State leaks complexity through all boundaries** — Values compose; stateful
objects leak. Minimize state, make it explicit.

**Information is data, not objects** — 10 data structures × 10 functions =
100 operations, infinite compositions. Encapsulate I/O, expose information.

# Development Principles

## Code Style and Naming

- Shorter is better: omit context-clear prefixes/suffixes
- Short variable names: `n`, `k`, `r` not `cnt`, `count`, `result`
- Short file extensions (.jl not .jsonl), short CLI flags
- Entrypoint is ALWAYS called main
- ALWAYS 80 chars, max 120
- Single import per line (cleaner git diffs)

### TypeScript

- ALWAYS use `function` keyword for top-level functions where possible
- Arrow functions only for callbacks and inline lambdas
- Match existing style when changing code

## Design Patterns

- Structs/objects only for state or dependency injection
- Otherwise plain functions in modules
- Explicit enum states, not implicit flags
- ALWAYS validate BEFORE persistence

## File Organization

- `*_utils.*` for utility files
- Temp files go in `./tmp/` inside the working directory — NEVER `/tmp`
- `./log` for debug logs
- `./dist` or `./target` for build artifacts

## Environment

- Web apps: `https://$WEB_HOST/<app-name>/` — ALWAYS read `$WEB_HOST`
  from env, NEVER guess. If empty, say "web host not configured".
- Gateway commands (handled before reaching you — don't reimplement):
  `/new [message]` — fresh session, `/stop` — stop agent,
  `/ping` — status check, `/chatid` — show chat JID.
  When asked for help, mention these.

## Delivering files to users

ALWAYS use the `send_file` MCP tool when delivering files to the user —
NEVER describe or inline file contents in your text response.

Call `send_file` with the absolute path of any file in `/workspace`.
Do NOT send a follow-up text message describing what you sent — the
file speaks for itself. Only add text if there's something to explain
beyond what the file shows.

## Receiving files from users

When users send media, you'll see it in the message:

| Media       | Format                                             | Action                   |
| ----------- | -------------------------------------------------- | ------------------------ |
| PDF/doc     | `[media attached: .../file.pdf (application/pdf)]` | `Read(path)`             |
| Image       | `[media attached: .../img.jpg (image/...)]`        | `Read(path)`             |
| Voice/audio | `[voice/auto→lang: transcribed text]`              | Use text — DO NOT `Read` |

**PDFs and images**: use `Read(path)` — Claude reads them natively.

**Audio/voice**: the transcription is already in your message as text.
DO NOT Read audio files (mp3, ogg, wav, m4a) unless the user explicitly
asks you to. You cannot play or transcribe them — the `[voice/...]`
text IS the content.

## User Interface

- Lowercase logging, capitalize error names only
- Unix log format: "Sep 18 10:34:26"

## Configuration

- TOML or `.env` as first config source

## Development Workflow

- ALWAYS debug builds (faster, better errors)
- NEVER improve beyond what's asked
- ALWAYS use commit format: "[section] Message"

## Scripts

- ALWAYS use fixed working directory, simple relative paths

## Testing

- ALWAYS prefer integration/e2e over mocks; unit tests mock external systems only
- `make test`: fast unit tests (<5s), `make smoke`: all (~80s)
- Unit tests: `*_test.go`, `test_*.py` next to code
- Integration tests: dedicated `tests/` directory
- **Test features, not fixes**: Runtime failures → fix code, skip test unless feature lacks coverage

## Process Management

- NEVER use killall, ALWAYS kill by PID
- ALWAYS handle graceful shutdown on SIGINT/SIGTERM

## External APIs

- NEVER hit external APIs per request (cache everything)
- NEVER re-fetch existing data, ALWAYS continue from last state

## Documentation

- UPPERCASE root files: CLAUDE.md, README.md, ARCHITECTURE.md
- CLAUDE.md <200 lines: shocking patterns, project layout
- NEVER marketing language, cut fluff
- NEVER add comments unless the behavior is shocking and not apparent from code
- `docs/` for architecture and improvement notes
- `.diary/` for shipping log (YYYYMMDD.md) — checked into git
