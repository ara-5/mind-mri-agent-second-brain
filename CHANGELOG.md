# Changelog

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
- `npm run ui` no longer builds a shell command from environment variables.
- Dashboard: added an inline favicon (the browser requested `/favicon.ico` and got a 404 on every load); verified in a real browser that the graph, Org Chart tab, search and node detail run with no JavaScript errors.
- Earlier hardening: path traversal, command injection in git sync, dashboard XSS, loopback-only binding, sandbox isolation, frontmatter round-tripping, multilingual search and tags, time-decay hiding old notes.

### Changed
- Licence is PolyForm Noncommercial 1.0.0.
- Agent and subdirectory names must be single safe path segments (no `/`, `\`, `:` and similar).
