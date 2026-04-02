# Session 18 — ORBIT Navigation Mode

## 2026-04-01 · Design Brief for Claude Code

---

## Context

NavigationController currently implements WALK mode fully, with FLY and
ORBIT accepted by `setMode()` but falling back to WALK behavior. The
upcoming SOM Inspector tool needs ORBIT as its default navigation mode.
This session implements ORBIT in NavigationController and adds a mode
switcher UI to `apps/client`.

**Reference:** `Project_Atrium_2026-03-30.md` in `docs/` is the full
project handoff. Read it for architecture, conventions, and known issues.

---

## ORBIT Mode Behavior

ORBIT mode positions the camera on a sphere around a focus point. The
user rotates the view by dragging, and zooms by scrolling. There is no
avatar movement — ORBIT is a viewing mode, not a movement mode.

### Internal State

NavigationController gains three new properties when in ORBIT mode:

```javascript
this._orbitTarget = [0, 0, 0]    // focus point (world space)
this._orbitRadius = 10.0          // distance from focus point
this._orbitAzimuth = 0            // horizontal angle (radians, around Y)
this._orbitElevation = 0.3        // vertical angle (radians, from horizon)
```

Sensible defaults — `orbitRadius = 10` gives a wide view, `orbitElevation = 0.3`
(~17°) is slightly above the horizon.

### Input Mapping in ORBIT Mode

**`onMouseMove(dx, dy)` (only called when primary mouse button is down):**

```javascript
if (this._mode === 'ORBIT') {
  this._orbitAzimuth  -= dx * this._mouseSensitivity
  this._orbitElevation += dy * this._mouseSensitivity
  // Clamp elevation to prevent flipping
  this._orbitElevation = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this._orbitElevation))
}
```

Note: azimuth uses the same sign convention as yaw (negative dx = rotate
right), and elevation is inverted from pitch (positive dy = tilt up, looking
down at the scene) to feel natural for orbit inspection.

**`onWheel(deltaY)` — NEW input method:**

```javascript
onWheel(deltaY) {
  if (this._mode !== 'ORBIT') return
  this._orbitRadius *= deltaY > 0 ? 1.1 : 0.9
  this._orbitRadius = Math.max(0.5, Math.min(100, this._orbitRadius))
}
```

Multiplicative zoom feels more natural than additive — each scroll step
is proportional. Clamped to prevent going inside the focus point or
zooming absurdly far out.

**`onKeyDown` / `onKeyUp`:**

WASD keys are **ignored** in ORBIT mode. `tick()` produces no movement.
Keys are still tracked in the Set (so switching back to WALK mid-press
doesn't produce stuck keys), but `tick()` skips the movement computation.

### `tick(dt)` in ORBIT Mode

Instead of computing WASD movement and applying yaw/pitch to the avatar
node, ORBIT mode computes the camera position from spherical coordinates:

```javascript
if (this._mode === 'ORBIT') {
  const az = this._orbitAzimuth
  const el = this._orbitElevation
  const r  = this._orbitRadius
  const t  = this._orbitTarget

  // Spherical to Cartesian (Y-up)
  const x = t[0] + r * Math.cos(el) * Math.sin(az)
  const y = t[1] + r * Math.sin(el)
  const z = t[2] + r * Math.cos(el) * Math.cos(az)

  // Position the avatar/camera node at the computed location
  const node = this._avatar.localNode
  if (!node) return
  node.translation = [x, y, z]

  // No rotation set on the node — app.js handles lookAt
}
```

**Camera sync in app.js:** In ORBIT mode, the app sets the Three.js
camera position from `avatar.localNode.translation` and calls
`camera.lookAt(orbitTarget)`. This is different from WALK mode's camera
sync. See the app.js changes section below.

### `setView` in ORBIT Mode

`avatar.setView()` is still called in ORBIT mode — the camera position
IS the view position (there's no separate avatar body). `look` is the
direction from camera to orbit target. `move` is `[0,0,0]` and
`velocity` is `0` (no movement). This keeps peers informed of where this
client is looking, even in ORBIT mode.

### New Public API

```javascript
nav.onWheel(deltaY)           // new — scroll zoom, ORBIT only

nav.orbitTarget                // [x,y,z] — read/write, focus point
nav.orbitRadius                // number — read/write, zoom distance
```

Exposing these lets the app (or future inspector tool) programmatically
set the orbit focus — e.g., focus on a selected node.

---

## Mode Switching

### NavigationController Changes

`setMode(mode)` already accepts mode strings and validates against
NavigationInfo. Add transition logic:

```javascript
setMode(mode) {
  if (mode === this._mode) return
  // validate against allowed modes...

  if (mode === 'ORBIT') {
    // Initialize orbit state from current camera position
    // so the view doesn't jump on mode switch
    this._initOrbitFromCurrentPosition()
  }

  this._mode = mode
}
```

**`_initOrbitFromCurrentPosition()`:**

When switching from WALK to ORBIT, compute orbit parameters from the
current avatar position so the camera doesn't teleport:

```javascript
_initOrbitFromCurrentPosition() {
  const pos = this._avatar.localNode?.translation ?? [0, 0, 0]
  const target = this._orbitTarget  // keep current target (default [0,0,0])

  const dx = pos[0] - target[0]
  const dy = pos[1] - target[1]
  const dz = pos[2] - target[2]

  this._orbitRadius    = Math.sqrt(dx*dx + dy*dy + dz*dz) || 10
  this._orbitAzimuth   = Math.atan2(dx, dz)
  this._orbitElevation = Math.asin(dy / this._orbitRadius)
}
```

When switching from ORBIT back to WALK, the avatar node is already at
the orbit camera position. This might be high up or at an odd angle.
Acceptable for now — a more polished transition (drop to ground plane)
can come later.

---

## Changes to `apps/client`

### `apps/client/src/app.js`

**Mode switcher UI wiring:**

```javascript
const modeSwitcher = document.getElementById('mode-switcher')
modeSwitcher.addEventListener('change', (e) => {
  nav.setMode(e.target.value)
})
```

**Scroll wheel wiring:**

```javascript
viewportEl.addEventListener('wheel', (e) => {
  e.preventDefault()
  nav.onWheel(e.deltaY)
}, { passive: false })
```

`passive: false` is required to call `preventDefault()`, which prevents
the page from scrolling when the user zooms in the viewport.

**Camera sync — ORBIT branch:**

Add an ORBIT case to the tick loop camera sync:

```javascript
if (nav.mode === 'ORBIT') {
  const pos = avatar.localNode.translation
  camera.position.set(pos[0], pos[1], pos[2])
  const t = nav.orbitTarget
  camera.lookAt(t[0], t[1], t[2])
} else if (hasOffset) {
  // existing third-person path
} else {
  // existing first-person path
}
```

ORBIT camera sync is simple — position from the node, lookAt the target.
No yaw/pitch quaternion math needed.

**`setView` call still happens** via NavigationController → AvatarController.
The delta optimization handles the "standing still in ORBIT" case (only
sends when orbit position changes from drag/zoom).

### `apps/client/index.html`

**Mode switcher in the toolbar:**

Add a `<select>` element in the toolbar, next to the Connect button:

```html
<select id="mode-switcher">
  <option value="WALK">Walk</option>
  <option value="ORBIT">Orbit</option>
</select>
```

Styled to match the existing toolbar aesthetic (same font, height, colors
as the URL input and Connect button).

**Hint text update:**

`updateHintText()` should reflect the current mode:

- WALK: existing hint (`Drag to look · WASD to move · ...`)
- ORBIT: `Drag to orbit · Scroll to zoom`

The WALK-specific hot key hints (`[M]` mouse mode, `[V]` camera perspective)
should be hidden in ORBIT mode — they don't apply to orbit viewing.

---

## NavigationController Unit Tests (New)

Add to `packages/client/tests/navigation-controller.test.js`:

- ORBIT mode: `onMouseMove` updates azimuth and elevation
- ORBIT mode: elevation clamped to prevent flipping
- ORBIT mode: `onWheel` adjusts radius
- ORBIT mode: `onWheel` radius clamped (min 0.5, max 100)
- ORBIT mode: `tick()` positions node at correct spherical coordinates
- ORBIT mode: WASD keys produce no movement
- ORBIT mode: `setView` called with zero move/velocity
- Mode switch WALK → ORBIT: orbit state initialized from current position
- Mode switch WALK → ORBIT: camera does not teleport (radius/azimuth
  derived from position)
- `onWheel` ignored in WALK mode

---

## Scope Boundary

**In scope:**
- ORBIT mode implementation in `packages/client/src/NavigationController.js`
- `onWheel(deltaY)` input method
- Mode switcher `<select>` in `apps/client` toolbar
- ORBIT camera sync branch in `app.js` tick loop
- Scroll wheel event wiring in `app.js`
- Hint text update for ORBIT mode
- Unit tests for ORBIT behavior

**Explicitly deferred:**
- FLY mode implementation (stub remains)
- Orbit focus on selected node (future — SOM Inspector feature)
- Pan (middle-mouse or shift-drag) — future enhancement
- Smooth ORBIT → WALK transition (drop to ground)
- SOM Inspector tool (next session, after ORBIT is available)
- Hot key for mode switching (toolbar dropdown is sufficient for now)

---

## Design Principles Check

| Principle | Respected |
|---|---|
| Design before code | ✅ This brief |
| No throwaway code | ✅ ORBIT mode is permanent NavigationController feature |
| Incremental correctness | ✅ WALK mode unaffected, ORBIT additive |
| AtriumClient is geometry-agnostic | ✅ No AtriumClient changes |
| SOM is source of truth | ✅ Camera position written to SOM node |
| Static first, multiplayer second | ✅ ORBIT works in static mode |
