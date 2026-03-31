# Session 15 — Browser UX Buildout

## 2026-03-30 · Design Brief for Claude Code

---

## Context

`apps/client` is Atrium's browser — a single `index.html` + `src/app.js`
that renders glTF worlds, connects to world servers, and supports
third-person avatar navigation. Sessions 13–14 landed AtriumClient sync,
avatar-camera parenting, and third-person navigation.

Session 15 focuses on UX improvements to make the browser feel more like a
real application. Three features, in priority order.

**Reference:** `Project_Atrium_2026-03-30.md` in `docs/` is the full
project handoff. Read it for architecture, conventions, and known issues.

---

## Feature 1 — Drag-to-Look Mode

### Problem

The current navigation uses pointer lock (click viewport to capture mouse,
Escape to release). This is standard for FPS games but unfriendly for a
browser-like experience — the cursor disappears, and users must explicitly
escape to interact with UI.

### Design

Add a drag-to-look input mode as the **default**, with pointer lock
retained as an option.

**Drag-to-look behavior:**

- `mousedown` on the viewport sets a `dragging` flag
- `mousemove` while `dragging` rotates yaw and pitch (same sensitivity
  math as the current `movementX`/`movementY` pointer lock handler)
- `mouseup` clears the `dragging` flag
- Cursor remains visible at all times
- WASD/arrow key movement works identically in both modes — movement is
  always relative to current yaw

**Configuration:**

Add a constant at the top of `app.js`:

```javascript
const USE_POINTER_LOCK = false   // true = FPS-style, false = drag-to-look
```

**Implementation notes:**

- When `USE_POINTER_LOCK = false`:
  - Do NOT call `canvas.requestPointerLock()` on click
  - Listen for `mousedown`, `mousemove`, `mouseup` on the canvas
  - On `mousemove`, use `e.movementX` / `e.movementY` (these work
    without pointer lock in all modern browsers)
  - Guard rotation updates behind the `dragging` flag
- When `USE_POINTER_LOCK = true`:
  - Existing pointer lock path, unchanged
- Both modes feed into the same yaw/pitch variables and the same
  tick-loop camera sync logic

**What NOT to change:**

- The tick loop, SOM-driven camera sync, and `setView` call path are
  untouched
- WASD input handling is untouched
- Third-person camera rig (avatar → camera child node) is untouched

### Acceptance

- Default mode (`USE_POINTER_LOCK = false`): click-drag rotates view,
  release stops rotation, cursor always visible
- Toggle to `true`: existing pointer lock behavior works as before
- WASD movement works in both modes
- Third-person camera rig is unaffected
- Peer avatar rendering is unaffected

---

## Feature 2 — World Metadata HUD

### Problem

There is no on-screen indication of what world is loaded, who you are,
or who else is present. All state is only visible via `console.log` or
`window.atriumClient`.

### Design

**Console logging (always on):**

- On `world:loaded`: log world name, description, author (from
  `extras.atrium` metadata)
- On `peer:join`: log peer display name and updated peer count
- On `peer:leave`: log peer display name and updated peer count

**HUD overlay:**

A minimal, semi-transparent overlay in the viewport showing key state.
Position: **top-left** of the viewport, inside the canvas container.

```
┌──────────────────────────────────┐
│  World: Space                    │
│  You: User-3f2a                  │
│  Peers: 2                        │
└──────────────────────────────────┘
```

**Implementation:**

- A `<div id="hud">` positioned absolutely over the canvas, `pointer-events: none`
- CSS: semi-transparent dark background (`rgba(0,0,0,0.5)`), white text,
  small font (12–14px), monospace, modest padding, rounded corners
- Three lines, each a `<span>` or `<div>` updated by event handlers:
  - `world` line: updated on `world:loaded` — show `name` from
    `extras.atrium` metadata, or the filename if no metadata
  - `you` line: updated on `session:ready` — show `client.displayName`;
    blank or hidden pre-connect
  - `peers` line: updated on `peer:join` / `peer:leave` — show count;
    hidden when not connected
- The HUD should be visible in both static-load and connected states,
  showing only the relevant lines

**What NOT to change:**

- No changes to AtriumClient, SOM, or protocol
- No changes to navigation or rendering

### Acceptance

- Console shows world metadata on load, peer join/leave with counts
- HUD overlay is visible in viewport with world name, display name, peer count
- HUD updates live as peers join/leave
- HUD is unobtrusive — does not interfere with navigation or pointer events

---

## Feature 3 — Connection State UI

### Problem

The Connect button has two states (Connect / Disconnect) but there is no
visual feedback during connection, and no indication of connection state
in the viewport.

### Design

**Button state changes:**

| State | Button label | Button enabled |
|---|---|---|
| Disconnected | Connect | Yes |
| Connecting | Connecting... | No (disabled) |
| Connected | Disconnect | Yes |
| Error | Connect | Yes |

**Status indicator:**

A small colored dot (CSS `border-radius: 50%`) next to the Connect button
or in the URL bar area:

| State | Dot color |
|---|---|
| Disconnected | Gray (`#888`) |
| Connecting | Yellow / amber (`#f0ad4e`) |
| Connected | Green (`#5cb85c`) |
| Error | Red (`#d9534f`) |

**Implementation:**

- Track connection state via AtriumClient events:
  - Button click → set state to `connecting`, disable button
  - `connected` event → set state to `connected`
  - `disconnected` event → set state to `disconnected`
  - `error` event → set state to `disconnected` (re-enable Connect)
- A `<span id="status-dot">` styled as a small circle, placed inline
  next to the button
- A helper function `setConnectionState(state)` that updates both the
  button and the dot

**Integration with HUD:**

The "You" and "Peers" lines in the HUD (Feature 2) naturally reflect
connection state — they appear on connect and hide on disconnect. No
extra work needed if the HUD event handlers are correct.

**What NOT to change:**

- No changes to AtriumClient, SOM, or protocol
- The URL bar behavior is unchanged
- No changes to navigation or rendering

### Acceptance

- Button shows "Connecting..." and is disabled during connection
- Button shows "Disconnect" when connected
- Colored dot reflects current state (gray/yellow/green/red)
- Error state returns to disconnected UI
- HUD peer/name lines appear/disappear appropriately with connection state

---

## Scope Boundary

**In scope for Session 15:**

1. Drag-to-look mode (with pointer lock toggle)
2. World metadata HUD (console + overlay)
3. Connection state UI (button + status dot)

**Explicitly deferred (do NOT start these):**

- Reconcile avatar rendering paths (Session 16 candidate)
- View message assembly refactor (Session 16 candidate)
- Delta-based view sends (Session 16 candidate)
- SOM Inspector tool (backlog)
- Any protocol or AtriumClient changes

---

## Files Modified

All changes are in `apps/client/`:

- `src/app.js` — drag-to-look input handling, HUD updates, connection
  state management, console logging
- `index.html` — HUD markup, status dot markup, any new CSS

No other packages are modified. No new dependencies. No test changes
(these are UI-only features in the app shell).

---

## Design Principles Check

| Principle | Respected |
|---|---|
| Design before code | ✅ This brief |
| No throwaway code | ✅ All features are permanent UX |
| Incremental correctness | ✅ Each feature is independent and testable |
| AtriumClient is geometry-agnostic | ✅ No client package changes |
| SOM is source of truth | ✅ HUD reads from SOM/client events, doesn't create state |
| Static first, multiplayer second | ✅ HUD works in static mode; connection UI is additive |
