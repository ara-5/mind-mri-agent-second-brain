/**
 * ══════════════════════════════════════════════════════════════
 *  SECOND BRAIN — Vault Git Sync
 *
 *  Auto-commits and pushes SPECIFIC vault file changes after a write,
 *  serialized so concurrent writes don't race on .git/index.lock (a
 *  single busy swarm task can trigger several writes within a second).
 *
 *  Deliberately stages only the paths the caller says changed, never the
 *  whole vault folder — `git add <wholeVault>` sweeps up ANY other
 *  unrelated in-progress edit sitting uncommitted at that moment into
 *  whatever commit fires next, bundling unrelated in-flight edits under a
 *  confusingly unrelated commit message. See test/git_sync.test.js for the
 *  regression test this guards against.
 * ══════════════════════════════════════════════════════════════
 */
import path from 'path';
import { execFile as defaultExecFile } from 'child_process';

/**
 * @param {string} vaultDir - absolute path to the vault folder
 * @param {object} [options]
 * @param {boolean} [options.enabled] - if false, gitSync() is a no-op (matches AUTO_GIT_SYNC)
 * @param {Function} [options.execFile] - injectable in place of child_process.execFile, for tests
 * @param {Function} [options.onError] - (err, command) => void, called when a sync fails
 * @param {Function} [options.onSuccess] - (message) => void, called when a sync succeeds
 */
export function createGitSync(vaultDir, options = {}) {
  const runExecFile = options.execFile || defaultExecFile;
  const enabled = options.enabled ?? true;
  let busy = false;
  let queued = null; // { message, paths: Set<string> } | null

  // Absolute filesystem path -> path relative to the vault folder, suitable
  // for `git add <vaultFolderName>/<this>`.
  function toVaultRelativePath(absPath) {
    return path.relative(vaultDir, absPath).replace(/\\/g, '/');
  }

  function runSync(message, paths) {
    busy = true;
    const vaultFolderName = path.basename(vaultDir);
    // Note: the embedding cache (.embeddings.db) is deliberately NOT folded
    // in here — it's gitignored (regenerable from vault content), so
    // there's nothing to stage for it even if a caller asked.
    const addTargets = paths.length
      ? paths.map(p => path.posix.join(vaultFolderName, p))
      : [vaultFolderName];
    // Each step is its own argv-style git invocation (no shell), because the
    // commit message and file names carry agent-controlled text (node titles,
    // task prompts) that a shell would otherwise interpret (`$(...)`, backticks).
    const steps = [
      ['pull', 'origin', 'main'],
      ['add', '--', ...addTargets],
      ['commit', '-m', message],
      ['push', 'origin', 'main'],
    ];
    const command = steps.map(a => ['git', ...a].join(' ')).join(' && ');
    const projectRoot = path.resolve(vaultDir, '..');

    function runSteps(i, cb) {
      if (i >= steps.length) return cb(null);
      runExecFile('git', steps[i], { cwd: projectRoot }, (err) => (err ? cb(err) : runSteps(i + 1, cb)));
    }

    return new Promise((resolve) => {
      runSteps(0, (err) => {
        busy = false;
        if (err) options.onError?.(err, command);
        else options.onSuccess?.(message);

        if (queued) {
          const next = queued;
          queued = null;
          runSync(next.message, [...next.paths]).then(resolve);
        } else {
          resolve({ error: err || null, command });
        }
      });
    });
  }

  /**
   * @param {string}   message
   * @param {string[]} [paths] - vault-relative paths (see toVaultRelativePath)
   *   of exactly what changed. Omitting this falls back to staging the
   *   whole vault folder — only appropriate for a caller that genuinely
   *   doesn't know which files moved.
   * @returns {Promise<{error, command}>|undefined} resolves once this sync
   *   (and any it absorbed while running) settles; production callers can
   *   ignore the return value, tests can await it.
   */
  function gitSync(message, paths) {
    if (!enabled) return;
    if (busy) {
      if (!queued) queued = { message, paths: new Set(paths || []) };
      else {
        queued.message = message; // last message wins
        for (const p of paths || []) queued.paths.add(p);
      }
      return;
    }
    return runSync(message, paths || []);
  }

  return { gitSync, toVaultRelativePath };
}
