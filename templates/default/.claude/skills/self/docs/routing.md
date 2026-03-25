# Routing

Routes tell the gateway which group handles messages from a given JID. One route per row.

## Route types

| Type      | Match criteria                               | Example match |
| --------- | -------------------------------------------- | ------------- |
| `default` | fallback — matches all messages              | —             |
| `prefix`  | message starts with string (no space needed) | `@`, `#`      |
| `command` | exact or `match + ' '` prefix                | `/code`       |
| `pattern` | regex (max 200 chars)                        | `^deploy`     |
| `keyword` | case-insensitive substring                   | `billing`     |
| `sender`  | sender name matches regex                    | `alice`       |
| `verb`    | reserved for future use                      | —             |

Evaluation order: command → pattern → keyword → sender → default. First match wins within each tier. Routes sorted by `seq` (lower = higher priority).

Predefined routes (seq -2, -1) for tiers 0-2: `@` prefix and `#` prefix.

## MCP tools

```
get_routes(jid?)       # list routes; pass jid to filter, omit for all
add_route(...)         # add a route
delete_route(id)       # remove by ID
```

### add_route parameters

```
jid            string   # JID this route applies to (use $NANOCLAW_CHAT_JID)
type           string   # default | prefix | command | pattern | keyword | sender
seq            number   # priority (lower = first); user routes start at seq 0+
target         string   # group folder to delegate to
match?         string   # match string (required for all types except default)
impulse_config? string  # JSON impulse config (see below)
```

### Example: add a keyword route

```javascript
add_route({
  jid: process.env.NANOCLAW_CHAT_JID,
  type: 'keyword',
  seq: 10,
  match: 'billing',
  target: 'atlas/billing',
});
```

### Example: platform wildcard — store all Discord, never trigger

```javascript
add_route({
  jid: 'discord:', // wildcard: matches all discord JIDs
  type: 'default',
  seq: 9999,
  target: 'atlas/content',
  impulse_config: JSON.stringify({
    threshold: 100,
    weights: { '*': 0 },
    max_hold_ms: 0,
  }),
});
```

Platform wildcards use `<platform>:` (no channel ID). They apply to all JIDs of that platform when no per-channel route matches.

## Routing symbols

Built-in symbols handled before route table evaluation:

### @agent — delegate to child group

`@support hello` or `hey @support` anywhere in the message routes to `<parent>/support`. The `@name` token is stripped before the agent sees it. Falls through to normal processing if the child doesn't exist.

### #topic — named session within same group

`#deploy status` routes to session "deploy" within the same group. Same agent, same folder, different session history. Token stripped. `/new #deploy` resets that topic's session.

|              | @agent                    | #topic                        |
| ------------ | ------------------------- | ----------------------------- |
| Routes to    | different group/container | same group, different session |
| Context      | separate                  | separate                      |
| Agent config | can differ                | identical                     |

## Impulse config

All JIDs go through the impulse gate. Default: fire on every message.

```json
{ "threshold": 100, "weights": { "message": 100 }, "max_hold_ms": 300000 }
```

To store without triggering (e.g. for social monitoring):

```json
{ "threshold": 100, "weights": { "*": 0 }, "max_hold_ms": 0 }
```

Per-route `impulse_config` overrides the default for that JID. Platform wildcard routes provide the fallback config when no per-channel config exists.

## {sender} template routing

Route target can contain `{sender}` — expanded to the sender's name at routing time. Creates per-sender child folders automatically (auto-threading):

```javascript
add_route({
  jid: 'telegram:-123',
  type: 'default',
  seq: 0,
  target: 'atlas/{sender}',
});
```

Each sender gets routed to their own child group: `atlas/alice`, `atlas/bob`, etc.
