# Atrium Project Memory

## Stack
- Node.js + glTF-Transform server, Three.js + DocumentView client
- All ES modules, no TypeScript, no build step
- Test runner: `node --test`
- SPDX license header in every .js file
- Package manager: pnpm workspaces

## Test Counts (Session 9)
| Package | Tests |
|---------|-------|
| `@atrium/protocol` | 41 |
| `@atrium/som` | 19 |
| `@atrium/server` | 32 |
| **Total** | **92** |

Run with: `node --test packages/protocol/test/*.test.js packages/som/test/*.test.js packages/server/test/*.test.js`
(Top-level `npm test` fails on missing gltf-extension test — ignore it)

## Key Architecture

### Session identity (Session 9+)
- Client generates `sessionId = crypto.randomUUID()` on load
- `sessionId` = session identifier in SOP messages = avatar SOM node name
- `displayName = 'User-' + sessionId.slice(0, 4)`
- Server uses `msg.id` from `hello` as session ID (`session.id`)

### Connect sequence (Session 9+)
1. Client sends `hello` with `id: sessionId`
2. Server → `hello` response (echoes `id: sessionId`)
3. Server → `som-dump` (full glTF with all current avatar nodes)
4. Server → `join` broadcasts (presence, existing behavior)
5. Client sends `add` with full avatar node descriptor (capsule geometry)
6. Server adds to SOM, `broadcastExcept` `add` to others
7. Client starts sending `view` with `position`, `look`, `move`, `velocity`

### Disconnect sequence (Session 9+)
1. Server removes avatar SOM node by `session.avatarNodeName`
2. Server `broadcast` `remove { id: departedId }` (avatar removal)
3. Server `broadcast` `leave { id: departedId }` (presence, existing behavior)

### Avatar node
- `node.name = sessionId` (UUID)
- `node.extras.displayName = 'User-XXXX'`
- Geometry: CapsuleGeometry(0.3, 0.8, 4, 8), blue material
- Server tracks: `session.avatarNodeName = msg.node.name` on `add`

### SOM node lookup
- `som.getNodeByName(name)` — looks up by node.name (= sessionId for avatars)
- `som.ingestNode(descriptor)` — handles mesh geometry in node descriptors

## Key Files
- `packages/protocol/src/index.js` — Ajv validator, direction-aware for hello/view
- `packages/server/src/session.js` — WebSocket session, presence, SOM mutations
- `packages/server/src/world.js` — glTF-Transform wrapper, serialize(), ingestNode via SOM
- `packages/som/src/SOMDocument.js` — SOM API, `ingestNode()` handles mesh primitives
- `tests/fixtures/generate-space.js` — regenerate space.gltf (run from repo root)
- `tests/client/index.html` — single-file browser client

## Protocol Message Direction
- `hello`, `view` — direction-specific validators (`hello:client`, `view:server`, etc.)
- `som-dump` — server only, non-directional validator key `'som-dump'`
- All others — single schema regardless of direction

## NavigationInfo (Session 9+)
In `extras.atrium.world.navigation` (was bare string `"WALK"`):
```json
{
  "mode": ["WALK", "FLY", "ORBIT", "TELEPORT"],
  "terrainFollowing": true,
  "speed": { "default": 1.4, "min": 0.5, "max": 5.0 },
  "collision": { "enabled": false },
  "updateRate": { "positionInterval": 1000, "maxViewRate": 20 }
}
```

## Ports used in tests
- 3001: session.test.js main server
- 3002: (session.test.js world-full sub-server port + 1)
- 3003-3006: session.test.js integration tests
- 3008: avatar.test.js
