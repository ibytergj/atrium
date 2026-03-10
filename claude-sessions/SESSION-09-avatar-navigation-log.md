# Atrium — Session 9 Log
## Avatar, Navigation & View Message
### Completed: 2026-03-09

---

## Deliverables

### 1. Avatars as SOM Nodes ✅

Full connect/disconnect lifecycle implemented. Avatars are regular SOM nodes
living in the scene graph for the lifetime of the session.

**`packages/protocol/src/schemas/add.json`**
- Added optional `id` field (session UUID, identifies the sender for avatar adds)
- Added `mesh` to node descriptor properties (primitives with attributes, indices, material)

**`packages/protocol/src/index.js`**
- Imported and registered `som-dump` server schema validator

**`packages/som/src/SOMDocument.js`**
- Added `ingestNode(descriptor)` — ingests a full glTF node descriptor including
  mesh geometry (POSITION/NORMAL Float32Array, Uint16Array indices, PBR material)
  into the live glTF-Transform document. Used by both server and client.

**`packages/server/src/world.js`**
- Switched `addNode()` from `createNode` to `ingestNode` — now handles mesh geometry
- Added `serialize()` — emits the live glTF document as base64-embedded JSON
  (same embedding strategy as generate-space.js)

**`packages/server/src/session.js`**
- `hello` handler: uses `msg.id` (client UUID) as `session.id` so avatar node
  name = session ID = client UUID; sends `som-dump` (full serialized world) to
  the joining client immediately after hello handshake
- `add` handler: stores `session.avatarNodeName = msg.node.name`; switched from
  `broadcast` to `broadcastExcept` so sender doesn't receive their own add
- `view` handler: updates avatar SOM node `translation` and `rotation` (via
  `lookToQuaternion`) from `position` and `look`; relays `up` field if present
- `close` handler: removes avatar SOM node by `avatarNodeName`, broadcasts
  `remove { id: departedId }` for scene cleanup in addition to existing `leave`

**`tests/client/index.html`**
- Generates `sessionId = crypto.randomUUID()` and `displayName = 'User-XXXX'`
  on load (first 4 chars of UUID)
- Sends `hello` with `id: sessionId`
- Handles `som-dump`: reloads scene via `WebIO.readJSON`, then sends `add` with
  full capsule node descriptor (CapsuleGeometry → POSITION/NORMAL/indices arrays)
- Handles `add`: calls `som.ingestNode(msg.node)` + `som.scene.addChild()`;
  DocumentView propagates to Three.js automatically
- Handles `remove`: looks up by `msg.id ?? msg.node`, disposes from SOM;
  DocumentView handles Three.js cleanup
- Handles `view` from peers: updates avatar SOM node translation/rotation;
  DocumentView propagates automatically
- Removed pure Three.js avatar group management — SOM + DocumentView replaces it
- Updated status bar to display `displayName` and short session ID

---

### 2. `view` Message Schema Updates ✅

**`packages/protocol/src/schemas/view-client.json`**
- Added optional `up` field: `[x, y, z]` unit vector (default `[0, 1, 0]`)

**`packages/protocol/src/schemas/view-server.json`**
- Mirrored `up` field addition

**`tests/client/index.html`**
- `broadcastView()` now sends `look` (unit vector from walkYaw/walkPitch),
  `move` (unit vector or `[0,0,0]`), and `velocity` (scalar m/s) with every
  position update broadcast
- `up` omitted in WALK mode (non-default only in FLY mode — future)
- Server relays `up` field through `view` outbound message

---

### 3. NavigationInfo in Fixture ✅

**`tests/fixtures/generate-space.js`**
- Replaced bare `navigation: 'WALK'` with full NavigationInfo object:
  ```js
  navigation: {
    mode: ['WALK', 'FLY', 'ORBIT', 'TELEPORT'],
    terrainFollowing: true,
    speed: { default: 1.4, min: 0.5, max: 5.0 },
    collision: { enabled: false },
    updateRate: { positionInterval: 1000, maxViewRate: 20 },
  }
  ```

**`tests/fixtures/space.gltf`**
- Regenerated from updated `generate-space.js`

---

## Test Results

All 92 tests pass. No regressions.

| Package | Tests | Status |
|---------|-------|--------|
| `@atrium/protocol` | 41 | ✅ pass |
| `@atrium/som` | 19 | ✅ pass |
| `@atrium/server` | 32 | ✅ pass |
| **Total** | **92** | **✅ all pass** |

---

## Design Decisions

**Session ID = Avatar Node Name**
The server uses the client-provided `hello.id` (UUID v4) as `session.id`.
The avatar node's `name` in the SOM equals this UUID. Lookup is trivial:
`som.getNodeByName(session.id)`. Display name is in `node.extras.displayName`.

**Geometry-agnostic server**
The server calls `world.addNode(msg.node)` — `ingestNode` handles whatever
geometry the client provides. No mesh construction on the server. The client
owns avatar appearance entirely.

**SOM as single rendering path**
Peer avatars enter the scene via `som.ingestNode` + `som.scene.addChild`.
DocumentView handles Three.js object creation, position updates, and disposal.
The previous pure-Three.js avatar group map (`avatars`) is removed.

**`broadcastExcept` for client-triggered `add`**
Clients don't receive their own `add` echoed back. This prevents the sender
from double-adding the avatar node they already know about.

**Backward compatibility**
Existing `join`/`leave` presence messages are unchanged. `leave` is still
broadcast on disconnect alongside the new `remove` message. All existing
tests continue to pass without modification.

---

## Open Items (deferred)

- Dead reckoning on the client (interpolation between `view` updates)
- `up` vector send in FLY mode
- Avatar name label overlay in the viewport
- `ATRIUM_world` extension formalization (NavigationInfo migration)
- View send frequency delta thresholds (min delta for event-driven sends)
- Collision proxy conventions
