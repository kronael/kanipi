# v2: Audience Agents

v2 is about agents that serve many users — not just the operator.
Atlas (Marinade codebase guide), support bots, community agents.

The core problems:

1. **Facts** — institutional knowledge the agent draws from
2. **Facts search** — find the right facts for a question (similarity)
3. **Researcher** — background task that grows the knowledge base
4. **Verifier** — quality gate on new knowledge
5. **User context** — per-user memory, preferences, history

## What moved

Previous v2 specs (topics, memory layers, IPC→MCP, workflows,
channel adapters) moved to v3/. They're infrastructure concerns.

v2 is the product layer: making agents useful for audiences.
