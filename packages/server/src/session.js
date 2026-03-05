// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { WebSocketServer } from 'ws'
import { randomUUID } from 'crypto'
import { validate } from '@atrium/protocol'
import { createTickLoop } from './tick.js'

const MIN_TICK_INTERVAL = 50
const DEFAULT_TICK_INTERVAL = 1000
const KEEPALIVE_INTERVAL = 30_000

let serverSeq = 0

function nextSeq() {
  return ++serverSeq
}

function sendError(ws, seq, code, message) {
  ws.send(JSON.stringify({ type: 'error', code, message, ...(seq != null ? { seq } : {}) }))
}

export function createSessionServer({ port = 3000, maxUsers = 100 } = {}) {
  const sessions = new Map()
  const wss = new WebSocketServer({ port })

  wss.on('connection', (ws) => {
    let session = null

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw)
      } catch {
        sendError(ws, null, 'UNKNOWN_MESSAGE', 'Invalid JSON')
        return
      }

      const { valid, errors } = validate('client', msg)
      if (!valid) {
        const detail = errors[0]?.message ?? 'Validation failed'
        sendError(ws, msg.seq ?? null, 'UNKNOWN_MESSAGE', detail)
        return
      }

      if (!session && msg.type !== 'hello') {
        sendError(ws, msg.seq ?? null, 'AUTH_FAILED', 'Handshake required')
        return
      }

      switch (msg.type) {
        case 'hello': {
          if (sessions.size >= maxUsers) {
            sendError(ws, null, 'WORLD_FULL', 'Server is full')
            ws.close()
            return
          }

          const clientInterval = msg.capabilities?.tick?.interval ?? DEFAULT_TICK_INTERVAL
          const negotiated = Math.max(clientInterval, MIN_TICK_INTERVAL)

          session = {
            ws,
            id: randomUUID(),
            capabilities: msg.capabilities ?? {},
            seq: nextSeq(),
            alive: true,
            tickStop: null,
          }
          sessions.set(session.id, session)

          ws.send(JSON.stringify({
            type: 'hello',
            id: session.id,
            seq: session.seq,
            serverTime: Date.now(),
            capabilities: {
              tick: { interval: negotiated, minInterval: MIN_TICK_INTERVAL },
            },
          }))

          session.tickStop = createTickLoop(session, negotiated).stop
          break
        }

        case 'ping': {
          ws.send(JSON.stringify({
            type: 'pong',
            clientTime: msg.clientTime,
            serverTime: Date.now(),
          }))
          break
        }

        default:
          sendError(ws, msg.seq ?? null, 'UNKNOWN_MESSAGE', `Unhandled message type: ${msg.type}`)
      }
    })

    ws.on('close', () => {
      if (session) {
        session.tickStop?.()
        sessions.delete(session.id)
        session = null
      }
    })

    ws.on('pong', () => {
      if (session) session.alive = true
    })
  })

  const keepaliveTimer = setInterval(() => {
    for (const [id, s] of sessions) {
      if (!s.alive) {
        s.ws.terminate()
        sessions.delete(id)
      } else {
        s.alive = false
        s.ws.ping()
      }
    }
  }, KEEPALIVE_INTERVAL)

  wss.on('close', () => {
    clearInterval(keepaliveTimer)
  })

  return { wss, sessions }
}
