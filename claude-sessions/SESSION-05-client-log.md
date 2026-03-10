# Atrium — Session 5 Log
## World Client: glTF-Transform Document + Three.js Renderer

---

## What Was Built

### Part 1 — `tests/fixtures/space.gltf` (upgraded)

**New file: `tests/fixtures/generate-space.js`**

One-off geometry generator using `@gltf-transform/core`. Produces a fully
self-contained `.gltf` with all buffers embedded as base64 `data:` URIs.

Geometry:
- `ground-plane` — box mesh 10 × 0.05 × 10, translation [0,0,0], matte grey
- `crate-01` — box mesh 0.5 × 0.5 × 0.5, translation [1, 0.25, 0], orange-brown
- `lamp-01` — parent node at [3, 0, 0] with two children:
  - `lamp-stand` — cylinder r=0.05, h=1.5, centered at [0, 0.75, 0], dark grey
  - `lamp-shade` — cone (top r=0, bottom r=0.3, h=0.4), centered at [0, 1.6, 0], warm cream

Implementation notes:
- Box geometry: 6 faces × 4 vertices (flat normals), CCW winding verified by
  computing `cross(e1, e2)` for each face — all outward-pointing.
- Cylinder geometry: 16 radial segments, side quads in b0/t0/t1/b1 order (CCW
  from outside); bottom cap fan (center, v_i, v_{i+1}) gives −Y; top cap fan
  reversed (center, v_{i+1}, v_i) gives +Y.
- `NodeIO.writeJSON()` returns `{ json, resources }` — the buffer binary is
  then base64-encoded and written as `data:application/octet-stream;base64,...`
  directly into `buffers[0].uri` before serializing the JSON.

Run with:
```bash
node tests/fixtures/generate-space.js
```

The script dynamically imports `@gltf-transform/core` via a direct file URL
relative to its own location (`../../packages/server/node_modules/...`), so no
extra install is needed — the package is already a dependency of
`packages/server`.

**`tests/package.json`** — added `{"type": "module"}` so that `generate-space.js`
(and any future scripts in `tests/`) are treated as ES modules by Node.js.

**Server tests:** all 26 tests still pass after the fixture upgrade. The tests
check node names and world metadata, not initial translation values, so the
crate-01 translation change from `[1,0,0]` to `[1,0.25,0]` was safe.

---

### Part 2 — Protocol Inspector fix

**`tools/protocol-inspector/index.html`** — one targeted change only: the type
dropdown now contains only the 5 client-sendable types:

```
hello  ping  send  add  remove
```

Removed server-only types: `pong`, `tick`, `set`, `join`, `leave`, `error`.

---

### Part 3 — `tests/client/index.html`

Single-file world client, all JS in `<script type="module">`, all CSS inline.

**Layout** — two-column, full viewport height:
- Left (360px fixed): SOP messaging panel
- Right (flex): Three.js viewport (top, fills available height) + message log
  (bottom, 200px fixed)

**Left panel — SOP messaging:**
- Client-only type dropdown: `hello`, `ping`, `send`, `add`, `remove`
- JSON editor textarea pre-filled from templates on type change
- [Send] validates JSON before sending; inline error display
- [Reset] restores template for current type
- Auto-generates `clientId` via `crypto.randomUUID()` on page load

**Connection flow:**
1. Page loads → Three.js viewport initializes (grid helper, dark bg)
2. `tryStaticLoad()` runs immediately — loads `space.gltf` in offline/static
   mode so the scene is visible even without a server (browser-first principle)
3. [Connect] → WebSocket opens, auto-sends `hello` immediately
4. Server `hello` response → `onServerHello()` loads (or re-uses) the scene
5. Subsequent `set`/`add`/`remove` messages mutate the glTF-Transform Document;
   `DocumentView` propagates changes to Three.js automatically

**Three.js viewport:**
- `WebGLRenderer` with `antialias: true`, shadow maps enabled
- Camera at `[0, 2, 6]` looking at `[0, 0.5, 0]`
- `OrbitControls` for interactive navigation
- `AmbientLight` intensity 0.4 + `DirectionalLight` at `[5, 10, 5]` intensity 1.0
- `ResizeObserver` on the viewport div — renderer size and camera aspect update
  on resize

**glTF-Transform / DocumentView integration:**
```javascript
const io = new WebIO().registerExtensions(KHRONOS_EXTENSIONS)
gltfDoc = await io.read(WORLD_GLTF_PATH)
docView = new DocumentView(gltfDoc)
const group = docView.view(gltfDoc.getRoot().listScenes()[0])
threeScene.add(group)
```

Mutations applied to `gltfDoc` (e.g. `node.setTranslation(...)`) are
automatically reflected in Three.js — no manual mesh manipulation needed.

**SOP message handlers:**
- `applySet(msg)` — sets translation/rotation/scale/extras on the named node
- `applyAdd(msg)` — creates a new glTF node, attaches to parent or scene root
- `applyRemove(msg)` — calls `node.dispose()` on the named node
- `onJoin` / `onLeave` — logged only, no visual avatar representation
- `onError` — logged with red tint

**Message log:**
- Inbound (blue left border) and outbound (green left border) entries
- Timestamp, direction arrow (→/←), type, key fields inline
- Click to expand full JSON
- "Show tick messages" checkbox — filters on display, ticks still stored
- [Clear] button

**CDN versions used:**
- `three@0.163.0`
- `@gltf-transform/core@4.3.0` (matches installed version in packages/server)
- `@gltf-transform/extensions@4.3.0`
- `@gltf-transform/view@4.3.0?deps=three@0.163.0`

The `?deps=three@0.163.0` parameter on the view import forces esm.sh to share
the Three.js instance between the top-level import and DocumentView's internal
usage. Without this, `instanceof` checks in DocumentView fail and the scene
does not attach correctly.

**WORLD_GLTF_PATH** — constant at the top of the script, defaults to
`../fixtures/space.gltf` (relative to `tests/client/`, works when served from
`tests/` via `npx serve -l 5173 tests/`).

---

## How to Run the Magic Moment

```bash
# Terminal 1 — Atrium server
WORLD_PATH=tests/fixtures/space.gltf node packages/server/src/index.js

# Terminal 2 — HTTP server for the client
npx serve -l 5173 tests/
```

1. Open `http://localhost:5173/client/index.html`
2. Click [Connect] — hello handshake completes, space.gltf loads in viewport
3. Open `tools/protocol-inspector/index.html` in a second tab
4. Connect to `ws://localhost:3000`
5. Select type `send`, send:
   ```json
   {
     "type": "send",
     "seq": 1,
     "node": "crate-01",
     "field": "translation",
     "value": [4.0, 0.25, 0.0]
   }
   ```
6. Crate moves in the world client viewport in real time ✓
7. Send `remove` for `crate-01` → crate disappears from the viewport ✓

---

## Files Created / Modified

| File | Action |
|------|--------|
| `tests/fixtures/generate-space.js` | Created — geometry generator script |
| `tests/fixtures/space.gltf` | Regenerated — upgraded with real geometry |
| `tests/package.json` | Created — `{"type": "module"}` for ESM scripts |
| `tests/client/index.html` | Created — world client |
| `tools/protocol-inspector/index.html` | Modified — dropdown restricted to 5 client types |

---

## Issues / Notes

- `@gltf-transform/core` version installed in the monorepo is **4.3.0**, not
  4.1.0 as specified in the session doc. CDN imports in the client were pinned
  to 4.3.0 to match.
- `DocumentView` API uses `docView.view(sceneDef)` returning a Three.js
  `Object3D`/`Group` that is added to `threeScene`. Mutations to the Document
  propagate automatically — no explicit `update()` call required.
- The `?deps=three@0.163.0` query parameter on the `@gltf-transform/view`
  import is critical for shared Three.js instance resolution on esm.sh.
- The `tryStaticLoad()` call on page load implements the "browser model":
  static scene first, multiplayer second. The scene is visible even if the
  WebSocket server is unreachable.
- Node.js ESM does not support `NODE_PATH` for module resolution; the generate
  script works around this with a dynamic `import()` using a direct file URL
  path to the server package's `node_modules`.
