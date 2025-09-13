import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';
import { createSpinner, printError, printInfo } from './output-formatter.js';
import { parsePidPpidChildren } from './process-tree.js';
import { readAll, spawn, spawnSync } from './spawn.js';

const REGISTRY = 'ghcr.io/indragiek/uniprof';

/**
 * Get the Docker platform string for the current architecture
 */
function getDockerPlatform(): string {
  const arch = os.arch() as string;
  switch (arch) {
    case 'x64':
    case 'x86_64':
      return 'linux/amd64';
    case 'arm64':
    case 'aarch64':
      return 'linux/arm64';
    default:
      // Default to amd64 for unknown architectures
      return 'linux/amd64';
  }
}

export interface DockerEnvironmentCheck {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  setupInstructions: string[];
}

export async function checkDockerEnvironment(): Promise<DockerEnvironmentCheck> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const setupInstructions: string[] = [];

  try {
    const proc = spawnSync(['docker', '--version']);
    if (proc.exitCode !== 0) {
      throw new Error('Docker command failed');
    }
  } catch {
    errors.push('Docker is not installed or not in PATH');
    setupInstructions.push(
      chalk.bold('Install Docker:'),
      '  Visit https://docs.docker.com/get-docker/ for installation instructions',
      '  ',
      '  macOS: Install Docker Desktop',
      '  Linux: Follow distribution-specific instructions',
      '  Windows: Install Docker Desktop with WSL2 backend'
    );
  }

  if (errors.length === 0) {
    try {
      const proc = spawnSync(['docker', 'info'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if (proc.exitCode !== 0) {
        throw new Error('Docker daemon check failed');
      }
    } catch {
      errors.push('Docker daemon is not running');
      setupInstructions.push(
        chalk.bold('Start Docker:'),
        '  macOS/Windows: Start Docker Desktop application',
        '  Linux: sudo systemctl start docker'
      );
    }
  }

  if (errors.length === 0 && os.platform() === 'linux') {
    try {
      const proc = spawnSync(['docker', 'ps'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if (proc.exitCode !== 0) {
        const stderr = proc.stderr?.toString() || '';
        if (stderr.includes('permission denied')) {
          throw { stderr };
        }
      }
    } catch (error: any) {
      if (error.stderr?.includes('permission denied')) {
        warnings.push(
          'You may need to run Docker commands with sudo or add your user to the docker group'
        );
        setupInstructions.push(
          chalk.bold('Add user to docker group (optional):'),
          '  sudo usermod -aG docker $USER',
          '  Then log out and back in for changes to take effect'
        );
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    setupInstructions,
  };
}

export async function checkHostNetworkingEnabled(): Promise<{
  enabled: boolean;
  diagnostics: string;
}> {
  // Default diagnostics
  let diagnostics = '';
  const platform = os.platform();

  // On Linux, Docker Engine supports host networking; consider it enabled
  if (platform === 'linux') {
    return { enabled: true, diagnostics: '' };
  }

  // macOS: require Docker Desktop version >= 4.43.0
  if (platform === 'darwin') {
    try {
      const proc = spawnSync(['docker', 'version'], { stdout: 'pipe', stderr: 'pipe' });
      const out = (proc.stdout?.toString() || '') + (proc.stderr?.toString() || '');
      const m = out.match(/Server:\s*Docker Desktop\s*([0-9]+)\.([0-9]+)\.([0-9]+)/i);
      if (!m) {
        diagnostics = 'Could not determine Docker Desktop version from "docker version" output.';
        return { enabled: false, diagnostics };
      }
      const [maj, min, pat] = [
        Number.parseInt(m[1], 10),
        Number.parseInt(m[2], 10),
        Number.parseInt(m[3], 10),
      ];
      const cmp = maj > 4 || (maj === 4 && (min > 43 || (min === 43 && pat >= 0)));
      if (!cmp) {
        diagnostics =
          'Docker Desktop version is too old for host networking. Please update to 4.43.0 or newer.';
        return { enabled: false, diagnostics };
      }
    } catch {
      diagnostics =
        'Failed to execute "docker version" to detect Docker Desktop version. Open Docker Desktop, check Settings > Resources > Network, enable Host Networking (v4.43.0+), and disable Enhanced Container Isolation.';
      return { enabled: false, diagnostics };
    }
  }

  // Determine settings file path
  let settingsPathCandidates: string[] = [];
  if (os.platform() === 'darwin') {
    const base = path.join(os.homedir(), 'Library', 'Group Containers', 'group.com.docker');
    settingsPathCandidates = [
      path.join(base, 'settings-store.json'),
      path.join(base, 'settings.json'),
    ];
  } else {
    // On other platforms (e.g., Windows), host networking portability is different; return disabled
    return { enabled: false, diagnostics: 'Host networking check is not supported on this OS.' };
  }

  let settingsPath: string | null = null;
  for (const p of settingsPathCandidates) {
    if (fs.existsSync(p)) {
      settingsPath = p;
      break;
    }
  }
  if (!settingsPath) {
    return {
      enabled: false,
      diagnostics:
        'Could not locate Docker Desktop settings file to verify host networking (looked for settings-store.json).',
    };
  }

  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const json = JSON.parse(raw);
    const eci = json.EnhancedContainerIsolation;
    if (eci === true) {
      return {
        enabled: false,
        diagnostics:
          'Host networking is not supported when Enhanced Container Isolation (ECI) is enabled. See: https://docs.docker.com/enterprise/security/hardened-desktop/enhanced-container-isolation/enable-eci/',
      };
    }
    const hostNet = json.HostNetworkingEnabled;
    if (hostNet !== true) {
      return {
        enabled: false,
        diagnostics:
          'Docker Desktop Host Networking is disabled. Enable it in Docker Desktop settings. Docs: https://docs.docker.com/engine/network/drivers/host/',
      };
    }
  } catch (e: any) {
    return {
      enabled: false,
      diagnostics: `Failed to read Docker Desktop settings (${settingsPath}): ${e?.message || e}`,
    };
  }

  return { enabled: true, diagnostics: '' };
}

export function getContainerImage(platform: string): string {
  return `${REGISTRY}-${platform}:latest`;
}

export async function pullContainerImage(platform: string, quiet = false): Promise<void> {
  const image = getContainerImage(platform);
  const spinner = quiet ? null : createSpinner(`Pulling container image ${image}...`);

  try {
    spinner?.start();

    try {
      const proc = spawnSync(['docker', 'image', 'inspect', image], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if (proc.exitCode === 0 && proc.stdout) {
        const imageData = JSON.parse(proc.stdout.toString());

        const expectedPlatform = getDockerPlatform();
        const hasCorrectPlatform = imageData.some((img: any) => {
          const platform = `${img.Os}/${img.Architecture}`;
          return platform === expectedPlatform;
        });

        if (hasCorrectPlatform) {
          spinner?.stop();
          if (!quiet) {
            printInfo(`Using existing container image: ${chalk.cyan(image)}`);
          }
          return;
        }
      }
    } catch {}

    const pullProcess = spawn(['docker', 'pull', '--platform', getDockerPlatform(), image], {
      stdout: !quiet ? 'inherit' : 'pipe',
      stderr: !quiet ? 'inherit' : 'pipe',
    });

    await pullProcess.exited;
    spinner?.stop();

    if (!quiet) {
      printInfo(`Successfully pulled container image: ${chalk.cyan(image)}`);
    }
  } catch (error: any) {
    spinner?.stop();
    throw new Error(`Failed to pull container image: ${error.message}`);
  }
}

export interface DockerRunOptions {
  image: string;
  command: string[];
  workdir?: string;
  volumes?: string[];
  environment?: Record<string, string>;
  capabilities?: string[];
  verbose?: boolean;
  captureOutput?: boolean; // Capture output for error handling
  hostNetwork?: boolean; // Use host networking if available
  profilerProcessNames?: string[]; // Names to exclude from first SIGINT
}

export async function runContainer(
  options: DockerRunOptions
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  function normalizeVolume(vol: string): string {
    if (process.platform !== 'win32') return vol;
    const idx = vol.lastIndexOf(':');
    if (idx === -1) return vol;
    let host = vol.slice(0, idx);
    const cont = vol.slice(idx + 1);
    // Convert backslashes to forward slashes
    host = host.replace(/\\/g, '/');
    // Convert UNC \\server\share -> //server/share
    if (host.startsWith('\\\\')) host = `//${host.slice(2)}`;
    return `${host}:${cont}`;
  }
  // Build common docker args for create
  const createArgs = ['create', '--platform', getDockerPlatform()];

  if (options.hostNetwork) {
    createArgs.push('--network', 'host');
  }

  if (options.capabilities) {
    for (const cap of options.capabilities) {
      createArgs.push('--cap-add', cap);
    }
  }

  if (options.capabilities?.includes('SYS_ADMIN')) {
    createArgs.push('--privileged');
  }

  if (options.volumes) {
    for (const vol of options.volumes) {
      createArgs.push('-v', normalizeVolume(vol));
    }
  }

  if (options.workdir) {
    createArgs.push('-w', options.workdir);
  }

  if (options.environment) {
    for (const [key, value] of Object.entries(options.environment)) {
      createArgs.push('-e', `${key}=${value}`);
    }
  }

  // Allocate a pseudo-TTY when we're going to show output to a terminal.
  // This enables color/TTY detection inside the container (e.g., [[ -t 1 ]]).
  // Use TTY when stdout is inherited (visible to user) and the host stdout is a TTY.
  const willInheritStdout = options.verbose || !options.captureOutput;
  if (willInheritStdout && process.stdout.isTTY) {
    createArgs.push('-t');
  }

  createArgs.push(options.image, ...options.command);

  let stdio: any;
  if (options.verbose) {
    // Verbose mode: show all output
    stdio = ['inherit', 'inherit', 'inherit'];
  } else if (options.captureOutput) {
    // Capture mode: capture output for error handling but don't show by default
    stdio = ['inherit', 'pipe', 'pipe'];
  } else {
    // Default: show output
    stdio = ['inherit', 'inherit', 'inherit'];
  }

  // Create container
  const createProc = spawn(['docker', ...createArgs], { stdout: 'pipe', stderr: 'pipe' });
  const [createdExit, createStderr, createStdout] = await Promise.all([
    createProc.exited,
    createProc.stderr ? readAll(createProc.stderr) : Promise.resolve(''),
    createProc.stdout ? readAll(createProc.stdout) : Promise.resolve(''),
  ]);
  if (createdExit !== 0 || !createStdout) {
    const errorMsg = createStderr
      ? `Failed to create container: ${createStderr.trim()}`
      : 'Failed to create container';
    throw new Error(errorMsg);
  }
  const containerId = createStdout.trim();

  // Start and attach
  const startArgs = ['start', '-a', containerId];
  const subprocess = spawn(['docker', ...startArgs], {
    stdin: stdio[0] === 'inherit' ? 'inherit' : 'pipe',
    stdout: stdio[1] === 'inherit' ? 'inherit' : 'pipe',
    stderr: stdio[2] === 'inherit' ? 'inherit' : 'pipe',
  });

  let stdout = '';
  let stderr = '';
  const shouldCapture = options.captureOutput;
  let waitStdout: Promise<void> | null = null;
  let waitStderr: Promise<void> | null = null;

  if (shouldCapture) {
    waitStdout = readAll(subprocess.stdout).then((s) => {
      stdout = s;
    });
    waitStderr = readAll(subprocess.stderr).then((s) => {
      stderr = s;
    });
  }

  let firstSigintAt: number | null = null;
  const sigintWindowMs = 2000;

  async function execInContainer(
    cmd: string[]
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const proc = spawn(['docker', 'exec', containerId, ...cmd], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    const stdout = await readAll(proc.stdout);
    const stderr = await readAll(proc.stderr);
    return { exitCode, stdout, stderr };
  }

  const onSigint = async () => {
    const now = Date.now();
    if (firstSigintAt && now - firstSigintAt <= sigintWindowMs) {
      try {
        await execInContainer(['/bin/sh', '-lc', 'kill -s INT 1 >/dev/null 2>&1 || true']);
      } catch {}
      try {
        const killProc = spawn(['docker', 'kill', '-s', 'INT', containerId]);
        await killProc.exited;
      } catch {}
      try {
        subprocess.kill('SIGINT');
      } catch {}
      return;
    }
    firstSigintAt = now;
    const deny = new Set((options.profilerProcessNames || []).map((n) => n.toLowerCase()));
    async function signalChildrenOnce(): Promise<number> {
      try {
        const list = await execInContainer(['/bin/sh', '-lc', 'ps -eo pid,ppid']);
        const text = list.stdout || '';
        const children = parsePidPpidChildren(text, 1);
        if (!children.length) return 0;
        const list2 = await execInContainer([
          '/bin/sh',
          '-lc',
          `ps -o pid,comm -p ${children.join(',')}`,
        ]);
        const namesOut = list2.stdout || '';
        const pidToComm = new Map<number, string>();
        const lines = namesOut.split('\n').slice(1);
        for (const l of lines) {
          const parts = l.trim().split(/\s+/);
          if (parts.length >= 2)
            pidToComm.set(Number.parseInt(parts[0], 10), parts.slice(1).join(' ').toLowerCase());
        }
        const targets = children.filter(
          (pid) => !deny.has((pidToComm.get(pid) || '').toLowerCase())
        );
        if (options.verbose && targets.length) {
          console.log(
            chalk.yellow(`Signalling SIGINT to container child PIDs: ${targets.join(', ')}`)
          );
        }
        if (targets.length) {
          const script = `kill -s INT ${targets.join(' ')}`;
          await execInContainer(['/bin/sh', '-lc', script]);
          return targets.length;
        }
      } catch {}
      return 0;
    }

    let sent = await signalChildrenOnce();
    if (sent === 0) {
      for (let i = 0; i < 10 && sent === 0; i++) {
        await new Promise((r) => setTimeout(r, 100));
        sent = await signalChildrenOnce();
      }
    }
    if (sent === 0) {
      // Fallback: signal PID 1 if it is not a known profiler (e.g., shell wrapper).
      // PID 1 signalling is a last resort to stop the app when process discovery yields
      // no eligible children; this may also affect wrapper processes supervising the app.
      try {
        const p1 = await execInContainer(['/bin/sh', '-lc', 'ps -o pid,comm -p 1']);
        const text = p1.stdout || '';
        const line = (text.split('\n')[1] || '').trim();
        const parts = line.split(/\s+/);
        const name = (parts.slice(1).join(' ') || '').toLowerCase();
        if (name && !deny.has(name)) {
          await execInContainer(['/bin/sh', '-lc', 'kill -s INT 1']);
          if (options.verbose) {
            console.log(chalk.yellow('Fallback: signalled SIGINT to PID 1 inside container'));
          }
        }
      } catch {}
    }
  };

  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigint);

  try {
    const exitCode = await subprocess.exited;

    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigint);

    if (waitStdout) await waitStdout;
    if (waitStderr) await waitStderr;

    // Remove container after exit
    try {
      const rm = spawn(['docker', 'rm', '-f', containerId]);
      await rm.exited;
    } catch {}

    if (!options.verbose && options.captureOutput && exitCode !== 0) {
      if (stdout) {
        console.log('Container output:');
        console.log(stdout);
      }
      if (stderr) {
        printError('Container errors:');
        console.error(stderr);
      }
    }

    return {
      exitCode: exitCode || 0,
      stdout: shouldCapture ? stdout : '',
      stderr: shouldCapture ? stderr : '',
    };
  } catch (error) {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigint);
    try {
      const rm = spawn(['docker', 'rm', '-f', containerId]);
      await rm.exited;
    } catch {}
    throw error;
  }
}

export async function copyFromContainer(
  containerId: string,
  sourcePath: string,
  destPath: string
): Promise<void> {
  try {
    const proc = spawn(['docker', 'cp', `${containerId}:${sourcePath}`, destPath]);
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error('Docker cp command failed');
    }
  } catch (error: any) {
    throw new Error(`Failed to copy from container: ${error.message}`);
  }
}

export async function createTempContainer(
  image: string,
  command: string[] = ['sleep', 'infinity']
): Promise<string> {
  const proc = spawn(['docker', 'create', image, ...command], {
    stdout: 'pipe',
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0 || !proc.stdout) {
    throw new Error('Failed to create container');
  }
  const stdout = await readAll(proc.stdout);
  return stdout.trim();
}

export async function removeContainer(containerId: string): Promise<void> {
  try {
    const proc = spawn(['docker', 'rm', '-f', containerId]);
    await proc.exited;
  } catch {
    // Ignore errors when removing container
  }
}
