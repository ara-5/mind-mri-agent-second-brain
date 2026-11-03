# Changelog

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
