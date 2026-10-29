/**
 * Opens the dashboard in the default browser. The dashboard is served by the
 * API server itself (same origin, so no CORS), so this points at that URL
 * rather than at ui/index.html on disk. Start the server first (npm start).
 */
import { spawn } from 'child_process';

const host = process.env.BRAIN_HOST && !['0.0.0.0', '::'].includes(process.env.BRAIN_HOST)
  ? process.env.BRAIN_HOST
  : '127.0.0.1';
const port = process.env.BRAIN_PORT || '3747';

// The URL is built from environment variables, so check it before handing it to
// an opener; argv (never a shell string) keeps it from being interpreted.
if (!/^\d{1,5}$/.test(port) || !/^[\w.\-:\[\]]+$/.test(host)) {
  console.error(`Refusing to open: BRAIN_HOST/BRAIN_PORT look invalid (${host}:${port}).`);
  process.exit(1);
}
const url = `http://${host}:${port}/`;

const [cmd, ...cmdArgs] = process.platform === 'win32' ? ['rundll32', 'url.dll,FileProtocolHandler', url]
  : process.platform === 'darwin' ? ['open', url]
  : ['xdg-open', url];

console.log(`Opening ${url} (start the server with "npm start" if it is not running)`);
const child = spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true });
child.on('error', (err) => {
  console.error(`Could not open a browser automatically: ${err.message}\nOpen ${url} manually.`);
});
child.unref();
