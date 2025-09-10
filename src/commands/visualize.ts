import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import * as url from 'node:url';
import chalk from 'chalk';
import { createSpinner, printError, printSuccess } from '../utils/output-formatter.js';
import { spawn } from '../utils/spawn.js';

interface VisualizeOptions {
  port?: number;
}

export async function visualizeCommand(
  profilePath: string,
  options: VisualizeOptions = {}
): Promise<void> {
  if (!fs.existsSync(profilePath)) {
    printError(`Profile file not found: ${profilePath}`);
    process.exit(1);
  }

  const port = typeof options.port === 'number' ? options.port : 0;
  if (options.port !== undefined && (port < 0 || port > 65535)) {
    printError('Invalid port number. Must be between 0 and 65535.');
    process.exit(1);
  }

  let profileTitle = path.basename(profilePath, '.json');
  try {
    const content = await fs.promises.readFile(profilePath, 'utf8');
    const profile = JSON.parse(content);
    if (profile.name) profileTitle = profile.name;
  } catch {}

  const spinner = createSpinner('Starting web server...');
  spinner?.start();

  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

  // Speedscope path candidates:
  // 1) dist runtime: <dist>/speedscope (one level up from dist/commands)
  // 2) dev runtime:  repo root speedscope/ (two levels up from src/commands)
  const distSpeedscopePath = path.join(__dirname, '..', 'speedscope');
  const devSpeedscopePath = path.resolve(path.join(__dirname, '..', '..', 'speedscope'));

  let speedscopePath = distSpeedscopePath;
  if (!fs.existsSync(path.join(speedscopePath, 'index.html'))) {
    if (fs.existsSync(path.join(devSpeedscopePath, 'index.html'))) {
      speedscopePath = devSpeedscopePath;
    }
  }

  // Verify speedscope directory exists at chosen location
  if (!fs.existsSync(path.join(speedscopePath, 'index.html'))) {
    spinner?.stop();
    printError('Could not find speedscope directory');
    console.log(
      chalk.white(`Speedscope files should be located at:
  - ${distSpeedscopePath}
  - ${devSpeedscopePath}`)
    );
    console.log(
      chalk.white('Try running "npm run build" to ensure speedscope is bundled correctly')
    );
    process.exit(1);
  }
  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url || '/', 'http://localhost');
      let pathname = parsedUrl.pathname;
      if (pathname === '/profile.json') {
        try {
          const profileData = await fs.promises.readFile(profilePath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
          res.end(profileData);
        } catch (_e) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error reading profile file');
        }
        return;
      }
      if (pathname === '/') pathname = '/index.html';
      const base = path.resolve(speedscopePath);
      const requested = path.resolve(path.join(base, pathname));
      if (!(requested === base || requested.startsWith(base + path.sep))) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(requested)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const ext = path.extname(requested).toLowerCase();
      const contentTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.woff2': 'font/woff2',
        '.txt': 'text/plain',
      };
      const contentType = contentTypes[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(requested).pipe(res);
    } catch (error: any) {
      printError(`Server error: ${error?.message || error}`);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });

  // Wait until the server is actually listening before reporting the URL
  await new Promise<void>((resolve) => {
    server.listen(port || 0, '127.0.0.1', resolve);
  });
  spinner?.stop();

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port || 0;
  const serverUrl = `http://127.0.0.1:${actualPort}`;

  // Single line server start, showing full profile URL with dimmed path
  console.log();
  const profileUrl = `${serverUrl}#profileURL=${encodeURIComponent('/profile.json')}&title=${encodeURIComponent(profileTitle)}`;
  const tail = profileUrl.slice(serverUrl.length);
  const displayUrl = `${chalk.cyan(serverUrl)}${chalk.gray(`${tail}`)}`;
  printSuccess(`Server started on ${displayUrl}`);

  // Animated spinner: Opening browser...
  const openSpinner = createSpinner('Opening browser...');
  openSpinner?.start();

  // Try to open the browser
  try {
    if (process.platform === 'darwin') {
      await spawn(['open', profileUrl], { stdout: 'pipe', stderr: 'pipe' }).exited;
    } else if (process.platform === 'win32') {
      await spawn(['cmd', '/c', 'start', '', profileUrl], { stdout: 'pipe', stderr: 'pipe' })
        .exited;
    } else {
      await spawn(['xdg-open', profileUrl], { stdout: 'pipe', stderr: 'pipe' }).exited;
    }
    openSpinner?.stop();
    printSuccess('Browser opened!');
  } catch (_err) {
    // Try fallback for Linux systems
    if (process.platform === 'linux') {
      try {
        await spawn(['sensible-browser', profileUrl], { stdout: 'pipe', stderr: 'pipe' }).exited;
        openSpinner?.stop();
        printSuccess('Browser opened!');
      } catch {
        openSpinner?.stop();
        console.log(
          chalk.red('✗'),
          `Browser failed to open. Open this link manually: ${chalk.cyan(profileUrl)}`
        );
      }
    } else {
      openSpinner?.stop();
      console.log(
        chalk.red('✗'),
        `Browser failed to open. Open this link manually: ${chalk.cyan(profileUrl)}`
      );
    }
  }

  console.log();
  console.log(chalk.gray('Press Ctrl+C to stop the server'));

  // Keep the process alive
  process.on('SIGINT', () => {
    console.log();
    console.log(chalk.white('Shutting down server...'));
    server.close(() => process.exit(0));
  });

  // Prevent the process from exiting
  await new Promise(() => {});
}
