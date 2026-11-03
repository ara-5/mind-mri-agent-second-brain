/**
 * A short, opaque identifier for a vault folder.
 *
 * The API server reports it in /health and the MCP server computes the one it
 * expects, so the MCP server can tell whether the server answering on a port is
 * using the vault it was configured for. It is a hash, so /health does not leak
 * the absolute path.
 */
import crypto from 'node:crypto';
import path from 'node:path';

export function vaultIdFor(dir) {
  const normalized = path.resolve(dir).replace(/\\/g, '/').replace(/\/+$/, '');
  // Windows paths are case-insensitive, and the same folder is often spelled
  // with a different drive-letter case.
  const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}
