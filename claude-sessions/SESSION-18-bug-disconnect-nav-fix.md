# Bug Fix Log — Navigation Dead After Disconnect + Stale Avatar Capsule

## 2026-04-01 · Session 18 continuation

---

## Root Cause

On disconnect, `AvatarController` nulls `_localNode` and `_cameraNode`.
`NavigationController.tick()` guards on `!localNode` and returns early —
no node to drive, so all input is silently dropped. The avatar and peer
capsule geometry remains in the SOM document that `DocumentView` is still
rendering.

---

## Fix

One addition to the `disconnected` handler in `apps/client/src/app.js`:

```javascript
const url = worldUrlInput.value.trim()
if (url) client.loadWorld(url)
```

Called after `labels.clear()`, `setConnectionState('disconnected')`,
`firstPerson = false`, and `updateHintText()` — state is cleaned up
before the reload fires.

`client.loadWorld(url)` loads the original glTF, creates a fresh SOM
(no avatar or peer nodes), and emits `world:loaded`. Because
`client.connected` is now `false`, `AvatarController`'s `world:loaded`
handler takes the static path — creating a bare navigation node with
first-person camera offset. `NavigationController.tick()` gets a valid
`localNode` again and input resumes. `initDocumentView` re-renders from
the clean SOM, removing all capsule geometry.

---

## Files Changed

| File | Change |
|---|---|
| `apps/client/src/app.js` | Added `client.loadWorld(url)` call in `disconnected` handler |

No changes to `AtriumClient`, `AvatarController`, `NavigationController`,
SOM, or protocol. All automated tests continue to pass.

---

## Acceptance Verified (manual)

| # | Step | Expected |
|---|---|---|
| 1 | Connect, navigate | Normal connected behavior |
| 2 | Disconnect | Button → "Connect", status dot gray |
| 3 | Local avatar capsule | Gone |
| 4 | Peer capsules | Gone |
| 5 | Peer labels | Gone (`labels.clear()` runs before reload) |
| 6 | Drag to look | Works (static first-person) |
| 7 | WASD | Works |
| 8 | HUD | "World:" shown, "You"/"Peers" hidden |
| 9 | Reconnect | Avatar reappears, third-person |
| 10 | Disconnect while in ORBIT | Orbit continues in static mode |
