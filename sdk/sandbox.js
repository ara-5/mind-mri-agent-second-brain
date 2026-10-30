/**
 * ══════════════════════════════════════════════════════════════
 *  SECOND BRAIN — Sandboxed Code Execution
 *
 *  Runs a short Python/JavaScript snippet in an isolated environment.
 *  Prefers Docker (network-disabled, memory-capped, auto-removed
 *  container) when the Docker daemon is reachable; otherwise falls
 *  back to a restricted local child process with a keyword blacklist
 *  and a hard timeout. Neither path is a required dependency — with
 *  no Docker installed, this degrades to the local fallback rather
 *  than failing to load.
 * ══════════════════════════════════════════════════════════════
 */
import fs from 'fs';
import path from 'path';
import { exec, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = process.env.SANDBOX_WORKSPACE
  ? path.resolve(process.env.SANDBOX_WORKSPACE)
  : path.resolve(__dirname, '..', 'sandbox_workspace');

if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}
// The container runs with every capability dropped, so root inside it is subject
// to normal file permissions: a private (0700) workspace, such as one made by
// mkdtemp, would make the mounted script unreadable ("Cannot find module").
// The folder only ever holds the snippet being run. No-op on Windows.
try { fs.chmodSync(WORKSPACE_DIR, 0o755); } catch { /* not ours to change, or unsupported */ }

/**
 * Detect the available Python binary on this system.
 * Tries python3 first (Linux/macOS default), then python, then py (Windows launcher).
 */
function detectPythonBin() {
  for (const bin of ['python3', 'python', 'py']) {
    try {
      execSync(`${bin} --version`, { stdio: 'ignore', timeout: 2000 });
      return bin;
    } catch {}
  }
  return 'python'; // last resort — will fail with a clear error
}

const PYTHON_BIN = detectPythonBin();

/**
 * Check if the Docker daemon is running and responsive.
 */
// `docker info` can take a couple of seconds on a busy machine. A timeout that was
// too short made a healthy daemon look absent, which refuses the run (or, with
// SANDBOX_ALLOW_LOCAL=1, silently downgrades it to unsandboxed execution). The
// answer is cached briefly so a single request, and the callers that ask twice,
// agree with each other and don't pay for the probe on every call.
const DOCKER_PROBE_TIMEOUT_MS = 8000;
const DOCKER_CACHE_UP_MS = 30_000;
const DOCKER_CACHE_DOWN_MS = 5_000;
let dockerProbe = { at: 0, up: false };

export function isDockerRunning() {
  const age = Date.now() - dockerProbe.at;
  if (dockerProbe.at && age < (dockerProbe.up ? DOCKER_CACHE_UP_MS : DOCKER_CACHE_DOWN_MS)) return dockerProbe.up;
  let up = false;
  try {
    execSync('docker info', { stdio: 'ignore', timeout: DOCKER_PROBE_TIMEOUT_MS });
    up = true;
  } catch { /* not installed, not running, or not responding */ }
  dockerProbe = { at: Date.now(), up };
  return up;
}

function isCodeSafe(code, language) {
  const lowerCode = code.toLowerCase();

  if (language === 'javascript') {
    const blacklist = [
      'child_process', 'exec', 'spawn', 'fork', 'execfile', 'execsync',
      'fs.unlink', 'fs.rmdir', 'fs.rm', 'fs.promises', 'process.env', 'process.exit',
    ];
    for (const word of blacklist) {
      if (lowerCode.includes(word.toLowerCase())) {
        return { safe: false, reason: `Use of restricted JavaScript keyword/module: "${word}"` };
      }
    }
  } else if (language === 'python') {
    const blacklist = [
      'os.system', 'subprocess', 'shutil', 'os.remove', 'os.rmdir', 'os.unlink',
      'os.environ', 'sys.exit', 'eval(', 'exec(',
    ];
    for (const word of blacklist) {
      if (lowerCode.includes(word.toLowerCase())) {
        return { safe: false, reason: `Use of restricted Python keyword/module: "${word}"` };
      }
    }
  }
  return { safe: true };
}

/**
 * Execute a snippet of code in a secure sandbox.
 * @param {string} code - The code snippet to run
 * @param {string} language - 'python' or 'javascript'
 * @param {number} timeoutMs - Execution timeout limit (default: 5000ms)
 * @returns {Promise<{success: boolean, stdout: string, stderr: string, runner: string}>}
 */
export async function executeCode(code, language, timeoutMs = 5000) {
  const isDocker = isDockerRunning();
  const runner = isDocker ? 'docker' : 'local-child-process';

  if (!isDocker) {
    // A keyword blacklist is not a security boundary (string concatenation,
    // aliasing, etc. bypass it), so the local fallback is opt-in only.
    if (process.env.SANDBOX_ALLOW_LOCAL !== '1') {
      return {
        success: false,
        stdout: '',
        stderr: 'Sandbox unavailable: Docker is not running. The unisolated local fallback is disabled by default; set SANDBOX_ALLOW_LOCAL=1 to enable it ONLY in a trusted environment.',
        runner,
      };
    }
    const check = isCodeSafe(code, language);
    if (!check.safe) {
      return {
        success: false,
        stdout: '',
        stderr: `Security block: ${check.reason}. Install/enable Docker for isolated, network-disabled execution instead of the keyword-blacklist fallback.`,
        runner,
      };
    }
  }

  const ext = language === 'python' ? 'py' : 'js';
  const tempFilename = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const hostFilePath = path.join(WORKSPACE_DIR, tempFilename);

  fs.writeFileSync(hostFilePath, code, 'utf8');

  const containerName = `sandbox_${tempFilename.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;

  return new Promise((resolve) => {
    let command = '';

    if (isDocker) {
      // Resolve absolute path for Docker volume mounting (converting backslashes to forward slashes for Windows compatibility)
      const absMountSource = path.resolve(WORKSPACE_DIR).replace(/\\/g, '/');
      const image = language === 'python' ? 'python:3.12-slim' : 'node:22-alpine';
      const execCmd = language === 'python' ? `python /app/${tempFilename}` : `node /app/${tempFilename}`;

      // No network, memory/CPU/process-capped, no capabilities, read-only root and
      // code mount, auto-removed on exit. Named so a timeout can force-remove it
      // (killing the `docker run` client alone leaves the container running).
      command = `docker run --rm --name ${containerName} --network none -m 128m --cpus 1 --pids-limit 64 ` +
        `--cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp:rw,size=16m ` +
        `-v "${absMountSource}:/app:ro" ${image} ${execCmd}`;
    } else {
      // Fallback: run locally via the node/python executable in an isolated cwd with a strict timeout.
      const bin = language === 'python' ? PYTHON_BIN : 'node';
      command = `"${bin}" "${hostFilePath}"`;
    }

    // The local fallback must not inherit the server's environment (API keys etc.).
    const childEnv = isDocker ? process.env : { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };

    exec(command, { timeout: timeoutMs, cwd: WORKSPACE_DIR, env: childEnv }, (error, stdout, stderr) => {
      if (isDocker && error && error.killed) {
        exec(`docker rm -f ${containerName}`, () => {});
      }
      try {
        if (fs.existsSync(hostFilePath)) fs.unlinkSync(hostFilePath);
      } catch (err) {
        console.warn(`[sandbox] Cleanup error: ${err.message}`);
      }

      if (error) {
        let errStr = error.message;
        if (error.killed) {
          errStr = `Execution timed out after ${timeoutMs}ms limit.`;
        }
        resolve({
          success: false,
          stdout: stdout.trim(),
          stderr: (stderr || errStr).trim(),
          runner,
        });
      } else {
        resolve({
          success: true,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          runner,
        });
      }
    });
  });
}

// CLI handler if run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const lang = args[0] || 'python';
  const code = args[1] || 'print("Hello from Sandbox!")';

  console.log(`[sandbox] Testing ${lang} execution...`);
  executeCode(code, lang).then(res => {
    console.log(JSON.stringify(res, null, 2));
  });
}
