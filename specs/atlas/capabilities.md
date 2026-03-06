# Atlas: What We Actually Need

Strip away ElizaOS scaffolding. The evangelist plugin's real value is 5 things.

## 1. Facts

YAML markdown knowledge files. Institutional memory.

**Status:** Have them. 50+ files copied to `groups/main/facts/`.

## 2. Facts search (similarity)

Given a question, find the most relevant facts.
Evangelist used embeddings with keyword fallback, tiered confidence
(high >80%, medium 40-80%, low <40%). Max ~18 facts injected per message.

**Status:** Not built. Agent can grep facts/ manually but no
automatic similarity search or injection.

**Options:**

- MCP sidecar with embedding model (nomic-embed-text via Ollama)
- Simple keyword/TF-IDF search as a skill (no embeddings needed)
- Agent-side: `/facts <query>` skill that searches and returns matches
- Gateway-side: inject top-N facts into prompt (like diary injection)

## 3. Researcher

Background task that explores repos, web, docs — writes findings
to facts/ as new YAML markdown files.

Evangelist: 40-min Opus task, spawned on knowledge gap detection
or explicit trigger. Read-only tools (Grep, Glob, Read, WebSearch,
git clone). Output: XML factset parsed into fact files.

**Status:** Not built.

**Options:**

- Subagent with research prompt + write access to facts/
- Scheduled or on-demand via `/research <question>`
- Agent already has all the tools — just needs the workflow

## 4. Verifier

Quality gate on research output. Evangelist: Opus researches,
Sonnet cross-checks (two-phase). Rejection drops findings entirely.

**Status:** Not built.

**Options:**

- Second subagent pass with verify prompt
- Or skip initially — single-pass research with agent self-critique
- Quality comes from the prompt, not the architecture

## 5. Persona / gatekeeper

How the agent behaves, who it responds to, honesty rules.

**Status:** Done. CLAUDE.md + character.json + group trigger mode.

## Also missing (not evangelist-specific, but needed)

### Forwarded messages

Telegram forwards carry `forward_origin` metadata. Kanipi drops it —
agent sees raw text with no context that it was forwarded or who said it.
The evangelist had `handleForward` that extracted the original question.

**To build:** Parse `forward_origin` in telegram.ts, prepend
`[Forwarded from <name>]` to message text (like media placeholders).

### Reply-to threading

Evangelist patched grammy to send replies with `reply_to_message_id`
so research results threaded back to the original question.
Kanipi doesn't track or use reply-to at all.

**To build:** Store message ID in gateway DB, pass to agent context.
Agent or IPC sendMessage includes `replyTo` field. Channel sends
with `reply_to_message_id`. Needed for research delivery threading.

## Everything else

Everything else the evangelist plugin did is either:

- Kanipi infrastructure (message routing, logging, sessions, file delivery)
- Claude Code native (codebase grep, file reading, web search)
- ElizaOS plumbing (providers, evaluators, action routing, Eliza cache)

## Build order

1. **Facts search** — a `/facts` skill or gateway injection. Biggest impact.
2. **Forwarded messages** — simple, high usability. Few lines in telegram.ts.
3. **Researcher** — subagent workflow. Write findings to facts/.
4. **Reply-to threading** — needed for research delivery.
5. **Verifier** — second pass. Can defer (single-pass is fine initially).
