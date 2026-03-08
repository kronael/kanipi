# Agent Capabilities Setup

v1m1 spec — catalog of agent capabilities, data sources, media
handling, and content presentation. Goal: agents know what they
can do and pick the right output format naturally.

## Current state

### Container tooling

Agents run in `node:22-slim` with:

- **chromium** + **agent-browser** — full browser automation
- **curl**, **git**, **bun**, **node**
- **claude-code** — Claude Agent SDK

Missing from container (need apt or sidecar):

- `yt-dlp` — YouTube/video download
- `ffmpeg` — audio/video conversion
- `python3` — scripting, data processing
- `jq` — JSON processing
- `gallery-dl` — image gallery scraping
- `pandoc` — document conversion (HTML to PDF, etc.)

### Gateway-side media handling

Gateway processes media before it reaches the agent:

- **Voice messages** → whisper sidecar transcribes, text injected
- **Video messages** → ffmpeg extracts audio → whisper transcribes
- **Images** → passed as attachments (Claude vision reads them)
- **Documents** → saved to group's `media/` dir, path in message

### IPC actions (agent → gateway)

- `send_message` — text to any registered channel
- `send_file` — file attachment to any channel
- `inject_message` — insert message into DB without delivery

### User commands (gateway-side, not agent)

- `/put [path]` — upload file to workspace
- `/get <path>` — download file from workspace
- `/ls [path]` — list workspace files

## Data sources

### Tier 1: works now (browser + curl)

| Source          | Method         | Notes                          |
| --------------- | -------------- | ------------------------------ |
| Web pages       | agent-browser  | full JS rendering, screenshots |
| REST APIs       | curl / fetch   | JSON, XML, any format          |
| RSS/Atom feeds  | curl + parse   | no special tooling needed      |
| Google search   | agent-browser  | navigate + extract             |
| Public web data | agent-browser  | tables, lists, articles        |
| Images on web   | curl / browser | download, Claude vision reads  |
| PDFs on web     | curl download  | Claude reads PDFs natively     |

### Tier 2: needs yt-dlp in container

| Source              | Method              | Notes                    |
| ------------------- | ------------------- | ------------------------ |
| YouTube videos      | yt-dlp              | download audio/video     |
| YouTube transcripts | yt-dlp --write-subs | extract captions         |
| YouTube metadata    | yt-dlp --dump-json  | title, description, etc. |
| Twitter/X videos    | yt-dlp              | supports many sites      |
| Podcast episodes    | yt-dlp / curl       | audio download           |

### Tier 3: needs ffmpeg in container

| Source                  | Method                   | Notes                       |
| ----------------------- | ------------------------ | --------------------------- |
| Audio transcription     | ffmpeg + whisper sidecar | extract → transcribe        |
| Video frame extraction  | ffmpeg -ss               | screenshot at timestamp     |
| Audio format conversion | ffmpeg                   | any format to wav/mp3       |
| Media metadata          | ffprobe                  | duration, codec, resolution |

### Tier 4: needs python3 in container

| Source              | Method                 | Notes                  |
| ------------------- | ---------------------- | ---------------------- |
| Structured scraping | beautifulsoup / scrapy | complex HTML parsing   |
| Data analysis       | pandas                 | CSV, Excel, statistics |
| Chart generation    | matplotlib             | data visualization     |
| Image processing    | pillow                 | resize, crop, annotate |

## Content presentation

### Decision tree

```
Is the user asking for a specific file format?
  YES → send_file (PDF, CSV, XLSX, etc.)
  NO ↓

Is the content short (< ~500 words, simple structure)?
  YES → chat message (text or markdown)
  NO ↓

Is it raw data (CSV, JSON, code, archives)?
  YES → send_file
  NO ↓

Deploy to web.
  - One-off content → pages/ (dated, auto-indexed)
  - Persistent app → named directory (e.g. /dashboard/)
  - Always verify with curl after deploy
```

### Output formats

| Format                | When                                               | How                                      |
| --------------------- | -------------------------------------------------- | ---------------------------------------- |
| Chat message          | Short answers, confirmations, summaries            | Direct text response                     |
| Web page              | Guides, reports, research, itineraries, dashboards | web skill → `$WEB_DIR/`                  |
| Web page (disposable) | One-off content, dated                             | web skill → `$WEB_DIR/pages/YYYY-MM-DD/` |
| File attachment       | Explicit request, raw data, archives               | `send_file` action                       |
| Screenshot            | Visual proof, web state capture                    | agent-browser screenshot                 |

### Howto updates needed

The howto skill should present these capabilities by level:

**Level 1 additions:**

- "Send me a voice message — I'll transcribe it"
- "Send images — I can read and analyze them"
- "Send documents — I can read PDFs, spreadsheets, text files"
- "I create web pages for rich content (guides, research)"

**Level 2 additions:**

- "Ask me to research something — I'll create a web page"
- "I can scrape websites and extract structured data"
- "I can monitor prices, news, or any web data on schedule"
- YouTube/video transcription (when yt-dlp available)

## Implementation plan

### Phase 1: container tooling (Dockerfile changes)

Add to agent container:

```dockerfile
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 python3-pip \
    jq \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install --break-system-packages yt-dlp
```

This unlocks tier 2 + tier 3 sources. ~150MB image size increase.

Alternative: sidecar model (like whisper). Heavier to set up but
keeps agent container slim. Recommendation: just add to container —
these are standard unix tools, not heavy ML models.

### Phase 2: skill for data collection

New skill: `container/skills/collect/SKILL.md`

Teaches agent how to:

- Use yt-dlp for YouTube (transcripts, audio, metadata)
- Use ffmpeg for media conversion
- Use agent-browser for web scraping
- Use curl for API access
- Store collected data in group workspace
- Present results (web page vs file vs message)

### Phase 3: howto skill update

Update `container/skills/howto/SKILL.md` level 1 and level 2
sections to mention:

- Voice/audio transcription
- Image analysis
- Document reading
- Web page creation for rich content
- Data collection capabilities (when tools available)

### Phase 4: audio steering

Agent-side audio output (text-to-speech) for voice-first channels.
Requires TTS sidecar or API. Out of scope for v1m1 — note for v1m2.

## Open questions

1. **yt-dlp in container vs sidecar** — container is simpler,
   sidecar keeps image small. yt-dlp binary is ~30MB.
2. **Whisper from agent** — currently gateway-only. Should agents
   be able to call whisper directly for downloaded audio?
3. **Gallery-dl** — worth including for image-heavy scraping?
   Or is agent-browser sufficient?
4. **Rate limiting** — agents hitting external APIs need throttling.
   Per-session or per-instance limits?
