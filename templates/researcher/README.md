# Researcher Template

A kanipi template for autonomous research agents. The bot conducts deep
research, builds a verified knowledge base, and produces structured reports.

## What's included

- `SYSTEM.md` — research-focused system prompt; three-phase pipeline
  (plan → gather → synthesize), source citation requirements, structured
  report format
- `SOUL.md` — rigorous researcher persona (methodical, thorough, skeptical of sources)
- `CLAUDE.md` — routing note
- `env.example` — configuration with placeholders

## Setup

### 1. Create instance

```bash
sudo kanipi create --template researcher <name>
```

### 2. Configure

Edit `/srv/data/kanipi_<name>/.env`:

- `TELEGRAM_BOT_TOKEN` — bot token
- `ASSISTANT_NAME` — researcher bot name
- `AUTH_SECRET` — already generated

### 3. Customize research scope

Edit `groups/root/CLAUDE.md` to define the research domain:

- Topic areas the bot specializes in
- Preferred sources or source restrictions
- Output format preferences (Markdown, PDF via weasyprint, etc.)

### 4. Set up scheduled research (optional)

Add cron tasks for recurring research runs:

```bash
kanipi task add <name> root "0 8 * * *" "Research and summarize latest developments in <topic>"
```

### 5. Start

```bash
sudo systemctl enable --now kanipi_<name>
```

## Skill behavior

| Skill         | Behavior                                         |
| ------------- | ------------------------------------------------ |
| web           | Active — deploy research reports as web pages    |
| facts         | Active — primary knowledge store for research    |
| recall        | Active — search existing research before digging |
| research      | Active — deep multi-source research pipeline     |
| acquire       | Active — video/audio download, transcription     |
| agent-browser | Active — browse web for research                 |
| tweet         | Active — distill research into threads           |

## Research workflow

1. User sends research request
2. Bot runs `/recall` to check existing knowledge
3. If insufficient: deep research via WebSearch + WebFetch + agent-browser
4. Facts created/updated in `facts/` with verification date
5. Report delivered as web page or file
