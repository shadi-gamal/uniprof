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
import { buildBashTrampoline, shellEscape } from '../utils/trampoline.js';
import { BasePlatform } from './base-platform.js';

export class PythonPlatform extends BasePlatform {
  readonly name = 'python';
  readonly profiler = 'py-spy';
  readonly extensions = ['.py'];
  readonly executables = ['python', 'python3', 'python2'];

  detectCommand(args: string[]): boolean {
    if (args.length === 0) return false;
    const cmd = args[0].toLowerCase();
    const basename = path.basename(cmd);

    if (basename === 'uv' && args.length >= 2 && args[1] === 'run') {
      return true; // Always assume Python for uv run
    }

    // Direct script invocation (e.g., ./script.py)
    if (this.extensions.some((ext) => basename.endsWith(ext))) {
      return true;
    }

    return super.detectCommand(args);
  }

  async checkLocalEnvironment(executablePath?: string): Promise<ProfilerEnvironmentCheck> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const setupInstructions: string[] = [];

    let actualExecutablePath = executablePath;

    if (!actualExecutablePath) {
      const foundPath = await this.findExecutableInPath();
      if (!foundPath) {
        errors.push('Python is not installed or not in PATH');
        setupInstructions.push(
          chalk.bold('Install Python:'),
          '  macOS: brew install python3',
          '  Ubuntu/Debian: sudo apt-get install python3',
          '  Windows: Download from https://www.python.org/downloads/'
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
          const v = res.stdout?.toString() || '' || res.stderr?.toString() || '';
          const versionMatch = v.match(/Python (\d+)\.(\d+)\.(\d+)/);
          if (versionMatch) {
            const major = Number.parseInt(versionMatch[1], 10);
            const minor = Number.parseInt(versionMatch[2], 10);

            if (major < 3 || (major === 3 && minor < 7)) {
              warnings.push(`Python version ${major}.${minor} is outdated. Recommend Python 3.7+`);
            }
          }
        }
      } catch (_error) {
        warnings.push('Could not determine Python version');
      }
    }

    try {
      const pyspyProc = spawnSync(['py-spy', '--version'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if (pyspyProc.exitCode !== 0) {
        throw new Error('py-spy not found');
      }
    } catch {
      errors.push('py-spy is not installed or not in PATH');
      setupInstructions.push(
        chalk.bold('Install py-spy:'),
        '  pip install py-spy',
        '  Or: cargo install py-spy',
        '  ',
        '  Note: On some systems, you may need to install additional dependencies:',
        '  Ubuntu/Debian: sudo apt-get install libunwind-dev',
        '  macOS: Should work out of the box'
      );
    }

    if (process.env.VIRTUAL_ENV) {
      const venvPath = process.env.VIRTUAL_ENV;
      const venvName = path.basename(venvPath);
      warnings.push(`Virtual environment detected: ${venvName}`);
      warnings.push('py-spy will profile the Python interpreter in the virtual environment');
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

    const uvCacheDir = path.join(cacheBaseDir, 'uv');
    if (!fs.existsSync(uvCacheDir)) {
      fs.mkdirSync(uvCacheDir, { recursive: true });
    }
    volumes.push({
      hostPath: uvCacheDir,
      containerPath: '/root/.cache/uv',
    });

    const pipCacheDir = path.join(cacheBaseDir, 'pip');
    if (!fs.existsSync(pipCacheDir)) {
      fs.mkdirSync(pipCacheDir, { recursive: true });
    }
    volumes.push({
      hostPath: pipCacheDir,
      containerPath: '/root/.cache/pip',
    });

    const venvCacheDir = this.getProjectCacheDir(cacheBaseDir, cwd, 'venvs');
    if (!fs.existsSync(venvCacheDir)) {
      fs.mkdirSync(venvCacheDir, { recursive: true });
    }
    volumes.push({
      hostPath: venvCacheDir,
      containerPath: '/workspace/.venv',
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
    const containerOutputPath = '/workspace/profile.json';

    const containerArgs = args.map((arg, index) => {
      if (index === 0) {
        if (['python', 'python3', 'uv', 'pip', 'pip3', 'poetry', 'pipenv'].includes(arg)) {
          return arg;
        }
        return toContainerPath(cwd, arg);
      }
      return toContainerPath(cwd, arg);
    });
    const script = `set -e
source /usr/local/bin/bootstrap.sh
source /workspace/.venv/bin/activate 2>/dev/null || true
export PATH="/root/.local/bin:$PATH"

# Split pre-args (py-spy record args) and app args at '::'
PRE=()
while [ "$#" -gt 0 ]; do
  if [ "$1" = "::" ]; then shift; break; fi
  PRE+=("$1"); shift
done

# Start Python app in background
"$@" &
PID=$!

# Start py-spy attached to the PID
"\${PRE[@]}" --pid "$PID" &
SPY=$!

# Wait app, then stop py-spy gracefully
wait "$PID"; APP=$?
kill -INT "$SPY" 2>/dev/null || true
wait "$SPY" 2>/dev/null || true
exit "$APP"`;

    // Prevent overriding output path (-o/--output)
    const outStrip = stripOutputPathFlags(options.extraProfilerArgs, ['-o', '--output']);
    if (outStrip.removed.length) {
      printWarning(
        `Ignoring output-related flags in --extra-profiler-args for py-spy: ${outStrip.removed.join(' ')}`
      );
    }
    const pySpyArgs = ensureDefaultFlag(outStrip.filtered, ['--rate'], '999');
    const preArgs = [
      'py-spy',
      'record',
      '--format',
      'speedscope',
      '-o',
      containerOutputPath,
      '--subprocesses',
      ...pySpyArgs,
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
      profilerProcessNames: ['py-spy'],
    });

    // Check if profile was created first, as py-spy may return exit code 1
    // when the profiled process exits normally (vs being interrupted)
    const containerProfilePath = path.join(cwd, 'profile.json');
    let profileCreated = fs.existsSync(containerProfilePath);

    if (result.exitCode !== 0) {
      if (result.exitCode === 130 || result.exitCode === 143) {
        throw new Error('SIGINT');
      }

      // py-spy returns exit code 1 when the profiled process exits normally
      // Only treat as error if profile wasn't created
      if (result.exitCode === 1) {
        // Briefly retry in case py-spy is still flushing output
        if (!profileCreated) {
          for (let i = 0; i < 5 && !profileCreated; i++) {
            await new Promise((r) => setTimeout(r, 200));
            profileCreated = fs.existsSync(containerProfilePath);
          }
        }
        if (!profileCreated) {
          throw new Error(
            'py-spy did not produce a profile file. The target may have exited before py-spy initialized. Try profiling a longer-running command or add a short startup delay.'
          );
        }
        // Otherwise, profileCreated is true and we can continue
      } else {
        const { makeProfilerExitMessage } = await import('../utils/profiler-error.js');
        throw new Error(makeProfilerExitMessage(result.exitCode, result.stdout, result.stderr));
      }
    }

    if (profileCreated) {
      // Defer normalization/renaming and exporter tagging to postProcessProfile
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
    // Prevent overriding output path (-o/--output)
    const outStrip = stripOutputPathFlags(options.extraProfilerArgs, ['-o', '--output']);
    if (outStrip.removed.length) {
      printWarning(
        `Ignoring output-related flags in --extra-profiler-args for py-spy: ${outStrip.removed.join(' ')}`
      );
    }
    const extra = ensureDefaultFlag(outStrip.filtered, ['--rate'], '999');

    const preArgs = [
      'py-spy',
      'record',
      '--format',
      'speedscope',
      '-o',
      outputPath,
      '--subprocesses',
      ...extra,
    ];

    // Wrap in a small bash trampoline that treats py-spy exit code 1 as success
    // when the expected output file exists (py-spy quirk on normal target exit).
    const outEsc = shellEscape(outputPath);
    const script = `
PRE=()
while [ "$#" -gt 0 ]; do
  if [ "$1" = "::" ]; then shift; break; fi
  PRE+=("$1"); shift
done

"\${PRE[@]}" "$@"
code=$?
if [ "$code" -eq 1 ] && [ -f ${outEsc} ]; then
  exit 0
fi
exit "$code"`;

    // Include a literal "--" in the app args so the returned argv visibly
    // separates profiler args from the target command, matching other platforms
    // and tests. The script forwards "$@" directly, so only one separator is used.
    return buildBashTrampoline(script, preArgs, ['--', ..._args]);
  }

  async needsSudo(): Promise<boolean> {
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
        // Ignore errors reading ptrace scope
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
    return 'python your_script.py';
  }

  getSamplingRate(extraProfilerArgs?: string[]): number | null {
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
    return 999;
  }

  getAdvancedOptions() {
    return {
      description: 'py-spy supports additional options via --extra-profiler-args:',
      options: [
        { flag: '--rate <Hz>', description: 'sampling rate (default: 999)' },
        { flag: '--duration <sec>', description: 'Profile for specific duration' },
        { flag: '--native', description: 'Profile native C extensions' },
        { flag: '--threads', description: 'Show thread names' },
        { flag: '--gil', description: 'Only sample threads holding the GIL' },
        { flag: '--idle', description: 'Include idle threads' },
        { flag: '--nonblocking', description: "Don't pause the Python program" },
        { flag: '--subprocesses', description: 'profile subprocesses spawned by the target' },
      ],
      example: {
        description: 'Profile with higher sampling rate and native extensions',
        command:
          'uniprof record -o profile.json --extra-profiler-args --rate 500 --native -- python script.py',
      },
    };
  }
}
