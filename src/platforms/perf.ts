import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';
import type { ProfilerEnvironmentCheck } from '../types/index.js';
import type {
  DockerVolume,
  PlatformPlugin,
  ProfileContext,
  RecordOptions,
} from '../types/platform-plugin.js';
import { stripOutputPathFlags } from '../utils/cli-parsing.js';
import { runContainer } from '../utils/docker.js';
import { printWarning } from '../utils/output-formatter.js';
import { toContainerPath } from '../utils/path-utils.js';
import { addTempDir, addTempFile, setRawArtifact } from '../utils/profile-context.js';
import { readAll, spawn } from '../utils/spawn.js';
import { buildBashTrampoline, shellEscape } from '../utils/trampoline.js';
import { checkDependencies, hasDwarf, isValidBinary } from '../utils/validate-native-binary.js';
import { BasePlatform } from './base-platform.js';

export interface PerfOptions {
  samplingRate?: string;
  callGraphMode?: string;
  extraArgs?: string[];
  environmentVariables?: Record<string, string>;
  treatExecutableAsCommand?: boolean; // If true, don't copy executable, treat it as a command in container
  containerImage?: string; // Override the default container image
  hasJIT?: boolean; // If true, use -k 1 flag for JIT profiling
}

const DEFAULT_PERF_SAMPLING_RATE = '999';
const DEFAULT_PERF_CALL_GRAPH_MODE = 'dwarf';

export class PerfPlatform extends BasePlatform implements PlatformPlugin {
  readonly name = 'perf';
  readonly profiler = 'perf';
  readonly extensions: string[] = [];
  readonly executables = ['perf'];
  protected perfOptions: PerfOptions;

  constructor(perfOptions?: PerfOptions) {
    super();
    this.perfOptions = perfOptions || {};
  }

  detectCommand(args: string[]): boolean {
    if (args.length === 0) return false;

    const command = args[0];

    // Check for ELF binaries
    if (fs.existsSync(command)) {
      const stats = fs.statSync(command);
      if (stats.isFile()) {
        try {
          const buf = fs.readFileSync(command);
          if (buf.length >= 4) {
            const magicLE = buf.readUInt32LE(0);

            // ELF magic number: 0x7F454C46 ("\x7FELF")
            if (magicLE === 0x464c457f) {
              return true;
            }
          }
        } catch {
          // Can't read file, not a binary we can profile
        }
      }
    }

    return false;
  }

  getProfilerName(_mode: 'host' | 'container'): string {
    return 'perf';
  }

  getContainerImage(): string {
    // Use the specified container image or default to native
    return this.perfOptions.containerImage || 'ghcr.io/indragiek/uniprof-native:latest';
  }

  protected async validateBinary(filePath: string): Promise<{
    isValid: boolean;
    format?: string;
    hasDwarf?: boolean;
    dependencies?: { missing: string[]; errors: string[] };
  }> {
    const binaryCheck = isValidBinary(filePath);

    if (!binaryCheck.valid || (binaryCheck.format !== 'ELF' && binaryCheck.format !== 'Mach-O')) {
      return { isValid: false, format: binaryCheck.format };
    }

    const hasDwarfInfo = hasDwarf(filePath, binaryCheck.format);
    const dependencies = checkDependencies(filePath, binaryCheck.format);

    return {
      isValid: true,
      format: binaryCheck.format,
      hasDwarf: hasDwarfInfo,
      dependencies,
    };
  }

  async checkLocalEnvironment(executablePath?: string): Promise<ProfilerEnvironmentCheck> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const setupInstructions: string[] = [];

    if (process.platform !== 'linux') {
      errors.push('Linux perf is only available on Linux');
      setupInstructions.push(
        chalk.bold('Linux perf requires a Linux system'),
        '',
        'Consider using Docker mode (--mode container) for cross-platform profiling'
      );
      return { isValid: false, errors, warnings, setupInstructions };
    }

    const perfPath = await this.findExecutableInPath();
    if (!perfPath) {
      errors.push('perf is not installed or not in PATH');
      setupInstructions.push(
        chalk.bold('Install perf:'),
        '',
        'Ubuntu/Debian:',
        '  sudo apt-get install linux-tools-common linux-tools-generic linux-tools-`uname -r`',
        '',
        'RHEL/CentOS/Fedora:',
        '  sudo yum install perf',
        '  # or',
        '  sudo dnf install perf',
        '',
        'Arch Linux:',
        '  sudo pacman -S perf'
      );
    }

    await this.checkPerfPermissions(warnings, setupInstructions);

    if (executablePath && fs.existsSync(executablePath)) {
      await this.checkBinary(executablePath, errors, warnings, setupInstructions);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      setupInstructions,
    };
  }

  protected async checkPerfPermissions(
    warnings: string[],
    setupInstructions: string[]
  ): Promise<void> {
    try {
      const stdout = fs.readFileSync('/proc/sys/kernel/perf_event_paranoid', 'utf8');
      const level = Number.parseInt(stdout.trim(), 10);
      if (level > 1) {
        warnings.push('Kernel perf_event_paranoid level is restrictive');
        setupInstructions.push(
          chalk.bold('Grant perf event access:'),
          '',
          'Temporary (until reboot):',
          "  echo '1' | sudo tee /proc/sys/kernel/perf_event_paranoid",
          '',
          'Or more permanent:',
          '  sudo sysctl kernel.perf_event_paranoid=1',
          '',
          'You may also need to increase mlock limit:',
          '  sudo sysctl kernel.perf_event_mlock_kb=2048'
        );
      }
    } catch {
      warnings.push('Could not check kernel perf settings');
    }
  }

  protected async checkBinary(
    executablePath: string,
    errors: string[],
    warnings: string[],
    setupInstructions: string[]
  ): Promise<void> {
    const validation = await this.validateBinary(executablePath);

    if (!validation.isValid) {
      errors.push(`${executablePath} is not a valid binary`);
      return;
    }

    if (!validation.hasDwarf) {
      warnings.push(`${executablePath} lacks DWARF debug information`);
      setupInstructions.push(
        chalk.bold('For better profiling results, compile with debug info:'),
        '',
        'C/C++:',
        '  gcc -g ...',
        '  clang -g ...',
        '',
        'Rust:',
        '  Add to Cargo.toml:',
        '  [profile.release]',
        '  debug = true',
        '',
        'Go:',
        '  go build (includes debug info by default)'
      );
    }

    if (validation.dependencies) {
      const { errors: depErrors, missing } = validation.dependencies;
      for (const err of depErrors) {
        warnings.push(err);
      }
      if (missing.length > 0) {
        warnings.push(`Missing ${missing.length} dynamic dependencies:`);
        for (const dep of missing) {
          warnings.push(`  • ${dep}`);
        }
      }
    }
  }

  getContainerCacheVolumes(_cacheBaseDir: string, cwd: string): DockerVolume[] {
    const buildDirs = ['build', 'target', '.build', 'out'];

    return buildDirs
      .map((dir) => path.join(cwd, dir))
      .filter(fs.existsSync)
      .map((hostPath) => ({
        hostPath,
        containerPath: `/workspace/${path.basename(hostPath)}`,
      }));
  }

  async runProfilerInContainer(
    args: string[],
    _outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): Promise<void> {
    const cwd = path.resolve(options.cwd || process.cwd());
    let workspaceBinaryPath: string | undefined;
    let containerExecutablePath: string;
    let binaryName: string;
    let didCopyBinary = false;

    try {
      const executablePath = args[0];
      const containerArgs: string[] = [];

      if (this.perfOptions.treatExecutableAsCommand) {
        // Treat as command (e.g., escript, elixir, erl) - don't copy
        containerExecutablePath = executablePath;
        binaryName = executablePath;
        containerArgs.push(executablePath);

        // Map file paths to container paths for remaining arguments
        for (let i = 1; i < args.length; i++) {
          const arg = args[i];
          if (path.isAbsolute(arg) && !arg.startsWith(cwd)) {
            // Outside workspace: mount basename into /workspace
            containerArgs.push(`/workspace/${path.basename(arg)}`);
          } else {
            containerArgs.push(toContainerPath(cwd, arg));
          }
        }
      } else {
        // Treat as binary file
        const resolvedPath = path.resolve(cwd, executablePath);
        binaryName = path.basename(resolvedPath);

        // Check if the binary is already in the workspace directory
        const canonicalResolved = path.resolve(resolvedPath);
        const canonicalCwd = path.resolve(cwd);

        if (
          canonicalResolved.startsWith(canonicalCwd + path.sep) ||
          canonicalResolved === canonicalCwd
        ) {
          // Binary is already in workspace, use it directly
          workspaceBinaryPath = resolvedPath;
          didCopyBinary = false;
        } else {
          // Binary is outside workspace, copy it in. Bail if a file with the same
          // name already exists in the workspace to avoid accidental overwrite.
          workspaceBinaryPath = path.join(cwd, binaryName);

          if (fs.existsSync(workspaceBinaryPath)) {
            throw new Error(
              `A file named ${binaryName} already exists in the working directory. To avoid overwriting it, rename your executable or run uniprof from the directory containing your binary.\nWorking directory: ${cwd}\nBinary: ${resolvedPath}`
            );
          }

          if (fs.existsSync(resolvedPath) && !fs.lstatSync(resolvedPath).isDirectory()) {
            fs.copyFileSync(resolvedPath, workspaceBinaryPath);
            didCopyBinary = true;
          }
        }

        containerExecutablePath = `/workspace/${binaryName}`;
        containerArgs.push(containerExecutablePath);

        for (let i = 1; i < args.length; i++) {
          containerArgs.push(toContainerPath(cwd, args[i]));
        }
      }

      let hasDwarfInfo: boolean | null = null;
      if (workspaceBinaryPath && fs.existsSync(workspaceBinaryPath)) {
        const validation = await this.validateBinary(workspaceBinaryPath);
        hasDwarfInfo = validation.isValid ? !!validation.hasDwarf : null;
      }

      // Prefer DWARF when available for better stack traces, fallback to frame pointers
      const callGraphMode = this.perfOptions.callGraphMode || (hasDwarfInfo ? 'dwarf' : 'fp');

      if (hasDwarfInfo === false && !this.perfOptions.callGraphMode) {
        printWarning('Binary lacks DWARF debug info, using frame pointers for stack traces');
      }

      const combinedExtraArgs = [
        ...(this.perfOptions.extraArgs || []),
        ...(options.extraProfilerArgs || []),
      ];
      const perfCmd = this.buildPerfCommand(
        '/workspace/profile.perf',
        containerArgs,
        {
          ...options,
          extraProfilerArgs: combinedExtraArgs,
        },
        true,
        callGraphMode
      );

      // Pass the host cwd to the container so we can construct the correct virtiofs path
      const hostCwd = cwd;

      // Add environment variables if specified
      const envVars = this.perfOptions.environmentVariables || {};
      const envExport = Object.entries(envVars)
        .map(([key, value]) => `export ${key}='${value.replace(/'/g, "'\\''")}'`)
        .join('\n');

      const hostCwdEsc = shellEscape(hostCwd);
      const binPathEsc = shellEscape(containerExecutablePath);
      const binNameEsc = shellEscape(binaryName);

      // Split profiler command into pre-args (up to and including --) and app args after it
      const splitIdx = perfCmd.indexOf('--');
      const preArgs = splitIdx !== -1 ? perfCmd.slice(0, splitIdx + 1) : [...perfCmd, '--'];
      const appArgsAfter = splitIdx !== -1 ? perfCmd.slice(splitIdx + 1) : [];

      const jitInjectionScript = this.perfOptions.hasJIT
        ? `# Inject JIT symbol information (best-effort)
perf inject --jit -i /workspace/profile.perf -o /workspace/profile.jitted.perf || true

# Choose input for perf script
INFILE=/workspace/profile.jitted.perf
[ -f "$INFILE" ] || INFILE=/workspace/profile.perf

# Generate parsed script output (best-effort)
perf script -i "$INFILE" --symfs / > /workspace/profile.script || true`
        : `# Generate parsed script output (best-effort)
perf script -i /workspace/profile.perf --symfs / > /workspace/profile.script || true`;

      const scriptContent = this.perfOptions.treatExecutableAsCommand
        ? `set -e
${envExport}

# Split pre-args (perf record + options) and app args at '::'
PRE=()
while [ "$#" -gt 0 ]; do
  if [ "$1" = "::" ]; then shift; break; fi
  PRE+=("$1"); shift
done

# Run perf record with app args (no exec to allow post-processing)
"\${PRE[@]}" "$@"

${jitInjectionScript}`
        : `set -e
${options.verbose ? '/usr/local/bin/bootstrap.sh' : '/usr/local/bin/bootstrap.sh >/dev/null 2>&1 || true'}

HOST_CWD=${hostCwdEsc}
BIN_PATH=${binPathEsc}
BIN_NAME=${binNameEsc}

${envExport}

if [ -f "$BIN_PATH" ]; then
  chmod +x "$BIN_PATH"
fi

if [ -n "$HOST_CWD" ] && [ -f "$BIN_PATH" ]; then
  VIRTIOFS_PATH="/run/host_virtiofs$HOST_CWD"
  mkdir -p "$VIRTIOFS_PATH"
  ln -sf "$BIN_PATH" "$VIRTIOFS_PATH/$BIN_NAME"
  perf buildid-cache --add "$BIN_PATH" 2>/dev/null || true
fi

# Split pre-args (perf record + options) and app args at '::'
PRE=()
while [ "$#" -gt 0 ]; do
  if [ "$1" = "::" ]; then shift; break; fi
  PRE+=("$1"); shift
done

# Run perf record with app args (no exec to allow post-processing)
"\${PRE[@]}" "$@"

${jitInjectionScript}`;

      const volumes = [
        { hostPath: cwd, containerPath: '/workspace' },
        ...this.getContainerCacheVolumes(path.join(os.homedir(), '.cache', 'uniprof'), cwd),
      ];

      // Build trampoline command: perf record invocation is passed purely as argv
      // Use split pre-args and app args for the trampoline
      const command = buildBashTrampoline(scriptContent, preArgs, appArgsAfter);

      const result = await runContainer({
        image: this.getContainerImage(),
        command: command,
        workdir: '/workspace',
        volumes: volumes.map((v) => `${v.hostPath}:${v.containerPath}`),
        capabilities: ['SYS_ADMIN', 'SYS_PTRACE'],
        verbose: options.verbose,
        // Capture output when not verbose so we can surface diagnostics on failure
        captureOutput: !options.verbose,
        hostNetwork: !!options.enableHostNetworking,
        profilerProcessNames: ['perf', 'perf-record'],
      });

      if (result.exitCode !== 0) {
        if (result.exitCode === 130 || result.exitCode === 143) {
          throw new Error('SIGINT');
        }
        throw new Error(`Profiler exited with code ${result.exitCode}`);
      }

      const containerScriptPath = path.join(cwd, 'profile.script');
      if (!fs.existsSync(containerScriptPath)) {
        // Provide better diagnostics to the user
        const diag: string[] = [];
        diag.push('Profile script file was not created by perf script.');
        if (!options.verbose && result) {
          if (result.stderr) {
            diag.push('perf stderr:');
            diag.push(result.stderr.trim());
          }
          if (result.stdout) {
            diag.push('perf stdout:');
            diag.push(result.stdout.trim());
          }
        }
        diag.push(
          'Note: Symbol resolution inside containers can be limited. Ensure perf and perf script ran successfully. Try re-running with --verbose for more details.'
        );
        throw new Error(diag.join('\n'));
      }

      // Defer conversion and cleanup to postProcessProfile
      const { setRawArtifact, addTempFile } = await import('../utils/profile-context.js');
      setRawArtifact(context, 'perfscript', containerScriptPath);
      context.samplingHz = this.getSamplingRate(combinedExtraArgs) || 999;
      addTempFile(context, containerScriptPath);
      if (didCopyBinary && workspaceBinaryPath) addTempFile(context, workspaceBinaryPath);
    } catch (error) {
      // Only delete the binary if we copied it (don't delete original files in workspace)
      if (didCopyBinary && workspaceBinaryPath && fs.existsSync(workspaceBinaryPath)) {
        try {
          await fs.promises.unlink(workspaceBinaryPath);
        } catch {
          // Ignore cleanup errors
        }
      }
      throw error;
    }
  }

  buildLocalProfilerCommand(
    args: string[],
    _outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): string[] {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniprof-perf-'));
    const tempPerfFile = path.join(tempDir, 'profile.perf');

    setRawArtifact(context, 'perfdata', tempPerfFile);
    addTempFile(context, tempPerfFile);
    addTempDir(context, tempDir);

    const allExtraArgs = [
      ...(this.perfOptions.extraArgs || []),
      ...(options.extraProfilerArgs || []),
    ];
    // Store effective sampling rate for post-processing time calculations
    const samplingRate =
      this.getSamplingRate(allExtraArgs) ||
      Number.parseInt(this.perfOptions.samplingRate || DEFAULT_PERF_SAMPLING_RATE, 10);
    context.samplingHz = samplingRate;
    const callGraphMode = this.perfOptions.callGraphMode || DEFAULT_PERF_CALL_GRAPH_MODE;

    return this.buildPerfCommand(
      tempPerfFile,
      args,
      {
        ...options,
        extraProfilerArgs: allExtraArgs,
      },
      false,
      callGraphMode
    );
  }

  protected buildPerfCommand(
    outputFile: string,
    args: string[],
    options: RecordOptions,
    useBuildIdAll = false,
    callGraphMode?: string
  ): string[] {
    const samplingRate = this.perfOptions.samplingRate || DEFAULT_PERF_SAMPLING_RATE;
    const finalCallGraphMode =
      callGraphMode || this.perfOptions.callGraphMode || DEFAULT_PERF_CALL_GRAPH_MODE;

    const perfArgs = ['perf', 'record', '-g', '--call-graph', finalCallGraphMode];

    // Only add default sampling rate if user hasn't explicitly provided one
    const userArgs = options.extraProfilerArgs || [];
    const userHasFreq = userArgs.some((a) => a === '-F' || a.startsWith('-F') || a === '--freq');
    if (!userHasFreq) {
      perfArgs.splice(2, 0, '-F', samplingRate);
    }

    // Add -k mono flag for JIT profiling (required for perf inject --jit)
    if (this.perfOptions.hasJIT) {
      perfArgs.push('-k', 'mono');
    }

    perfArgs.push('-o', outputFile);

    if (useBuildIdAll) {
      perfArgs.push('--buildid-all');
    }

    // Prevent overriding output path (-o/--output) via extra args
    const outStrip = stripOutputPathFlags(options.extraProfilerArgs, ['-o', '--output']);
    if (outStrip.removed.length) {
      printWarning(
        `Ignoring output-related flags in --extra-profiler-args for perf: ${outStrip.removed.join(' ')}`
      );
    }

    if (outStrip.filtered?.length) {
      perfArgs.push(...outStrip.filtered);
    }

    perfArgs.push('--', ...args);

    return perfArgs;
  }

  async needsSudo(): Promise<boolean> {
    if (process.platform !== 'linux') {
      return false;
    }

    try {
      const stdout = fs.readFileSync('/proc/sys/kernel/perf_event_paranoid', 'utf8');
      const level = Number.parseInt(stdout.trim(), 10);
      return level > 1; // Needs sudo if paranoid level is restrictive
    } catch {
      return true; // Assume we need sudo if we can't check
    }
  }

  async postProcessProfile(
    _rawOutputPath: string,
    finalOutputPath: string,
    context: ProfileContext
  ): Promise<void> {
    const artifact = context.rawArtifact;
    const samplingHz = context.samplingHz || 999;

    if (artifact?.type === 'perfscript' && fs.existsSync(artifact.path)) {
      const { parsePerfScript, convertPerfEventsToSpeedscope } = await import(
        '../utils/perf-trace.js'
      );
      const scriptOutput = await fs.promises.readFile(artifact.path, 'utf8');
      const events = parsePerfScript(scriptOutput);
      const speedscopeData = convertPerfEventsToSpeedscope(
        events,
        this.getExporterName(),
        samplingHz
      );
      await fs.promises.writeFile(finalOutputPath, JSON.stringify(speedscopeData, null, 2));
      const { cleanupTemps } = await import('../utils/profile-context.js');
      await cleanupTemps(context);
      return;
    }

    if (artifact?.type === 'perfdata' && fs.existsSync(artifact.path)) {
      const speedscopeData = await this.convertPerfToSpeedscope(artifact.path, samplingHz);
      await fs.promises.writeFile(finalOutputPath, JSON.stringify(speedscopeData, null, 2));
      const { cleanupTemps } = await import('../utils/profile-context.js');
      await cleanupTemps(context);
      return;
    }

    throw new Error('Perf output not found for post-processing');
  }

  protected async convertPerfToSpeedscope(perfFile: string, samplingHz = 999): Promise<any> {
    let perfFileToUse = perfFile;
    let injectedFile: string | null = null;

    // If JIT profiling is enabled, inject JIT symbol information first
    if (this.perfOptions.hasJIT) {
      injectedFile = `${perfFile}.jitted`;
      const injectProc = spawn(['perf', 'inject', '--jit', '-i', perfFile, '-o', injectedFile], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const injectExitCode = await injectProc.exited;
      if (injectExitCode !== 0) {
        throw new Error(
          'perf inject --jit command failed. Ensure perf events are permitted (perf_event_paranoid <= 1), try running with sudo, and consider adding "-k 1" via --extra-profiler-args for JIT-heavy workloads.'
        );
      }
      perfFileToUse = injectedFile;
    }

    try {
      const proc = spawn(['perf', 'script', '-i', perfFileToUse], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) throw new Error('perf script command failed');
      const perfScript = await readAll(proc.stdout);
      const { parsePerfScript, convertPerfEventsToSpeedscope } = await import(
        '../utils/perf-trace.js'
      );
      const events = parsePerfScript(perfScript);
      return convertPerfEventsToSpeedscope(events, this.getExporterName(), samplingHz);
    } finally {
      // Clean up the injected file if we created one
      if (injectedFile && fs.existsSync(injectedFile)) {
        try {
          await fs.promises.unlink(injectedFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  async cleanup(context: ProfileContext): Promise<void> {
    if (context.tempFiles) {
      for (const f of context.tempFiles) {
        try {
          if (fs.existsSync(f)) await fs.promises.unlink(f);
        } catch {}
      }
    }
    if (context.tempDirs) {
      for (const d of context.tempDirs) {
        try {
          await fs.promises.rm(d, { recursive: true, force: true });
        } catch {}
      }
    }
  }

  getExampleCommand(): string {
    return './my-native-app';
  }

  getSamplingRate(extraProfilerArgs?: string[]): number | null {
    // Check if user provided -F or --freq flag
    if (extraProfilerArgs) {
      for (let i = 0; i < extraProfilerArgs.length; i++) {
        if (extraProfilerArgs[i] === '-F' || extraProfilerArgs[i] === '--freq') {
          if (i + 1 < extraProfilerArgs.length) {
            const rate = Number.parseInt(extraProfilerArgs[i + 1], 10);
            if (!Number.isNaN(rate)) {
              return rate;
            }
          }
        }
      }
    }
    // Return default rate
    const rate = this.perfOptions.samplingRate || DEFAULT_PERF_SAMPLING_RATE;
    return Number.parseInt(rate, 10);
  }

  getAdvancedOptions() {
    return {
      description: 'Linux perf profiling. Pass additional options with --extra-profiler-args',
      options: [
        { flag: '-F <freq>', description: 'Sampling frequency in Hz (default: 999)' },
        { flag: '-c <count>', description: 'Sample every N events' },
        { flag: '-t <tid>', description: 'Profile specific thread ID' },
        { flag: '-C <cpu>', description: 'Profile specific CPU' },
        { flag: '--call-graph <mode>', description: 'Call graph mode: fp, dwarf, lbr' },
      ],
      example: {
        description: 'Profile at 1000Hz sampling rate',
        command: 'uniprof record -o profile.json --extra-profiler-args "-F 1000" -- ./my-app',
      },
    };
  }
}
