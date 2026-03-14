---
status: shipped
---

# Agent Capabilities

Agent containers are rich environments with multimedia
acquisition, compilation toolchains, and browser automation.

## Container tooling

**Base**: node 22, chromium, curl, git

**Runtimes**: bun, python3, go 1.24, rust/cargo, uv

**Media**: ffmpeg, yt-dlp, imagemagick, optipng, jpegoptim

**Research**: pandoc, pdftotext (poppler-utils), tesseract-ocr,
httrack, agent-browser

**Data/office**: pandas, numpy, scipy, matplotlib, plotly,
weasyprint, marp-cli (slides), python-pptx, openpyxl

**Linters**: biome, ruff, pyright, shellcheck, prettier,
htmlhint, svgo

**Network**: wget, whois, dnsutils (dig), traceroute, net-tools

**Search**: ripgrep, fd-find, fzf, tree, bat

**Build**: build-essential, pkg-config, jq

Full inventory in `container/Dockerfile`.

## Gateway → agent data flow

| Media   | Gateway processing  | What agent sees                |
| ------- | ------------------- | ------------------------------ |
| Voice   | whisper transcribes | `[voice/auto→en: text]`        |
| Video   | ffmpeg → whisper    | `[video audio: text]`          |
| Image   | passed through      | attachment path (vision reads) |
| PDF/doc | passed through      | attachment path (Read tool)    |

Video transcription is off by default (`VIDEO_TRANSCRIPTION_ENABLED`).

## Agent → whisper (direct)

`WHISPER_BASE_URL` env var passed to container. Agent can
transcribe audio it downloads (yt-dlp output, podcast
episodes, etc.) without going through gateway IPC.

## Skill: acquire

`container/skills/acquire/SKILL.md` — teaches agents the
multimedia acquisition strategy:

1. Prefer transcripts over raw media
2. Screenshot key moments for visual context
3. Metadata first (often enough without full download)
4. Non-obvious search services (DeepWiki, Marginalia, etc.)

## Content presentation

Decision: short → chat message, rich → web page,
raw data → send_file. Documented in container/CLAUDE.md
(tools section).
