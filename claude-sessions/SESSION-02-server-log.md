# Atrium — Session 2 Log
## SOP Server: Session Lifecycle + Protocol Inspector

**Date:** 2026-03-05
**Status:** Complete — all tests passing

---

## What Was Built

### `packages/server/src/tick.js`
- Exports `createTickLoop(session, intervalMs)`
- Sets an interval that sends `{ type, seq, serverTime }` tick messages to the session's WebSocket
- Uses a module-level `globalSeq` counter incremented on each tick
- Returns `{ stop() }` to cancel the interval

### `packages/server/src/session.js`
- Exports `createSessionServer({ port, maxUsers })`
- Creates a `WebSocketServer` on the given port (default 3000)
- Tracks sessions in a `Map` keyed by UUID
- **hello handler:** validates, rejects WORLD_FULL, negotiates tick interval (min 50ms), registers session, sends server hello, starts tick loop
- **ping handler:** responds immediately with pong (clientTime + serverTime)
- **Pre-handshake guard:** any non-hello message before hello → AUTH_FAILED error
- **Keepalive:** pings all sessions every 30s; terminates sessions that don't respond
- **Disconnect:** stops tick loop, removes session from Map on ws close
- **`sendError(ws, seq, code, message)`** helper for all error responses
- Returns `{ wss, sessions }`

### `packages/server/src/index.js`
- Entry point — calls `createSessionServer({ port: 3000 })` and logs the listening URL

### `packages/server/test/session.test.js`
Seven tests using `node --test`, all passing (345ms total):
1. **completes hello handshake** — verifies reply shape (type, id, seq, serverTime)
2. **server hello contains negotiated tick interval** — request 2000ms, verify ≥ 50
3. **rejects message before hello with AUTH_FAILED** — send `send` before hello
4. **responds to ping with pong** — verifies clientTime echoed, serverTime present
5. **sends tick messages after handshake** — 100ms interval, wait for tick, verify shape
6. **rejects connection when world full** — maxUsers: 1, second client gets WORLD_FULL
7. **handles client disconnect cleanly** — verifies session removed from Map by ID

### `tools/protocol-inspector/index.html`
Self-contained single-file vanilla-JS inspector:
- Two-column layout: Send panel + Message Log
- Type dropdown with all 11 SOP message types; selecting pre-fills a valid JSON template
- JSON editor with inline parse validation
- Log entries: timestamp, direction (→/←), type, seq; click to expand full JSON
- Clear and Export JSON (downloads `.json` file with full log)
- Scenario runner: Full handshake, Clock sync, Ping flood
- Connection status indicator (dot + label: Disconnected / Connecting / Connected / Error)

---

## Key Implementation Notes

- `node --test` runs top-level tests **concurrently** within a file — the disconnect test uses session ID lookup (`sessions.has(id)`) rather than Map size comparisons to avoid race conditions with other tests' sessions
- `maxUsers: 20` on the test server prevents spurious WORLD_FULL rejections during concurrent test execution
- The keepalive `setInterval` is cleared in `wss.on('close', ...)` so the server shuts down cleanly after tests

---

## Test Results

```
# tests 7
# pass  7
# fail  0
# duration_ms 345
```
