// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

let globalSeq = 0

export function createTickLoop(session, intervalMs) {
  const id = setInterval(() => {
    if (session.ws.readyState === session.ws.OPEN) {
      globalSeq += 1
      session.ws.send(JSON.stringify({
        type: 'tick',
        seq: globalSeq,
        serverTime: Date.now(),
      }))
    }
  }, intervalMs)

  return {
    stop() {
      clearInterval(id)
    },
  }
}
