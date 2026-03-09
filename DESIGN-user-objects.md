# Atrium — User Object Extensions Design Brief
## Pre-Session 8 Design Discussion

---

## Overview

This brief captures the design discussion for `ATRIUM_user_object` — the glTF
vendor extension that enables user-defined, interactive, reusable objects in
Atrium worlds. It covers the extension mechanism, the property model, the
instancing flow, and the relationship to the broader glTF ecosystem.

---

## The Extension Mechanism

### Vendor extensions in glTF

glTF has three tiers of extensibility:

- **Ratified KHR extensions** — e.g. `KHR_materials_unlit`, through the Khronos process
- **Multi-vendor EXT extensions** — e.g. `EXT_mesh_gpu_instancing`
- **Vendor extensions** — e.g. `MSFT_lod`, `FB_ngon_encoding`, `ATRIUM_*`

`ATRIUM_*` is a legitimate vendor extension namespace, owned by the Atrium
project. No Khronos ratification required. `ATRIUM_world`, `ATRIUM_avatar`,
and `ATRIUM_user_object` are all valid names in this namespace.

### One extension for all user-defined types

Rather than creating a new `ATRIUM_*` extension for every object type a
developer might invent, there is a single `ATRIUM_user_object` extension that
acts as a typed container. The type name inside the extension tells the runtime
what kind of object it is. A record player, a door, and a vending machine all
use the same extension — they are just different types within it.

This keeps the extension schema stable. You version `ATRIUM_user_object` once;
the type system inside it evolves independently.

### `extras` vs extensions

glTF has two extensibility mechanisms:

- **`extras`** — open, unspecified JSON slot, no schema, invisible to the
  ecosystem. Already used by Atrium for world metadata (`extras.atrium`).
- **Extensions** — first-class, named, schema-backed, declared in
  `extensionsUsed`/`extensionsRequired`. Visible to validators and loaders.

`ATRIUM_user_object` is the right choice for user objects because it is a
contract — it has meaning that other implementations could understand and act
on. `extras.atrium` remains correct for world-level metadata intrinsic to the
content (name, maxUsers, navigation, capabilities).

---

## Graceful Degradation

A critical design requirement: a viewer that does not understand
`ATRIUM_user_object` should still be able to render the object.

The pattern for this is to keep all geometry in the main glTF `nodes` array as
plain, valid glTF nodes. The `ATRIUM_user_object` extension hangs off the
parent node and is purely additive — it layers Atrium semantics on top of what
is already a renderable node hierarchy.

Declaring the extension in `extensionsUsed` (not `extensionsRequired`) signals
to any loader that graceful degradation is expected and the file is valid
without it.

A non-Atrium viewer sees a record player and renders it. An Atrium runtime sees
the extension and wires up properties, behaviors, and multiplayer state on top.

---

## File Structure

The extension appears in two places in the glTF file:

**Top-level** — a type registry under `extensions.ATRIUM_user_object.types`,
containing the full type definitions for all user object types used in the file.

**Per-node** — on each instance node, a thin `extensions.ATRIUM_user_object`
block carrying only the type name and the current property values.

### Skeleton example

```json
{
  "asset": { "version": "2.0" },
  "extensionsUsed": ["ATRIUM_user_object"],

  "extensions": {
    "ATRIUM_user_object": {
      "types": [
        {
          "id": "record_player",
          "name": "Record Player",
          "version": "1.0.0",
          "nodes": [ "...subtree definition — open question, see below..." ],
          "properties": [
            {
              "name": "playing",
              "type": "boolean",
              "value": false,
              "target": { "node": "turntable-disc", "property": "rotation" },
              "onchange": "onPlayingChanged"
            },
            {
              "name": "track",
              "type": "string",
              "value": "kind-of-blue",
              "onchange": "onTrackChanged"
            },
            {
              "name": "volume",
              "type": "number",
              "value": 0.8,
              "target": { "node": "speaker-01", "property": "gain" }
            }
          ]
        }
      ]
    }
  },

  "nodes": [
    {
      "name": "record-player-01",
      "translation": [2, 0, -1],
      "children": [1, 2, 3],
      "extensions": {
        "ATRIUM_user_object": {
          "type": "record_player",
          "properties": {
            "playing": true,
            "track": "a-love-supreme",
            "volume": 0.6
          }
        }
      }
    },
    { "name": "turntable-disc", "mesh": 0 },
    { "name": "speaker-01", "mesh": 1 },
    { "name": "plinth", "mesh": 2 }
  ]
}
```

---

## The Property Model

Each property in the type definition is self-describing. It carries:

- **`name`** — the logical property name
- **`type`** — data type: `boolean`, `string`, `number` (enables editor UI)
- **`value`** — the default value (on the type definition) or current value (on the instance)
- **`target`** *(optional)* — a direct structural mapping to a glTF node property
- **`onchange`** *(optional)* — a script handler to call when the value changes

`target` and `onchange` are not mutually exclusive. Both can be present on the
same property — the runtime applies the direct mapping automatically, then calls
the script. This covers cases where you want the scene graph to update directly
*and* trigger additional behavior.

### Target node references

`target` uses separate `node` and `property` fields — not a dotted path string.
This avoids parsing complexity and is consistent with how glTF animation
channels handle targeting (`target.node` + `target.path`). Node references are
by name.

```json
"target": {
  "node": "turntable-disc",
  "property": "rotation"
}
```

### Descendant constraint

Direct `target` mappings are constrained to descendant nodes of the UO root.
This enforces encapsulation — a UO owns its subtree. Cross-object effects
(e.g. a record player dimming the room lights) are handled via `onchange`
scripts, not direct target mappings. This is a principled distinction:
structural mappings are local; side effects are scripted.

### Instance properties

At the instance level, `properties` is a flat key/value object — not an array.
The instance only carries current state. The type definition owns the schema,
default values, target mappings, and onchange handlers.

---

## Scripts

Scripts (`onchange` handlers) are noted in the property model but their
execution context is explicitly deferred. This is a significant design question
touching security, sandboxing, server-side vs. client-side execution, and trust
models. It requires a dedicated design session.

---

## The Authoring and Instancing Flow

### Authoring and publishing

A creator authors a user object in the (theoretical) Atrium editor. The output
is a self-contained glTF asset — a node subtree with real geometry, meshes, and
materials (all valid plain glTF) — plus the `ATRIUM_user_object` extension on
the root node carrying the type definition and default property values. The
creator publishes this to the (theoretical) Atrium marketplace.

### Placing in a world

A second user finds the asset in the marketplace and drops it into their world
in the Atrium editor. The editor merges the asset into the world's glTF:
geometry nodes land in the `nodes` array, meshes and materials are merged in,
and the parent node carries `ATRIUM_user_object` with instance property state.
The type definition is registered in the top-level
`extensions.ATRIUM_user_object.types` array, either inline or referenced by
URI back to the published asset (open question).

### Runtime instancing via SOP

When a user places an object in a live multiplayer world, it arrives as an
`add` SOP message carrying a glTF node descriptor — the same subtree, with the
extension on the root node. The Atrium runtime instances it into the live scene
graph. All connected clients receive the same `add` message and do the same.
An Atrium-aware client wires up the properties and behaviors. A non-Atrium
client renders the geometry and sees the object.

The extension is purely additive throughout the entire pipeline: authoring,
publishing, instancing, and rendering.

---

## Relationship to glTF External Reference Format (glXF)

The Khronos 3D Formats Working Group is developing a glTF External Reference
Format (previously called glXF) for composing scenes from multiple glTF assets.
This would be directly relevant to cross-world UO sharing and instancing.

Current status: the original 2022 spec documents are explicitly obsolete.
Significant conceptual changes have occurred. Replacement documents were
anticipated for 2H2025 but have not yet landed. **glXF is not a stable
foundation to build on today.**

Atrium will solve the scene graph fragment instancing problem within
`ATRIUM_user_object` without depending on glXF. The `atrium.json` manifest
already establishes a precedent for Atrium-specific assembly. When glXF
eventually stabilizes there is likely a clean migration path.

---

## Open Questions

These are the unresolved design questions to address in future sessions:

1. **Scene graph fragment instancing** — glTF has no native mechanism for
   defining a reusable node subtree and stamping out multiple instances of it.
   How does `ATRIUM_user_object` handle this? Does the type definition in
   `extensions.ATRIUM_user_object.types` contain the canonical subtree, and
   instances are expanded from it? Or does each instance carry its own subtree
   in the `nodes` array?

2. **Type definition location** — when a UO type is used in a world, does its
   full definition travel inline (in `extensions.ATRIUM_user_object.types`) or
   is it referenced by URI back to the published asset? Both have tradeoffs for
   portability, caching, and versioning.

3. **Script execution context** — what is the runtime context for `onchange`
   scripts? Sandboxed? Trusted? Client-side only or also server-side? This is
   a significant design effort deferred to its own session.

4. **Property types** — is `boolean`, `string`, `number` sufficient or are
   richer types needed (e.g. `vector3`, `color`, `uri`)?

5. **Authority** — in a multiplayer world, who can mutate the properties of a
   user object? Any connected client? The owner? Server-enforced rules?

6. **`target.property` vocabulary** — what is the full set of supported values?
   Just the glTF animation set (`translation`, `rotation`, `scale`, `weights`)
   or broader (materials, audio gain, visibility, etc.)?

---

## What Is NOT Changing

- `extras.atrium` in the glTF — stays for world metadata intrinsic to content
- The SOP `add`/`set`/`remove` message model — UO instancing and mutation goes
  through existing protocol messages
- The `atrium.json` manifest — deployment configuration stays separate from content
- The "static first, multiplayer second" load principle

---
*Design discussion: Session 8 pre-work, 2026-03-07*
