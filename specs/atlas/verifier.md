# Verifier

Quality gate on research output.

## Evangelist approach

Two-phase: Opus researches, Sonnet cross-checks.
Sonnet gets the findings + access to the same sources.
Rejection drops findings entirely. Binary: accept or reject.

## Kanipi approach

? Second subagent pass after researcher writes to facts/
? Or agent self-critique (single pass, review own output)
? Or skip entirely — quality from the research prompt itself

## Open questions

- Is two-phase worth the cost (2x tokens, 2x time)?
- What's the false positive rate without verification?
- Could a simple heuristic replace LLM verification?
  (e.g., reject facts <50 chars, reject if no source citation)
- Should verification be async or block delivery?
