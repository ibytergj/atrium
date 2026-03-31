# Bug Fix — Connect Button Stuck on "Connecting..."

## 2026-03-31 · Session 15 continuation

---

## Problem

After clicking Connect with a running server, the button text changes to
"Connecting..." but never transitions to "Disconnect". The connection
itself succeeds — the world loads, the HUD shows the world name, the
avatar appears, peers are visible. But `setConnectionState('connected')`
is never called, so the button stays disabled with "Connecting..." text
and the status dot stays amber.

This happens in all tabs/clients.

---

## Where to Look

File: `apps/client/src/app.js`

1. Find the `setConnectionState` function. Confirm it handles the
   `'connected'` state correctly (sets button text to "Disconnect",
   enables the button, sets dot class to `connected`).

2. Find the AtriumClient event listeners. There should be a listener
   for the `'connected'` event:

   ```javascript
   client.on('connected', () => {
     setConnectionState('connected')
   })
   ```

3. Check for common mistakes:
   - Wrong event name (`'connect'` instead of `'connected'`)
   - Missing listener entirely
   - Listener exists but calls the wrong function or passes wrong arg
   - Listener wired up inside a conditional that doesn't execute

4. Also verify the `'disconnected'` and `'error'` event listeners
   exist and call `setConnectionState` with the right state strings.

---

## AtriumClient Event Reference

From `packages/client/src/AtriumClient.js`, the relevant events are:

```javascript
client.on('connected', () => {})       // WebSocket opened
client.on('disconnected', () => {})    // WebSocket closed
client.on('error', (err) => {})        // WebSocket or protocol error
client.on('session:ready', (...) => {})  // hello exchange complete
client.on('world:loaded', (...) => {})   // SOM initialized
```

The button state should transition on `connected` / `disconnected` /
`error` — NOT on `session:ready` or `world:loaded`.

---

## Fix

Wire up the `connected` event to call `setConnectionState('connected')`.
If the listener exists but is broken, fix it. If it's missing, add it.

Verify all three state transitions work:

- `connecting` → `connected` (on successful connection)
- `connected` → `disconnected` (on disconnect button or server drop)
- `connecting` → `disconnected` or `error` (on connection failure)

---

## Verification

1. Start the world server:
   ```bash
   cd packages/server
   WORLD_PATH=../../tests/fixtures/space.gltf node src/index.js
   ```

2. Open `apps/client/index.html` in the browser.

3. Click Connect. Confirm:
   - Button shows "Connecting..." briefly
   - Button changes to "Disconnect"
   - Status dot turns green

4. Click Disconnect. Confirm:
   - Button returns to "Connect"
   - Status dot turns gray

5. Stop the server, click Connect. Confirm:
   - Button shows "Connecting..." briefly
   - Button returns to "Connect" after failure
   - Status dot turns red or gray

---

## Scope

- **Only** fix the event wiring in `apps/client/src/app.js`
- Do NOT change AtriumClient, SOM, protocol, or any package code
- Do NOT change any other Session 15 features (drag-to-look, HUD)
- This is a wiring bug, not an architecture issue
