import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import type { ProfilerEnvironmentCheck } from '../types/index.js';
import type {
  DockerVolume,
  PlatformPlugin,
  ProfileContext,
  RecordOptions,
} from '../types/platform-plugin.js';
import { mergeRuntimeEnv } from '../utils/profile-context.js';
import { readAll, spawn, spawnSync } from '../utils/spawn.js';
import { type PerfOptions, PerfPlatform } from './perf.js';

/**
 * BeamPlatform provides profiling support for BEAM VM applications (Erlang/OTP and Elixir)
 * using Linux perf with JIT integration.
 */
export class BeamPlatform implements PlatformPlugin {
  readonly name = 'beam';
  readonly profiler = 'perf';
  readonly extensions = ['.ex', '.exs', '.erl', '.hrl', '.app.src'];
  readonly executables = ['elixir', 'iex', 'erl', 'mix', 'rebar3', 'escript'];

  private perfPlatform: PerfPlatform;

  constructor() {
    // Configure perf with frame pointers for BEAM JIT
    const perfOptions: PerfOptions = {
      callGraphMode: 'fp', // Use frame pointers for Erlang JIT
      samplingRate: '999', // Default perf sampling rate
      treatExecutableAsCommand: true, // escript, elixir, erl, mix are commands, not binaries to copy
      hasJIT: true, // BEAM VM uses JIT compilation
      environmentVariables: {
        ERL_FLAGS: '+JPperf true', // Enable perf JIT integration for BEAM VM
      },
      containerImage: 'ghcr.io/indragiek/uniprof-beam:latest',
    };

    // Create a custom PerfPlatform that uses our exporter name
    class BeamPerfPlatform extends PerfPlatform {
      getExporterName(): string {
        return 'uniprof-beam';
      }
    }

    this.perfPlatform = new BeamPerfPlatform(perfOptions);
  }

  detectCommand(args: string[]): boolean {
    if (args.length === 0) return false;

    const command = path.basename(args[0]);

    // Check for direct executables
    if (this.executables.includes(command)) {
      return true;
    }

    // Check for common package manager patterns
    if (command === 'mix' || command === 'rebar3') {
      return true;
    }

    // Check for escript files
    if (args[0].endsWith('.escript')) {
      return true;
    }

    return false;
  }

  detectExtension(fileName: string): boolean {
    return this.extensions.some((ext) => fileName.endsWith(ext));
  }

  getExporterName(): string {
    return `uniprof-${this.name}`;
  }

  getProfilerName(mode: 'host' | 'container'): string {
    return this.perfPlatform.getProfilerName(mode);
  }

  async findExecutableInPath(): Promise<string | null> {
    return this.perfPlatform.findExecutableInPath();
  }

  supportsContainer(): boolean {
    return this.perfPlatform.supportsContainer();
  }

  getDefaultMode(args: string[]): 'host' | 'container' | 'auto' {
    return this.perfPlatform.getDefaultMode(args);
  }

  async needsSudo(): Promise<boolean> {
    return this.perfPlatform.needsSudo();
  }

  async cleanup(context: ProfileContext): Promise<void> {
    return this.perfPlatform.cleanup(context);
  }

  async postProcessProfile(
    rawOutputPath: string,
    finalOutputPath: string,
    context: ProfileContext
  ): Promise<void> {
    await this.perfPlatform.postProcessProfile(rawOutputPath, finalOutputPath, context);

    try {
      const { setProfileExporter } = await import('../utils/profile.js');
      await setProfileExporter(finalOutputPath, this.getExporterName());
    } catch (error) {
      const { printWarning } = await import('../utils/output-formatter.js');
      printWarning(`Could not update exporter field to BEAM: ${error}`);
    }
  }

  async checkLocalEnvironment(executablePath?: string): Promise<ProfilerEnvironmentCheck> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const setupInstructions: string[] = [];

    // On macOS, host mode is not supported
    if (process.platform === 'darwin') {
      errors.push('Local mode is not supported on macOS for Erlang/Elixir profiling');
      setupInstructions.push(
        chalk.bold('Erlang/Elixir profiling requires Linux perf'),
        '',
        'Use container mode instead (default):',
        '  uniprof record -o profile.json -- elixir script.exs',
        '',
        'Or explicitly:',
        '  uniprof record --mode container -o profile.json -- elixir script.exs'
      );
      return { isValid: false, errors, warnings, setupInstructions };
    }

    // Check Linux perf environment
    const perfCheck = await this.perfPlatform.checkLocalEnvironment(executablePath);
    errors.push(...perfCheck.errors);
    warnings.push(...perfCheck.warnings);
    setupInstructions.push(...perfCheck.setupInstructions);

    // Check for Erlang/Elixir installation
    const erlangFound = await this.checkErlangInstallation(errors, warnings, setupInstructions);
    const elixirFound = await this.checkElixirInstallation(warnings, setupInstructions);

    if (!erlangFound && !elixirFound) {
      errors.push('Neither Erlang nor Elixir is installed');
    }

    // Check for JIT support
    await this.checkJitSupport(warnings, setupInstructions);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      setupInstructions,
    };
  }

  private async checkErlangInstallation(
    _errors: string[],
    warnings: string[],
    setupInstructions: string[]
  ): Promise<boolean> {
    try {
      const versionProc = spawnSync(['erl', '-version'], { stdout: 'pipe', stderr: 'pipe' });
      if (versionProc.exitCode !== 0) throw new Error('Erlang version check failed');

      const otpProc = spawn(
        ['erl', '-noshell', '-eval', 'io:format("~s", [erlang:system_info(otp_release)]), halt().'],
        { stdout: 'pipe', stderr: 'pipe' }
      );
      const otpExitCode = await otpProc.exited;
      if (otpExitCode !== 0) throw new Error('OTP version check failed');
      const stdout = await readAll(otpProc.stdout);

      const otpVersion = Number.parseInt(stdout, 10);
      if (otpVersion < 24) {
        warnings.push(`Erlang/OTP ${stdout} detected. OTP 24+ recommended for JIT support`);
        setupInstructions.push(
          chalk.bold('Consider upgrading Erlang/OTP:'),
          '  # Ubuntu/Debian:',
          '  sudo apt-get update && sudo apt-get install erlang',
          '  # macOS:',
          '  brew install erlang',
          '  # Or use asdf/kerl for version management'
        );
      }

      return true;
    } catch {
      return false;
    }
  }

  private async checkElixirInstallation(
    warnings: string[],
    setupInstructions: string[]
  ): Promise<boolean> {
    try {
      const proc = spawnSync(['elixir', '--version'], { stdout: 'pipe', stderr: 'pipe' });
      if (proc.exitCode !== 0) throw new Error('Command failed');
      return true;
    } catch {
      warnings.push('Elixir is not installed (optional for Erlang projects)');
      setupInstructions.push(
        chalk.bold('To install Elixir:'),
        '  # Ubuntu/Debian:',
        '  sudo apt-get install elixir',
        '  # macOS:',
        '  brew install elixir',
        '  # Or use asdf for version management'
      );
      return false;
    }
  }

  private async checkJitSupport(warnings: string[], setupInstructions: string[]): Promise<void> {
    try {
      const proc = spawn(
        [
          'erl',
          '-noshell',
          '-eval',
          'case erlang:system_info(jit) of true -> io:format("enabled"); _ -> io:format("disabled") end, halt().',
        ],
        { stdout: 'pipe', stderr: 'pipe' }
      );
      const exitCode = await proc.exited;
      if (exitCode !== 0) throw new Error('Command failed');
      const stdout = await readAll(proc.stdout);

      if (stdout === 'disabled') {
        warnings.push('Erlang JIT is disabled. Profiling may be less accurate');
        setupInstructions.push(
          chalk.bold('JIT is disabled. To enable:'),
          '  Use Erlang/OTP 24 or newer (JIT introduced in OTP 24)',
          '  Ensure Erlang was compiled with JIT support',
          '  Check that your CPU architecture supports JIT (x86_64, aarch64)',
          '  Some distro packages disable JIT; consider using asdf/kerl or official builds'
        );
      }
    } catch {
      warnings.push('Could not check JIT status');
    }
  }

  getContainerCacheVolumes(cacheBaseDir: string, cwd: string): DockerVolume[] {
    const volumes: DockerVolume[] = [];

    // Elixir deps and build cache
    const elixirDirs = ['deps', '_build', '.mix', '.hex'];
    for (const dir of elixirDirs) {
      const hostPath = path.join(cwd, dir);
      if (fs.existsSync(hostPath)) {
        volumes.push({
          hostPath,
          containerPath: `/workspace/${dir}`,
        });
      }
    }

    // Erlang/rebar3 cache
    const rebar3CacheDir = this.getProjectCacheDir(cacheBaseDir, cwd, 'rebar3');
    volumes.push({
      hostPath: rebar3CacheDir,
      containerPath: '/root/.cache/rebar3',
    });

    // Hex cache for Elixir
    const hexCacheDir = this.getProjectCacheDir(cacheBaseDir, cwd, 'hex');
    volumes.push({
      hostPath: hexCacheDir,
      containerPath: '/root/.hex',
    });

    // Mix cache
    const mixCacheDir = this.getProjectCacheDir(cacheBaseDir, cwd, 'mix');
    volumes.push({
      hostPath: mixCacheDir,
      containerPath: '/root/.mix',
    });

    return volumes;
  }

  getContainerImage(): string {
    return 'ghcr.io/indragiek/uniprof-beam:latest';
  }

  async runProfilerInContainer(
    args: string[],
    outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): Promise<void> {
    // The ERL_FLAGS are already set in the PerfOptions passed to perfPlatform
    // The treatExecutableAsCommand flag ensures escript/elixir/erl are treated as commands
    return this.perfPlatform.runProfilerInContainer(args, outputPath, options, context);
  }

  buildLocalProfilerCommand(
    args: string[],
    outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): string[] {
    // Set ERL_FLAGS in the context for host execution (single runtimeEnv).
    mergeRuntimeEnv(context, { ERL_FLAGS: '+JPperf true' });

    return this.perfPlatform.buildLocalProfilerCommand(args, outputPath, options, context);
  }

  getExampleCommand(): string {
    return 'elixir script.exs';
  }

  getSamplingRate(extraProfilerArgs?: string[]): number | null {
    // Delegate to the underlying perf platform
    return this.perfPlatform.getSamplingRate(extraProfilerArgs);
  }

  getAdvancedOptions() {
    return {
      description:
        'Erlang/Elixir profiling uses Linux perf with JIT integration. The ERL_FLAGS="+JPperf true" flag is automatically set.',
      options: [
        { flag: '-F <freq>', description: 'Sampling frequency in Hz (default: 999)' },
        { flag: '-c <count>', description: 'Sample every N events' },
        { flag: '-t <tid>', description: 'Profile specific thread ID' },
        { flag: '--call-graph fp', description: 'Use frame pointers (default for Erlang JIT)' },
      ],
      example: {
        description: 'Profile an Elixir Mix application',
        command: 'uniprof record -o profile.json -- mix run --no-halt',
      },
    };
  }

  protected getProjectCacheDir(baseCacheDir: string, cwd: string, subdir: string): string {
    const projectHash = crypto.createHash('md5').update(cwd).digest('hex').substring(0, 8);
    const cacheDir = path.join(baseCacheDir, 'erlang', projectHash, subdir);

    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    return cacheDir;
  }
}
