# Knowledge: Files + Summaries + Injection + Nudges

One pattern, applied at different scales. Not separate systems.

## The pattern

1. **Files** in a directory, structured by some key (date, topic, user)
2. **Summaries** in frontmatter or index — compact representation
3. **Injection** of relevant summaries into agent context (gateway-side)
4. **Nudges** that prompt the agent to create/update files (hooks, skills)

## Layers

### Diary (shipped)

- Key: date (`YYYYMMDD.md`)
- Summaries: YAML frontmatter
- Injection: 2 most recent on session start, with relative time
- Nudges: PreCompact hook, Stop hook at 100 turns
- Scale: ~1 file/day, always small enough to inject all summaries

### Facts (atlas, to build)

- Key: topic slug (`validator-bonds.md`, `sam-auction.md`)
- Summaries: YAML frontmatter (topic, confidence, verified_at)
- Injection: relevant summaries by query (needs search when corpus is large)
- Nudges: researcher subagent, or agent notices gap and writes
- Scale: 50+ files now, could grow to hundreds

### Episodes (future)

- Key: time period (weekly/monthly)
- Summaries: distilled from diary entries
- Injection: alongside diary summaries
- Nudges: scheduled task aggregates diary into episodes
- Scale: ~4/month, always small

### User context (future)

- Key: user ID (`<user-id>.md`)
- Summaries: first N lines of body
- Injection: on message from that user
- Nudges: agent notices new user or notable preference
- Scale: grows with audience, needs search at scale

## Retrieval

Small corpus (diary, episodes): inject all summaries. No search needed.

Large corpus (facts, users): need a search tool.

Options:

- MCP sidecar with embeddings (Ollama at 10.0.5.1:11434)
- Agent uses Grep as poor-man's search (works for <100 files)
- `search_knowledge(query) → top-N chunks` tool

The search tool is generic — same tool works for facts, user
context, or any other file-based knowledge. It's just an index
over a directory.

## Agent creates knowledge

Same as diary: agent writes files using standard file tools.
Gateway nudges via hooks and skills. No special write API.

Researcher = agent (or subagent) that writes to facts/.
User context = agent that writes to users/.
Episodes = agent (or scheduled task) that reads diary, writes episodes.

All just files. The "system" is the nudge + injection pattern.
