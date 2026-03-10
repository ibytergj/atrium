# Atrium — Avatar, Navigation & View Message Design Brief
## Pre-Session 8 Design Discussion

---

## Overview

This brief covers two related design areas:

1. **The `view` SOP message** — what observer state a client broadcasts, and
   how other clients use it for dead reckoning and avatar rendering.
2. **NavigationInfo** — how a world declares its navigation rules, inspired by
   VRML's `NavigationInfo` node but slimmed down for Atrium's needs.

Viewpoints (named cameras a user can jump to) were discussed and deferred to
a later session — see note at the end.

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

This is simpler to implement and debug than a differential scheme, and avoids
"relative to what?" ambiguity entirely.

### Orientation representation

`look` and `up` are **unit vectors**, not Euler angles, quaternions, or
axis/angle. Reasoning:

- **Euler angles** — human-readable but order-dependent, gimbal lock is a
  real problem once FLY mode is in scope.
- **Quaternions** — mathematically superior, what Three.js uses internally,
  but opaque to debug and overkill for the wire format.
- **Axis/angle** — the right answer for describing a *transformation*, not a
  *direction*. Not appropriate here.
- **Unit vectors** — `look` is naturally a direction, not a rotation.
  `camera.getWorldDirection()` in Three.js hands you exactly this. Human-
  readable in logs. Linear interpolation on the receiving end is trivial.

A single forward vector (`look`) encodes pitch and yaw. Roll requires a second
vector (`up`). This is the standard "forward + up" basis used in graphics and
navigation — fully specifies orientation without redundancy, no gimbal lock.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `position` | `[x, y, z]` | Yes | Absolute world position |
| `look` | `[x, y, z]` | Yes | Forward unit vector — where the camera points |
| `move` | `[x, y, z]` | Yes | Movement direction unit vector. `[0,0,0]` if stationary |
| `velocity` | number | Yes | Scalar speed in meters per second. `0` if stationary |
| `up` | `[x, y, z]` | No | Up unit vector. Defaults to `[0, 1, 0]` if omitted |

`up` is only transmitted when it differs from the default — FLY mode, vehicles,
or any scenario involving roll. WALK mode clients never send it. Receiving
clients assume `[0, 1, 0]` when absent.

Note: `look` and `move` can differ. A player looking slightly upward while
moving horizontally has different `look` and `move` vectors. Strafing produces
a `move` direction orthogonal to `look`.

### Sample messages

**WALK mode, moving:**
```json
{
  "type": "view",
  "position": [2.4, 1.7, -3.1],
  "look": [0.71, -0.1, -0.70],
  "move": [0.71, 0.0, -0.70],
  "velocity": 1.4
}
```

**WALK mode, standing still:**
```json
{
  "type": "view",
  "position": [2.4, 1.7, -3.1],
  "look": [0.71, -0.1, -0.70],
  "move": [0, 0, 0],
  "velocity": 0
}
```

**FLY mode, banking (roll present):**
```json
{
  "type": "view",
  "position": [0, 8.0, -5.0],
  "look": [0.5, -0.3, -0.81],
  "move": [0.5, -0.3, -0.81],
  "velocity": 3.2,
  "up": [0.17, 0.94, 0.30]
}
```

### Protocol schema notes

The existing SOP `view` client schema already reserves `look`, `move`, and
`velocity` as optional fields. Changes needed:

- Add `up` as an optional field (`[x, y, z]` unit vector, default `[0, 1, 0]`)
- Clarify that `move` is a unit vector (or zero vector), not a scalar
- Update the server-side relay schema to match (`view` server message adds `id`)

---

## NavigationInfo

### Design principles

Inspired by VRML's `NavigationInfo` node but slimmer. Avatar geometry is
handled elsewhere (avatar system, not navigation). NavigationInfo covers the
world's rules for how clients move through it.

This lives in **`extras.atrium`** in the glTF — it is world content metadata,
intrinsic to the content, not deployment configuration. It is not in
`atrium.json`.

The existing fixture has `navigation: "WALK"` as a bare string placeholder.
This design replaces that with a richer object.

### Fields

```json
"extras": {
  "atrium": {
    "world": {
      "name": "My World",
      "maxUsers": 32,
      "capabilities": ["voice", "video"]
    },
    "navigation": {
      "mode": "WALK",
      "terrainFollowing": true,
      "gravity": true,
      "speed": {
        "default": 1.4,
        "min": 0.5,
        "max": 5.0
      },
      "collision": {
        "enabled": true,
        "proxy": "collision-mesh"
      }
    }
  }
}
```

### Field notes

**`mode`** — one of `WALK`, `FLY`, `ORBIT`, `TELEPORT`. The client uses this
to initialize the correct controller on world load. Single value for v0.1 —
could become an array later to allow multiple modes with user switching.

**`terrainFollowing`** — boolean. In WALK mode the client keeps the avatar on
the ground surface. Ignored in FLY mode.

**`gravity`** — boolean. Distinct from terrain following — determines whether
the avatar falls when moving off an edge. Could become a scalar (actual
gravity value in m/s²) in a future version, but boolean is correct for v0.1.

**`speed`** — all values in meters per second, consistent with `velocity` in
the `view` message. `default` is the initialization value. `min`/`max` are
optional world-enforced bounds.

**`collision`** — an object, not a boolean, to leave room for the full design
space:

- Omit entirely — no collision
- `{ "enabled": true }` — collision using visible geometry as the surface
- `{ "enabled": true, "proxy": "collision-mesh" }` — dedicated invisible
  proxy node, lower-poly than visible geometry, referenced by node name

The proxy node is conventionally invisible (no material, or flagged as such),
but the convention for marking nodes invisible is a separate design question.
Collision is a **placeholder for v0.1** — not being implemented yet, but the
field shape is no longer a dead end.

---

## Viewpoints — Deferred

VRML's `Viewpoint` node was discussed. glTF already has camera nodes that can
be attached to nodes and animated — a camera dolly, crane shot, or path-
following camera is all expressible in standard glTF animation.

Atrium viewpoints would add:
- A named inventory of cameras a UI can present to the user
- A designated default entry point (first in list, or explicitly flagged)
- Optionally, a referenced animation to play on transition

Design conclusion: viewpoints are a **named subset of existing glTF camera
nodes** with a designated default. Thin layer, no new coordinate data.

**Deferred to a future session.** Not needed for v0.1.

---

## What Needs Updating When Implemented

- **`packages/protocol`** — `view` client and server schemas: add `up`,
  clarify `move` as unit vector
- **`tests/fixtures/generate-space.js`** — replace `navigation: "WALK"` bare
  string with the full NavigationInfo object
- **`tests/fixtures/space.gltf`** — regenerate from updated script
- **`tests/client/index.html`** — wire up `look`, `move`, `velocity`, `up`
  in the Walk controller's `view` broadcast
- **`packages/server`** — no protocol changes beyond schema update; relay
  logic is already correct

---

## Open Questions

1. **`mode` as array** — should a world be able to declare multiple supported
   navigation modes and let the user switch? Or is a single default mode
   sufficient? Deferred — single mode for v0.1.

2. **Collision proxy conventions** — how is a collision proxy node marked
   invisible? A naming convention (`collision-*`)? A flag in `extras`? A
   future `ATRIUM_collision` extension? Deferred with collision implementation.

3. **Gravity as scalar** — when physics simulation is in scope, `gravity`
   becomes a value in m/s², not a boolean. Noted for future revision.

4. **Dead reckoning on the client** — the `view` message design enables it
   but the client implementation (extrapolating peer avatar positions between
   updates) has not been designed in detail. To be covered in the real client
   design session.

5. **Send frequency** — what triggers a `view` send? Position change threshold?
   Look direction change threshold? A minimum heartbeat interval regardless?
   Not yet specified.

---
*Design discussion: Session 8 pre-work, 2026-03-07*
