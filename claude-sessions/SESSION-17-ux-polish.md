# Session 17 — UX Polish: Navigation Toggle, Camera Perspective, Peer Labels

## 2026-04-01 · Design Brief for Claude Code

---

## Context

`apps/client` is a functional browser with drag-to-look navigation,
third-person camera, HUD overlay, and connection state UI (Sessions 15–16).
Session 16 introduced AvatarController and NavigationController, eliminating
the manual Three.js mesh path.

Session 17 adds four UX features that make the browser feel more complete:
runtime navigation mode switching, first/third-person camera toggle, HUD
hint text, and floating peer name labels.

**Reference:** `Project_Atrium_2026-03-30.md` in `docs/` is the full
project handoff. Read it for architecture, conventions, and known issues.

---

## Feature 1 — Navigation Mode Toggle

### Problem

Switching between drag-to-look and pointer lock requires changing the
`USE_POINTER_LOCK` constant in `app.js` and reloading. Users should be
able to toggle at runtime.

### Design

**Hot key:** `M` toggles between drag-to-look and pointer lock.

**Implementation:**

Replace the `USE_POINTER_LOCK` constant with a mutable variable:

```javascript
let usePointerLock = false   // default: drag-to-look
```

On `M` keydown (in `app.js`, not NavigationController — this is a UI
concern):

```javascript
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    usePointerLock = !usePointerLock
    if (!usePointerLock && document.pointerLockElement) {
      document.exitPointerLock()
    }
    updateHintText()
    return
  }
  nav.onKeyDown(e.code)
})
```

When toggling FROM pointer lock TO drag-to-look, exit pointer lock if
currently engaged. When toggling FROM drag-to-look TO pointer lock, do
not immediately engage pointer lock — let the user click to engage (same
as the current pointer lock path).

**Mouse event handling must support both modes simultaneously:**

Both input paths should be wired at startup. The active path is selected
by checking `usePointerLock`:

```javascript
// Pointer lock path
document.addEventListener('pointerlockchange', () => {
  pointerLocked = !!document.pointerLockElement
})
viewportEl.addEventListener('click', () => {
  if (usePointerLock) viewportEl.requestPointerLock()
})

// Drag-to-look path
viewportEl.addEventListener('mousedown', () => {
  if (!usePointerLock) dragging = true
})
document.addEventListener('mouseup', () => { dragging = false })

// Shared mousemove — one handler, mode-gated
document.addEventListener('mousemove', (e) => {
  if (usePointerLock && pointerLocked) {
    nav.onMouseMove(e.movementX, e.movementY)
  } else if (!usePointerLock && dragging) {
    nav.onMouseMove(e.movementX, e.movementY)
  }
})
```

**NavigationController is not modified.** It receives `onMouseMove` calls
regardless of which input mode produced them.

---

## Feature 2 — Camera Perspective Toggle

### Problem

The camera is locked to third-person view when connected. Users should
be able to switch to first-person for immersive exploration.

### Design

**Hot key:** `V` toggles between first-person and third-person.

**State:**

```javascript
let firstPerson = false   // default: third-person when connected
```

**On `V` keydown (in `app.js`):**

```javascript
if (e.code === 'KeyV' && avatar.localNode) {
  firstPerson = !firstPerson
  if (firstPerson) {
    avatar.cameraNode.translation = [0, 1.6, 0]   // eye height
    avatar.localNode.visible = false                // hide capsule
  } else {
    avatar.cameraNode.translation = [0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z]
    avatar.localNode.visible = true                 // show capsule
  }
  updateHintText()
}
```

**Camera sync in tick loop:**

The camera sync already branches on whether the camera child offset has
a Z component (from the Session 16 static mode fix):

```javascript
const camOffset = cameraNode.translation ?? [0, 0, 0]
const hasOffset = Math.abs(camOffset[2]) > 0.001

if (hasOffset) {
  // Third-person: lookAt path (existing)
} else {
  // First-person: direct quaternion path (existing)
}
```

Setting `cameraNode.translation = [0, 1.6, 0]` has Y but no Z, so
`hasOffset` is false → first-person path. Setting it back to
`[0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z]` has Z → third-person path.
**No changes to the camera sync logic needed** — it already handles both.

**Verify the `hasOffset` check:** The existing check tests both Y and Z:
```javascript
const hasOffset = Math.abs(camOffset[1]) > 0.001 || Math.abs(camOffset[2]) > 0.001
```
This needs to change — first-person at eye height has `camOffset[1] = 1.6`,
which would incorrectly trigger the third-person path. The check should
test **only Z**:
```javascript
const hasOffset = Math.abs(camOffset[2]) > 0.001
```
Z offset means "behind the avatar" = third-person. No Z offset (even with
Y for eye height) = first-person.

**Avatar visibility:**

`SOMNode` has a `visible` property. Setting `avatar.localNode.visible = false`
should hide the capsule mesh via DocumentView propagation. Verify this
works — if DocumentView does not propagate visibility, fall back to
finding the Three.js mesh in the scene and setting `.visible` directly.

**Static mode:** The `V` key should be ignored when there is no avatar
geometry (static mode already uses first-person). Guard with
`if (avatar.localNode)` and optionally check if connected.

---

## Feature 3 — HUD Hint Text

### Problem

The lower-left hint text is static ("Drag to look · WASD to move"). It
should reflect the current navigation mode and camera perspective, and
show the hot keys for switching.

### Design

A `<div id="hud-hint">` at the bottom-left of the viewport (where the
current hint text is), updated dynamically.

**Content format:**

```
[current mode info] · WASD to move · M: toggle mouse mode · V: toggle camera
```

Examples:

```
Drag to look · WASD to move · [M] mouse lock · [V] first person
```

```
Click to look (locked) · WASD to move · [M] drag mode · [V] third person
```

The hint shows what the hot key will switch TO, not the current state —
this is more actionable ("press M to get drag mode" vs "you are currently
in pointer lock mode").

**Implementation:**

An `updateHintText()` function called whenever `usePointerLock` or
`firstPerson` changes:

```javascript
function updateHintText() {
  const mouseMode = usePointerLock
    ? 'Click to look · WASD to move'
    : 'Drag to look · WASD to move'
  const mouseToggle = usePointerLock
    ? '[M] drag mode'
    : '[M] mouse lock'
  const cameraToggle = firstPerson
    ? '[V] third person'
    : '[V] first person'
  hudHintEl.textContent = `${mouseMode} · ${mouseToggle} · ${cameraToggle}`
}
```

**Styling:** Same as the existing hint text — small font, semi-transparent,
bottom-left, `pointer-events: none`.

**Static mode:** Show only `Drag to look · WASD to move · [M] mouse lock`
(no camera toggle since there's no avatar).

---

## Feature 4 — Peer Name Labels

### Problem

Peer avatars are colored capsules with no identification. Users cannot
tell who is who without checking the console.

### Design

Floating CSS labels above each peer's capsule, showing their display name.

**New file:** `apps/client/src/LabelOverlay.js`

This is an app-layer helper — it depends on Three.js (for projection) and
the DOM (for label elements). It does NOT live in `packages/client`.

### LabelOverlay API

```javascript
import { LabelOverlay } from './LabelOverlay.js'

const labels = new LabelOverlay(containerEl, camera)

labels.addLabel(displayName, somNode)
labels.removeLabel(displayName)
labels.update()    // call each frame
labels.clear()     // remove all labels (on disconnect)
```

### Constructor

```javascript
class LabelOverlay {
  constructor(container, camera) {
    this._container = container   // the viewport div
    this._camera = camera         // the Three.js camera
    this._labels = new Map()      // displayName → { div, somNode }
  }
}
```

### `addLabel(displayName, somNode)`

- Create a `<div>` with the display name as text content
- Style: `position: absolute`, `pointer-events: none`, `transform: translate(-50%, -100%)` (centered horizontally, anchored at bottom so it floats above the capsule), white text, small font (12px), monospace, semi-transparent dark background pill (`rgba(0,0,0,0.6)`, `border-radius: 8px`, `padding: 2px 8px`)
- Append to `this._container`
- Store in `this._labels` Map

### `removeLabel(displayName)`

- Remove the div from the DOM
- Delete from the Map

### `update()`

Called each frame in the tick loop. For each label:

1. Read the peer's world position from `somNode.translation`
2. Add a Y offset for capsule height — the label should float above the
   capsule top. Use a constant like `LABEL_HEIGHT_OFFSET = 2.2` (capsule
   is ~2m tall, label slightly above)
3. Project to screen coordinates:
   ```javascript
   const pos = new THREE.Vector3(worldX, worldY + LABEL_HEIGHT_OFFSET, worldZ)
   pos.project(this._camera)
   ```
4. Convert from NDC (-1 to 1) to pixel coordinates:
   ```javascript
   const x = ( pos.x * 0.5 + 0.5) * containerWidth
   const y = (-pos.y * 0.5 + 0.5) * containerHeight
   ```
5. Position the div: `div.style.left = x + 'px'`; `div.style.top = y + 'px'`
6. **Hide if behind camera:** if `pos.z > 1`, set `div.style.display = 'none'`;
   otherwise `'block'`
7. **Optional — fade with distance:** compute distance from camera to peer,
   reduce opacity for distant peers. Not required for Session 17 but nice
   to have.

### `clear()`

Remove all label divs from the DOM, clear the Map. Called on disconnect.

### Wiring in `app.js`

```javascript
import { LabelOverlay } from './LabelOverlay.js'

const labels = new LabelOverlay(viewportEl, camera)

avatar.on('avatar:peer-added', ({ displayName, node }) => {
  labels.addLabel(displayName, node)
  updateHud()
})

avatar.on('avatar:peer-removed', ({ displayName }) => {
  labels.removeLabel(displayName)
  updateHud()
})

client.on('disconnected', () => {
  labels.clear()
})
```

In the tick loop, after `nav.tick(dt)` and camera sync:

```javascript
labels.update()
renderer.render(threeScene, camera)
```

`labels.update()` must be called AFTER the camera sync so that projections
use the current frame's camera position/orientation.

### Local avatar label

**Not shown.** The user knows who they are from the HUD. Peer labels only.

---

## Files Modified / Created

| File | Change |
|---|---|
| `apps/client/src/app.js` | Nav toggle, camera toggle, hint text, label wiring, `hasOffset` fix |
| `apps/client/src/LabelOverlay.js` | New file — peer name label overlay |
| `apps/client/index.html` | HUD hint markup if not already present |

**No changes to:**
- `packages/client/src/AtriumClient.js`
- `packages/client/src/AvatarController.js`
- `packages/client/src/NavigationController.js`
- Any protocol or SOM code

---

## Testing Strategy

All four features are UI-only in the app shell. No automated tests added
(no package changes). Manual testing:

### Feature 1 — Nav Mode Toggle

| # | Step | Expected |
|---|---|---|
| 1 | Load and connect. Default is drag-to-look. | Drag rotates, cursor visible. |
| 2 | Press `M` | Hint text updates to show pointer lock mode. |
| 3 | Click viewport | Pointer lock engages, cursor disappears. |
| 4 | Move mouse | Camera rotates (pointer lock style). |
| 5 | Press `M` again | Pointer lock exits. Drag-to-look restored. Hint updates. |
| 6 | WASD works in both modes | Movement is unaffected by toggle. |

### Feature 2 — Camera Perspective Toggle

| # | Step | Expected |
|---|---|---|
| 1 | Connected in third-person (default) | Avatar capsule visible ahead of camera. |
| 2 | Press `V` | Camera snaps to first-person (eye height). Avatar capsule disappears. |
| 3 | WASD and drag-to-look | First-person navigation works. |
| 4 | Press `V` again | Camera returns to third-person. Avatar capsule reappears. |
| 5 | Hint text updates on each toggle | Shows what `V` will switch to next. |
| 6 | Static mode (no connection) | `V` has no effect (already first-person, no avatar). |

### Feature 3 — HUD Hint Text

| # | Step | Expected |
|---|---|---|
| 1 | Default state | "Drag to look · WASD to move · [M] mouse lock · [V] first person" |
| 2 | Press `M` | Mouse mode portion updates. |
| 3 | Press `V` | Camera portion updates. |
| 4 | Static mode | No camera toggle shown. |

### Feature 4 — Peer Name Labels

| # | Step | Expected |
|---|---|---|
| 1 | Tab A connected, Tab B connects | Tab A sees a label above Tab B's capsule showing "User-XXXX". |
| 2 | Tab B moves | Label follows the capsule smoothly. |
| 3 | Tab B disconnects | Label disappears. |
| 4 | Tab C connects (late joiner) | Tab C sees labels for all existing peers. |
| 5 | Rotate camera so peer is behind you | Label hidden (behind camera check). |
| 6 | Label does not interfere with mouse events | `pointer-events: none` — drag-to-look works over labels. |
| 7 | Tab A disconnects and reconnects | Labels cleared on disconnect, repopulated on reconnect. |

---

## Scope Boundary

**In scope:**
1. Navigation mode toggle (`M` key)
2. Camera perspective toggle (`V` key)
3. HUD hint text (dynamic, reflects current modes)
4. Peer name labels (LabelOverlay class)

**Explicitly deferred:**
- Local avatar name label
- Label distance-based opacity fade
- FLY / ORBIT mode implementation
- SOM Inspector tool
- User Object Extensions
- Any package-level changes

---

## Design Principles Check

| Principle | Respected |
|---|---|
| Design before code | ✅ This brief |
| No throwaway code | ✅ All features are permanent UX |
| Incremental correctness | ✅ Each feature is independent |
| AtriumClient is geometry-agnostic | ✅ No client package changes |
| SOM is source of truth | ✅ Labels read position from SOM nodes |
| Static first, multiplayer second | ✅ Toggle features degrade gracefully in static mode |
