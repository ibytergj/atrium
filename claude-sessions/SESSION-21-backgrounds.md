# Session 21 Brief — Background Loading

## Overview

Add support for equirectangular background textures in both `apps/client`
and `tools/som-inspector`. The background image serves as both the visible
skybox and the IBL (image-based lighting) environment for PBR materials.

## Schema

The background is defined in `extras.atrium` at the glTF document root,
alongside the existing `navigation` block:

```json
"extras": {
  "atrium": {
    "navigation": { ... },
    "background": {
      "texture": "skyboxtest1.png",
      "type": "equirectangular"
    }
  }
}
```

- `texture` — path to the image, resolved relative to the world `.gltf` URL
- `type` — `"equirectangular"` or `"cubemap"`. Only `equirectangular` is
  implemented; log a warning and skip if `cubemap` is encountered.

## Implementation

### Where

Both files follow the same pattern:

- `apps/client/src/app.js`
- `tools/som-inspector/src/app.js`

### When

After `world:loaded` fires, the SOM is initialized and the Three.js scene
is set up. This is the right moment to read the background metadata and
load the texture.

### Steps

1. **Read metadata.** After `world:loaded`, get the document root extras:
   ```js
   const extras = client.som.document.getRoot().getExtras()
   const bg = extras?.atrium?.background
   ```

2. **Validate.** If `bg` is missing or `bg.texture` is falsy, do nothing.
   If `bg.type` is present and not `"equirectangular"`, log a warning
   (`console.warn('Unsupported background type:', bg.type)`) and return.

3. **Resolve URL.** The texture path is relative to the world `.gltf` URL.
   Derive the base URL from the world URL that was loaded:
   ```js
   const baseUrl = worldUrl.substring(0, worldUrl.lastIndexOf('/') + 1)
   const textureUrl = new URL(bg.texture, baseUrl).href
   ```
   `worldUrl` is whatever was passed to `client.loadWorld()` or typed
   into the URL bar. If it's a relative path, `new URL()` will need
   an absolute base — use `window.location.href` as the fallback base.

4. **Load texture.** Use Three.js `TextureLoader`:
   ```js
   import { TextureLoader, EquirectangularReflectionMapping, SRGBColorSpace } from 'three'

   const loader = new TextureLoader()
   loader.load(
     textureUrl,
     (texture) => {
       texture.mapping = EquirectangularReflectionMapping
       texture.colorSpace = SRGBColorSpace
       scene.background = texture
       scene.environment = texture
     },
     undefined,
     (err) => {
       console.warn('Failed to load background texture:', textureUrl, err)
     }
   )
   ```
   This is fire-and-forget. The world renders immediately; the sky pops
   in when the image finishes loading.

5. **Cleanup on disconnect/reload.** When the world is reloaded (e.g. on
   disconnect in `apps/client`, or loading a new URL), clear the previous
   background:
   ```js
   scene.background = null
   scene.environment = null
   ```
   The next `world:loaded` will load the new world's background if present.

### Three.js import note

`TextureLoader`, `EquirectangularReflectionMapping`, and `SRGBColorSpace`
are all in the `three` package, already in the import map. If the file
already imports from `'three'`, just add these to the existing import.

### HDR support (not required now, note for later)

If the texture path ends in `.hdr`, use `RGBELoader` from
`three/addons/loaders/RGBELoader.js` instead of `TextureLoader`.
This is not needed for the current `skyboxtest1.png` — just noting
it as a future enhancement.

## Test fixture

`tests/fixtures/atrium.gltf` already has the `background` metadata
pointing to `skyboxtest1.png`. Place the sky image in `tests/fixtures/`
alongside `atrium.gltf`.

To verify:
1. Start the server: `cd packages/server && WORLD_PATH=../../tests/fixtures/atrium.gltf node src/index.js`
2. Open `apps/client/index.html`, load `../../tests/fixtures/atrium.gltf`
   (or the `.atrium.json`). The sky should appear behind the geometry.
3. Open `tools/som-inspector/index.html`, load the same URL. Same sky
   should appear in the inspector viewport.
4. PBR materials (marble floor, brushed metal) should show environment
   reflections from the sky image.

## What NOT to do

- No UI for editing the background in the inspector. Just render it.
- No cubemap support. Warn and skip.
- No HDR loader. PNG/JPG only for now.
- No changes to protocol, SOM, or server. This is purely app-layer.
