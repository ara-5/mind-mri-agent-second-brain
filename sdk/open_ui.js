/**
 * Opens the dashboard in the default browser. The dashboard is served by the
 * API server itself (same origin, so no CORS), so this points at that URL
 * rather than at ui/index.html on disk. Start the server first (npm start).
 */
import { exec } from 'child_process';

const host = process.env.BRAIN_HOST && !['0.0.0.0', '::'].includes(process.env.BRAIN_HOST)
  ? process.env.BRAIN_HOST
  : '127.0.0.1';
const url = `http://${host}:${process.env.BRAIN_PORT || '3747'}/`;

const opener = process.platform === 'win32' ? `start "" "${url}"`
  : process.platform === 'darwin' ? `open "${url}"`
  : `xdg-open "${url}"`;

console.log(`Opening ${url} (start the server with "npm start" if it is not running)`);
exec(opener, (err) => {
  if (err) console.error(`Could not open a browser automatically: ${err.message}\nOpen ${url} manually.`);
});
