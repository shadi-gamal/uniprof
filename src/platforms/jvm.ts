import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';
import type { ProfilerEnvironmentCheck } from '../types/index.js';
import type { DockerVolume, ProfileContext, RecordOptions } from '../types/platform-plugin.js';
import { cleanJavaProfile, convertBGFlameGraphFile } from '../utils/bg-flamegraph-trace.js';
import { stripOutputPathFlags } from '../utils/cli-parsing.js';
import { runContainer } from '../utils/docker.js';
import { printWarning } from '../utils/output-formatter.js';
import { toContainerPath } from '../utils/path-utils.js';
import { addTempFile, mergeRuntimeEnv, setRawArtifact } from '../utils/profile-context.js';
import { spawnSync } from '../utils/spawn.js';
import { buildBashTrampoline } from '../utils/trampoline.js';
import { BasePlatform } from './base-platform.js';

export class JvmPlatform extends BasePlatform {
  readonly name = 'jvm';
  readonly profiler = 'async-profiler';
  readonly extensions = ['.jar'];
  readonly executables = ['java'];

  detectCommand(args: string[]): boolean {
    if (args.length === 0) return false;
    const cmd = args[0];
    const basename = path.basename(cmd);

    if (basename === 'java') {
      return true;
    }

    if (cmd === './gradlew' || cmd.endsWith('/gradlew')) {
      return true;
    }

    if (cmd === './mvnw' || cmd.endsWith('/mvnw')) {
      return true;
    }

    if (basename.endsWith('.jar')) {
      return true;
    }

    return false;
  }

  async checkLocalEnvironment(executablePath?: string): Promise<ProfilerEnvironmentCheck> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const setupInstructions: string[] = [];

    let actualExecutablePath = executablePath;
    if (!actualExecutablePath) {
      const foundPath = await this.findExecutableInPath();
      if (!foundPath) {
        errors.push('Java is not installed or not in PATH');
        setupInstructions.push(
          chalk.bold('Install Java:'),
          '  macOS: brew install openjdk',
          '  Ubuntu/Debian: sudo apt-get install default-jdk',
          '  Windows: Download from https://adoptium.net/'
        );
      } else {
        actualExecutablePath = foundPath;
      }
    }

    if (actualExecutablePath) {
      try {
        const res = spawnSync([actualExecutablePath, '-version'], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const stderr = res.stderr?.toString() || '';
        const versionMatch = stderr.match(/version "(\d+)\.(\d+)/);
        if (versionMatch) {
          const major = Number.parseInt(versionMatch[1], 10);
          if (major < 8) warnings.push(`Java version ${major} is outdated. Recommend Java 8+`);
        }
      } catch (_error) {
        warnings.push('Could not determine Java version');
      }
    }

    const asyncProfilerPath = process.env.ASYNC_PROFILER_HOME;
    if (!asyncProfilerPath) {
      errors.push('ASYNC_PROFILER_HOME environment variable is not set');
      const platform = os.platform();
      if (platform === 'darwin') {
        setupInstructions.push(
          chalk.bold('Install async-profiler on macOS:'),
          '  1. Download macOS version from https://github.com/async-profiler/async-profiler/releases',
          '  2. Extract the archive (e.g., to /usr/local/async-profiler)',
          '  3. Set ASYNC_PROFILER_HOME environment variable:',
          '     export ASYNC_PROFILER_HOME=/usr/local/async-profiler',
          '  4. Add to your shell profile (~/.zshrc, ~/.bash_profile)'
        );
      } else {
        setupInstructions.push(
          chalk.bold('Install async-profiler:'),
          '  1. Download from https://github.com/async-profiler/async-profiler/releases',
          '  2. Extract the archive',
          '  3. Set ASYNC_PROFILER_HOME environment variable to the extracted directory',
          '  ',
          '  Example:',
          '  export ASYNC_PROFILER_HOME=/path/to/async-profiler'
        );
      }
    } else {
      const platform = os.platform();
      const libName = platform === 'darwin' ? 'libasyncProfiler.dylib' : 'libasyncProfiler.so';
      const libPath = path.join(asyncProfilerPath, 'lib', libName);

      if (!fs.existsSync(libPath)) {
        errors.push(`async-profiler library not found at ${libPath}`);
        setupInstructions.push(
          chalk.bold('Ensure async-profiler is properly installed:'),
          `  Expected library at: ${libPath}`,
          `  Make sure you downloaded the correct version for ${platform}`
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

    const m2CacheDir = path.join(cacheBaseDir, 'm2');
    if (!fs.existsSync(m2CacheDir)) {
      fs.mkdirSync(m2CacheDir, { recursive: true });
    }
    volumes.push({
      hostPath: m2CacheDir,
      containerPath: '/root/.m2',
    });

    const gradleCacheDir = path.join(cacheBaseDir, 'gradle');
    if (!fs.existsSync(gradleCacheDir)) {
      fs.mkdirSync(gradleCacheDir, { recursive: true });
    }
    volumes.push({
      hostPath: gradleCacheDir,
      containerPath: '/root/.gradle',
    });

    const buildCacheDir = this.getProjectCacheDir(cacheBaseDir, cwd, 'build');
    if (!fs.existsSync(buildCacheDir)) {
      fs.mkdirSync(buildCacheDir, { recursive: true });
    }
    volumes.push({
      hostPath: buildCacheDir,
      containerPath: '/workspace/build',
    });

    return volumes;
  }

  /**
   * Convert command-line style profiler arguments to agent format
   * For example: --threads --simple --rate 100
   * Becomes: threads,simple,interval=10000000 (rate converted to interval in ns)
   */
  private convertProfilerArgsToAgentFormat(args: string[]): string[] {
    const agentArgs: string[] = [];
    let i = 0;

    while (i < args.length) {
      const arg = args[i];

      // Skip if not a flag
      if (!arg.startsWith('--')) {
        i++;
        continue;
      }

      const option = arg.substring(2);

      let value: string | undefined;
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        value = args[i + 1];
        i += 2;
      } else {
        i++;
      }

      switch (option) {
        case 'threads':
        case 'simple':
        case 'norm':
        case 'sig':
        case 'lib':
        case 'total':
        case 'ann':
          agentArgs.push(option);
          break;
        case 'interval':
          if (value) {
            const interval = Number.parseInt(value, 10);
            if (!Number.isNaN(interval) && interval > 0) {
              agentArgs.push(`interval=${interval}ns`);
            } else {
              printWarning(`Invalid --interval value '${value}' for async-profiler; ignoring`);
            }
          }
          break;
        case 'duration':
          if (value) {
            agentArgs.push(`duration=${value}`);
          }
          break;
        case 'file':
          // Ignore file output; uniprof manages the output path
          break;
        default:
          if (value) {
            agentArgs.push(`${option}=${value}`);
          } else {
            agentArgs.push(option);
          }
          break;
      }
    }

    return agentArgs;
  }

  /**
   * Modify command to include async-profiler agent based on command type
   * Returns modified args and optional environment variables
   */
  private injectAgentPath(
    args: string[],
    outputPath: string,
    extraProfilerArgs?: string[],
    asyncProfilerHome?: string
  ): { args: string[]; env?: Record<string, string> } {
    return injectAsyncProfilerAgent(args, outputPath, extraProfilerArgs, asyncProfilerHome, (a) =>
      this.convertProfilerArgsToAgentFormat(a)
    );
  }

  private buildAgentPathString(
    outputPath: string,
    extraProfilerArgs: string[] | undefined,
    asyncProfilerHome: string
  ): string {
    return buildAsyncProfilerAgentPathString(
      outputPath,
      extraProfilerArgs,
      asyncProfilerHome,
      (a) => this.convertProfilerArgsToAgentFormat(a)
    );
  }

  async runProfilerInContainer(
    args: string[],
    _outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): Promise<void> {
    const cwd = path.resolve(options.cwd || process.cwd());
    const containerOutputPath = '/workspace/profile.collapsed';

    const bootstrapCmd = '/usr/local/bin/bootstrap.sh';

    // Inject agent configuration
    let result: { args: string[]; env?: Record<string, string> };
    try {
      // Strip any output file override before converting to agent args
      const { stripOutputPathFlags } = await import('../utils/cli-parsing.js');
      const outStrip = stripOutputPathFlags(options.extraProfilerArgs as string[] | undefined, [
        '--file',
      ]);
      if (outStrip.removed.length) {
        const { printWarning } = await import('../utils/output-formatter.js');
        printWarning(
          `Ignoring output-related flags in --extra-profiler-args for async-profiler: ${outStrip.removed.join(' ')}`
        );
      }

      result = this.injectAgentPath(
        args,
        containerOutputPath,
        outStrip.filtered,
        '/opt/async-profiler'
      );
    } catch (error) {
      throw new Error(`Failed to inject async-profiler agent: ${error}`);
    }

    // Map paths to container paths
    const containerArgs = result.args.map((arg, index) => {
      if (index === 0) return arg; // command itself
      if (arg.includes(containerOutputPath)) return arg;
      return toContainerPath(cwd, arg);
    });

    const envExports = result.env
      ? Object.entries(result.env)
          .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
          .join(' && ')
      : '';

    const script = `set -e
source ${bootstrapCmd}
${
  envExports
    ? `${envExports}
`
    : ''
}
# Skip the :: separator - since we're not using preArgs, it's the first argument
if [ "$1" = "::" ]; then shift; fi

exec "$@"`;
    const fullCommand = buildBashTrampoline(script, [], containerArgs);

    const cacheBaseDir = path.join(os.homedir(), '.cache', 'uniprof');
    const volumes = [
      { hostPath: cwd, containerPath: '/workspace' },
      ...this.getContainerCacheVolumes(cacheBaseDir, cwd),
    ];

    const containerResult = await runContainer({
      image: this.getContainerImage(),
      command: fullCommand,
      workdir: '/workspace',
      volumes: volumes.map((v) => `${v.hostPath}:${v.containerPath}`),
      capabilities: ['SYS_PTRACE'],
      verbose: options.verbose,
      captureOutput: !options.verbose,
      hostNetwork: !!options.enableHostNetworking,
      // JVM agent runs in-process; no separate profiler binary to exclude
      profilerProcessNames: [],
    });

    if (
      containerResult.exitCode !== 0 &&
      containerResult.exitCode !== 130 &&
      containerResult.exitCode !== 143
    ) {
      const { makeProfilerExitMessage } = await import('../utils/profiler-error.js');
      throw new Error(
        makeProfilerExitMessage(
          containerResult.exitCode,
          containerResult.stdout,
          containerResult.stderr
        )
      );
    }

    const collapsedPath = path.join(cwd, 'profile.collapsed');
    if (fs.existsSync(collapsedPath)) {
      // Defer conversion and exporter tagging to postProcessProfile
      setRawArtifact(context, 'collapsed', collapsedPath);
      addTempFile(context, collapsedPath);
    } else {
      throw new Error('Profile file was not created in container');
    }
  }

  buildLocalProfilerCommand(
    args: string[],
    outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): string[] {
    const asyncProfilerHome = process.env.ASYNC_PROFILER_HOME;
    if (!asyncProfilerHome) {
      throw new Error('ASYNC_PROFILER_HOME environment variable is not set');
    }

    const tempOutputPath = outputPath.replace('.json', '.collapsed');

    setRawArtifact(context, 'collapsed', tempOutputPath);

    // Build pre-args (agent) and apply consistently across host modes
    // Strip any output override flag before building agent args
    const outStrip = stripOutputPathFlags(options.extraProfilerArgs as string[] | undefined, [
      '--file',
    ]);
    if (outStrip.removed.length) {
      printWarning(
        `Ignoring output-related flags in --extra-profiler-args for async-profiler: ${outStrip.removed.join(' ')}`
      );
    }

    const agentPath = this.buildAgentPathString(
      tempOutputPath,
      outStrip.filtered,
      asyncProfilerHome
    );

    const cmd = args[0];
    const basename = path.basename(cmd);

    // For wrappers, set env-based pre-args
    if (cmd === './gradlew' || cmd.endsWith('/gradlew')) {
      mergeRuntimeEnv(context, { JAVA_TOOL_OPTIONS: agentPath });
      return args;
    }
    if (cmd === './mvnw' || cmd.endsWith('/mvnw')) {
      mergeRuntimeEnv(context, { MAVEN_OPTS: agentPath });
      return args;
    }

    // For jar, construct full command with pre-args
    if (basename.endsWith('.jar')) {
      return ['java', agentPath, '-jar', ...args];
    }

    // For direct java, inject pre-args before main class/jar
    if (basename === 'java') {
      const modifiedArgs = [...args];
      for (const a of modifiedArgs) {
        if (a.startsWith('-agentpath')) {
          throw new Error('Command already includes -agentpath. Cannot add async-profiler agent.');
        }
      }
      let insertIndex = 1;
      while (insertIndex < modifiedArgs.length) {
        const currentArg = modifiedArgs[insertIndex];
        if (currentArg === '-jar') break;
        if (!currentArg.startsWith('-')) break;
        if (currentArg.startsWith('-cp') || currentArg.startsWith('-classpath')) {
          insertIndex += 2;
        } else {
          insertIndex++;
        }
      }
      modifiedArgs.splice(insertIndex, 0, agentPath);
      return modifiedArgs;
    }

    // Fallback: return args unchanged
    return args;
  }

  async postProcessProfile(
    rawOutputPath: string,
    finalOutputPath: string,
    context: ProfileContext
  ): Promise<void> {
    const artifact = context.rawArtifact;

    if (artifact?.type === 'collapsed' && fs.existsSync(artifact.path)) {
      await convertBGFlameGraphFile(
        artifact.path,
        finalOutputPath,
        this.getExporterName(),
        'JVM Profile'
      );

      const profileData = JSON.parse(fs.readFileSync(finalOutputPath, 'utf8'));
      if (profileData.profiles?.[0]) {
        cleanJavaProfile(profileData.profiles[0]);
      }
      fs.writeFileSync(finalOutputPath, JSON.stringify(profileData, null, 2));

      const { finalizeProfile } = await import('../utils/profile-context.js');
      await finalizeProfile(context, finalOutputPath, finalOutputPath, this.getExporterName());
    } else if (fs.existsSync(rawOutputPath)) {
      // Fallback for already-speedscope JSON
      const { finalizeProfile } = await import('../utils/profile-context.js');
      await finalizeProfile(context, rawOutputPath, finalOutputPath, this.getExporterName());
    } else {
      throw new Error(`Profile file was not created at ${rawOutputPath}`);
    }
  }

  async needsSudo(): Promise<boolean> {
    // async-profiler typically needs elevated permissions for perf events
    if (os.platform() === 'linux') {
      try {
        const paranoidPath = '/proc/sys/kernel/perf_event_paranoid';
        if (fs.existsSync(paranoidPath)) {
          const paranoidLevel = Number.parseInt(fs.readFileSync(paranoidPath, 'utf8').trim(), 10);
          return paranoidLevel > 1;
        }
      } catch {
        // If we can't read the file, assume we need sudo
      }
      return true;
    }
    return false;
  }

  getExampleCommand(): string {
    return 'java -jar your-app.jar';
  }

  getSamplingRate(_extraProfilerArgs?: string[]): number | null {
    // async-profiler doesn't have a native --rate flag; default remains ~999Hz
    return 999;
  }

  getAdvancedOptions() {
    return {
      description: 'async-profiler supports additional options via --extra-profiler-args:',
      options: [
        { flag: '--interval <ns>', description: 'Sampling interval in nanoseconds' },
        { flag: '--duration <sec>', description: 'Profile for specific duration in seconds' },
        { flag: '--threads', description: 'Profile threads separately' },
        { flag: '--simple', description: 'Use simple class names instead of FQN' },
        { flag: '--sig', description: 'Include method signatures' },
        { flag: '--ann', description: 'Annotate JIT compilation levels' },
        { flag: '--lib', description: 'Prepend library names to symbols' },
        { flag: '--total', description: 'Count total metric value instead of samples' },
      ],
      example: {
        description: 'Profile with higher sampling rate and thread separation',
        command:
          'uniprof record -o profile.json --extra-profiler-args --interval 1000000 --threads -- java -jar app.jar',
      },
    };
  }
}

/**
 * Build the async-profiler -agentpath argument string.
 * A converter may be supplied to translate CLI-style args into agent options.
 */
export function buildAsyncProfilerAgentPathString(
  outputPath: string,
  extraProfilerArgs: string[] | undefined,
  asyncProfilerHome: string,
  convertArgs?: (args: string[]) => string[]
): string {
  const isContainer = asyncProfilerHome === '/opt/async-profiler';
  const libName = isContainer
    ? 'libasyncProfiler.so'
    : os.platform() === 'darwin'
      ? 'libasyncProfiler.dylib'
      : 'libasyncProfiler.so';
  const libPath = path.join(asyncProfilerHome, 'lib', libName);

  const agentArgs: string[] = ['start', 'event=cpu'];

  let hasUserInterval = false;
  if (extraProfilerArgs && extraProfilerArgs.length > 0) {
    for (let i = 0; i < extraProfilerArgs.length; i++) {
      if (extraProfilerArgs[i] === '--interval') {
        hasUserInterval = true;
        break;
      }
    }
  }
  if (!hasUserInterval) {
    agentArgs.push('interval=1001001ns');
  }
  agentArgs.push(`file=${outputPath}`, 'collapsed');
  if (extraProfilerArgs && extraProfilerArgs.length > 0) {
    const converted = convertArgs
      ? convertArgs(extraProfilerArgs)
      : (() => {
          const out: string[] = [];
          for (let i = 0; i < extraProfilerArgs.length; i++) {
            const opt = extraProfilerArgs[i];
            const next = extraProfilerArgs[i + 1];
            if (opt === '--interval' && typeof next === 'string') {
              const val = Number.parseInt(next, 10);
              if (Number.isFinite(val) && val > 0) out.push(`interval=${val}ns`);
              i++;
              continue;
            }
            if (next && !next.startsWith('--')) {
              out.push(`${opt}=${next}`);
              i++;
            } else {
              out.push(opt);
            }
          }
          return out;
        })();
    agentArgs.push(...converted);
  }
  return `-agentpath:${libPath}=${agentArgs.join(',')}`;
}

/**
 * Typed helper to inject the async-profiler agent. Exported for tests.
 */
export function injectAsyncProfilerAgent(
  args: string[],
  outputPath: string,
  extraProfilerArgs?: string[],
  asyncProfilerHome?: string,
  convertArgs?: (args: string[]) => string[]
): { args: string[]; env?: Record<string, string> } {
  if (!asyncProfilerHome) {
    throw new Error('asyncProfilerHome is required for injectAgentPath');
  }
  const agentPath = buildAsyncProfilerAgentPathString(
    outputPath,
    extraProfilerArgs,
    asyncProfilerHome,
    convertArgs
  );

  const cmd = args[0];
  const basename = path.basename(cmd);

  if (basename.endsWith('.jar')) {
    const newArgs = ['java', agentPath, '-jar', ...args];
    return { args: newArgs };
  }

  if (cmd === './gradlew' || cmd.endsWith('/gradlew')) {
    return {
      args,
      env: { JAVA_TOOL_OPTIONS: agentPath },
    };
  }

  if (cmd === './mvnw' || cmd.endsWith('/mvnw')) {
    return {
      args,
      env: { MAVEN_OPTS: agentPath },
    };
  }

  if (basename === 'java') {
    const modifiedArgs = [...args];

    for (const a of modifiedArgs) {
      if (a.startsWith('-agentpath')) {
        throw new Error('Command already includes -agentpath. Cannot add async-profiler agent.');
      }
    }

    let insertIndex = 1;
    while (insertIndex < modifiedArgs.length) {
      const currentArg = modifiedArgs[insertIndex];
      if (currentArg === '-jar') break;
      if (!currentArg.startsWith('-')) break;
      if (currentArg.startsWith('-cp') || currentArg.startsWith('-classpath')) {
        insertIndex += 2;
      } else {
        insertIndex++;
      }
    }

    modifiedArgs.splice(insertIndex, 0, agentPath);
    return { args: modifiedArgs };
  }

  throw new Error(`Unsupported command: ${cmd}`);
}
