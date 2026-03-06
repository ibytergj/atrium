// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

export function createPresence() {
  const clients = new Map()

  function add(id) {
    const entry = { id, joinedAt: Date.now(), position: [0, 0, 0] }
    clients.set(id, entry)
    return entry
  }

  function setPosition(id, position) {
    const entry = clients.get(id)
    if (!entry) return null
    entry.position = position
    return entry
  }

  function remove(id) {
    const entry = clients.get(id) ?? null
    clients.delete(id)
    return entry
  }

  function get(id) {
    return clients.get(id) ?? null
  }

  function list() {
    return Array.from(clients.values())
  }

  function has(id) {
    return clients.has(id)
  }

  return { add, remove, get, list, has, setPosition }
}
