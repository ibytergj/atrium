// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { NodeIO } from '@gltf-transform/core'

const ALLOWED_FIELDS = new Set(['translation', 'rotation', 'scale', 'extras'])

export async function createWorld(gltfPath) {
  const io = new NodeIO()
  const document = await io.read(gltfPath)

  const rootExtras = document.getRoot().getExtras()
  const meta = rootExtras?.atrium?.world ?? {}

  function getNode(name) {
    return document.getRoot().listNodes().find((n) => n.getName() === name) ?? null
  }

  function setField(nodeName, field, value) {
    const node = getNode(nodeName)
    if (!node) return { ok: false, code: 'NODE_NOT_FOUND' }

    if (!ALLOWED_FIELDS.has(field)) return { ok: false, code: 'INVALID_FIELD' }

    switch (field) {
      case 'translation': node.setTranslation(value); break
      case 'rotation':    node.setRotation(value);    break
      case 'scale':       node.setScale(value);       break
      case 'extras':      node.setExtras(value);      break
    }

    return { ok: true }
  }

  function addNode(nodeDescriptor, parentName) {
    const node = document.createNode(nodeDescriptor.name)

    if (nodeDescriptor.translation) node.setTranslation(nodeDescriptor.translation)
    if (nodeDescriptor.rotation)    node.setRotation(nodeDescriptor.rotation)
    if (nodeDescriptor.scale)       node.setScale(nodeDescriptor.scale)
    if (nodeDescriptor.extras)      node.setExtras(nodeDescriptor.extras)

    if (parentName) {
      const parent = getNode(parentName)
      if (!parent) return { ok: false, code: 'NODE_NOT_FOUND' }
      parent.addChild(node)
    } else {
      const scene = document.getRoot().listScenes()[0]
      if (scene) scene.addChild(node)
    }

    return { ok: true, node }
  }

  function removeNode(nodeName) {
    const node = getNode(nodeName)
    if (!node) return { ok: false, code: 'NODE_NOT_FOUND' }
    node.dispose()
    return { ok: true }
  }

  function getNodeTranslation(name) {
    const node = getNode(name)
    if (!node) return null
    return [...node.getTranslation()]
  }

  function listNodeNames() {
    return document.getRoot().listNodes().map((n) => n.getName())
  }

  return { meta, getNode, setField, addNode, removeNode, getNodeTranslation, listNodeNames }
}
