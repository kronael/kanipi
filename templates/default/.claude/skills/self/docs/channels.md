# Channels

Channels are enabled by env var presence in the instance `.env`. Set them, restart the gateway.

## Chat channels (no impulse gate)

| Channel   | Trigger env var                       | Notes                                       |
| --------- | ------------------------------------- | ------------------------------------------- |
| Telegram  | `TELEGRAM_BOT_TOKEN`                  | grammy bot, long-poll or webhook            |
| Discord   | `DISCORD_USER_TOKEN`                  | userbot (discord.js-selfbot-v13), NOT a bot |
| WhatsApp  | (creds file)                          | baileys; no token — QR pairing              |
| Email     | `EMAIL_IMAP_HOST`                     | IMAP IDLE + SMTP reply threading            |
| Slack     | `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` | @slack/bolt Socket Mode; no public URL      |
| Web/slink | slink token in DB                     | HTTP POST; no gateway env var needed        |

## Social channels (through impulse gate)

| Channel  | Trigger env vars                                        | Library                      |
| -------- | ------------------------------------------------------- | ---------------------------- |
| Twitter  | `TWITTER_USERNAME`, `TWITTER_PASSWORD`, `TWITTER_EMAIL` | agent-twitter-client scraper |
| Mastodon | `MASTODON_*`                                            | REST + streaming             |
| Bluesky  | `BLUESKY_*`                                             | AT protocol                  |
| Reddit   | `REDDIT_*`                                              | REST                         |

Social channels accumulate events through the impulse gate. Default: fire on every message (threshold=100, weight=100). For store-only, see `routing.md`.

---

## Setup details

### Telegram

```env
TELEGRAM_BOT_TOKEN=123456:ABC...
```

Get token from [@BotFather](https://t.me/BotFather). The bot must be added to groups and given message read permission.

### Discord (userbot)

```env
DISCORD_USER_TOKEN=<your account token>
```

Get from browser: DevTools → Network tab → any Discord API request → `Authorization` header value. **This is your personal account token — treat as a password.** Using userbots may violate Discord ToS; use a dedicated account.

After starting, send `!chatid` in any channel to get the JID for registration:

```bash
kanipi config <name> group add discord:1234567890 <folder>
```

Discord channels are typically configured as **watch-only**: messages are stored
and appear as `<observed>` context in other groups, but do not trigger the agent
directly. This is done via a platform wildcard route with zero-weight impulse config:

```javascript
add_route({
  jid: 'discord:',
  type: 'default',
  seq: 9999,
  target: 'root',
  impulse_config: JSON.stringify({
    threshold: 100,
    weights: { '*': 0 },
    max_hold_ms: 0,
  }),
});
```

See `routing.md` for impulse config details and observed messages.

### WhatsApp

No env var. Start gateway without WhatsApp credentials — a QR code prints to terminal. Scan with WhatsApp mobile app. Credentials saved to `store/auth/creds.json` and reused on restart.

### Email

```env
EMAIL_IMAP_HOST=imap.example.com
EMAIL_SMTP_HOST=smtp.example.com   # optional, derived from IMAP if unset
EMAIL_ACCOUNT=bot@example.com
EMAIL_PASSWORD=secret
```

Reply threading via SMTP; IMAP IDLE for live delivery.

### Slack

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
```

Uses Socket Mode — no public URL needed. The bot connects outbound via WebSocket.

**Required scopes** (OAuth & Permissions):

- `chat:write` — post messages
- `files:write` — upload files
- `channels:history`, `groups:history`, `im:history`, `mpim:history` — read messages
- `users:read` — resolve display names
- `channels:read`, `groups:read` — resolve channel names

**App-Level Token** (`xapp-...`) requires `connections:write` scope (Socket Mode).

Enable Socket Mode in your Slack app settings, then add the bot to channels. Send `!chatid` in any channel to get the JID:

```bash
kanipi config <name> group add slack:C1234567890 <folder>
```

### Twitter/X

```env
TWITTER_USERNAME=@handle
TWITTER_PASSWORD=secret
TWITTER_EMAIL=account@example.com
```

Uses `agent-twitter-client` scraper (no API key). Cookies cached in `store/twitter-cookies.json`. The `me()` call verifies login on startup.

Limitations: scraper may break on Twitter UI changes. No native media upload. Rate-limited by Twitter.

---

## JID formats

| Channel  | Format                 | Example               |
| -------- | ---------------------- | --------------------- |
| telegram | `telegram:<chat_id>`   | `telegram:-100123456` |
| discord  | `discord:<channel_id>` | `discord:1234567890`  |
| whatsapp | `whatsapp:<jid>`       | `whatsapp:12345@g.us` |
| email    | `email:<thread_id>`    | `email:<Message-ID>`  |
| slack    | `slack:<channel_id>`   | `slack:C1234567890`   |
| twitter  | `twitter:<user_id>`    | `twitter:123456`      |
| web      | `web:<name>`           | `web:main`            |
