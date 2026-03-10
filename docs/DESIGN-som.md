# Atrium — Scene Object Model (SOM) Design Brief
## Pre-Session 8 Design Discussion

---

## Overview

The Scene Object Model (SOM) is the programmatic API by which the Atrium
runtime reads and mutates the scene at runtime. It is an abstraction layer
that sits above glTF-Transform, exposing a clean, DOM-inspired property-based
interface to the rest of the Atrium stack.

SOP `send`/`set` messages are serialized SOM mutations — the wire format
describes an operation, and any client or server that implements the SOM can
execute it by making the corresponding SOM API calls. The SOM is therefore the
canonical definition that all Atrium runtimes implement against.

---

## Design Principles

### DOM-inspired
The SOM is modeled on the HTML DOM. Properties for simple values, methods only
for operations with behavior. Collections are plain properties, not methods.
The global `som` instance is analogous to the browser's global `document`.

### Thin abstraction over glTF-Transform
SOM v0.1 is mostly a passthrough to glTF-Transform, implemented via JavaScript
`get`/`set` property accessors that delegate to the underlying glTF-Transform
getter/setter methods:

```javascript
class SOMNode {
  get name()        { return this._node.getName() }
  set name(v)       { this._node.setName(v) }

  get translation() { return this._node.getTranslation() }
  set translation(v){ this._node.setTranslation(v) }

  get children()    { return this._node.listChildren().map(n => new SOMNode(n)) }

  get mesh()        { return this._node.getMesh() ? new SOMMesh(this._node.getMesh()) : null }
  set mesh(v)       { this._node.setMesh(v._mesh) }
}
```

The glTF-Transform object is completely hidden behind the SOM interface.

### Portability and resilience
Having a named SOM layer — even if v0.1 is 95% passthrough — means:
- glTF-Transform version bumps don't break the protocol
- A future runtime could swap in a different scene graph implementation
- The SOM is the spec that third-party Atrium clients implement against
- It is a hedge against glTF-Transform compatibility issues or abandonment

### Mirrors glTF-Transform document structure
The SOM structure follows glTF-Transform's Document/Scene/Node hierarchy
faithfully. `SOMDocument` wraps the full Document — not just the scene graph.
Meshes, materials, cameras etc. live at the document level, independent of
the node hierarchy, exactly as in glTF-Transform.

### Symmetric client and server
Both the Atrium server and each client maintain a `SOMDocument` instance
wrapping their respective glTF-Transform Document. The SOM API is identical
on both sides. Permission and authority rules sit above the SOM — they are
a runtime concern, not a SOM design concern.

---

## The Global `som` Instance

In the Atrium runtime context, `som` is a global singleton — a pre-instantiated
`SOMDocument` wrapping the current world's Document. It is available everywhere
without instantiation, exactly as `document` is in the browser.

```javascript
// Just available — no instantiation needed
som.scene
som.getNodeByName('crate-01')
som.createNode({ name: 'my-node', translation: [0, 0, 0] })
```

The underlying `SOMDocument` class still exists for cases requiring multiple
instances — loading an external glTF fragment, previewing a UO before
instancing, unit testing.

---

## Full API

---

### SOMDocument

Wraps a glTF-Transform `Document`. The global `som` is an instance of this class.

```javascript
// Scene graph entry point
som.scene                              // SOMScene

// Node lookup
som.getNodeByName(name)                // SOMNode | null

// Collections — all objects in the document
som.nodes                              // SOMNode[]
som.meshes                             // SOMMesh[]
som.materials                          // SOMMaterial[]
som.cameras                            // SOMCamera[]
som.animations                         // SOMAnimation[]
som.textures                           // SOMTexture[]
som.skins                              // SOMSkin[]

// Type factories — create empty objects, populate manually
som.createNode(descriptor)
som.createMesh(descriptor)
som.createMaterial(descriptor)
som.createCamera(descriptor)
som.createAnimation(descriptor)
som.createTexture(descriptor)
som.createSkin(descriptor)
som.createPrimitive(descriptor)

// Instancing from external glTF
som.createNodeFromGLTF(gltf, nodeName)
// gltf: URL string | glTF JSON object | glTF-Transform Document
// nodeName: optional — defaults to scene root if omitted
// Returns: SOMNode (root of the instanced subtree)
// Internally: merges the external Document into the current Document
```

---

### SOMScene

Entry point for the node hierarchy. Wraps glTF-Transform `Scene`.
Analogous to `document.body` in the DOM.

```javascript
// Properties
som.scene.name                         // string
som.scene.extras                       // object

// Children — root-level nodes only
som.scene.children                     // SOMNode[]
som.scene.addChild(node)               // attach a node to the scene root
som.scene.removeChild(node)            // detach a node from the scene root
```

---

### SOMNode

Wraps glTF-Transform `Node`.

```javascript
// Identity
node.name                              // string
node.extras                            // object

// Transform
node.translation                       // [x, y, z]
node.rotation                          // [x, y, z, w] quaternion
node.scale                             // [x, y, z]

// Visibility — bridges to Three.js object3D.visible
node.visible                           // boolean

// Attachments
node.mesh                              // SOMMesh | null
node.camera                            // SOMCamera | null
node.skin                              // SOMSkin | null

// Scene graph
node.parent                            // SOMNode | SOMScene | null
node.children                          // SOMNode[]
node.addChild(node)
node.removeChild(node)

// Instancing
node.clone()                           // deep clone — node + entire subtree
                                       // analogous to DOM cloneNode(true)

// Extensions
node.getExtension(name)
node.setExtension(name, value)
```

### Node Descriptor

The descriptor passed to `som.createNode()` mirrors the node's properties.
All fields optional — omitted fields get sensible defaults.

```javascript
som.createNode({
  name: "record-player-01",
  translation: [2.0, 0.0, -1.0],      // default [0, 0, 0]
  rotation: [0.0, 0.0, 0.0, 1.0],     // default identity
  scale: [1.0, 1.0, 1.0],             // default [1, 1, 1]
  visible: true,                       // default true
  extras: { atrium: { ... } }
})
```

The node descriptor is also the canonical shape of the glTF node descriptor
in SOP `add` messages — the wire format and the SOM factory use the same shape.

---

### SOMMesh

Wraps glTF-Transform `Mesh`.

```javascript
// Properties
mesh.name                              // string
mesh.weights                           // number[] — morph target weights
mesh.extras                            // object

// Primitives
mesh.primitives                        // SOMPrimitive[]
mesh.addPrimitive(primitive)
mesh.removePrimitive(primitive)
```

---

### SOMPrimitive

Wraps glTF-Transform `Primitive`.

```javascript
// Properties
primitive.material                     // SOMMaterial | null
primitive.mode                         // TRIANGLES | LINES | POINTS | etc.
primitive.extras                       // object
```

---

### SOMMaterial

Wraps glTF-Transform `Material`.

```javascript
// Identity
material.name                          // string
material.extras                        // object

// PBR — Metallic Roughness
material.baseColorFactor               // [r, g, b, a]
material.metallicFactor                // number 0.0–1.0
material.roughnessFactor               // number 0.0–1.0
material.baseColorTexture              // SOMTexture | null
material.metallicRoughnessTexture      // SOMTexture | null

// Surface
material.normalTexture                 // SOMTexture | null
material.occlusionTexture              // SOMTexture | null
material.emissiveFactor                // [r, g, b]
material.emissiveTexture               // SOMTexture | null

// Rendering
material.alphaMode                     // "OPAQUE" | "MASK" | "BLEND"
material.alphaCutoff                   // number
material.doubleSided                   // boolean
```

---

### SOMCamera

Wraps glTF-Transform `Camera`.

```javascript
// Identity
camera.name                            // string
camera.extras                          // object

// Type
camera.type                            // "perspective" | "orthographic"

// Perspective properties
camera.yfov                            // number, radians
camera.aspectRatio                     // number | null (use viewport aspect)
camera.znear                           // number
camera.zfar                            // number | null (infinite projection)

// Orthographic properties
camera.xmag                            // number
camera.ymag                            // number
```

---

### SOMAnimation

Wraps glTF-Transform `Animation` + Three.js `AnimationMixer`.
The one SOM type that bridges two APIs — glTF-Transform owns the data,
Three.js owns playback.

```javascript
// Identity
animation.name                         // string
animation.extras                       // object

// Properties
animation.loop                         // boolean
animation.timeScale                    // number
animation.duration                     // number, read-only — derived from samplers

// Data — read-only, from glTF-Transform
animation.channels                     // AnimationChannel[]
animation.samplers                     // AnimationSampler[]

// Playback — bridges to Three.js AnimationMixer
animation.play()
animation.stop()
animation.getState()                   // "playing" | "stopped" | "paused"
animation.setWeight(number)            // 0.0–1.0 for blending
```

---

### SOMTexture

Read-only in v0.1. Wraps glTF-Transform `Texture`.

```javascript
// Identity
texture.name                           // string, read-only
texture.mimeType                       // string, read-only
texture.extras                         // object, read-only

// Data
texture.getImage()                     // read-only — raw image data
```

---

### SOMSkin

Read-only in v0.1. Wraps glTF-Transform `Skin`.

```javascript
// Identity
skin.name                              // string, read-only
skin.extras                            // object, read-only

// Data — read-only
skin.joints                            // SOMNode[], read-only
skin.skeleton                          // SOMNode | null, read-only
```

---

## Path Syntax for SOP `send`/`set`

With the SOM defined, the dot-bracket path syntax for `send`/`set` messages
follows directly. All paths are relative to the named node anchor in the
`send` message. The runtime walks the path using SOM property accessors to
resolve and apply the mutation.

### Syntax rules
- `.` separates object property traversal steps
- `[n]` accesses an array element by index
- All segment names match SOM property names exactly
- Paths are always relative to the anchor node — never global

### Examples

```javascript
// Node transform
"translation"
"rotation"
"scale"
"visible"

// Material via node
"mesh.primitives[0].material.baseColorFactor"
"mesh.primitives[0].material.roughnessFactor"
"mesh.primitives[0].material.doubleSided"
"mesh.primitives[0].material.alphaMode"
"mesh.primitives[0].material.emissiveFactor"

// Camera
"camera.yfov"
"camera.znear"
"camera.zfar"

// Animation
"animation.loop"
"animation.timeScale"
```

### Sample `send` message — set material to green

```json
{
  "type": "send",
  "seq": 42,
  "node": "crate-01",
  "field": "mesh.primitives[0].material.baseColorFactor",
  "value": [0.0, 1.0, 0.0, 1.0]
}
```

Which the runtime resolves as:

```javascript
const node = som.getNodeByName('crate-01')
node.mesh.primitives[0].material.baseColorFactor = [0.0, 1.0, 0.0, 1.0]
```

Clean 1-1 mapping between wire format and SOM API call.

---

## Relationship to SOP

The SOM is the semantic layer that gives SOP messages meaning:

| SOP Message | SOM Operation |
|-------------|---------------|
| `add` | `som.createNode(descriptor)` or `som.createNodeFromGLTF(gltf)` + `som.scene.addChild(node)` |
| `remove` | `som.getNodeByName(name)` + `node.parent.removeChild(node)` |
| `send`/`set` | `som.getNodeByName(name)` + path traversal + property assignment |

---

## Package

The SOM lives in `packages/som` — a new package in the Atrium monorepo.

```
packages/
  som/
    src/
      index.js          # exports SOMDocument, SOMNode, SOMMaterial etc.
      SOMDocument.js
      SOMScene.js
      SOMNode.js
      SOMMesh.js
      SOMPrimitive.js
      SOMMaterial.js
      SOMCamera.js
      SOMAnimation.js
      SOMTexture.js
      SOMSkin.js
    test/
      som.test.js
```

Both `packages/server` and `tests/client` will depend on `packages/som`.

---

## Open Questions

1. **`node.visible` implementation** — not a native glTF property. The server
   can store it in `extras` or as a SOM-internal flag. The client bridges it
   to Three.js `object3D.visible` via DocumentView. How does the server
   represent and persist visibility state?

2. **Animation playback on the server** — the server doesn't have a Three.js
   `AnimationMixer`. Does animation playback state (`play`, `stop`, `loop`)
   live in the SOM as pure state that clients act on, with the server only
   storing and relaying it? Or does the server have no animation playback
   concept at all?

3. **`som.createNodeFromGLTF` merge strategy** — when merging an external
   Document into the current Document, how are name collisions handled?
   Materials and meshes with the same name — deduplicated or duplicated?

4. **Path validation** — when a `send` message arrives, the server needs to
   validate the path before executing it. Does this happen against the live
   SOM (attempt traversal and catch errors) or against a static schema of
   valid paths?

5. **Read-only enforcement** — `SOMTexture` and `SOMSkin` are read-only in
   v0.1. How is this enforced — setter throws, setter is simply absent, or
   a permission layer above the SOM handles it?

6. **Wrapping vs. subclassing** — the SOM wraps glTF-Transform objects via
   composition (`this._node`). Should SOM objects subclass glTF-Transform
   objects instead? Composition is safer for portability — the internal
   implementation stays hidden — but subclassing is less code.

---

## What Is NOT In Scope for v0.1

- Accessors — typed array views into binary buffers, implementation detail
- Morph target data on primitives — read-only infrastructure
- Sampler filtering and wrapping on textures
- Physics, collision, audio — separate extension territory
- Permission and authority rules — sit above the SOM

---
*Design discussion: Session 8 pre-work, 2026-03-08*
