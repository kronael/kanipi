---
status: next
---

# Social Channels Rollback — kanipi end state

## Decision

kanipi ends as a complete, stable TypeScript gateway at **5 core channels +
support + evangelist templates**. Social inbound channels (twitter, reddit,
facebook, bluesky, mastodon) are removed. Arizuko (Go rewrite) is the
continuation for social and future channel work.

Evangelist template stays — it is outbound posting via skills, not an
inbound channel adapter.

## What to remove

### Source

```
src/channels/twitter/          client.ts, watcher.ts, index.ts
src/channels/reddit/           client.ts, watcher.ts, index.ts
src/channels/facebook/         client.ts, watcher.ts, index.ts
src/channels/bluesky/          client.ts, watcher.ts, index.ts
src/channels/mastodon/         client.ts, watcher.ts, index.ts
src/actions/social.ts          social action registry (like, repost, reply-to-post)
src/actions/social.test.ts
```

Remove channel registrations from `src/index.ts` (twitter/reddit/facebook/
bluesky/mastodon init blocks and their env var guards).

Remove from `src/types.ts`: social-specific channel option types if any
are not shared with core channels.

### Templates

```
templates/default/.claude/output-styles/twitter.md
templates/default/.claude/output-styles/bluesky.md
templates/default/.claude/output-styles/mastodon.md
templates/default/.claude/output-styles/reddit.md
templates/default/.claude/output-styles/facebook.md
```

### Tests

Remove test cases that reference social channels by name in:

- `src/routing.test.ts`
- `src/grants-derive.test.ts`
- `src/action-registry.test.ts`
- `src/grants.test.ts`
- `src/ipc.test.ts`

Do not remove entire test files — only the social-channel-specific cases.

### Docs

In `specs/index.md`, phase 2 section: remove or mark `dropped` for:

- `f-facebook` — Facebook Page channel
- `g-reddit` — Reddit channel
- `h-twitter` — Twitter/X channel
- `i-social-events` — Unified inbound model
- `j-social-actions` — Outbound action catalog
- `k-channel-actions` — Dynamic action registration

In `docs/kanipi.html`: remove social channels from the channel adapter list.
Update TL;DR and stats to reflect 5 channels (not 8+).

### ROADMAP.md

Replace current content with a clear "shipped / done" declaration:

- Phase 1–3 shipped
- Phase 2 social channels: dropped (moved to arizuko)
- Status: maintenance only — no new features planned
- Future: arizuko (Go rewrite, same agent container)

### CHANGELOG.md

Add a `[Unreleased]` entry documenting the rollback and the rationale.

## What stays

- `src/channels/telegram/`, `whatsapp/`, `discord/`, `email/`, `web/` — unchanged
- `src/dashboards/evangelist.ts` — outbound posting dashboard, not a channel
- `templates/evangelist/` — post pipeline template
- `templates/support/` — support bot template
- `templates/default/.claude/output-styles/telegram.md`, `discord.md`, `email.md`, `whatsapp.md`, `web.md`
- All Phase 3 features: dashboards, auth, routing, memory, onboarding, permissions

## Acceptance criteria

- `make build` passes with no social channel imports
- `make test` passes with reduced test count (fewer cases, same pass rate)
- `src/index.ts` references no social channel modules
- `templates/default/.claude/output-styles/` has exactly 5 files: telegram, discord, email, whatsapp, web
- `specs/index.md` phase 2 social specs marked `dropped`
- `ROADMAP.md` declares kanipi done
- New CHANGELOG entry documents rollback
- `docs/kanipi.html` updated and deployed to krons
