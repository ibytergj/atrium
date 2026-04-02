# Session 19 — SOM Inspector

## Goal

Build `tools/som-inspector/`, a developer tool for viewing and editing the
live SOM. Uses the full client stack (AtriumClient, AvatarController,
NavigationController) with an inspection-focused UI.

---

## Design Decisions (settled)

1. **Tree view rebuilds fully** on `som:add` / `som:remove`. No incremental
   DOM patching — rebuild the whole tree. Optimize later if needed.

2. **Property sheet updates via scene events.** Three subscriptions on
   AtriumClient drive the entire UI:
   - `som:add` → rebuild tree
   - `som:remove` → rebuild tree (clear property sheet if selected node was removed)
   - `som:set` → if `nodeName` matches the currently selected node,
     re-read that node's SOM properties and repopulate the property sheet.
     Otherwise ignore.

   No per-object mutation listeners. No polling. Property sheet stays live
   for the selected node via `som:set` and populates on click for everything
   else.

3. **Import from package source via import map.** No manual copies. Same
   pattern as `apps/client`:
   ```
   "@atrium/som":       "../../packages/som/src/index.js"
   "@atrium/protocol":  "../../packages/protocol/src/index.js"
   "@atrium/client":    "../../packages/client/src/AtriumClient.js"
   ```

4. **ORBIT is the default navigation mode.** Inspection means looking at
   objects from all angles.

5. **No visible avatars.** First-person / ORBIT with no avatar body.
   Avatars exist in the SOM for networking but aren't visually relevant
   in an inspector context.

6. **Ephemeral node indicator.** Tree view checks
   `extras.atrium.ephemeral === true` on each node (stamped by
   AtriumClient in `connect()`). Ephemeral nodes get a small filled
   circle indicator next to their name. Confirmed working via debugger
   in a prior testing session.

---

## Layout

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

Left column: tree view (top, scrollable) + property sheet (bottom).
Right side: full-height Three.js viewport. Toolbar spans full width.

---

## File Structure

```
tools/som-inspector/
├── index.html          # Shell: import map, toolbar, layout containers
└── src/
    ├── app.js          # Bootstrap: AtriumClient, AvatarController,
    │                   #   NavigationController, Three.js viewport,
    │                   #   DocumentView, event wiring
    ├── TreeView.js     # Scene graph tree: build, rebuild, selection,
    │                   #   ephemeral indicators
    └── PropertySheet.js  # Property editor: reads selected SOMNode,
                          #   type-appropriate inputs, writes mutations
                          #   back to SOM
```

---

## Import Map

Same CDN versions as `apps/client`. Same local package imports.

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
</script>
```

---

## Build Order

### Pass 1 — HTML shell + tree view

1. Create `index.html` with import map, toolbar (URL bar, Load, connection
   dot, Connect/Disconnect, mode dropdown), and the two-panel layout
   (left column + right viewport container).

2. Create `src/app.js` — bootstrap:
   - Instantiate AtriumClient, AvatarController (first-person, no visible
     avatar), NavigationController (default ORBIT).
   - Set up Three.js scene, renderer, camera.
   - Set up DocumentView for glTF rendering.
   - Wire toolbar: Load fetches world, Connect/Disconnect manages
     connection, mode dropdown calls `nav.setMode()`.
   - Wire mouse/keyboard input to NavigationController (same pattern as
     `apps/client` but ORBIT default, no pointer lock, no `V` toggle).
   - Tick loop: `nav.tick(dt)`, camera sync, `renderer.render()`.

3. Create `src/TreeView.js`:
   - `build(som)` — walk `som.scene` children recursively, generate tree
     DOM. Check `extras.atrium.ephemeral` for indicator.
   - `rebuild(som)` — clear and re-run `build()`. Preserve selection if
     the selected node still exists.
   - Click handler — set selected node, call `onSelect(somNode)` callback.
   - Expand/collapse toggles on nodes with children.

4. Wire in `app.js`:
   - On `world:loaded` → `treeView.build(client.som)`
   - On `som:add` → `treeView.rebuild(client.som)`
   - On `som:remove` → `treeView.rebuild(client.som)`

### Pass 2 — Property sheet

5. Create `src/PropertySheet.js`:
   - `show(somNode)` — read current SOM values, generate editor DOM.
   - `refresh(somNode)` — re-read values into existing inputs (for
     `som:set` live updates on selected node).
   - `clear()` — empty the property sheet.

6. Property sections and editors:

   **Node properties:**
   - Translation: vec3 (three number inputs, step 0.1)
   - Rotation: vec4 (four number inputs, step 0.01)
   - Scale: vec3 (three number inputs, step 0.1)
   - Visible: checkbox

   **Material properties** (drill: node → mesh → primitives[0] → material):
   - Base color: RGB color picker + alpha number input
   - Metallic factor: number + range slider (0–1)
   - Roughness factor: number + range slider (0–1)
   - Emissive factor: vec3 (three number inputs)
   - Alpha mode: dropdown (OPAQUE, MASK, BLEND)
   - Alpha cutoff: number input (shown only when alpha mode = MASK)
   - Double sided: checkbox

   **Camera properties** (if node has camera):
   - Type: dropdown (perspective, orthographic)
   - Y-FOV: number + range slider
   - Z-near, Z-far: number inputs

7. Input → SOM mutation: each editor input's `change` (or `input` for
   sliders) handler writes directly to the SOM property via the setter.
   This fires a mutation event → AtriumClient syncs to server → broadcast.
   The existing pipeline handles everything.

8. Wire in `app.js`:
   - TreeView `onSelect` → `propertySheet.show(somNode)`
   - On `som:set` → if `nodeName === selectedNode.name`,
     call `propertySheet.refresh(selectedNode)`
   - On `som:remove` → if removed node was selected,
     call `propertySheet.clear()`

### Pass 3 — Polish

9. Connection state UI: green/gray dot, disable Connect when connected,
   disable Disconnect when not.

10. Disconnect behavior: same as `apps/client` — reload world via
    `client.loadWorld(url)`, rebuild tree, clear property sheet.

11. Toolbar mode dropdown: call `nav.setMode()`, sync UI state.

---

## What This Session Does NOT Include

- Object highlighting / selection in the 3D viewport
- Right-click to select in viewport
- Focus orbit on selected node
- Undo/redo
- Full scene editor capabilities (add/delete nodes from inspector)

These are deferred to future sessions per the handoff doc.

---

## Key Principles (from handoff — always apply)

1. Design before code.
2. No throwaway code.
3. Incremental correctness.
4. SOM is the source of truth.
5. Static first, multiplayer second.
