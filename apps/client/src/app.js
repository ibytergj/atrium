// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'
import { WebIO } from '@gltf-transform/core'
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import { DocumentView } from '@gltf-transform/view'
import { AtriumClient } from '@atrium/client'

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const worldUrlInput = document.getElementById('worldUrl')
const wsUrlInput    = document.getElementById('wsUrl')
const loadBtn       = document.getElementById('loadBtn')
const connectBtn    = document.getElementById('connectBtn')
const statusDot     = document.getElementById('statusDot')
const viewportEl    = document.getElementById('viewport')
const overlayEl     = document.getElementById('overlay')
const hudWorldEl    = document.getElementById('hud-world')
const hudYouEl      = document.getElementById('hud-you')
const hudPeersEl    = document.getElementById('hud-peers')

// ---------------------------------------------------------------------------
// Three.js renderer / scene
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.shadowMap.enabled = true
viewportEl.appendChild(renderer.domElement)

const threeScene = new THREE.Scene()
threeScene.background = new THREE.Color(0x1a1a2e)

// Ambient + directional light
threeScene.add(new THREE.AmbientLight(0xffffff, 0.6))
const sun = new THREE.DirectionalLight(0xffffff, 1.2)
sun.position.set(5, 10, 5)
sun.castShadow = true
threeScene.add(sun)

// Grid helper
threeScene.add(new THREE.GridHelper(40, 40, 0x333333, 0x222222))

// Camera
const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 1000)
camera.position.set(0, 1.6, 4)

// ---------------------------------------------------------------------------
// Third-person camera constants
// ---------------------------------------------------------------------------

const CAMERA_OFFSET_Y = 2.0   // meters above avatar
const CAMERA_OFFSET_Z = 4.0   // meters behind avatar (+Z = behind in glTF right-handed)

// ---------------------------------------------------------------------------
// Navigation mode
// ---------------------------------------------------------------------------

const USE_POINTER_LOCK = false  // true = FPS pointer-lock, false = drag-to-look

// Resize handler
function onResize() {
  const w = viewportEl.clientWidth
  const h = viewportEl.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', onResize)
onResize()

// ---------------------------------------------------------------------------
// DocumentView — bridges SOM → Three.js
// ---------------------------------------------------------------------------

let docView = null
let sceneGroup = null

function initDocumentView(somDocument) {
  if (docView) { docView.dispose(); threeScene.remove(sceneGroup) }
  docView    = new DocumentView(renderer)

  const sceneDef = somDocument.document.getRoot().listScenes()[0]
  sceneGroup = docView.view(sceneDef)
  threeScene.add(sceneGroup)
}

// ---------------------------------------------------------------------------
// Peer avatar meshes (managed directly, bypassing DocumentView for v0.1)
// ---------------------------------------------------------------------------

const peerMeshes = new Map()  // displayName → THREE.Mesh

function buildCapsuleMesh() {
  const geo = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8)
  const color = [Math.random() * 0.5 + 0.5, Math.random() * 0.5 + 0.5, Math.random() * 0.5 + 0.5, 1]
  const mat = new THREE.MeshStandardMaterial({ color: color })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  return mesh
}

function addPeerMesh(displayName) {
  if (peerMeshes.has(displayName)) return
  const mesh = buildCapsuleMesh()
  mesh.position.set(0, 0.7, 0)
  threeScene.add(mesh)
  peerMeshes.set(displayName, mesh)
}

function removePeerMesh(displayName) {
  const mesh = peerMeshes.get(displayName)
  if (mesh) {
    threeScene.remove(mesh)
    mesh.geometry.dispose()
    mesh.material.dispose()
    peerMeshes.delete(displayName)
  }
}

function updatePeerMesh(displayName, position, look) {
  const mesh = peerMeshes.get(displayName)
  if (!mesh) return
  if (position) mesh.position.set(...position)
  if (look) {
    // Rotate Y-up capsule to face look direction
    const target = new THREE.Vector3(...look)
    const dummy  = new THREE.Object3D()
    dummy.position.copy(mesh.position)
    dummy.lookAt(dummy.position.clone().add(target))
    mesh.quaternion.copy(dummy.quaternion)
  }
}

// ---------------------------------------------------------------------------
// Avatar capsule descriptor (sent to server via AtriumClient)
// ---------------------------------------------------------------------------

function buildAvatarDescriptor(name) {
  const geo     = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8)
  const positions = Array.from(geo.attributes.position.array)
  const normals   = Array.from(geo.attributes.normal.array)
  const indices   = Array.from(geo.index.array)
  geo.dispose()

  const color = [Math.random() * 0.5 + 0.5, Math.random() * 0.5 + 0.5, Math.random() * 0.5 + 0.5, 1]

  return {
//    name,
    translation: [0, 0.7, 0],
    extras: { displayName: name },
    mesh: {
      primitives: [{
        attributes: { POSITION: positions, NORMAL: normals },
        indices,
        material: {
          pbrMetallicRoughness: {
            baseColorFactor: color,
            metallicFactor:  0.0,
            roughnessFactor: 0.7,
          },
        },
      }],
    },
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

function updateHud() {
  hudPeersEl.textContent = client.connected
    ? `Peers: ${peerMeshes.size}`
    : ''
  hudYouEl.textContent = client.connected && client.displayName
    ? `You: ${client.displayName}`
    : ''
}

// ---------------------------------------------------------------------------
// Connection state UI
// ---------------------------------------------------------------------------

function setConnectionState(state) {
  statusDot.className = 'status-dot ' + state

  if (state === 'connecting') {
    connectBtn.textContent = 'Connecting...'
    connectBtn.disabled    = true
  } else if (state === 'connected') {
    connectBtn.textContent = 'Disconnect'
    connectBtn.disabled    = false
  } else {
    // disconnected or error
    connectBtn.textContent = 'Connect'
    connectBtn.disabled    = false
  }

  updateHud()
}

// ---------------------------------------------------------------------------
// AtriumClient
// ---------------------------------------------------------------------------

const client = new AtriumClient({ debug: false })
window.atriumClient = client   // expose for manual console testing

// Local avatar and camera child nodes — set on world:loaded (when connected)
let localAvatarNode  = null
let localCameraNode  = null

client.on('world:loaded', ({ name, description, author }) => {
  if (!client.som) return
  initDocumentView(client.som)

  // HUD world line
  hudWorldEl.textContent = name ? `World: ${name}` : ''

  // Console metadata
  console.log(`[app] World: ${name ?? '(unnamed)'}${author ? ` by ${author}` : ''}`)
  if (description) console.log(`[app]   ${description}`)

  if (client.connected) {
    const displayName = client.displayName
    localAvatarNode = client.som.getNodeByName(displayName)
    if (!localAvatarNode) return

    // Create a local-only camera child node with third-person offset
    localCameraNode = client.som.createNode({
      name:        `${displayName}-camera`,
      translation: [0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z],
    })
    localAvatarNode.addChild(localCameraNode)
  }
})

client.on('session:ready', () => {
  setConnectionState('connected')
  updateHud()
})

client.on('peer:join', ({ displayName }) => {
  addPeerMesh(displayName)
  updateHud()
  console.log(`[app] Peer joined: ${displayName} (${peerMeshes.size} peer${peerMeshes.size === 1 ? '' : 's'})`)
})

client.on('peer:leave', ({ displayName }) => {
  removePeerMesh(displayName)
  updateHud()
  console.log(`[app] Peer left: ${displayName} (${peerMeshes.size} peer${peerMeshes.size === 1 ? '' : 's'})`)
})

client.on('peer:view', ({ displayName, position, look }) => {
  updatePeerMesh(displayName, position, look)
})

client.on('disconnected', () => {
  localAvatarNode = null
  localCameraNode = null
  setConnectionState('disconnected')
})
client.on('error', (err) => {
  console.error('[app] client error:', err)
  setConnectionState('error')
})

// ---------------------------------------------------------------------------
// UI actions
// ---------------------------------------------------------------------------

loadBtn.addEventListener('click', async () => {
  const url = worldUrlInput.value.trim()
  if (!url) return
  loadBtn.disabled = true
  overlayEl.textContent = 'Loading…'
  try {
    await client.loadWorld(url)
    overlayEl.textContent = USE_POINTER_LOCK
      ? 'Click to capture mouse · WASD to move · Mouse to look · Esc to release'
      : 'Drag to look · WASD to move'
  } catch (err) {
    overlayEl.textContent = 'Load failed: ' + err.message
    console.error(err)
  } finally {
    loadBtn.disabled = false
  }
})

connectBtn.addEventListener('click', () => {
  if (client.connected) {
    client.disconnect()
    return
  }
  const wsUrl = wsUrlInput.value.trim()
  if (!wsUrl) return
  setConnectionState('connecting')
  const avatar = buildAvatarDescriptor()
  client.connect(wsUrl, { avatar })
})

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const keys      = new Set()
let yaw         = 0    // radians
let pitch       = 0    // radians, clamped
let pointerLock = false
let dragging    = false

const SPEED   = 1.4  // m/s default
const TICK_MS = 1000 / 60

if (USE_POINTER_LOCK) {
  viewportEl.addEventListener('click', () => { viewportEl.requestPointerLock() })
  document.addEventListener('pointerlockchange', () => {
    pointerLock = document.pointerLockElement === viewportEl
  })
  document.addEventListener('mousemove', (e) => {
    if (!pointerLock) return
    yaw   -= e.movementX * 0.002
    pitch -= e.movementY * 0.002
    pitch  = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, pitch))
  })
} else {
  viewportEl.addEventListener('mousedown', () => { dragging = true })
  document.addEventListener('mouseup',     () => { dragging = false })
  document.addEventListener('mousemove',   (e) => {
    if (!dragging) return
    yaw   -= e.movementX * 0.002
    pitch -= e.movementY * 0.002
    pitch  = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, pitch))
  })
}

document.addEventListener('keydown', (e) => { keys.add(e.code) })
document.addEventListener('keyup',   (e) => { keys.delete(e.code) })

// Euler → look vector (glTF forward is -Z)
function getLookVector() {
  const x = Math.sin(yaw) * Math.cos(pitch)
  const y = Math.sin(pitch)
  const z = -Math.cos(yaw) * Math.cos(pitch)
  return [x, y, z]
}

function getMoveVector() {
  const fwd = keys.has('KeyW') || keys.has('ArrowUp')
  const bwd = keys.has('KeyS') || keys.has('ArrowDown')
  const lft = keys.has('KeyA') || keys.has('ArrowLeft')
  const rgt = keys.has('KeyD') || keys.has('ArrowRight')

  let dx = 0, dz = 0
  if (fwd) dz -= 1
  if (bwd) dz += 1
  if (lft) dx -= 1
  if (rgt) dx += 1

  const len = Math.sqrt(dx * dx + dz * dz)
  if (len === 0) return null
  return [dx / len, 0, dz / len]
}

let lastTick = performance.now()

function tick(now) {
  requestAnimationFrame(tick)

  const dt = (now - lastTick) / 1000
  lastTick = now

  const qYaw   = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
  const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch)

  const move = getMoveVector()

  if (localAvatarNode) {
    // Navigation drives SOM nodes
    localAvatarNode.rotation = [qYaw.x, qYaw.y, qYaw.z, qYaw.w]

    if (move) {
      const speed   = SPEED * dt
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(qYaw)
      const right   = new THREE.Vector3(1, 0, 0).applyQuaternion(qYaw)
      const pos     = localAvatarNode.translation ?? [0, 0.7, 0]
      localAvatarNode.translation = [
        pos[0] + forward.x * (-move[2] * speed) + right.x * (move[0] * speed),
        Math.max(0.7, pos[1]),
        pos[2] + forward.z * (-move[2] * speed) + right.z * (move[0] * speed),
      ]
    }

    if (localCameraNode) {
      localCameraNode.rotation = [qPitch.x, qPitch.y, qPitch.z, qPitch.w]
    }

    // Sync Three.js camera from SOM state (third-person)
    const avatarPos = localAvatarNode.translation ?? [0, 0.7, 0]
    const offset    = new THREE.Vector3(0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z)
    offset.applyQuaternion(qYaw)
    camera.position.set(
      avatarPos[0] + offset.x,
      avatarPos[1] + offset.y,
      avatarPos[2] + offset.z,
    )
    const lookTarget = new THREE.Vector3(avatarPos[0], avatarPos[1] + 1.0, avatarPos[2])
    camera.lookAt(lookTarget)
    // Apply pitch tilt on top of lookAt
    camera.rotateX(pitch)

    // Report view state
    const avatarLook = [Math.sin(yaw), 0, -Math.cos(yaw)]
    const position   = [...avatarPos]
    client.setView({
      position,
      look:     avatarLook,
      move:     move ?? [0, 0, 0],
      velocity: move ? SPEED : 0,
    })
  } else {
    // No avatar yet (static mode / pre-connect) — drive camera directly
    camera.quaternion.copy(qYaw).multiply(qPitch)
    if (move) {
      const speed   = SPEED * dt
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(qYaw)
      const right   = new THREE.Vector3(1, 0, 0).applyQuaternion(qYaw)
      camera.position.addScaledVector(forward, -move[2] * speed)
      camera.position.addScaledVector(right,    move[0] * speed)
      camera.position.y = Math.max(0.2, camera.position.y)
    }
    const look     = getLookVector()
    const position = [camera.position.x, camera.position.y, camera.position.z]
    client.setView({
      position,
      look,
      move:     move ?? [0, 0, 0],
      velocity: move ? SPEED : 0,
    })
  }

  // Render
  // if (docView) docView.render()
  renderer.render(threeScene, camera)
}

requestAnimationFrame(tick)
