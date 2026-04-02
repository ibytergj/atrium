# Bug Fix — Navigation Dead After Disconnect + Stale Avatar Capsule

## 2026-04-01 · Session 18 continuation

---

## Problem

Two issues after clicking Disconnect:

1. **Navigation is dead.** Mouse drag and WASD have no effect. Pointer
   lock can be toggled via `M` but mouse movement does nothing. No
   console errors.

2. **Stale avatar capsule.** The local avatar capsule (and potentially
   peer avatar capsules) remain visible in the viewport after disconnect.

**Root cause:** On disconnect, AvatarController clears its internal
`_localNode` and `_cameraNode` references. NavigationController's
`tick()` checks `avatar.localNode` — it's null, so it returns early.
No node to drive = no navigation.

The avatar capsule remains because the SOM node with its geometry was
never removed from the document that DocumentView is rendering.
AvatarController nulls its reference but doesn't dispose the node or
refresh DocumentView.

---

## Design

On disconnect, the app reloads the world in static mode. This is the
cleanest path — it gives a fresh SOM from the original glTF (no avatar
or peer nodes), DocumentView re-renders the clean scene, and
AvatarController creates a bare navigation node for static browsing.

This aligns with principle #8: "Static first, multiplayer second. The
client renders the world even if the server is unreachable. Multiplayer
is an overlay."

### Implementation

In `apps/client/src/app.js`, in the `disconnected` event handler (or
in the disconnect flow), re-trigger a static world load:

```javascript
client.on('disconnected', () => {
  setConnectionState('disconnected')
  labels.clear()
  firstPerson = false

  // Reload the world in static mode
  const worldUrl = urlInput.value
  if (worldUrl) {
    client.loadWorld(worldUrl)
  }
})
```

`client.loadWorld(url)` loads the glTF, creates a fresh SOM, and fires
`world:loaded`. Since `client.connected` is now `false`, AvatarController's
`world:loaded` handler will take the static path — creating a bare
navigation node with first-person camera. DocumentView will re-render
from the fresh SOM (no avatars).

### What Needs to Be Verified

1. **`loadWorld` works after disconnect.** It should — it's the static
   load path, independent of connection state. But verify there are no
   guards that prevent calling it post-disconnect.

2. **DocumentView refresh.** When `loadWorld` creates a new SOM and
   `world:loaded` fires, the app needs to call `docView.view()` on the
   new SOM's scene to get a fresh Three.js scene group. Check that
   `app.js`'s `world:loaded` handler already does this — it should,
   since it's the same code path as the initial load.

3. **AvatarController state.** The `disconnected` handler clears
   `_localNode` and `_cameraNode`. Then `world:loaded` fires and the
   static path sets them again. Verify the ordering is clean — 
   `disconnected` fires first, then `loadWorld` triggers `world:loaded`.

4. **NavigationController state.** Yaw, pitch, and pressed keys should
   reset on disconnect so the user starts fresh. Either NavigationController
   resets on mode change, or `app.js` handles it. Check if yaw/pitch
   carry over from the connected session — if so, that's acceptable
   (you keep looking the same direction) or a minor polish item.

5. **Mode switcher.** If the user was in ORBIT mode when they disconnect,
   ORBIT should continue working in static mode. The mode doesn't need
   to reset.

6. **`firstPerson` reset.** The Session 17 log noted that `firstPerson`
   is reset to `false` on disconnect. After the static reload, the user
   gets first-person view (from the bare node's zero camera offset).
   This is correct — static mode is always first-person.

---

## Acceptance

| # | Step | Expected |
|---|---|---|
| 1 | Connect to server, navigate around | Normal connected behavior. |
| 2 | Click Disconnect | Button returns to "Connect". Status dot gray. |
| 3 | Avatar capsule | Gone — scene shows only world geometry. |
| 4 | Peer capsules (if any were present) | Gone. |
| 5 | Peer labels | Gone (labels.clear already called). |
| 6 | Drag to look | Camera rotates (first-person static mode). |
| 7 | WASD to move | Camera moves through the world. |
| 8 | HUD | "World:" line shows. "You" and "Peers" hidden. |
| 9 | Reconnect | Works normally — avatar appears, third-person. |
| 10 | Disconnect while in ORBIT mode | Orbit continues working in static mode. |

---

## Scope

- `apps/client/src/app.js` — add `loadWorld` call in disconnect handler
- Possibly minor adjustments if `loadWorld` or `world:loaded` handler
  needs guarding
- No changes to AtriumClient, AvatarController, NavigationController,
  SOM, or protocol
- All automated tests must still pass
