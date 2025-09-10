import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';
import type { ProfilerEnvironmentCheck } from '../types/index.js';
import type { DockerVolume, ProfileContext, RecordOptions } from '../types/platform-plugin.js';
import { stripOutputPathFlags } from '../utils/cli-parsing.js';
import { runContainer } from '../utils/docker.js';
import { printWarning } from '../utils/output-formatter.js';
import { toContainerPath } from '../utils/path-utils.js';
import { addTempDir, setRawArtifact } from '../utils/profile-context.js';
import { spawnSync } from '../utils/spawn.js';
import { convertTicksToSpeedscope, writeSpeedscopeFile } from '../utils/ticks-trace.js';
import { buildBashTrampoline } from '../utils/trampoline.js';
import { BasePlatform } from './base-platform.js';

export class NodejsPlatform extends BasePlatform {
  readonly name = 'nodejs';
  readonly profiler = '0x';
  readonly extensions = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx'];
  readonly executables = ['node', 'nodejs', 'npm', 'npx', 'yarn', 'pnpm', 'tsx', 'ts-node'];

  detectCommand(args: string[]): boolean {
    if (args.length === 0) return false;
    const cmd = args[0].toLowerCase();
    const basename = path.basename(cmd);

    if (super.detectCommand(args)) {
      return true;
    }

    if (this.extensions.some((ext) => basename.endsWith(ext))) {
      return true;
    }

    // Check for npm/npx/yarn/etc commands
    return ['npm', 'npx', 'yarn', 'pnpm', 'tsx', 'ts-node'].includes(basename);
  }

  async checkLocalEnvironment(executablePath?: string): Promise<ProfilerEnvironmentCheck> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const setupInstructions: string[] = [];

    // Determine the executable path to use
    let actualExecutablePath = executablePath;

    // Check Node.js installation
    if (!actualExecutablePath) {
      const foundPath = await this.findExecutableInPath();
      if (!foundPath) {
        errors.push('Node.js is not installed or not in PATH');
        setupInstructions.push(
          chalk.bold('Install Node.js:'),
          '  macOS: brew install node',
          '  Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs',
          '  Windows: Download from https://nodejs.org/',
          '  Or use a version manager like nvm: https://github.com/nvm-sh/nvm'
        );
      } else {
        actualExecutablePath = foundPath;
      }
    }

    // Check Node.js version
    if (actualExecutablePath) {
      try {
        const res = spawnSync([actualExecutablePath, '--version'], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        if (res.exitCode === 0) {
          const version = (res.stdout?.toString() || '' || res.stderr?.toString() || '').trim();

          // Extract version number
          const versionMatch = version.match(/v(\d+)\.(\d+)\.(\d+)/);
          if (versionMatch) {
            const major = Number.parseInt(versionMatch[1], 10);

            if (major < 14) {
              warnings.push(`Node.js version ${version} is outdated. Recommend Node.js 14+`);
            }
          }
        }
      } catch (_error) {
        warnings.push('Could not determine Node.js version');
      }
    }

    // Check 0x installation
    try {
      const oxProc = spawnSync(['0x', '--version'], { stdout: 'pipe', stderr: 'pipe' });
      if (oxProc.exitCode !== 0) {
        throw new Error('0x not found');
      }
    } catch {
      errors.push('0x is not installed or not in PATH');
      setupInstructions.push(
        chalk.bold('Install 0x:'),
        '  npm install -g 0x',
        '  Or: yarn global add 0x'
      );
    }

    // Check for Linux-specific requirements
    if (os.platform() === 'linux') {
      try {
        const perfProc = spawnSync(['perf', '--version'], { stdout: 'pipe', stderr: 'pipe' });
        if (perfProc.exitCode !== 0) throw new Error('perf not found');
      } catch {
        warnings.push('perf is not installed (required for --kernel-tracing)');
        setupInstructions.push(
          chalk.bold('Install perf (optional, for kernel tracing):'),
          '  Ubuntu/Debian: sudo apt-get install linux-tools-common linux-tools-generic',
          '  RHEL/CentOS: sudo yum install perf',
          '  Note: Kernel tracing requires running with sudo'
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      setupInstructions,
    };
  }

  getContainerCacheVolumes(cacheBaseDir: string, cwd: string): DockerVolume[] {
    const volumes: DockerVolume[] = [];

    // NVM caches - we cache versions and downloads separately to avoid overwriting nvm itself
    const nvmVersionsDir = path.join(cacheBaseDir, 'nvm-versions');
    if (!fs.existsSync(nvmVersionsDir)) {
      fs.mkdirSync(nvmVersionsDir, { recursive: true });
    }
    volumes.push({
      hostPath: nvmVersionsDir,
      containerPath: '/root/.nvm/versions',
    });

    const nvmCacheDir = path.join(cacheBaseDir, 'nvm-cache');
    if (!fs.existsSync(nvmCacheDir)) {
      fs.mkdirSync(nvmCacheDir, { recursive: true });
    }
    volumes.push({
      hostPath: nvmCacheDir,
      containerPath: '/root/.nvm/.cache',
    });

    // NPM cache
    const npmCacheDir = path.join(cacheBaseDir, 'npm');
    if (!fs.existsSync(npmCacheDir)) {
      fs.mkdirSync(npmCacheDir, { recursive: true });
    }
    volumes.push({
      hostPath: npmCacheDir,
      containerPath: '/root/.npm',
    });

    // Yarn cache
    const yarnCacheDir = path.join(cacheBaseDir, 'yarn');
    if (!fs.existsSync(yarnCacheDir)) {
      fs.mkdirSync(yarnCacheDir, { recursive: true });
    }
    volumes.push({
      hostPath: yarnCacheDir,
      containerPath: '/root/.cache/yarn',
    });

    // PNPM store
    const pnpmStoreDir = path.join(cacheBaseDir, 'pnpm-store');
    if (!fs.existsSync(pnpmStoreDir)) {
      fs.mkdirSync(pnpmStoreDir, { recursive: true });
    }
    volumes.push({
      hostPath: pnpmStoreDir,
      containerPath: '/root/.local/share/pnpm/store',
    });

    // Project-specific node_modules cache
    const nodeModulesCacheDir = this.getProjectCacheDir(cacheBaseDir, cwd, 'node_modules');
    if (!fs.existsSync(nodeModulesCacheDir)) {
      fs.mkdirSync(nodeModulesCacheDir, { recursive: true });
    }
    volumes.push({
      hostPath: nodeModulesCacheDir,
      containerPath: '/workspace/node_modules',
    });

    return volumes;
  }

  async runProfilerInContainer(
    args: string[],
    _outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): Promise<void> {
    const cwd = path.resolve(options.cwd || process.cwd());
    const containerOutputDir = '/workspace/profile-0x-tmp';

    // Build the command to run inside the container
    const bootstrapCmd = '/usr/local/bin/bootstrap.sh';

    // Convert command arguments to be relative to /workspace
    const firstArg = args[0];
    const isExecutableCommand = ['node', 'npm', 'npx', 'yarn', 'pnpm', 'tsx', 'ts-node'].includes(
      path.basename(firstArg)
    );

    // Respect the user's chosen launcher if provided; otherwise default to node
    let launcherArgs: string[];
    if (isExecutableCommand) {
      // Preserve the original launcher token
      const launcher = firstArg;
      const rest = args.slice(1).map((arg) => toContainerPath(cwd, arg));
      launcherArgs = [launcher, ...rest];
    } else {
      const mapped = args.map((arg) => toContainerPath(cwd, arg));
      launcherArgs = ['node', ...mapped];
    }

    // Build 0x argument vector outside and pass it as pre-args to the trampoline for consistency
    // Filter output path overrides to avoid conflicts with our managed paths
    const outStrip = stripOutputPathFlags(options.extraProfilerArgs as string[] | undefined, [
      '--output-dir',
    ]);
    if (outStrip.removed.length) {
      printWarning(
        `Ignoring output-related flags in --extra-profiler-args for 0x: ${outStrip.removed.join(' ')}`
      );
    }

    const oxArgs = [
      '0x',
      '--output-dir',
      containerOutputDir,
      '--collect-only',
      '--write-ticks',
      ...(outStrip.filtered || []),
    ];

    const script = `set -e
source ${bootstrapCmd}
# Select latest Node.js in nvm.
# Note: The bootstrap installs Node via nvm inside the image; this path
# selection assumes at least one Node version is installed during bootstrap.
if [ -d "/root/.nvm/versions/node" ]; then
  export PATH="/root/.nvm/versions/node/$(ls -1 /root/.nvm/versions/node | sort -V | tail -1 2>/dev/null)/bin:$PATH"
fi

# Validate required tools are available
if ! command -v node >/dev/null 2>&1 || ! command -v 0x >/dev/null 2>&1; then
  echo "Required tools not found in container PATH (node and/or 0x). This should never happen because the bootstrap script installs Node. Please file a bug: https://github.com/indragiek/uniprof/issues" >&2
  exit 1
fi

# Split pre-args (0x arguments) and app args at '::'
PRE=()
while [ "$#" -gt 0 ]; do
  if [ "$1" = "::" ]; then shift; break; fi
  PRE+=("$1"); shift
done

exec "\${PRE[@]}" -- "$@"`;

    const fullCommand = buildBashTrampoline(script, oxArgs, launcherArgs);

    // Get cache volumes
    const cacheBaseDir = path.join(os.homedir(), '.cache', 'uniprof');
    const volumes = [
      { hostPath: cwd, containerPath: '/workspace' },
      ...this.getContainerCacheVolumes(cacheBaseDir, cwd),
    ];

    const result = await runContainer({
      image: this.getContainerImage(),
      command: fullCommand,
      workdir: '/workspace',
      volumes: volumes.map((v) => `${v.hostPath}:${v.containerPath}`),
      verbose: options.verbose,
      captureOutput: !options.verbose,
      hostNetwork: !!options.enableHostNetworking,
      profilerProcessNames: ['0x'],
    });

    if (result.exitCode !== 0) {
      // Check if it was interrupted by user
      if (result.exitCode === 130 || result.exitCode === 143) {
        throw new Error('SIGINT');
      }
      throw new Error(`Profiler exited with code ${result.exitCode}`);
    }

    // Defer conversion to postProcessProfile; record ticks path in context
    const ticksPath = path.join(cwd, 'profile-0x-tmp', 'ticks.json');
    if (fs.existsSync(ticksPath)) {
      setRawArtifact(context, 'ticks', ticksPath);
      addTempDir(context, path.dirname(ticksPath));
    } else {
      throw new Error('0x did not generate ticks.json file');
    }
  }

  buildLocalProfilerCommand(
    _args: string[],
    _outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): string[] {
    // 0x outputs to a directory. Use an absolute path so post-processing
    // can locate the ticks file regardless of process.cwd() vs --cwd.
    const baseDir = path.resolve(options.cwd || process.cwd());
    const outputDirFor0xName = `0x-profile-${Date.now()}`;
    const outputDirFor0x = path.join(baseDir, outputDirFor0xName);

    // Record where ticks will be emitted for post-processing (absolute path)
    setRawArtifact(context, 'ticks', path.join(outputDirFor0x, 'ticks.json'));
    addTempDir(context, outputDirFor0x);
    // Strip any user-provided output-dir to prevent overriding our directory
    const outStrip = stripOutputPathFlags(options.extraProfilerArgs as string[] | undefined, [
      '--output-dir',
    ]);
    if (outStrip.removed.length) {
      printWarning(
        `Ignoring output-related flags in --extra-profiler-args for 0x: ${outStrip.removed.join(' ')}`
      );
    }

    const profilerCmd = ['0x', '--output-dir', outputDirFor0x, '--collect-only', '--write-ticks'];

    // Add extra profiler arguments if provided
    if (outStrip.filtered.length > 0) {
      profilerCmd.push(...outStrip.filtered);
    }

    profilerCmd.push('--', ..._args);
    return profilerCmd;
  }

  async needsSudo(): Promise<boolean> {
    // Only need sudo on Linux if using kernel tracing
    return false;
  }

  async postProcessProfile(
    _rawOutputPath: string,
    finalOutputPath: string,
    context: ProfileContext
  ): Promise<void> {
    // Support both host-mode (outputDirectory) and container-mode (tempTicksPath)
    const ticksPath = context.rawArtifact?.type === 'ticks' ? context.rawArtifact.path : null;
    // tempDir is tracked in ctx.tempDirs; cleanup is handled centrally

    if (!ticksPath || !fs.existsSync(ticksPath)) {
      throw new Error('0x did not generate ticks.json file');
    }

    await this.convert0xToSpeedscope(ticksPath, finalOutputPath);
    const { cleanupTemps } = await import('../utils/profile-context.js');
    await cleanupTemps(context);
  }

  private async convert0xToSpeedscope(ticksPath: string, outputPath: string): Promise<void> {
    const speedscopeData = convertTicksToSpeedscope(ticksPath, this.getExporterName());
    writeSpeedscopeFile(speedscopeData, outputPath);
  }

  getExampleCommand(): string {
    return 'node your_script.js';
  }

  getSamplingRate(_extraProfilerArgs?: string[]): number | null {
    // 0x doesn't allow customizing the sampling rate, it uses V8's default
    // which is typically around 1000Hz
    return null;
  }

  getAdvancedOptions() {
    return {
      description: '0x supports additional options via --extra-profiler-args:',
      options: [
        { flag: '--kernel-tracing', description: 'Use kernel tracing (Linux only, requires perf)' },
        { flag: '--on-port <cmd>', description: 'Run command when server opens port' },
        {
          flag: '--collect-only',
          description: 'Collect profiling data only for later visualization',
        },
      ],
      example: {
        description: 'Profile with kernel tracing',
        command:
          'uniprof record -o profile.json --extra-profiler-args --kernel-tracing -- node app.js',
      },
    };
  }
}
