import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';
import type { ProfilerEnvironmentCheck } from '../types/index.js';
import type { DockerVolume, ProfileContext, RecordOptions } from '../types/platform-plugin.js';
import { ensureDefaultFlag, stripOutputPathFlags } from '../utils/cli-parsing.js';
import { runContainer } from '../utils/docker.js';
import { printWarning } from '../utils/output-formatter.js';
import { toContainerPath } from '../utils/path-utils.js';
import { spawnSync } from '../utils/spawn.js';
import { buildBashTrampoline } from '../utils/trampoline.js';
import { BasePlatform } from './base-platform.js';

export class RubyPlatform extends BasePlatform {
  readonly name = 'ruby';
  readonly profiler = 'rbspy';
  readonly extensions = ['.rb', 'Gemfile', 'Rakefile'];
  readonly executables = ['ruby', 'irb', 'bundle', 'rails', 'rake'];

  detectCommand(args: string[]): boolean {
    if (args.length === 0) return false;
    const cmd = args[0].toLowerCase();
    const basename = path.basename(cmd);

    if (basename === 'bundle' && args.length >= 3 && args[1] === 'exec') {
      return true;
    }

    // Detect common ruby executables and direct script invocation
    if (super.detectCommand(args)) {
      return true;
    }
    if (this.extensions.some((ext) => basename.endsWith(ext) || basename === ext)) {
      return true;
    }
    return false;
  }

  async checkLocalEnvironment(executablePath?: string): Promise<ProfilerEnvironmentCheck> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const setupInstructions: string[] = [];

    // Determine the executable path to use
    let actualExecutablePath = executablePath;

    if (!actualExecutablePath) {
      const foundPath = await this.findExecutableInPath();
      if (!foundPath) {
        errors.push('Ruby is not installed or not in PATH');
        setupInstructions.push(
          chalk.bold('Install Ruby:'),
          '  macOS: brew install ruby',
          '  Ubuntu/Debian: sudo apt-get install ruby-full',
          '  Windows: Download from https://rubyinstaller.org/',
          '  Or use a version manager like rbenv: https://github.com/rbenv/rbenv'
        );
      } else {
        actualExecutablePath = foundPath;
      }
    }

    if (actualExecutablePath) {
      try {
        const res = spawnSync([actualExecutablePath, '--version'], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        if (res.exitCode === 0) {
          const version = res.stdout?.toString() || '' || res.stderr?.toString() || '';
          const versionMatch = version.match(/ruby (\d+)\.(\d+)\.(\d+)/);
          if (versionMatch) {
            const major = Number.parseInt(versionMatch[1], 10);
            const minor = Number.parseInt(versionMatch[2], 10);
            if (major < 2 || (major === 2 && minor < 5)) {
              warnings.push(`Ruby version ${major}.${minor} is outdated. Recommend Ruby 2.5+`);
            }
          }
        }
      } catch (_error) {
        warnings.push('Could not determine Ruby version');
      }
    }

    try {
      const proc = spawnSync(['rbspy', '--version'], { stdout: 'pipe', stderr: 'pipe' });
      if (proc.exitCode !== 0) {
        throw new Error('Command failed');
      }
    } catch {
      errors.push('rbspy is not installed or not in PATH');
      setupInstructions.push(
        chalk.bold('Install rbspy:'),
        '  macOS/Linux: cargo install rbspy',
        '  Or download from: https://github.com/rbspy/rbspy/releases',
        '  ',
        '  Note: rbspy requires Rust/Cargo to install via cargo:',
        "  Install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
      );
    }

    if (process.env.GEM_HOME || process.env.GEM_PATH) {
      const gemHome = process.env.GEM_HOME || process.env.GEM_PATH?.split(':')[0];
      if (gemHome) {
        warnings.push(`Ruby gems environment detected: ${gemHome}`);
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

    const rbenvCacheDir = path.join(cacheBaseDir, 'rbenv');
    if (!fs.existsSync(rbenvCacheDir)) {
      fs.mkdirSync(rbenvCacheDir, { recursive: true });
    }

    // Bundle and gem caches expected by tests
    volumes.push({
      hostPath: path.join(rbenvCacheDir, 'bundle'),
      containerPath: '/usr/local/bundle',
    });
    volumes.push({ hostPath: path.join(rbenvCacheDir, 'gem'), containerPath: '/root/.gem' });

    const projectBundleDir = this.getProjectCacheDir(cacheBaseDir, cwd, 'vendor-bundle');
    if (!fs.existsSync(projectBundleDir)) {
      fs.mkdirSync(projectBundleDir, { recursive: true });
    }
    volumes.push({
      hostPath: projectBundleDir,
      containerPath: '/workspace/vendor/bundle',
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
    const bootstrapCmd = '/usr/local/bin/bootstrap.sh';

    // Convert command arguments to be relative to /workspace
    const containerArgs = args.map((arg, index) => {
      if (index === 0 && ['ruby', 'irb', 'bundle', 'rake', 'rails'].includes(arg)) {
        return arg;
      }
      return toContainerPath(cwd, arg);
    });

    const script = `set -e
source ${bootstrapCmd}

# Split pre-args (rbspy record args) and app args at '::'
PRE=()
while [ "$#" -gt 0 ]; do
  if [ "$1" = "::" ]; then shift; break; fi
  PRE+=("$1"); shift
done

exec "\${PRE[@]}" -- "$@"`;

    // Prevent overriding output path (--file/-o)
    const outStrip = stripOutputPathFlags(options.extraProfilerArgs, ['--file', '-o', '--output']);
    if (outStrip.removed.length) {
      printWarning(
        `Ignoring output-related flags in --extra-profiler-args for rbspy: ${outStrip.removed.join(' ')}`
      );
    }
    const xp = ensureDefaultFlag(outStrip.filtered, ['--rate'], '999');
    const preArgs = [
      'rbspy',
      'record',
      '--format',
      'speedscope',
      '--file',
      '/workspace/profile.json',
      '--subprocesses',
      '--silent',
      ...xp,
    ];
    const fullCommand = buildBashTrampoline(script, preArgs, containerArgs);

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
      capabilities: ['SYS_PTRACE'],
      verbose: options.verbose,
      captureOutput: !options.verbose,
      hostNetwork: !!options.enableHostNetworking,
      profilerProcessNames: ['rbspy'],
    });

    if (result.exitCode !== 0) {
      // Check if it was interrupted by user
      if (result.exitCode === 130 || result.exitCode === 143) {
        throw new Error('SIGINT');
      }
      throw new Error(`Profiler exited with code ${result.exitCode}`);
    }
    const containerProfilePath = path.join(cwd, 'profile.json');
    if (fs.existsSync(containerProfilePath)) {
      const { setRawArtifact, addTempFile } = await import('../utils/profile-context.js');
      setRawArtifact(context, 'speedscope', containerProfilePath);
      addTempFile(context, containerProfilePath);
    } else {
      throw new Error('Profile file was not created in container');
    }
  }

  buildLocalProfilerCommand(
    _args: string[],
    outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): string[] {
    void context;
    const base = [
      'rbspy',
      'record',
      '--format',
      'speedscope',
      '--file',
      outputPath,
      '--subprocesses',
      '--silent',
    ];
    // Prevent overriding output path (--file/-o)
    const outStrip = stripOutputPathFlags(options.extraProfilerArgs, ['--file', '-o', '--output']);
    if (outStrip.removed.length) {
      printWarning(
        `Ignoring output-related flags in --extra-profiler-args for rbspy: ${outStrip.removed.join(' ')}`
      );
    }
    const extra = ensureDefaultFlag(outStrip.filtered, ['--rate'], '999');
    return [...base, ...extra, '--', ..._args];
  }

  async needsSudo(): Promise<boolean> {
    // Check if we need sudo (macOS or restricted Linux)
    if (os.platform() === 'darwin') {
      return true;
    }

    if (os.platform() === 'linux') {
      try {
        const ptraceScopePath = '/proc/sys/kernel/yama/ptrace_scope';
        if (fs.existsSync(ptraceScopePath)) {
          const ptraceScope = fs.readFileSync(ptraceScopePath, 'utf8').trim();
          return ptraceScope !== '0';
        }
      } catch {
        // If we can't check, assume we need sudo
      }
      return true;
    }

    return false;
  }

  async postProcessProfile(
    _rawOutputPath: string,
    finalOutputPath: string,
    context: ProfileContext
  ): Promise<void> {
    const inPath = context.rawArtifact?.path || finalOutputPath;
    const { finalizeProfile } = await import('../utils/profile-context.js');
    await finalizeProfile(context, inPath, finalOutputPath, this.getExporterName());
  }

  getExampleCommand(): string {
    return 'ruby script.rb';
  }

  getSamplingRate(extraProfilerArgs?: string[]): number | null {
    // Check if user provided --rate flag
    if (extraProfilerArgs) {
      for (let i = 0; i < extraProfilerArgs.length; i++) {
        if (extraProfilerArgs[i] === '--rate') {
          if (i + 1 < extraProfilerArgs.length) {
            const rate = Number.parseInt(extraProfilerArgs[i + 1], 10);
            if (!Number.isNaN(rate)) {
              return rate;
            }
          }
        }
      }
    }
    // Default to 999Hz
    return 999;
  }

  getAdvancedOptions() {
    return {
      description: 'rbspy supports additional options via --extra-profiler-args:',
      options: [
        { flag: '--rate <Hz>', description: 'Sampling rate (default: 999)' },
        { flag: '--duration <sec>', description: 'Profile for specific duration' },
        { flag: '--nonblocking', description: "Don't pause the Ruby process" },
        { flag: '--subprocesses', description: 'profile subprocesses spawned by the target' },
        { flag: '--with-idle', description: 'include idle time in the profile' },
      ],
      example: {
        description: 'Profile with higher sampling rate',
        command:
          'uniprof record -o profile.json --extra-profiler-args --rate 500 -- ruby script.rb',
      },
    };
  }
}
