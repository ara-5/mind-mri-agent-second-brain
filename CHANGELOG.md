# Changelog

## 1.7.1

### Fixed
- The MCP server could silently write to the wrong vault. It treated any healthy answer on the port as its own server, so with another Second Brain already running there (a dev server, an older install) notes went into that one's vault. `/health` now reports an opaque `vaultId`, and the MCP server refuses to run tools against a server whose vault does not match (or that is too old to report one), with a message explaining the fix. `brain_health` still works and reports the check. `BRAIN_ALLOW_ANY_VAULT=1` opts out.

## 1.7.0

### Added
- `brain_tasks_update` MCP tool and a `result` field on `PATCH /tasks/:id`: agents can now claim a task, complete or fail it with a recorded outcome, and completing a task releases the tasks blocked on it (a failed or cancelled dependency fails its dependents). Before, the MCP task queue could only add and list tasks, so nothing could ever finish.

### Changed
- Tool descriptions now name their sibling tools, state ordering and pagination, cover failure modes (unknown message recipients, duplicate sends) and say each rule once, following per-tool feedback from the Glama quality evaluation.

### Fixed
- `PATCH /tasks/:id` rewrote the tags of any note whose id you passed, task or not. It now returns 404 unless the note is a task.

## 1.6.1

### Changed
- Tool definitions rewritten so models (and registry quality scores) get what they need: every parameter described, real defaults and limits (`hops` 0-3, `maxTokens` up to 8000, search default 10), enums for `type` and task `status`, what each tool returns, when to use it instead of a neighbouring tool, and when it errors.

### Added
- `Dockerfile` and `.dockerignore` so registries such as Glama can build and run the server; CI builds the image and speaks MCP to it, including a real note write as the unprivileged user.

### Fixed
- An oversized request now reliably gets its `413` on Linux too (the connection used to be closed while the client was still uploading, so it failed with EPIPE).
- Removed `smithery.yaml`: Smithery shut down hosting, accounts and its CLI on 2026-10-31.

## 1.6.0

### Added
- `brain_node_update` MCP tool: append to or replace an existing note in place (version-checked, retries once on a concurrent edit), so agents can extend a note instead of creating near-duplicates. It is the only tool marked destructive, because `replace` overwrites text.
- README quick start with a real captured session, npm and CI badges.

### Fixed
- A request over the size limit now gets a clear `413` response. Before, the server reset the connection, which clients saw as an opaque "fetch failed". The rest of the upload is discarded within a byte and time budget, then the connection is closed.
- `brain_remember` no longer echoes the whole stored note back to the model (it returns id, title, type and version), saving tokens on every save.

## 1.5.1

### Fixed
- The MCP server no longer starts the API server as soon as a client connects. It starts on the first tool call, as documented, so connecting only to list tools (registry scanners, the MCP Inspector) leaves no background process behind.

## 1.5.0

### Added
- Publishable as an MCP server: package `mind-mri-second-brain`, `npx -y mind-mri-second-brain`, registry metadata (`server.json`, `smithery.yaml`, `glama.json`).
- `brain_messages_mark_read` tool and `POST /messages/read`.
- MCP tool titles and annotations (`readOnlyHint`, `destructiveHint`, …), server `instructions`, protocol-version negotiation.
- Incremental indexing: writes re-read only the changed files (about 300x faster at 3,000 notes).
- Release workflow that publishes to npm with provenance when a `v*` tag is pushed.

### Fixed
- Input validation: bad `agent`, `subdir`, task and message fields, and non-object JSON bodies now return 400 instead of 500.
- CLI reports the real failure instead of "Found 0 nodes", rejects non-numeric flags, and no longer prints stack traces.
- MCP rejects missing required arguments, answers unparseable input with a JSON-RPC error, handles a last line with no newline, and exits quietly when the client disconnects.
- Task queue: a prompt or result containing a line like `## Final Result` could make `appendResult` / `setFinalResult` cut the task body at the wrong place and destroy the prompt and earlier results. Section headings are now matched as whole lines and look-alike lines in caller text are escaped.
- Titles ending in a period or longer than 200 characters (for example a task prompt ending in ".") were rejected by the server; the SDK now normalizes them.
- `POST /dedup/scan` accepted a non-numeric `threshold`, which flagged every note pair as a duplicate and sent each one to the paid LLM judge. The threshold is now validated, and at most 25 pairs (`maxJudged`, up to 200) are judged per scan.
- Test suite no longer leaves temporary folders behind (it left about 18 per run); the embeddings database handle is released on exit.
- `npm run ui` no longer builds a shell command from environment variables.
- Dashboard: added an inline favicon (the browser requested `/favicon.ico` and got a 404 on every load); verified in a real browser that the graph, Org Chart tab, search and node detail run with no JavaScript errors.
- Earlier hardening: path traversal, command injection in git sync, dashboard XSS, loopback-only binding, sandbox isolation, frontmatter round-tripping, multilingual search and tags, time-decay hiding old notes.

### Changed
- Licence is now MIT (earlier releases were under PolyForm Noncommercial 1.0.0).
- Agent and subdirectory names must be single safe path segments (no `/`, `\`, `:` and similar).
