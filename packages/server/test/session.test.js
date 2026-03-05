// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { createSessionServer } from '../src/session.js'

const PORT = 3001

let server

before(() => {
  server = createSessionServer({ port: PORT, maxUsers: 20 })
})

after(() => {
  return new Promise((resolve) => server.wss.close(resolve))
})

function connect() {
  return new WebSocket(`ws://localhost:${PORT}`)
}

function waitForMessage(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => {
      try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
    })
    ws.once('error', reject)
  })
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve()
    ws.once('open', resolve)
    ws.once('error', reject)
  })
}

function waitForClose(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve()
    ws.once('close', resolve)
  })
}

async function handshake(ws, opts = {}) {
  await waitForOpen(ws)
  ws.send(JSON.stringify({
    type: 'hello',
    id: opts.clientId ?? 'test-client',
    capabilities: { tick: { interval: opts.interval ?? 5000 } },
  }))
  return waitForMessage(ws)
}

test('completes hello handshake', async () => {
  const ws = connect()
  const reply = await handshake(ws)

  assert.equal(reply.type, 'hello')
  assert.ok(typeof reply.id === 'string' && reply.id.length > 0)
  assert.ok(typeof reply.seq === 'number')
  assert.ok(typeof reply.serverTime === 'number')

  ws.close()
  await waitForClose(ws)
})

test('server hello contains negotiated tick interval', async () => {
  const ws = connect()
  await waitForOpen(ws)
  ws.send(JSON.stringify({
    type: 'hello',
    id: 'test-client-2',
    capabilities: { tick: { interval: 2000 } },
  }))
  const reply = await waitForMessage(ws)

  assert.equal(reply.type, 'hello')
  assert.ok(reply.capabilities?.tick?.interval >= 50)

  ws.close()
  await waitForClose(ws)
})

test('rejects message before hello with AUTH_FAILED', async () => {
  const ws = connect()
  await waitForOpen(ws)
  ws.send(JSON.stringify({ type: 'send', seq: 1, node: 'x', field: 'translation', value: [0, 0, 0] }))
  const reply = await waitForMessage(ws)

  assert.equal(reply.type, 'error')
  assert.equal(reply.code, 'AUTH_FAILED')

  ws.close()
  await waitForClose(ws)
})

test('responds to ping with pong', async () => {
  const ws = connect()
  await handshake(ws)

  const clientTime = Date.now()
  ws.send(JSON.stringify({ type: 'ping', clientTime }))
  const reply = await waitForMessage(ws)

  assert.equal(reply.type, 'pong')
  assert.equal(reply.clientTime, clientTime)
  assert.ok(typeof reply.serverTime === 'number')

  ws.close()
  await waitForClose(ws)
})

test('sends tick messages after handshake', async () => {
  const ws = connect()
  await waitForOpen(ws)
  ws.send(JSON.stringify({
    type: 'hello',
    id: 'tick-test-client',
    capabilities: { tick: { interval: 100 } },
  }))

  // consume the hello reply
  await waitForMessage(ws)

  // wait for at least one tick
  const tick = await waitForMessage(ws)

  assert.equal(tick.type, 'tick')
  assert.ok(typeof tick.seq === 'number')
  assert.ok(typeof tick.serverTime === 'number')

  ws.close()
  await waitForClose(ws)
})

test('rejects connection when world full', async () => {
  const fullServer = createSessionServer({ port: PORT + 1, maxUsers: 1 })

  const ws1 = new WebSocket(`ws://localhost:${PORT + 1}`)
  await handshake(ws1)

  const ws2 = new WebSocket(`ws://localhost:${PORT + 1}`)
  await waitForOpen(ws2)
  ws2.send(JSON.stringify({ type: 'hello', id: 'second-client' }))
  const reply = await waitForMessage(ws2)

  assert.equal(reply.type, 'error')
  assert.equal(reply.code, 'WORLD_FULL')

  ws1.close()
  ws2.close()
  await Promise.all([waitForClose(ws1), waitForClose(ws2)])
  await new Promise((resolve) => fullServer.wss.close(resolve))
})

test('handles client disconnect cleanly', async () => {
  const ws = connect()
  const serverHello = await handshake(ws)

  // Session should be registered after handshake
  assert.ok(server.sessions.has(serverHello.id), 'session should be in sessions map after handshake')

  ws.close()
  await waitForClose(ws)

  // Give the server a tick to process the close event
  await new Promise((r) => setTimeout(r, 100))

  assert.ok(!server.sessions.has(serverHello.id), 'session should be removed from sessions map after disconnect')
})
