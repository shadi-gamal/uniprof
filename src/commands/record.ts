import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';
import { platformRegistry } from '../platforms/registry.js';
import type { Mode, RunMode } from '../types/index.js';
import type { PlatformPlugin, ProfileContext, RecordOptions } from '../types/platform-plugin.js';
import { splitArgsQuoted } from '../utils/cli-parsing.js';
import { checkDockerEnvironment, pullContainerImage } from '../utils/docker.js';
import {
  printStep as basePrintStep,
  printSuccess as basePrintSuccess,
  createSpinner,
  formatDuration,
  printError,
  printInfo,
  printSection,
  printWarning,
} from '../utils/output-formatter.js';
import { filterPidsByDenylist, parsePidComm, parsePidPpidChildren } from '../utils/process-tree.js';
import { readAll, spawn, spawnSync } from '../utils/spawn.js';
import { isValidBinary } from '../utils/validate-native-binary.js';

async function determineRunMode(
  mode: Mode,
  args: string[],
  platform: PlatformPlugin
): Promise<RunMode> {
  if (mode === 'host' || mode === 'container') {
    return mode;
  }

  if (mode === 'auto') {
    const platformDefault = platform.getDefaultMode(args);

    if (platformDefault === 'host' || platformDefault === 'container') {
      return platformDefault;
    }

    // Platform returned 'auto', apply general heuristics
    // This is mainly for platforms that are flexible about their mode
    // Currently, this would apply to the PerfPlatform and others

    try {
      const proc = spawnSync(['docker', 'version'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if (proc.exitCode === 0) {
        return 'container';
      }
    } catch {
      // Docker not available
    }

    return 'host';
  }

  // Should not reach here, but default to container
  return 'container';
}

interface ExtendedRecordOptions extends RecordOptions {
  analyze?: boolean;
  visualize?: boolean;
  enableHostNetworking?: boolean;
  platform?: string;
  format?: 'pretty' | 'json';
}

function hasSignal(err: unknown): err is { signal?: string } {
  return typeof err === 'object' && err !== null && 'signal' in err;
}

function getErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    return typeof m === 'string' ? m : '';
  }
  return '';
}

export async function recordCommand(options: ExtendedRecordOptions, args: string[]): Promise<void> {
  // When analyze format is json AND --analyze is active, route human output to stderr
  // so stdout remains clean JSON for MCP and similar consumers.
  const useStderr = options.format === 'json' && !!options.analyze;
  const log = (...a: any[]) => (useStderr ? console.error(...a) : console.log(...a));
  const wPrintInfo = (m: string) =>
    useStderr ? console.error(chalk.blue('ℹ'), chalk.white(m)) : printInfo(m);
  const wPrintSection = (m: string) => {
    if (useStderr) {
      console.error();
      console.error(chalk.bold.white(`▶ ${m}`));
      console.error(chalk.gray('─'.repeat(50)));
    } else {
      printSection(m);
    }
  };
  const wPrintStep = (m: string) =>
    useStderr ? console.error(chalk.blue('→'), m) : basePrintStep(m);
  const wPrintSuccess = (m: string) =>
    useStderr ? console.error(chalk.green('✓'), chalk.white(m)) : basePrintSuccess(m);

  if (args.length === 0) {
    printError('No command specified');
    log();
    log('Usage:');
    log('  uniprof record -o profile.json -- /path/to/executable <args>');
    process.exit(1);
  }

  // Defer path validation until run mode is known so host mode can warn instead of block.

  // Check mutually exclusive options
  if (options.analyze && options.visualize) {
    printError('Options --analyze and --visualize are mutually exclusive');
    wPrintInfo('Please specify only one of these options');
    process.exit(1);
  }

  // Warn if --format is provided without --analyze (format only applies to analyze output)
  if (options.format && !options.analyze) {
    printWarning('--format is only used with --analyze; ignoring');
  }

  // Warn if --verbose is provided with --format json (verbose breaks JSON output)
  if (options.verbose && options.format === 'json') {
    printWarning('--verbose is ignored when --format json is specified');
    // Force verbose to false to prevent output corruption
    options.verbose = false;
  }

  // If cwd is specified, we need to resolve relative paths against it for platform detection
  const originalCwd = process.cwd();

  // Temporarily change to the specified working directory for platform detection
  if (options.cwd) {
    try {
      process.chdir(options.cwd);
    } catch (_error) {
      printError(`Failed to change to directory: ${options.cwd}`);
      process.exit(1);
    }
  }

  let platform: PlatformPlugin | null = null;
  if (options.platform) {
    platform = platformRegistry.get(options.platform);
    if (!platform) {
      printError(`Unknown platform: ${options.platform}`);
      wPrintInfo(`Supported platforms: ${platformRegistry.getSupportedPlatforms().join(', ')}`);
      process.exit(1);
    }
  } else {
    platform = await platformRegistry.detectFromCommand(args);
  }

  // Restore original working directory
  if (options.cwd) {
    process.chdir(originalCwd);
  }

  // Normalize extra-profiler-args: allow values provided as a single string
  // (possibly containing spaces) or as multiple tokens. After normalization,
  // options.extraProfilerArgs will be an argv-like string[] suitable for
  // passing directly to platform builders.
  if (Array.isArray(options.extraProfilerArgs) && options.extraProfilerArgs.length > 0) {
    const normalized = options.extraProfilerArgs.flatMap((v: string) => splitArgsQuoted(String(v)));
    options.extraProfilerArgs = normalized;
  }
  if (!platform) {
    printError('Could not detect platform from command');
    wPrintInfo(
      `Currently supported platforms: ${platformRegistry.getSupportedPlatforms().join(', ')}`
    );
    wPrintInfo('Make sure your command starts with a recognized executable');
    process.exit(1);
  }

  const userMode: Mode = options.mode || 'auto';
  const mode: RunMode = await determineRunMode(userMode, args, platform);

  // Windows host mode is not supported
  if (process.platform === 'win32' && mode === 'host') {
    printError('Host mode is not supported on Windows');
    wPrintInfo('Use --mode container (default) to run profiling in Docker');
    process.exit(1);
  }

  // Validate absolute paths relative to working directory. In host mode, skip warnings.
  // In container mode, error when any argument path lies outside the working directory.
  {
    const cwdForValidation = options.cwd ? path.resolve(options.cwd) : process.cwd();
    const { findUnmappedPaths, findUnmappedOptionValuePaths, isWindowsAbsolute } = await import(
      '../utils/path-utils.js'
    );
    const unmapped = findUnmappedPaths(cwdForValidation, args);
    if (unmapped.length > 0 && mode === 'container') {
      log();
      for (const p of unmapped) {
        const winAbs = isWindowsAbsolute(p);
        const msg = `Argument path is outside the working directory: ${p}${
          winAbs && process.platform !== 'win32'
            ? ' (Windows-style absolute path detected on non-Windows host)'
            : ''
        }`;
        printError(msg);
      }
      log();
      wPrintInfo('Run from your project directory and use relative paths under it.');
      wPrintInfo(`Working directory: ${chalk.cyan(cwdForValidation)}`);
      process.exit(1);
    }

    // Best-effort: warn about absolute paths embedded in option values (e.g., --opt=/abs/path)
    // This is non-fatal and serves as a hint for potential container path issues.
    if (mode === 'container') {
      const embedded = findUnmappedOptionValuePaths(cwdForValidation, args);
      const { findUnmappedFollowingOptionValuePaths } = await import('../utils/path-utils.js');
      const embeddedSeparated = findUnmappedFollowingOptionValuePaths(cwdForValidation, args);
      const allWarn = [...new Set([...embedded, ...embeddedSeparated])];
      if (allWarn.length > 0) {
        for (const p of allWarn) {
          const winAbs = isWindowsAbsolute(p);
          const msg = `Option value contains path outside working directory (not mounted): ${p}${
            winAbs && process.platform !== 'win32'
              ? ' (Windows-style absolute path detected on non-Windows host)'
              : ''
          }`;
          printWarning(msg);
        }
        wPrintInfo(
          'Use relative paths under the project directory or switch to --mode host if necessary.'
        );
      }
    }
  }

  if (mode === 'container' && platform.name === 'native' && os.platform() === 'darwin') {
    // Resolve the path relative to the working directory
    const execPath = options.cwd ? path.resolve(options.cwd, args[0]) : args[0];
    if (fs.existsSync(execPath)) {
      const binaryCheck = isValidBinary(execPath);
      if (binaryCheck.valid && binaryCheck.format === 'Mach-O') {
        printError('Container mode is not supported for Mach-O binaries on macOS');
        wPrintInfo('macOS native binaries must be profiled using Instruments (host mode)');
        wPrintInfo('Use --mode host or let auto mode select the appropriate mode');
        process.exit(1);
      } else if (binaryCheck.valid && binaryCheck.format === 'ELF') {
        wPrintInfo('ELF binary detected on macOS - using container mode');
      } else {
        // Unknown or non-binary launcher (e.g., wrapper scripts). Allow container mode.
        wPrintInfo('Non-Mach-O executable detected - allowing container mode');
      }
    } else {
      // Binary doesn't exist yet, allow container mode (will be compiled in container)
      wPrintInfo('Binary not found - will be compiled in container');
    }
  }

  const profilerName = platform.getProfilerName(mode);

  // If user requested host networking, verify availability and record a flag
  let hostNetworkingActive = false;
  if (options.enableHostNetworking && mode === 'container') {
    try {
      const { checkHostNetworkingEnabled } = await import('../utils/docker.js');
      const hostNet = await checkHostNetworkingEnabled();
      if (!hostNet.enabled) {
        printWarning(
          `Host networking requested but not enabled in Docker Desktop. Proceeding without it.\n\n${hostNet.diagnostics}`
        );
      } else {
        hostNetworkingActive = true;
      }
    } catch (e: any) {
      printWarning(`Could not verify host networking: ${e?.message || e}`);
    }
  }

  log(
    chalk.green('✓'),
    chalk.white('Platform detected:'),
    chalk.gray(platform.name),
    chalk.white('| Using profiler:'),
    chalk.gray(profilerName),
    chalk.white('| Mode:'),
    chalk.gray(mode),
    hostNetworkingActive ? chalk.white('| Host networking:') : '',
    hostNetworkingActive ? chalk.gray('enabled') : ''
  );

  // Immediately print the starting profile line with sampling rate, no preceding newline
  let startingSamplingRateText = '';
  if ('getSamplingRate' in platform && typeof platform.getSamplingRate === 'function') {
    const rate = platform.getSamplingRate(options.extraProfilerArgs);
    startingSamplingRateText =
      rate === null
        ? chalk.gray(' (sampling rate not configurable)')
        : chalk.gray(` (${rate} Hz sampling rate)`);
  }
  wPrintStep(`${chalk.white('Starting profile')}${startingSamplingRateText}`);

  // Generate temporary output path if not provided and using --analyze or --visualize
  let outputPath: string;

  if (!options.output && (options.analyze || options.visualize)) {
    const tmpDir = os.tmpdir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const randomId = randomBytes(4).toString('hex');
    outputPath = path.join(tmpDir, `uniprof-${timestamp}-${randomId}.json`);
  } else {
    outputPath = path.resolve(options.output!);
  }
  const outputDir = path.dirname(outputPath);

  if (fs.existsSync(outputPath)) {
    const stats = fs.statSync(outputPath);
    if (stats.isDirectory()) {
      printError(`Output path is a directory: ${outputPath}`);
      wPrintInfo('Please specify a file path, not a directory');
      process.exit(1);
    }
    try {
      fs.unlinkSync(outputPath);
    } catch (_error) {
      printError(`Failed to remove existing file: ${outputPath}`);
      process.exit(1);
    }
  }

  if (!fs.existsSync(outputDir)) {
    try {
      fs.mkdirSync(outputDir, { recursive: true });
    } catch (_error) {
      printError(`Failed to create output directory: ${outputDir}`);
      process.exit(1);
    }
  }

  const startTime = Date.now();
  const profileSpinner = options.verbose ? null : createSpinner('Profiling in progress...');
  if (profileSpinner) {
    const info = chalk.gray(
      'Profiling will continue until the profiled program exits.\n' +
        'Press Ctrl+C once to terminate the profiled program and twice to terminate uniprof\n'
    );
    profileSpinner.text = `Profiling in progress...\n${info}`;
  }

  const profileContext: ProfileContext = {};

  try {
    if (mode === 'container') {
      if (!platform.supportsContainer()) {
        printError(`Container mode is not supported for ${platform.name}`);
        wPrintInfo('Please use --mode host to run with host-installed profiler');
        process.exit(1);
      }

      const dockerSpinner = options.verbose
        ? null
        : createSpinner('Checking Docker environment...');
      dockerSpinner?.start();

      const dockerCheck = await checkDockerEnvironment();
      dockerSpinner?.stop();

      if (!dockerCheck.isValid) {
        for (const error of dockerCheck.errors) {
          printError(error);
        }
        log();
        wPrintInfo('Run "uniprof bootstrap" for Docker setup instructions');
        process.exit(1);
      }

      await pullContainerImage(platform.name, true);

      if (profileSpinner) {
        profileSpinner.start();
      }

      // UI feedback on first Ctrl+C while container profiling is running
      let uiFirstSigint = false;
      const uiSigintHandler = () => {
        if (uiFirstSigint || !profileSpinner) return;
        uiFirstSigint = true;
        const info = chalk.gray(
          'Profiling will continue until the profiled program exits.\n' +
            'Press Ctrl+C once to terminate the profiled program and twice to terminate uniprof\n'
        );
        profileSpinner.text = `Stopping profiled program...\n${info}`;
      };
      process.on('SIGINT', uiSigintHandler);
      process.on('SIGTERM', uiSigintHandler);

      await platform.runProfilerInContainer(args, outputPath, options, profileContext);
      // Dev-time assertion: ensure container runs set a rawArtifact for post-processing
      if (!profileContext.rawArtifact) {
        const { setRawArtifact } = await import('../utils/profile-context.js');
        printWarning(
          'Platform did not set ctx.rawArtifact during container run; defaulting to speedscope at output path'
        );
        setRawArtifact(profileContext, 'speedscope', outputPath);
      }

      process.off('SIGINT', uiSigintHandler);
      process.off('SIGTERM', uiSigintHandler);
    } else {
      const envSpinner = createSpinner('Checking environment...');
      envSpinner?.start();

      const environmentCheck = await platform.checkLocalEnvironment(args[0]);
      envSpinner?.stop();

      if (!environmentCheck.isValid) {
        for (const error of environmentCheck.errors) {
          printError(error);
        }
        log();
        wPrintInfo('Run "uniprof bootstrap --mode host" for setup instructions');
        process.exit(1);
      }

      if (environmentCheck.warnings.length > 0) {
        for (const warning of environmentCheck.warnings) {
          printWarning(warning);
        }
      }

      if (profileSpinner) {
        profileSpinner.start();
      }

      const profilerCmd = platform.buildLocalProfilerCommand(
        args,
        outputPath,
        options,
        profileContext
      );

      const needsSudo = await platform.needsSudo();
      if (needsSudo && !profilerCmd[0].startsWith('sudo')) {
        if (profileSpinner) {
          profileSpinner.stop();
        }

        log();
        wPrintSection('Root Privileges Required');
        if (os.platform() === 'darwin') {
          wPrintInfo(
            `${platform.profiler} requires root privileges on macOS due to System Integrity Protection.`
          );
          wPrintInfo('This is necessary to read the memory of the process.');
        } else if (os.platform() === 'linux') {
          wPrintInfo(
            `${platform.profiler} requires root privileges on Linux to attach to processes.`
          );
          wPrintInfo('This is due to ptrace restrictions (ptrace_scope is not 0).');
        }
        log();
        wPrintInfo(`You will be prompted for your password to run ${platform.profiler} with sudo.`);
        log();

        profilerCmd.unshift('sudo');
        if (profileSpinner) {
          const info = chalk.gray(
            'Profiling will continue until the profiled program exits.\n' +
              'Press Ctrl+C once to terminate the profiled program and twice to terminate uniprof\n'
          );
          profileSpinner.start();
          profileSpinner.text = `Profiling in progress (running with sudo)...\n${info}`;
        }
      }

      const subprocess = spawn([profilerCmd[0], ...profilerCmd.slice(1)], {
        stdin: 'inherit',
        stdout: options.verbose ? 'inherit' : 'pipe',
        stderr: options.verbose ? 'inherit' : 'pipe',
        cwd: options.cwd || process.cwd(),
        env: {
          ...process.env,
          ...(profileContext.runtimeEnv || {}),
        },
      });

      // Two-stage Ctrl+C handling for host mode
      let firstSigintAt: number | null = null;
      const sigintWindowMs = 2000;
      let hardExitRequested = false;

      async function listChildPidsRecursive(parentPid: number): Promise<number[]> {
        try {
          const ps = spawnSync(['ps', '-eo', 'pid,ppid']);
          const text = ps.stdout?.toString() || '';
          return parsePidPpidChildren(text, parentPid);
        } catch {
          return [];
        }
      }

      async function sendSigintToChildrenOf(pid: number): Promise<number> {
        const pids = await listChildPidsRecursive(pid);
        // Map PID -> command name
        let targets = pids;
        if (pids.length) {
          try {
            const ps = spawnSync(['ps', '-o', 'pid,comm', '-p', pids.join(',')], {
              stdout: 'pipe',
            });
            const text = ps.stdout?.toString() || '';
            const pidToComm = parsePidComm(text);
            const deny = platform!.getProfilerProcessNames?.() || [platform!.profiler];
            targets = filterPidsByDenylist(pids, pidToComm, deny);
          } catch {}
        }
        if (options.verbose) {
          if (targets.length) {
            log(chalk.yellow(`Signalling SIGINT to child PIDs: ${targets.join(', ')}`));
          } else {
            log(chalk.yellow('No eligible child processes found yet; retrying...'));
          }
        }
        for (const cpid of targets) {
          try {
            process.kill(cpid, 'SIGINT');
          } catch {}
        }
        return targets.length;
      }

      const onSigint = async () => {
        const now = Date.now();
        if (firstSigintAt && now - firstSigintAt <= sigintWindowMs) {
          // Second Ctrl+C: terminate profiler and mark for hard exit after cleanup
          hardExitRequested = true;
          try {
            await sendSigintToChildrenOf(subprocess.pid!);
          } catch {}
          try {
            subprocess.kill('SIGINT');
          } catch {}
          if (profileSpinner) profileSpinner.stop();
          return;
        }
        // First Ctrl+C: signal profiled program(s) only
        firstSigintAt = now;
        if (profileSpinner) {
          const info = chalk.gray(
            'Profiling will continue until the profiled program exits.\n' +
              'Press Ctrl+C once to terminate the profiled program and twice to terminate uniprof\n'
          );
          profileSpinner.text = `Stopping profiled program...\n${info}`;
        }
        // Try to signal children; retry briefly if none yet
        let signalled = await sendSigintToChildrenOf(subprocess.pid!);
        if (signalled === 0) {
          for (let i = 0; i < 10 && signalled === 0; i++) {
            await new Promise((r) => setTimeout(r, 100));
            signalled = await sendSigintToChildrenOf(subprocess.pid!);
          }
        }
        if (signalled === 0 && process.platform !== 'win32') {
          // As a last resort on POSIX systems, signal the profiler's process group with SIGINT.
          // This can reach foreground children not yet observable via ps, but may also signal the
          // profiler itself depending on the platform's process group semantics. The denylist above
          // minimizes first-order impact; this fallback is only used when no eligible children were
          // detected after several retries, to favor profile finalization over a hung session.
          try {
            // Negative PID sends to process group
            process.kill(-subprocess.pid!, 'SIGINT');
            if (options.verbose) {
              log(chalk.yellow(`Fallback: signalled SIGINT to process group: -${subprocess.pid}`));
            }
          } catch {}
        }
      };

      process.on('SIGINT', onSigint);
      process.on('SIGTERM', onSigint);

      let exitCode: number | null = null;
      let signalCode: string | null = null;
      let stderr = '';
      let stdout = '';
      let waitStderr: Promise<void> | null = null;
      let waitStdout: Promise<void> | null = null;

      try {
        if (!options.verbose) {
          waitStderr = readAll(subprocess.stderr).then((s) => {
            stderr = s;
          });
          waitStdout = readAll(subprocess.stdout).then((s) => {
            stdout = s;
          });
        }

        exitCode = await subprocess.exited;
        signalCode = subprocess.signalCode;
      } catch (_error: any) {
        exitCode = 130;
        signalCode = 'SIGTERM';
      } finally {
        // Ensure we've fully drained captured streams before handling exit
        if (waitStderr) {
          try {
            await waitStderr;
          } catch {}
        }
        if (waitStdout) {
          try {
            await waitStdout;
          } catch {}
        }
        process.off('SIGINT', onSigint);
        process.off('SIGTERM', onSigint);
      }

      if ((exitCode ?? 0) !== 0) {
        if (profileSpinner) {
          profileSpinner.stop();
        }

        if (
          signalCode === 'SIGTERM' ||
          signalCode === 'SIGINT' ||
          exitCode === 130 ||
          exitCode === 143 ||
          hardExitRequested
        ) {
          log();
          printWarning('Profiling cancelled by user');
          process.exit(130);
        } else {
          printError(`Profiling failed with exit code ${exitCode}`);
          if (stderr) {
            log();
            log(chalk.red('Error output:'));
            log(stderr);
          }
          if (stdout) {
            log();
            log(chalk.red('Program output:'));
            log(stdout);
          }
          process.exit(1);
        }
      }

      // Host-mode post-processing is handled uniformly below
    }

    const duration = Date.now() - startTime;
    if (profileSpinner) {
      profileSpinner.stop();
    }

    log();
    wPrintSuccess(`Profiling completed successfully in ${formatDuration(duration)}`);

    // Perform post-processing for both host and container modes if the platform provides it.
    if (platform.postProcessProfile) {
      const rawPath = profileContext.rawArtifact?.path || outputPath;
      await platform.postProcessProfile(rawPath, outputPath, profileContext);
    }

    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      const filePart = chalk.cyan(outputPath);
      const sizePart = chalk.gray(` (${(stats.size / 1024).toFixed(2)} KB)`);
      log(chalk.gray('Profile saved:'), filePart + sizePart);

      // Run analyze or visualize if requested
      if (options.analyze) {
        const { analyzeCommand } = await import('./analyze.js');
        await analyzeCommand(outputPath, { format: options.format });
      } else if (options.visualize) {
        const { visualizeCommand } = await import('./visualize.js');
        await visualizeCommand(outputPath, {});
      } else {
        wPrintSection('Next Steps');
        log('Analyze the profile with:');
        log(chalk.cyan(`  uniprof analyze ${outputPath}`));
        log();
        log('Visualize the profile with:');
        log(chalk.cyan(`  uniprof visualize ${outputPath}`));
      }
    } else {
      printError('Profile file was not created');
      process.exit(1);
    }
  } catch (error: unknown) {
    if (profileSpinner) {
      profileSpinner.stop();
    }

    const msg = getErrorMessage(error);
    if (
      (hasSignal(error) && error.signal === 'SIGTERM') ||
      (hasSignal(error) && error.signal === 'SIGINT') ||
      msg === 'SIGINT' ||
      msg.includes('was killed with') ||
      msg.includes('Command failed with exit code 130')
    ) {
      log();
      printWarning('Profiling cancelled by user');
      process.exit(130);
    } else {
      printError(
        mode === 'container' ? 'Failed to run profiler in container' : 'Failed to start profiling'
      );
      if (msg) {
        log(chalk.red(msg));
      }

      if (msg?.includes('sudo')) {
        log();
        wPrintInfo('This platform requires elevated privileges for profiling');
        wPrintInfo('Try running the command with sudo');
      }

      process.exit(1);
    }
  } finally {
    if (platform.cleanup) {
      try {
        await platform.cleanup(profileContext);
      } catch (cleanupError) {
        // Log cleanup errors but don't fail the command
        printWarning(`Cleanup failed: ${cleanupError}`);
      }
    }
  }
}
