# Security

## Reporting a vulnerability

Please report security problems privately through GitHub's
"Report a vulnerability" button on the repository's Security tab, rather than in a
public issue. Include what you found, how to reproduce it, and the version
(`npm ls mind-mri-second-brain` or the `version` field of `GET /health`).

## Security model

- **Local by default.** The API server binds to `127.0.0.1` and sends no CORS
  headers. Exposing it on a network (`BRAIN_HOST=0.0.0.0`) is your choice; if you
  do, set `BRAIN_KEY` so every request needs a Bearer token.
- **Notes are untrusted data.** Anything stored in the vault can be read back into
  a model's context. The recall prompt frames notes as reference data, not
  instructions, but a malicious note can still try to steer a model. Do not point
  the server at a vault you do not trust.
- **Writes stay inside the vault.** Agent names, folders and titles are validated
  as single safe path segments, and resolved paths are checked against the vault
  root.
- **Code execution is opt-in and isolated.** `POST /sandbox/execute` uses Docker
  with networking disabled and CPU, memory and process limits. Without Docker it
  refuses to run unless `SANDBOX_ALLOW_LOCAL=1` is set, and that fallback is a
  keyword filter, not a sandbox. Only enable it in a trusted environment.
- **Secrets.** Provider API keys are read from the environment and sent in headers,
  never in URLs. Notes are stored exactly as written: nothing scans them for
  secrets automatically, and git sync (opt-in, `AUTO_GIT_SYNC=true`) commits them as-is. `sdk/safeguard.js`
  (`sanitizeContent`) is available if you want to redact text before saving it, but
  it is not wired in by default, so do not put credentials in notes, especially if
  git sync pushes the vault to a remote.
- **Known limits.** `/stream` accepts its token as a query parameter (browsers'
  EventSource cannot set headers), so it can appear in access logs of any proxy
  you put in front. The dashboard sets no Content-Security-Policy.
