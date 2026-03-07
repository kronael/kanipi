---
name: howto
description: Generate a getting-started howto page for this group. Deploys to the group's web directory. Use when asked to create onboarding, setup guide, or howto page.
---

# Howto

Generate a getting-started page that guides new users through
using this agent. Deploys to the group's web directory.

## When to use

- First-time instance/group setup
- User asks for a howto, guide, or onboarding page
- Group has no howto yet

## Web directory convention

Every skill that publishes web content MUST use the group's
web prefix, not a hardcoded path. This keeps group web roots
isolated within the shared `/workspace/web/`.

```bash
GROUP_FOLDER=$(basename /workspace/group)
if [ "$NANOCLAW_IS_ROOT" = "1" ]; then
  WEB_DIR="/workspace/web"
else
  WEB_DIR="/workspace/web/$GROUP_FOLDER"
  mkdir -p "$WEB_DIR"
fi
```

Howto deploys to: `$WEB_DIR/howto/index.html`

Public URL:

- Root: `https://$WEB_HOST/howto/`
- Group: `https://$WEB_HOST/$GROUP_FOLDER/howto/`

## Design requirements

Single self-contained HTML file. No build step.

- Tailwind CSS via CDN (`https://cdn.tailwindcss.com`)
- Dark/light theme toggle (localStorage persistence)
- Mobile-first responsive design
- Clean card-based layout with numbered steps
- Code blocks with terminal styling (dark bg, colored syntax)
- Subtle dot-pattern background

### Color palette (configure in tailwind.config)

Use warm earth tones for a professional, calm feel:

```js
leather: {
  50 - 900;
} // base text and borders
hay: {
  400 - 600;
} // accents, step numbers
field: {
  400 - 600;
} // success, green accents
copper: {
  400 - 600;
} // code highlights
sky: {
  400 - 600;
} // info, links
```

### Component patterns

- **Step cards**: numbered steps with colored top strip,
  icon number badge, content area
- **Code blocks**: dark rounded container with dot header
  (red/yellow/green dots like terminal), monospace content
- **Info banner**: dismissible (localStorage), subtle bg,
  explains this is a template page

## Content structure — three levels

The howto has three sections matching user skill levels.
ALL three are included on the same page, with clear visual
separation and anchor links in the nav.

### Level 1: Getting Started (beginner)

Target: someone who just wants to use the agent as a tool.

**Steps:**

1. **Talk to the bot** — How to start a conversation.
   On Telegram: find the bot by username, send a message.
   On Discord: add bot to server, mention in a channel.
   On WhatsApp: the instance links a phone number as a device
   (like WhatsApp Web). Join a group the bot is in, or message
   the linked number directly. The bot only responds in
   registered groups — private chats are ignored.
   On Email: send email to the configured address.
   Show the actual channel info from env vars.

2. **What it can do** — Conversational AI that can:
   - Research topics deeply (web search, multi-pass analysis)
   - Shop and compare products with detailed reviews
   - Explain concepts at any level of detail
   - Search and summarize information
   - Read files, images, PDFs you send it

3. **Using the web interface** — Show how to access the web
   at `https://$WEB_HOST/`. Explain:
   - Research hubs appear as pages on the site
   - The agent can build pages you can share with others
   - Bookmark useful pages it creates

4. **Email use** — If email is configured:
   - Send an email to the agent's address
   - It replies in-thread, preserving conversation
   - Attach files for analysis
   - Good for longer, async tasks

5. **Tips** — Be specific. Ask follow-up questions. The agent
   remembers your conversation. Say "research X thoroughly" for
   deep dives.

### Level 2: Building Web Apps (intermediate)

Target: someone who wants the agent to build interactive things.

**Steps:**

1. **Ask for a web app** — Example prompts:
   - "build me a todo app"
   - "create a dashboard showing crypto prices"
   - "make an interactive calculator for mortgage payments"
   - "build a comparison table for laptops under $1000"

2. **How it works** — The agent writes HTML/CSS/JS and deploys
   to a live URL. Apps update instantly. No build step needed.
   Explain the vite dev server + MPA architecture simply.

3. **Interactive dashboards** — The agent can build data
   dashboards that fetch and display live data. Examples:
   - API-powered dashboards (weather, stocks, crypto)
   - Data visualization with charts
   - Forms that process and display results

4. **Iterating** — Ask the agent to modify existing apps.
   "Change the color scheme", "Add a chart", "Make it mobile-
   friendly". It reads the existing code and updates it.

5. **Sharing** — Every app gets a permanent URL at
   `https://$WEB_HOST/<app-name>/`. Share with anyone.

### Level 3: Groups & Routing (advanced)

Target: power users who want multi-agent setups.

**Steps:**

1. **Groups** — A single instance can host multiple groups.
   Each group is a separate agent with its own memory, skills,
   and web directory. Groups can be in different chat channels.

2. **Registration** — Register a new chat via CLI:

   ```
   ./kanipi config <instance> group add "<jid>" "<name>" <folder>
   ```

   The agent can also register groups via MCP tools (root only).

3. **Adding WhatsApp** — WhatsApp links a phone number as a
   device (like WhatsApp Web). Setup:

   ```bash
   # Run from inside the gateway container:
   docker exec -w /srv/app/home <container> \
     node /srv/app/dist/whatsapp-auth.js \
     --pairing-code --phone <number>
   # Enter the pairing code on your phone:
   # WhatsApp → Settings → Linked Devices → Link a Device
   # → "Link with phone number instead" → enter code
   # Restart the service to enable WhatsApp
   # Join a group, send /chatid, register the JID
   ```

   WhatsApp only processes registered groups — all other
   messages are received but silently ignored.

4. **Routing** — Messages can be automatically routed between
   groups based on rules. A root agent can delegate to child
   groups for specialized tasks.

5. **Scheduled tasks** — The agent can schedule recurring tasks:
   - Cron-style schedules
   - One-time delayed tasks
   - Periodic checks and reports

6. **MCP tools** — Advanced users can extend the agent with
   custom MCP servers. Register in settings.json and tools
   become available in the next session.

## Customization

Read context before generating:

1. `echo $ASSISTANT_NAME` — bot name
2. `echo $WEB_HOST` — web URL (NEVER guess if empty)
3. `echo $NANOCLAW_IS_ROOT` — root or non-root group
4. `basename /workspace/group` — group folder name
5. Check which channels: env vars for TELEGRAM, DISCORD, EMAIL
6. Check existing web apps: `ls /workspace/web/`

## After deploying

1. Update the hub page (if root: `/workspace/web/index.html`;
   if group: create `/workspace/web/$GROUP_FOLDER/index.html`)
2. Verify: `curl -s http://localhost:$VITE_PORT/$WEB_PREFIX/howto/`
3. Tell the user the full URL

## Attribution

NEVER attribute to Anthropic or Claude in the footer.
Footer MUST read: `powered by <a href="https://krons.fiu.wtf/kanipi">kanipi</a>`

## Language

Write in the same language the user is communicating in.
Default to English if unclear.

## Reference implementation

Use `/workspace/self/template/web/pub/howto/index.html` as base.
Copy to `$WEB_DIR/howto/index.html` and customize:

- Replace "kanipi" with `$ASSISTANT_NAME` in title/hero
- Update subtitle for this specific group
- Remove steps for unconfigured channels
- Add all three levels (beginner/intermediate/advanced)
- Translate to user's language if not English

The template has the design system wired: tailwind config,
color palette, depth/glow classes, code blocks, step cards,
theme toggle, dismissible banner. Do NOT rebuild from scratch.
