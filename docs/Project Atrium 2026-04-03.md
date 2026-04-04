# Project Atrium
## 2026-04-03 · As of Session 20

---

## What Atrium Is

An open multiplayer 3D world platform built on glTF and WebSockets. The
philosophy: it should feel like a browser, not a platform. Point it at any
`.gltf` file and it renders. Point it at one with a world server behind it
and you're in a shared space with other people.

Built by Tony Parisi (co-creator of VRML, co-author of glTF) following the
principles of his [Seven Rules of the Metaverse](https://medium.com/meta-verses/the-seven-rules-of-the-metaverse-7d4e06fa864c).

**GitHub:** https://github.com/tparisi/atrium

---

## Stack & Conventions

- **Server:** Node.js + glTF-Transform + ws
- **Client:** Three.js + DocumentView (Three.js glTF-Transform bridge)
- **Protocol:** JSON over WebSocket, Ajv-validated
- **Modules:** ES modules throughout — no TypeScript, no build step
- **Tests:** `node --test` — no external test framework
- **Style:** SPDX license header in every `.js` file
- **Package manager:** pnpm workspaces

---

## Repository Structure

```
atrium/
├── packages/
│   ├── protocol/        # SOP message schemas (JSON Schema) + Ajv validator
│   ├── som/             # Scene Object Model — DOM-inspired API over glTF-Transform
│   ├── server/          # WebSocket world server
│   ├── client/          # AtriumClient, AvatarController, NavigationController
│   └── gltf-extension/  # ATRIUM_world glTF extension definition [coming]
├── apps/
│   └── client/          # Browser UI shell — Three.js viewport, navigation, avatars
│       ├── index.html
│       └── src/
│           ├── app.js
│           └── LabelOverlay.js
├── tools/
│   ├── protocol-inspector/index.html   # Single-file interactive protocol debugger
│   └── som-inspector/                  # SOM Inspector (Session 19)
│       ├── index.html
│       └── src/
│           ├── app.js
│           ├── TreeView.js
│           └── PropertySheet.js
├── tests/
│   ├── fixtures/
│   │   ├── space.gltf          # Minimal world fixture
│   │   ├── space.atrium.json   # World manifest
│   │   └── generate-space.js   # Geometry + fixture generator
│   └── client/
│       ├── index.html          # Legacy test client (protocol scratch pad)
│       └── som/                # Manual source copy of packages/som/src/
└── docs/
    └── sessions/        # Design briefs + session logs
```

---

## Test Counts (after Session 20)

| Package | Tests |
|---------|-------|
| `@atrium/protocol` | 43 |
| `@atrium/som` | 67 |
| `@atrium/server` | 32 |
| `@atrium/client` | 54 |
| **Total** | **196** |

All pass. Verify with `pnpm --filter <package> test` after pulling latest.

---

## Architecture — Three Layers

### Content layer
Standard glTF 2.0. A world is a `space.gltf` file with Atrium metadata in
`extras.atrium` at the root. Any glTF viewer can render it without a server.

### Protocol layer — SOP (Scene Object Protocol)
JSON over WebSocket, Ajv-validated. Defined in `@atrium/protocol`.

**Client → Server:** `hello`, `ping`, `send`, `add`, `remove`, `view`
**Server → Client:** `hello`, `pong`, `tick`, `set`, `add`, `remove`, `join`,
`leave`, `view`, `error`, `som-dump`

Key semantics:
- `send`/`set` mutations are echoed to sender as confirmation; the `set`
  broadcast includes `session` field so clients can identify their own echo
- `view` is NOT echoed back; fire-and-forget, last-write-wins
- `add` is broadcast to all clients *except* the sender (`broadcastExcept`)
- `som-dump` is the full current glTF (world state + all avatar nodes) sent
  to a newly connecting client immediately after `hello`
- All message types include `seq`

### Runtime layer — SOM (Scene Object Model)
`@atrium/som` — DOM-inspired API over glTF-Transform.

The SOM is **symmetric** — same package used server-side (world state) and
client-side (AtriumClient + DocumentView sync). `tests/client/som/` is a
manual copy of `packages/som/src/`. **Must be re-synced whenever
`packages/som` changes:**
```bash
cp packages/som/src/*.js tests/client/som/
```

---

## SOM Object Model

The SOM has a full object hierarchy wrapping glTF-Transform properties.
Every SOM type inherits from `SOMObject`.

### SOM Types

| Class | Wraps | Key mutable properties |
|-------|-------|----------------------|
| `SOMDocument` | glTF-Transform `Document` | (container — factories, lookups, resolve helpers) |
| `SOMScene` | glTF-Transform `Scene` | `addChild`, `removeChild` |
| `SOMNode` | glTF-Transform `Node` | `translation`, `rotation`, `scale`, `name`, `extras`, `visible`, `mesh`, `camera` |
| `SOMMesh` | glTF-Transform `Mesh` | `name`, `weights`, `addPrimitive`, `removePrimitive` |
| `SOMPrimitive` | glTF-Transform `Primitive` | `mode`, `material` |
| `SOMMaterial` | glTF-Transform `Material` | `baseColorFactor`, `metallicFactor`, `roughnessFactor`, `emissiveFactor`, `alphaMode`, `alphaCutoff`, `doubleSided` |
| `SOMCamera` | glTF-Transform `Camera` | `type`, `yfov`, `znear`, `zfar`, `aspectRatio`, `xmag`, `ymag` |
| `SOMAnimation` | glTF-Transform `Animation` | `loop`, `timeScale` |
| `SOMTexture` | glTF-Transform `Texture` | (read-only in v0.1) |
| `SOMSkin` | glTF-Transform `Skin` | (read-only in v0.1) |

### SOMObject base class

Provides DOM-style event listener API:

```javascript
addEventListener(type, callback)
removeEventListener(type, callback)
_hasListeners(type)      // internal — zero-cost check before allocating events
_dispatchEvent(event)    // internal
```

### Mutation events

Every setter on every SOM type fires a `mutation` event after updating
the underlying glTF-Transform object. Only allocates a `SOMEvent` if
listeners are present (`_hasListeners` check).

**Property change:**
```javascript
{ target: somObject, property: 'baseColorFactor', value: [1, 0, 0, 1] }
```

**Child list change:**
```javascript
{ target: somObject, childList: { addedNodes: ['nodeName'] } }
{ target: somObject, childList: { removedNodes: ['nodeName'] } }
```

### Wrapper caching, stable identity, and document threading (Session 20)

`SOMDocument` builds the full object graph at construction time, bottom-up.
All wrappers are cached in maps keyed by both glTF-Transform object and
by name.

```javascript
som.getNodeByName('x') === som.getNodeByName('x')   // true — stable identity
```

`getNodeByName` is O(1) via `_nodesByName` Map.

**Document reference threading:** Every wrapper that can return child
objects (`SOMScene`, `SOMNode`, `SOMMesh`, `SOMPrimitive`, `SOMSkin`)
receives the parent `SOMDocument` as a constructor argument and stores
it as `this._document`. All accessors (`.children`, `.parent`, `.mesh`,
`.camera`, `.skin`, `.primitives`, `.material`, `.joints`, `.skeleton`)
resolve through `SOMDocument` resolve helpers to return the cached
wrapper instance.

**Resolve helpers** on `SOMDocument`:
```javascript
_resolveNode(n)      // → cached SOMNode or null
_resolveMesh(m)      // → cached SOMMesh or null
_resolveCamera(c)    // → cached SOMCamera or null
_resolvePrimitive(p) // → cached SOMPrimitive or null
_resolveMaterial(m)  // → cached SOMMaterial or null
_resolveSkin(s)      // → cached SOMSkin or null
```

This guarantees stable identity everywhere — walking the tree via
`.children`, accessing `.mesh`, `.camera`, etc. all return the same
instances that carry AtriumClient mutation listeners. Prior to Session 20,
these accessors created fresh wrappers that silently dropped mutations.

### Key SOM API

```javascript
som.getNodeByName(name)           // O(1) lookup → SOMNode or null
som.nodes                         // all SOMNode instances
som.meshes / .materials / etc.    // same for other types
som.scene                         // the first SOMScene

som.ingestNode(descriptor)        // create node + full mesh geometry from glTF descriptor
som.createNode(descriptor)        // create bare node (no mesh)
som.createMesh / Material / etc.  // individual factories

som.setPath(somNode, 'mesh.primitives[0].material.baseColorFactor', value)
som.getPath(somNode, path)

som.document                      // underlying glTF-Transform Document
```

### SOM ↔ glTF-Transform relationship

The SOM wrappers are thin — every mutation flows through to the real
glTF-Transform document. The glTF-Transform `Document` is always the
ground truth. Serialize the document, you have serialized the world.

---

## Client Package (`packages/client`)

Three classes, zero Three.js or DOM dependency — portable across browser
UI, headless tests, and future bot clients.

### AtriumClient (`AtriumClient.js`)

Connection, protocol, SOM sync layer. Unchanged since Session 16 (one
small addition: stamps `extras.atrium.ephemeral = true` on avatar
descriptors in `connect()`).

**Constructor:** `new AtriumClient({ debug: false })`

**Properties:** `client.som`, `client.connected`, `client.displayName`

**Methods:**
```javascript
client.connect(wsUrl, { avatar: descriptor })
client.disconnect()
client.loadWorld(url)
client.setView({ position, look, move, velocity, up })
```

**Events:**
```javascript
client.on('connected', () => {})
client.on('disconnected', () => {})
client.on('error', (err) => {})
client.on('session:ready', ({ sessionId, displayName }) => {})
client.on('world:loaded', ({ name, description, author }) => {})
client.on('peer:join', ({ sessionId, displayName }) => {})
client.on('peer:leave', ({ sessionId, displayName }) => {})
client.on('peer:view', ({ displayName, position, look, move, velocity, up }) => {})
client.on('som:add', ({ nodeName }) => {})
client.on('som:remove', ({ nodeName }) => {})
client.on('som:set', ({ nodeName, path, value }) => {})
```

**Event timing:** `session:ready` fires before SOM exists. `world:loaded`
fires after SOM is initialized and avatar is ingested. Always use
`world:loaded` for node lookups.

**Scene events for UI consumers:** `som:add`, `som:remove`, and `som:set`
are the primary events for building UI on top of AtriumClient. `som:set`
only fires for remote mutations (loopback already filtered), so UI code
that writes to SOM setters will not trigger its own refresh. The SOM
Inspector (Session 19) uses only these three events to drive its entire
tree view and property sheet — no polling, no per-object listeners.

**Automatic SOM → Server sync:** Mutation listeners on all SOM nodes
forward local changes to the server. Loopback prevention via session ID
check (own echo) and `_applyingRemote` flag (inbound re-broadcast).

**`setView` send policy:** Position heartbeat at `positionInterval` ms,
look/move/up/velocity event-driven on change, overall rate capped at
`maxViewRate` msg/s. Values from `NavigationInfo.updateRate`.

### AvatarController (`AvatarController.js`) — Session 16

Manages all avatar state in the SOM. Never constructs or inspects mesh
geometry — operates on SOM node properties only.

**Constructor:** `new AvatarController(client, { cameraOffsetY, cameraOffsetZ })`

**Lifecycle — local avatar:**
- **Connected:** On `world:loaded`, looks up avatar node by display name,
  creates camera child at `[0, offsetY, offsetZ]`, emits `avatar:local-ready`
- **Static:** On `world:loaded` when not connected, creates bare node
  `__local_camera` at eye height `[0, 1.6, 0]`, camera child at `[0, 0, 0]`
  (first-person), emits `avatar:local-ready`
- **Disconnected:** Clears all references

**Lifecycle — peers:**
- On `peer:join`: looks up peer node, sets random bright color on SOM material
  (`baseColorFactor`), registers in peer map, emits `avatar:peer-added`
- On `world:loaded` (late joiner): scans SOM nodes for `extras.displayName`,
  registers pre-existing peers from `som-dump`
- On `peer:leave`: removes from peer map, emits `avatar:peer-removed`
- Peer node discriminator: `extras.displayName` field (set by AtriumClient,
  absent on world geometry nodes)

**Delta-based view optimization:** `setView()` compares position/look/move/up
(via `vec3Equal` with epsilon) and velocity (scalar epsilon) against last-sent
values. Skips `client.setView()` entirely when nothing changed.

**Events:** `avatar:local-ready`, `avatar:peer-added`, `avatar:peer-removed`

**Properties:** `avatar.localNode`, `avatar.cameraNode`, `avatar.peerCount`,
`avatar.getPeerNode(name)`

### NavigationController (`NavigationController.js`) — Sessions 16, 18

Translates user input into SOM node mutations. No Three.js or DOM dependency.

**Constructor:** `new NavigationController(avatar, { mode, mouseSensitivity })`

**Input methods (called by app from DOM event handlers):**
```javascript
nav.onMouseMove(dx, dy)    // yaw/pitch in WALK, azimuth/elevation in ORBIT
nav.onKeyDown(code)        // tracks pressed keys
nav.onKeyUp(code)
nav.onWheel(deltaY)        // scroll zoom in ORBIT, ignored in WALK
nav.setMode(mode)          // 'WALK', 'FLY', 'ORBIT' — validates against NavigationInfo
nav.tick(dt)               // called each frame
```

**WALK mode (fully implemented):**
- WASD movement on XZ ground plane, speed from NavigationInfo
- Yaw quaternion → `localNode.rotation`, pitch quaternion → `cameraNode.rotation`
- Look vector is yaw-only (no pitch) — pitch is camera-local
- Forward: `[-sin(yaw), 0, -cos(yaw)]`, Right: `[cos(yaw), 0, -sin(yaw)]`

**ORBIT mode (Session 18, fully implemented):**
- Spherical camera around `orbitTarget` focus point
- Drag orbits (azimuth + elevation), scroll zooms (multiplicative ×1.1/0.9)
- Elevation clamped ±π/2.2, radius clamped [0.5, 100]
- WASD disabled — viewing mode only
- `setView` sends camera position with zero move/velocity
- `setMode('ORBIT')` derives orbit params from current position (no teleport)

**FLY mode:** Stub — accepted by `setMode`, falls back to WALK behavior.

**NavigationInfo integration:** On `avatar:local-ready`, reads
`extras.atrium.navigation` from SOM for speed/mode config.

**Properties:** `nav.mode`, `nav.yaw`, `nav.pitch`, `nav.orbitTarget`,
`nav.orbitRadius`

---

## Avatar System

### Core design

**Avatar nodes are regular SOM nodes** — ephemeral per session, full glTF
citizens at runtime (geometry, materials, physics-ready), but session-scoped.
The cursor analogy: like a cursor in Google Docs — present while viewing,
reflected to all users, disappears on close, not persisted to the document.

**Ephemeral marking:** `extras.atrium.ephemeral = true` stamped by AtriumClient
in `connect()`. Consumed by:
- SOM Inspector TreeView — purple circle indicator on ephemeral nodes
- Future canonical serialization — will exclude ephemeral nodes

**Session identity = avatar node identity:** `displayName = User-${sessionId.slice(0,4)}`

**Geometry ownership:** Apps build avatar geometry (capsule, model, etc.) and
pass it as a descriptor to `client.connect()`. AtriumClient stamps the name.
AvatarController and the server never construct or inspect geometry.

**Single rendering path:** DocumentView renders all avatar nodes from the SOM.
No manual Three.js meshes. Peer colors set via SOM material mutation
(`baseColorFactor`), propagated by DocumentView automatically.

### NavigationInfo (in `extras.atrium` at glTF root)

```json
"navigation": {
  "mode": ["WALK", "FLY", "ORBIT", "TELEPORT"],
  "terrainFollowing": true,
  "speed": { "default": 1.4, "min": 0.5, "max": 5.0 },
  "collision": { "enabled": false },
  "updateRate": { "positionInterval": 1000, "maxViewRate": 20 }
}
```

### `view` message fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `seq` | number | Yes | Sequence number |
| `position` | `[x,y,z]` | Yes | Avatar/camera world position |
| `look` | `[x,y,z]` | Yes | Forward unit vector (yaw only, no pitch) |
| `move` | `[x,y,z]` | Yes | Movement direction; `[0,0,0]` if still |
| `velocity` | number | Yes | Speed in m/s; `0` if still |
| `up` | `[x,y,z]` | No | Up vector; omit in WALK |

---

## `apps/client` — Browser UI Shell

Single `index.html` + `src/app.js` + `src/LabelOverlay.js`. ES modules,
import map for Three.js, no build step.

### Import map

```html
<script type="importmap">
{
  "imports": {
    "three":                      "https://esm.sh/three@0.163.0",
    "three/addons/":              "https://esm.sh/three@0.163.0/addons/",
    "@gltf-transform/core":       "https://esm.sh/@gltf-transform/core@4.3.0",
    "@gltf-transform/extensions": "https://esm.sh/@gltf-transform/extensions@4.3.0",
    "@gltf-transform/view":       "https://esm.sh/@gltf-transform/view@4.3.0?deps=three@0.163.0,@gltf-transform/core@4.3.0",
    "@atrium/som":                "../../packages/som/src/index.js",
    "@atrium/protocol":           "../../packages/protocol/src/index.js",
    "@atrium/client":             "../../packages/client/src/AtriumClient.js",
    "@atrium/client/AvatarController":     "../../packages/client/src/AvatarController.js",
    "@atrium/client/NavigationController": "../../packages/client/src/NavigationController.js"
  }
}
```

### UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [URL bar] [Load]  ● [Connect]  [Walk ▾]                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│              Three.js viewport                              │
│                                                             │
│  ┌─ HUD (top-left) ──────────┐                              │
│  │ World: Space               │                              │
│  │ You: User-3f2a             │                              │
│  │ Peers: 2                   │                              │
│  └────────────────────────────┘                              │
│                                                             │
│                          [User-a1b2]  ← peer label          │
│                              🧍       ← peer capsule        │
│                                                             │
│  Drag to look · WASD to move · [M] mouse lock · [V] 1st    │
└─────────────────────────────────────────────────────────────┘
```

### Navigation Modes

**Drag-to-look (default):** Mousedown + drag rotates yaw/pitch. Cursor
visible. `M` key toggles to pointer lock and back.

**Pointer lock:** Click engages lock. Mouse movement rotates. Escape releases.

**Camera perspective:** `V` key toggles first-person / third-person while
connected. First-person: `cameraNode.translation = [0, 1.6, 0]`,
`localNode.visible = false`. Third-person: `[0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z]`,
`visible = true`.

**ORBIT mode:** Select from toolbar dropdown. Drag orbits, scroll zooms.
WASD disabled. `M`/`V` keys inactive in ORBIT.

**Camera sync branches in tick loop:**
```
nav.mode === 'ORBIT'  → position from node, lookAt orbitTarget
camOffset Z > 0.001   → third-person: lookAt with offset (WALK connected)
else                  → first-person: direct quaternion (WALK static or V-toggled)
```

### Peer avatar rendering

All via DocumentView from SOM. AvatarController sets random bright colors
on peer materials (`baseColorFactor`). `LabelOverlay` projects CSS labels
above peer capsules each frame.

### Disconnect behavior

On disconnect, app reloads the world via `client.loadWorld(url)`. This
creates a fresh SOM (no avatars), DocumentView re-renders the clean scene,
AvatarController creates a bare static-mode node. User returns to static
browsing seamlessly.

### Console access

```javascript
window.atriumClient          // the AtriumClient instance
window.atriumClient.som      // the live SOMDocument
```

---

## SOM Inspector (`tools/som-inspector/`) — Session 19

Developer tool for viewing and editing the live SOM. Uses the full client
stack (AtriumClient, AvatarController, NavigationController) with an
inspection-focused UI.

### Architecture

Three AtriumClient events drive all UI updates — no polling, no per-object
mutation listeners:

| Event | Handler |
|---|---|
| `world:loaded` | Init DocumentView, build tree, clear property sheet |
| `som:add` | Rebuild tree |
| `som:remove` | Rebuild tree; clear property sheet if selected node was removed |
| `som:set` | Refresh property sheet if `nodeName` matches selected node |

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  [URL bar: .gltf or .atrium.json]  [Load]  ● [Connect]      │
│                                              [Orbit ▾]       │
├────────────────────┬─────────────────────────────────────────┤
│                    │                                         │
│   Scene graph      │          3D Viewport                    │
│   tree view        │       (ORBIT default)                   │
│   (scrollable)     │                                         │
│                    │                                         │
│  ▸ Scene           │                                         │
│    ▸ Ground        │                                         │
│    ▸ Crate         │                                         │
│    ▸ Light         │                                         │
│    ▸ User-3f2a ◉   │                                         │
│                    │                                         │
├────────────────────┤                                         │
│                    │                                         │
│  Property sheet    │                                         │
│                    │                                         │
│  Node: Crate       │                                         │
│  Translation: ...  │                                         │
│  Material: ...     │                                         │
│                    │                                         │
└────────────────────┴─────────────────────────────────────────┘
```

### Key design decisions

- **ORBIT is the default navigation mode.** Higher mouse sensitivity
  (0.005 vs apps/client's 0.002) for fluid inspection.
- **No visible avatars.** Meshless avatar descriptor (translation only,
  no geometry). Avatars exist in the SOM for networking but aren't
  rendered.
- **No LabelOverlay.** Peer nodes appear in the tree view as ephemeral
  nodes (purple circle indicator) instead.
- **Ephemeral node indicator.** Tree checks `extras.atrium.ephemeral`
  on each node.
- **TreeView** rebuilds fully on structural changes. Selection preserved
  across rebuilds by node name.
- **PropertySheet** uses an updater pattern — `show()` stores closures
  per input that read SOM → write DOM. `refresh()` runs all updaters
  with no DOM reconstruction and no focus loss.
- **Live cross-client editing.** Confirmed working: editing a peer's
  material properties from the inspector propagates to `apps/client`
  in real time via the full SOM → AtriumClient → server → broadcast
  pipeline.

### Property sheet sections

**Node:** translation (vec3), rotation (vec4), scale (vec3), visible (checkbox).

**Material** (when `node.mesh?.primitives?.[0]?.material` is non-null):
base color (color picker + alpha), metallic factor (number + slider),
roughness factor (number + slider), emissive factor (vec3), alpha mode
(dropdown), alpha cutoff (conditional on MASK), double sided (checkbox).

**Camera** (when `node.camera` is non-null): type dropdown, Y-FOV
(number + slider), Z-near, Z-far.

### Deferred inspector features

- Object highlighting / selection in viewport (wireframe overlay)
- Click-to-select in viewport (raycast → SOM node → tree selection)
- Focus orbit on selected node
- Undo/redo
- Full scene editor capabilities (add/delete nodes)

---

## What's Been Built (Status)

| Layer | Status |
|---|---|
| Protocol schemas (`@atrium/protocol`) | ✅ Complete |
| Server session lifecycle | ✅ Complete |
| World state — glTF-Transform + send/set/add/remove | ✅ Complete |
| Presence — join/leave | ✅ Complete |
| SOM — Scene Object Model (`@atrium/som`) | ✅ Complete |
| SOM mutation events + SOMObject base class | ✅ Complete (Session 13) |
| SOM wrapper caching + stable identity | ✅ Complete (Session 13, fixed Session 20) |
| SOM document threading + resolve helpers | ✅ Complete (Session 20) |
| AtriumClient — connection, protocol, SOM sync | ✅ Complete |
| AtriumClient — automatic SOM → server sync | ✅ Complete (Session 13) |
| AtriumClient — loopback prevention | ✅ Complete (Session 13) |
| AvatarController — local + peer avatar lifecycle | ✅ Complete (Session 16) |
| AvatarController — delta-based view optimization | ✅ Complete (Session 16) |
| NavigationController — WALK mode | ✅ Complete (Session 16) |
| NavigationController — ORBIT mode | ✅ Complete (Session 18) |
| `apps/client` — third-person navigation | ✅ Complete (Session 14) |
| `apps/client` — drag-to-look + pointer lock toggle | ✅ Complete (Sessions 15, 17) |
| `apps/client` — first/third person toggle | ✅ Complete (Session 17) |
| `apps/client` — HUD overlay + connection state UI | ✅ Complete (Session 15) |
| `apps/client` — peer name labels (LabelOverlay) | ✅ Complete (Session 17) |
| `apps/client` — mode switcher (Walk/Orbit dropdown) | ✅ Complete (Session 18) |
| `apps/client` — disconnect → static mode reload | ✅ Complete (Session 18) |
| SOM Inspector — tree view + property sheet + viewport | ✅ Complete (Session 19) |
| SOM Inspector — live cross-client editing | ✅ Confirmed working (Session 19) |
| glTF extension (`ATRIUM_world`) | 🔜 Upcoming |
| User Object Extensions (`ATRIUM_user_object`) | 🔜 Upcoming (design open) |
| Physics | 🔜 Future |
| Persistence | 🔜 Future |

---

## Known Issues

- **Label height offset** — peer name labels may float too high above
  capsules (`LABEL_HEIGHT_OFFSET = 2.2`). Needs visual tuning.

- **ORBIT → WALK avatar placement** — switching from ORBIT back to WALK
  places the avatar at the orbit camera position, which may be floating
  in the air. Deferred polish.

- **Known flaky test** — "handles client disconnect cleanly" in
  `packages/server/tests/session.test.js` — race condition, pre-existing.

- **Debug `view` message spew** — `_debug = true` floods console with
  peer `view` messages. Needs throttling or separate verbose flag.

- **Camera child node in `som-dump`** — local-only camera child node
  could appear in `som-dump` for late joiners. May need ephemeral marking
  or creation outside the document.

- **No permissions model** — any connected client can mutate any node's
  properties, including other peers' avatars. Confirmed via SOM Inspector
  editing a peer's material color in `apps/client`. Needs a design pass
  before real-world use.

---

## Backlog (Prioritized)

### Next: Real content
- Replace procedural gray-box world with a real glTF environment
  (room interior or landscape from Sketchfab CC0 / KhronosGroup samples)
- Replace capsule avatars with static glTF character models
- Wire `extras.atrium` metadata (navigation info, spawn point, world
  name/description) on real assets
- Stress-test renderer, SOM, and avatar system against real-world assets

### Navigation
- **FLY mode** — remove Y constraint, include pitch in movement vector.
  Simpler than terrain following — do first.
- **Terrain following for WALK** — raycast downward to find ground surface.
  Needs a `getGroundHeight(x, z)` callback from app layer (keeps
  NavigationController free of Three.js dependency). App implements with
  Three.js `Raycaster`.
- **Gravity** — apply downward velocity when not on ground. Builds on
  terrain following infrastructure.

### Inspector interaction
- Object highlighting in viewport (wireframe overlay on selected node)
- Click-to-select in viewport (raycast → SOM node → tree selection)
- Focus orbit on selected node (`nav.orbitTarget` = node world position)
- Select-and-drag to move (simple editor)

### Architecture
- Persistence — periodic glTF snapshots, ephemeral node filtering,
  last-write-wins
- Permissions model design
- Design Session B — User Object Extensions (`ATRIUM_user_object`)

### UX polish
- Label height offset tuning
- ORBIT → WALK avatar placement polish
- Debug view spew fix (throttle or verbose flag)

### Deferred
- `ATRIUM_world` glTF extension formalization
- Dead reckoning
- Collision / physics
- Viewpoints (named camera nodes)
- `@atrium/som` npm publish
- AtriumRenderer abstraction (Three.js → renderer-agnostic)
- README / TESTING.md updates

---

## Key Design Principles (never violate these)

1. **Design before code.** Every session starts from a settled design brief.
2. **No throwaway code.** Every line is tested against the real implementation.
3. **Incremental correctness.** Each layer is fully working and tested before
   the next is built on top of it.
4. **glTF on the wire.** The protocol carries glTF node descriptors directly.
5. **Server is policy-free on geometry.** The server never constructs or
   interprets mesh geometry.
6. **AtriumClient is geometry-agnostic.** `packages/client` never constructs
   or inspects mesh geometry. The avatar descriptor is opaque.
7. **SOM is the source of truth.** All world state mutations go through the SOM.
8. **Static first, multiplayer second.** The client renders the world even
   if the server is unreachable.
9. **glTF is world state.** Serialize the Document, you have serialized the
   world.

---

## Getting Started (for Claude Code)

```bash
git clone https://github.com/tparisi/atrium.git
cd atrium
pnpm install

# run all tests
pnpm --filter @atrium/protocol test
pnpm --filter @atrium/som test
pnpm --filter @atrium/server test
pnpm --filter @atrium/client test

# start a world server
cd packages/server
WORLD_PATH=../../tests/fixtures/space.gltf node src/index.js

# open the browser client
open apps/client/index.html

# open the protocol inspector
open tools/protocol-inspector/index.html

# open the SOM inspector
open tools/som-inspector/index.html
```

**When you change `packages/som`, always sync the test client:**
```bash
cp packages/som/src/*.js tests/client/som/
```
