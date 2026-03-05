// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { createSessionServer } from './session.js'

createSessionServer({ port: 3000 })
console.log('Atrium server listening on ws://localhost:3000')
