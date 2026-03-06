# Atrium — Running Decisions & Deferred Items

This document captures architectural decisions made during vibe coding sessions
and deferred items to address in future sessions. Feed it to Claude at the start
of each new session alongside the session briefs.

---

## Architectural Decisions

### HTTP serving — keep it separate from the Atrium server
**Decided:** Session 5 planning

The Atrium server (`packages/server`) is a WebSocket world state server only.
It will not serve static files (HTML, glTF assets) over HTTP. Adding HTTP
serving would bloat the server and violate its single responsibility.

In production: a standard web server (nginx, Caddy, etc.) serves static files;
the Atrium WebSocket server runs alongside it.

In local dev: `npx serve -l 5173 tests/` serves the test client. This is a
two-terminal workflow and that's fine. It requires no install and is a footnote,
not a problem worth solving.

A separate `packages/dev-server` was considered and rejected — complexity for
zero architectural benefit.

---

## Deferred Items

### README — add testing / dev workflow documentation
**Deferred:** Session 5

The README needs to be updated with testing and local dev workflow information,
OR it should reference a dedicated doc (e.g. `tests/TESTING.md`) that describes:
- How to run the test suite (`pnpm --filter @atrium/server test`)
- How to start the Atrium server
- How to serve the test client (`npx serve`)
- The two-terminal dev workflow
- How to run the magic moment smoke test end-to-end

Decide in a future session whether this lives in the README directly or in a
separate `tests/TESTING.md` that the README references. Lean toward a separate
doc to keep the README high-level.

---
