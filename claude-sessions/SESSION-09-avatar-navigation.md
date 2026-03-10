# Atrium — Session 9 Brief
## For Claude Code

---

## Context

Atrium is an open multiplayer 3D world platform built on glTF and WebSockets.
The stack is: Node.js + glTF-Transform on the server, Three.js + DocumentView
on the client. All packages use ES modules, no TypeScript, no build step.
Test runner is `node --test`. SPDX license header in every `.js` file.

**Current test counts:**
| Package | Tests |
|---------|-------|
| `@atrium/protocol` | 41 |
| `@atrium/som` | 19 |
| `@atrium/server` | 32 |
| **Total** | **92** |

All 92 tests pass. Do not break them.

---

## Repository Structure

```
atrium/
├── packages/
│   ├── protocol/        # SOP schemas + Ajv validator
│   ├── server/          # WebSocket world server
│   └── som/             # Scene Object Model — API layer over glTF-Transform
├── tests/
│   ├── fixtures/
│   │   ├── space.gltf          # World fixture
│   │   ├── space.atrium.json   # World manifest
│   │   └── generate-space.js   # Geometry generator
│   └── client/
│       ├── index.html          # Single-file world client
│       └── som/                # SOM source copy for browser (dev-only)
└── tools/
    └── protocol-inspector/index.html
```

---

## Session 9 Goals

Three deliverables this session, in priority order:

1. **Avatars as SOM nodes** — full connect/disconnect lifecycle
2. **`view` message schema updates** — add `up`, clarify `move` as unit vector
3. **NavigationInfo in fixture** — replace bare `navigation: "WALK"` string

---

## 1. Avatars as SOM Nodes

### Design summary

Avatar nodes are regular SOM nodes. They live in the scene graph for the
lifetime of the session. The server maintains them like any other node —
they are included naturally in the world glTF and visible to all connected
clients.

### Session identity

The client generates a `sessionId` (UUID v4) on load. This same UUID serves as:
- The session identifier in all SOP messages
- The avatar node's ID in the SOM scene graph

The avatar display name is derived from the session UUID:
```
User-XXXX
```
where `XXXX` is the first 4 characters of the UUID. Generated client-side at
session init alongside the UUID.

### Connect / disconnect sequence

**On connect:**
1. Client connects via WebSocket
2. Client sends `join` (carries `sessionId`) — already implemented
3. Server responds with **full SOM dump as glTF** — the current scene
   including all present avatar nodes (new behaviour)
4. Client sends `add` — its avatar node descriptor (see below)
5. Server adds node to SOM, broadcasts `add` to all other clients
6. Client begins sending `view` messages as it navigates

**On disconnect:**
1. Client disconnects (or sends `leave`)
2. Server removes the avatar node from SOM
3. Server broadcasts `remove` to all other clients

### Avatar node descriptor (`add` message payload)

The client is responsible for constructing its entire avatar node — geometry
included — and sending it to the server. The server is completely
geometry-agnostic: it takes what the client sends, injects it into the SOM,
and broadcasts it to others. No geometry construction happens on the server.

The `add` message carries a complete glTF node descriptor:

```json
{
  "type": "add",
  "id": "<sessionId>",
  "node": {
    "name": "User-3f2a",
    "translation": [0, 0, 0],
    "rotation": [0, 0, 0, 1],
    "mesh": {
      "primitives": [{
        "attributes": { ... },
        "indices": ...,
        "material": { "pbrMetallicRoughness": { "baseColorFactor": [0.5, 0.7, 1.0, 1.0] } }
      }]
    }
  }
}
```

The client builds capsule geometry in Three.js / glTF-Transform, serializes
the full node to glTF JSON, and includes it in the `add` message. The server
calls `som.addNode(message.node)` — or equivalent — and that is the entirety
of its responsibility.

This means a future client could send a humanoid mesh, a robot, a custom
shape — the server never needs to change. Avatar appearance is entirely a
client concern.

### Full SOM dump on connect

When a new client connects, the server sends the full current glTF — the same
document it loaded at startup, with any avatar nodes that have been added since.
This is the response to `join`. The receiving client wraps it in a `SOMDocument`
exactly as it would the static file.

This means clients that join mid-session automatically see all already-present
avatars. No special catchup logic required.

### `view` message → avatar node update

When the server receives a `view` message from a client, it:
1. Looks up the avatar SOM node by `sessionId`
2. Updates `node.translation` and `node.rotation` from `position` and `look`
3. Relays the `view` message to all other clients (existing behaviour)

DocumentView on each receiving client propagates the SOM update to Three.js
automatically.

### Changes required

**`packages/protocol`:**
- Add `add` client message schema: `id` (sessionId), `node` (full glTF node
  descriptor including mesh geometry)
- Add `remove` server message schema: `id`
- Add `som-dump` server message schema (or reuse an existing envelope) for
  the full glTF payload sent on connect

**`packages/server`:**
- On `join`: send full SOM dump (current glTF serialized) to the joining client
- On `add`: call `som.addNode(message.node)` — no geometry construction,
  no interpretation of mesh contents; broadcast `add` to other clients
- On `view`: update avatar node `translation`/`rotation` in SOM, then relay
- On disconnect: remove avatar SOM node by sessionId, broadcast `remove`

The server must never construct or interpret geometry. It receives a node,
adds it to the SOM, and relays it. That is all.

**`packages/som`:**
- Add `get extras()` to `SOMDocument` — expose glTF root extras.
  Investigate `document.getRoot()` in glTF-Transform v4.3.0. If root extras
  are not cleanly accessible via the API, read `extras.atrium` directly from
  the raw glTF JSON at load time (NavigationInfo is static, read once).
- Add `som.addNode(gltfNodeDescriptor)` if not already present — ingests a
  glTF node descriptor (with mesh) into the live document

**`tests/client/index.html`:**
- Generate `sessionId` (UUID v4) and display name (`User-XXXX`) on load
- Build capsule geometry using Three.js (`CapsuleGeometry`) and serialize
  to a glTF node descriptor (position, rotation, mesh primitives, material)
- Send `add` message with the complete node descriptor after receiving the
  SOM dump response to `join`
- Render received `add` messages from other clients by ingesting the node
  descriptor into the local SOM — DocumentView propagates to Three.js
- Handle `remove` messages — remove node from SOM, DocumentView disposes
  Three.js objects
- Update peer avatar positions from relayed `view` messages via SOM

---

## 2. `view` Message Schema Updates

### Changes required

**`packages/protocol` — view client schema:**
- Add `up` as an optional field: `[x, y, z]` unit vector, default `[0, 1, 0]`
- Clarify / add validation that `move` is a unit vector or zero vector
  `[0, 0, 0]`, not a scalar
- `velocity` remains a scalar (meters per second)

**`packages/protocol` — view server schema:**
- Mirror the above changes (server relay schema adds `id` to the client schema)

**`tests/client/index.html`:**
- Wire up `up` in the walk controller's `view` broadcast (WALK mode may omit
  it — only send when non-default)
- Confirm `move` is sent as a unit vector

No server relay logic changes needed — the server already relays `view`
messages without inspecting their fields beyond `id`.

---

## 3. NavigationInfo in Fixture

Replace the bare `navigation: "WALK"` placeholder in the world fixture with
the full NavigationInfo object.

### Changes required

**`tests/fixtures/generate-space.js`:**

Replace:
```javascript
navigation: "WALK"
```

With:
```javascript
navigation: {
  mode: ["WALK", "FLY", "ORBIT", "TELEPORT"],
  terrainFollowing: true,
  speed: {
    default: 1.4,
    min: 0.5,
    max: 5.0
  },
  collision: {
    enabled: false
  },
  updateRate: {
    positionInterval: 1000,
    maxViewRate: 20
  }
}
```

**`tests/fixtures/space.gltf`:**
- Regenerate from updated `generate-space.js`

Note: `collision.enabled: false` for the space fixture — no collision mesh
present. The field shape is preserved for future use.

---

## Design Reference

The full design brief for avatar, navigation, and view message is included
below for reference.

---

# Atrium — Avatar, Navigation & View Message Design Brief
## Updated: Design Session A, 2026-03-09

---

## Overview

This brief covers three related design areas:

1. **Avatar identity and representation** — how a connected client's avatar
   is created, named, and maintained in the SOM scene graph.
2. **The `view` SOP message** — what observer state a client broadcasts, and
   how other clients use it for dead reckoning and avatar rendering.
3. **NavigationInfo** — how a world declares its navigation rules, inspired by
   VRML's `NavigationInfo` node but slimmed down for Atrium's needs.

Viewpoints (named cameras a user can jump to) were discussed and deferred to
a later session — see note at the end.

---

## Avatar Identity & Representation

### Session state vs. world state

The avatar has two distinct aspects that must not be conflated:

**World state** (lives in the SOM / glTF, server-maintained, visible to all):
- The avatar's scene node — position, orientation, geometry, material, name
- Exists in the scene graph for the lifetime of the session
- Included naturally in the full SOM dump sent to newly connecting clients

**Session state** (transient, client-authoritative, not persisted in glTF):
- The client's current navigation state — where it is looking, how it is
  moving, velocity
- The camera, derived from navigation state
- Persistence between visits is a client concern (localStorage or future user
  profile service) — out of scope for v0.1

### Avatar node in the SOM

The avatar's SOM node is a regular scene node. It has:
- `translation` / `rotation` — the avatar's position in the world
- A mesh (capsule geometry for v0.1)
- A `name` — the user's display name

The node is **ephemeral** — it is not written back into the canonical
`space.gltf`. It exists only for the lifetime of the session. The server
creates it when the client sends `add`, removes it on disconnect.

### Session identity and avatar node identity

The client generates a `sessionId` (UUID v4) on load. This same UUID serves
as:
- The session identifier in SOP messages (`join`, `view`, etc.)
- The avatar node's ID in the SOM scene graph

No separate mechanism is needed. The client already knows its own ID.

### Avatar naming

For v0.1, the avatar's display name is derived from the session UUID:

```
User-XXXX
```

where `XXXX` is the first 4 characters of the UUID. Generated client-side
at session init alongside the UUID itself. Human-readable in logs and name
labels, requires no extra machinery or word lists.

The node `name` property in the SOM maps 1:1 to the `name` field in the
underlying glTF JSON (via glTF-Transform's `getName()`/`setName()`). No
special handling needed.

### Connect / disconnect sequence

**On connect:**
1. Client connects via WebSocket
2. Client sends `join` — establishes the session (carries `sessionId`)
3. Server responds with full SOM dump as glTF — current scene including all
   present avatar nodes
4. Client sends `add` — its avatar node with geometry, material, initial
   transform, and derived display name
5. Server adds node to SOM, broadcasts `add` to other clients
6. Client begins sending `view` messages as it navigates

**On disconnect:**
1. Client disconnects (or sends `leave`)
2. Server removes avatar node from SOM
3. Server broadcasts `remove` to other clients

### Full SOM dump on connect

The "full SOM dump" is simply the current glTF — the same format the server
loaded at startup, with avatar nodes added and removed as sessions come and go.
The receiving client wraps it in a `SOMDocument` exactly as it would the static
file. Same code path. The static-first principle holds.

This naturally solves the "here are all the people already in the room" problem
— avatar nodes of existing clients are present in the glTF, no special catchup
logic needed.

### glTF as the single serialization format

The SOM is a live API lens over a glTF-Transform `Document`. The glTF file
*is* the world state — not a representation of it. SOM node names map 1:1 to
glTF JSON node names. Serialize the glTF, you have serialized the world,
avatar nodes and all.

---

## The `view` Message

### Design principles

Every `view` message is a **complete snapshot** of the client's observer state.
All values are absolute — no differential encoding. The client recalculates and
sends whenever anything changes.

Other clients use the high-frequency fields (`look`, `move`, `velocity`) for
**dead reckoning** — extrapolating avatar position smoothly between updates
using `position + (move * velocity * Δt)`. `position` is the periodic absolute
ground truth that corrects accumulated drift.

### Orientation representation

`look` and `up` are **unit vectors**, not Euler angles, quaternions, or
axis/angle. A single forward vector (`look`) encodes pitch and yaw. Roll
requires a second vector (`up`). This is the standard "forward + up" basis
used in graphics and navigation — fully specifies orientation without
redundancy, no gimbal lock.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `position` | `[x, y, z]` | Yes | Absolute world position |
| `look` | `[x, y, z]` | Yes | Forward unit vector — where the camera points |
| `move` | `[x, y, z]` | Yes | Movement direction unit vector. `[0,0,0]` if stationary |
| `velocity` | number | Yes | Scalar speed in meters per second. `0` if stationary |
| `up` | `[x, y, z]` | No | Up unit vector. Defaults to `[0, 1, 0]` if omitted |

`up` is only transmitted when it differs from the default — FLY mode,
vehicles, or any scenario involving roll. WALK mode clients never send it.

### Send frequency

- **Event-driven** (`look`, `move`, `up`, `velocity`) — sent on change beyond
  a minimum delta threshold
- **Time-driven** (`position`) — sent on a regular heartbeat interval

World specifies policy via `navigation.updateRate` in `extras.atrium`:
- `positionInterval` — ms between position heartbeat sends (default: 1000)
- `maxViewRate` — max view messages per second for event-driven fields (default: 20)

---

## NavigationInfo

Lives in `extras.atrium` at the glTF root object (temporary home until
`ATRIUM_world` extension is formalized).

```json
"extras": {
  "atrium": {
    "world": {
      "name": "My World",
      "maxUsers": 32,
      "capabilities": ["voice", "video"]
    },
    "navigation": {
      "mode": ["WALK", "FLY", "ORBIT", "TELEPORT"],
      "terrainFollowing": true,
      "speed": {
        "default": 1.4,
        "min": 0.5,
        "max": 5.0
      },
      "collision": {
        "enabled": true,
        "proxy": "collision-mesh"
      },
      "updateRate": {
        "positionInterval": 1000,
        "maxViewRate": 20
      }
    }
  }
}
```

**`mode`** — array of supported navigation modes: `WALK`, `FLY`, `ORBIT`,
`TELEPORT`. First entry is the default.

**`terrainFollowing`** — boolean, WALK mode only.

**`gravity`** — removed. Redundant with mode. Returns as scalar (m/s²) when
physics simulation is in scope.

**`speed`** — meters per second. `min`/`max` are optional bounds.

**`collision`** — object placeholder. Not implemented in v0.1.

**`updateRate`** — send policy for `view` messages (see above).

---

## Open Questions

1. **Dead reckoning on the client** — design deferred to real client design
   session.
2. **Collision proxy conventions** — deferred with collision implementation.
3. **Gravity as scalar** — deferred until physics simulation is in scope.
4. **`ATRIUM_world` extension** — NavigationInfo migrates here when the
   extension is formalized.
5. **View send frequency delta thresholds** — minimum delta for event-driven
   sends not yet specified. To be resolved in client implementation.

---
*Original design discussion: Session 8 pre-work, 2026-03-07*
*Updated: Design Session A, 2026-03-09*
