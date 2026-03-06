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

## That's it

Everything else the evangelist plugin did is either:

- Kanipi infrastructure (message routing, logging, sessions, file delivery)
- Claude Code native (codebase grep, file reading, web search)
- ElizaOS plumbing (providers, evaluators, action routing, Eliza cache)

## Build order

1. **Facts search** — a `/facts` skill or gateway injection. Biggest impact.
2. **Researcher** — subagent workflow. Write findings to facts/.
3. **Verifier** — second pass. Can defer (single-pass is fine initially).
