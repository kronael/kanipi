# Facts Search (Similarity)

Given a question, find the most relevant facts from the corpus.

## Evangelist approach

- Embed all fact paragraphs (nomic-embed-text via Ollama)
- Embed the question
- Cosine similarity → ranked results
- Tiered: high (>80%), medium (40-80%), low (<40%)
- Max ~18 facts injected per message
- Keyword fallback when embeddings unavailable

## Options for kanipi

### A. Agent-side grep (current)

Agent greps facts/ manually. Works for small corpora.
No similarity ranking, no automatic injection.

### B. Gateway injection (like diary)

Gateway reads facts/, matches against incoming message text,
injects top-N into agent prompt. Simple keyword/TF-IDF.

### C. MCP sidecar with embeddings

Ollama sidecar (already available at `http://10.0.5.1:11434`).
MCP tool: `search_facts(query) → ranked results`.
Agent calls it when needed.

### D. Skill-based

`/facts <query>` skill. Agent-side, uses Grep + scoring heuristic.
No embeddings. Good enough for <100 files.

## Open questions

- Which approach? B is simplest. C is most capable.
- How often to re-embed? On every facts/ change? Batch?
- Should the agent decide when to search or should it be automatic?
- What's the performance at 100 facts? 1000?
