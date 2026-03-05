# Atrium — Session 4 Log
## Presence: join/leave + Inspector Fixes

**Date:** 2026-03-05
**Tests:** 26 passing (20 pre-existing + 6 new)

---

## What Was Built

### `packages/server/src/presence.js` — new
`createPresence()` factory returning a presence registry backed by a `Map<id, { id, joinedAt }>`. API: `add(id)`, `remove(id)`, `get(id)`, `list()`, `has(id)`.

### `packages/server/src/session.js` — updated
- Imports `createPresence`; instance created alongside `sessions` Map inside `createSessionServer`
- **On hello handshake:** (1) broadcasts `join` with newcomer's server-assigned UUID to all existing sessions; (2) sends `join` for each presence-tracked client to the newcomer (bootstrap); (3) adds newcomer to presence — in this exact order so the newcomer never receives its own join
- **On `ws.on('close')`:** removes from sessions, removes from presence, broadcasts `leave` with the departed client's UUID to remaining sessions — only if the client had completed the hello handshake (guard: `if (removed)`)
- All outbound `join` and `leave` messages are validated with `validate('server', msg)` before sending
- `presence` exposed in return value: `{ wss, sessions, presence }`

### `packages/server/test/presence.test.js` — new (6 tests, port 3007)
Uses a `makeMessageQueue(ws)` helper (persistent `ws.on('message', ...)` registered before handshake) to avoid the race condition where hello + join arrive in the same TCP read and a `ws.once` handler drops the join. Uses `drainServer()` (100 ms delay) after each disconnect to let the server process close events before the next assertion.

Tests:
1. Newcomer receives `join` for each existing client
2. Existing clients receive `join` for newcomer
3. Client receives no `join` for itself
4. Remaining clients receive `leave` on disconnect
5. `leave` is not broadcast for pre-handshake disconnect
6. `presence.list()` count is accurate across connect/disconnect

### `tools/protocol-inspector/index.html` — two fixes
- **Auto-generate client ID:** `const clientId = crypto.randomUUID()` on page load; pre-fills the `hello` template and all scenario sender calls so every tab gets a unique stable identity
- **"Show tick messages" checkbox:** added to log panel header, checked by default; toggling immediately shows/hides all tick entries (existing and future) via `display` style, without affecting storage

---

## Key Design Notes

- `session.id` is always a server-generated `randomUUID()` — the `id` field in the client's `hello` message is ignored by the server
- `join` and `leave` messages carry this server-assigned UUID, consistent with the `id` returned in the server's `hello` reply
- The `makeMessageQueue` helper in presence tests is necessary because the ws library emits WebSocket frame events synchronously within a single read callback; hello and join frames sent back-to-back arrive in the same TCP segment and are both emitted before any microtasks run, making `ws.once` unsuitable for collecting all post-handshake messages

---

## Issues Encountered

- Background test processes from parallel `pnpm test` runs contended on ports 3001–3006; resolved by killing stale processes before the final clean run
- Extensive debugging of a reported leave-message `id` field issue confirmed to be operator error; all diagnostic logs were added and then removed; the leave broadcast is correct in all code paths
