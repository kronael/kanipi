Run Claude agents across telegram, whatsapp, and discord from one gateway. Agents deploy web apps that auto-serve via vite.

github.com/kronael/kanipi

---

Two ways to build agent infrastructure. Concrete block: works out of the box, breaks when you need something different. Bag of legos: infinite flexibility, you're the architect and the contractor and the plumber.

---

kanipi is legos assembled into a product. Every piece does one unix thing — SQLite for state, Docker for isolation, Vite for serving, bash for process management, signals for IPC. But you don't have to know that. Create instance, drop tokens, start.

---

Don't need discord? Don't set the token. Don't need web serving? Don't set the port. Take a piece out, the rest still works. Each lego is independent. Each lego is optional. But the default assembly is complete and production-ready.

---

This isn't theory. We ran takopipi for months — Claude agents building and deploying web apps daily. Real users, real failures, real fixes. kanipi is takopipi's battle-tested patterns on nanoclaw's clear skeleton. Lindy code on a readable foundation.

---

v1: multi-channel with unified interface. Env-based toggling. Vite MPA alongside the gateway. Per-conversation containers with /web mounted. Signal-triggered IPC. OAuth passthrough. Ansible deployment. One command to seed, one to run.

---

Next: pushing the minimalist lego bricks to their logical conclusion.

back to kroning.
