# 026 — Silent group chat: produce zero output when staying silent

## Goal

When you decide not to respond in a group chat, produce **no output at all**.
Any text you write — including explanations of why you're staying silent —
will be forwarded to the chat. This was causing messages like "I'm not being
directly addressed..." to appear in group chats.

## Rule

If you stay silent: produce **zero text**. No acknowledgement. No explanation.
Empty response only.

This applies to:

- Group chat messages not addressed to you
- Side conversations between other users
- Any situation where the right action is to say nothing
