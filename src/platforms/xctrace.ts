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
import { printWarning } from '../utils/output-formatter.js';
import { addTempDir, addTempFile, setRawArtifact } from '../utils/profile-context.js';
import { spawnSync } from '../utils/spawn.js';
import { checkDependencies, hasDwarf, isValidBinary } from '../utils/validate-native-binary.js';
import { BasePlatform } from './base-platform.js';

export class XctracePlatform extends BasePlatform implements PlatformPlugin {
  readonly name = 'xctrace';
  readonly profiler = 'instruments';
  readonly extensions: string[] = [];
  readonly executables = ['xcrun'];

  detectCommand(args: string[]): boolean {
    if (args.length === 0) return false;

    const command = args[0];

    // Check for .app bundles
    if (command.endsWith('.app')) {
      if (fs.existsSync(command)) {
        const stats = fs.statSync(command);
        if (stats.isDirectory()) {
          // This is a macOS application bundle
          return true;
        }
      }
    }

    // Check for Mach-O binaries
    if (fs.existsSync(command)) {
      const stats = fs.statSync(command);
      if (stats.isFile()) {
        try {
          const buf = fs.readFileSync(command);
          if (buf.length >= 4) {
            const magicBE = buf.readUInt32BE(0);

            // Mach-O magic numbers
            const MACHO_MAGICS = [
              0xfeedface, // 32-bit
              0xcefaedfe, // 32-bit swapped
              0xfeedfacf, // 64-bit
              0xcffaedfe, // 64-bit swapped
              0xcafebabe, // FAT binary
              0xcafebabf, // FAT binary (64-bit offsets)
            ];

            if (MACHO_MAGICS.includes(magicBE)) {
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
    return 'instruments';
  }

  protected async validateBinary(filePath: string): Promise<{
    isValid: boolean;
    format?: string;
    hasDwarf?: boolean;
    dependencies?: { missing: string[]; errors: string[] };
  }> {
    const binaryCheck = isValidBinary(filePath);

    if (!binaryCheck.valid || binaryCheck.format !== 'Mach-O') {
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

    if (process.platform !== 'darwin') {
      errors.push('xctrace/Instruments is only available on macOS');
      setupInstructions.push(
        chalk.bold('macOS Instruments requires macOS'),
        '',
        'Consider using Docker mode (--mode container) for cross-platform profiling'
      );
      return { isValid: false, errors, warnings, setupInstructions };
    }

    try {
      const proc = spawnSync(['xcrun', '--version'], { stdout: 'pipe', stderr: 'pipe' });
      if (proc.exitCode !== 0) {
        throw new Error('Command failed');
      }
      try {
        const proc2 = spawnSync(['xcrun', 'xctrace', 'version'], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        if (proc2.exitCode !== 0) {
          throw new Error('Command failed');
        }
      } catch {
        errors.push('xctrace is not available');
        setupInstructions.push(
          chalk.bold('Install Xcode Command Line Tools:'),
          '  xcode-select --install',
          '',
          'Or install full Xcode from the App Store'
        );
      }
    } catch {
      errors.push('Xcode Command Line Tools are not installed');
      setupInstructions.push(
        chalk.bold('Install Xcode Command Line Tools:'),
        '  xcode-select --install',
        '',
        'This includes the xcrun and xctrace tools needed for profiling'
      );
    }

    if (executablePath && fs.existsSync(executablePath)) {
      // Resolve .app bundle if needed
      try {
        const resolvedPath = this.resolveAppBundle(executablePath);
        await this.checkBinary(resolvedPath, errors, warnings, setupInstructions);
      } catch (error) {
        if (error instanceof Error) {
          errors.push(error.message);
        } else {
          errors.push(`Failed to resolve application: ${error}`);
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

  protected async checkBinary(
    executablePath: string,
    errors: string[],
    warnings: string[],
    setupInstructions: string[]
  ): Promise<void> {
    const validation = await this.validateBinary(executablePath);

    if (!validation.isValid) {
      errors.push(`${executablePath} is not a valid Mach-O binary`);
      return;
    }

    if (!validation.hasDwarf) {
      warnings.push(`${executablePath} lacks DWARF debug information`);
      setupInstructions.push(
        chalk.bold('For better profiling results, compile with debug info:'),
        '',
        'C/C++:',
        '  clang -g ...',
        '',
        'Rust:',
        '  Add to Cargo.toml:',
        '  [profile.release]',
        '  debug = true',
        '',
        'Go:',
        '  go build (includes debug info by default)',
        '',
        'Swift:',
        '  swiftc -g ...'
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

  protected resolveAppBundle(appPath: string): string {
    // Check if path ends with .app
    if (!appPath.endsWith('.app')) {
      return appPath;
    }

    const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');

    // Check if Info.plist exists
    if (!fs.existsSync(infoPlistPath)) {
      throw new Error(
        `Invalid .app bundle: Info.plist not found at ${infoPlistPath}\nRemediation: Ensure you are pointing to a valid macOS .app. If building locally, verify your app bundle contains a Contents/Info.plist file.`
      );
    }

    // Use PlistBuddy to read CFBundleExecutable
    const result = spawnSync(
      ['/usr/libexec/PlistBuddy', '-c', 'Print :CFBundleExecutable', infoPlistPath],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );

    if (result.exitCode !== 0) {
      const stderr = result.stderr?.toString() || '';
      if (stderr.includes('Does Not Exist')) {
        throw new Error(
          `Invalid .app bundle: CFBundleExecutable key not found in Info.plist\nPath: ${infoPlistPath}\nRemediation: Open Info.plist and add CFBundleExecutable (the main executable name), or ensure your build system sets it.`
        );
      }
      throw new Error(
        `Failed to read Info.plist: ${stderr}\nPath: ${infoPlistPath}\nRemediation: Verify /usr/libexec/PlistBuddy can read the plist, and that the plist is a valid XML/binary property list.`
      );
    }

    const executableName = result.stdout?.toString().trim();
    if (!executableName) {
      throw new Error(
        `Invalid .app bundle: CFBundleExecutable is empty in Info.plist\nPath: ${infoPlistPath}\nRemediation: Set CFBundleExecutable to your app's binary name (as found under Contents/MacOS).`
      );
    }

    // Construct path to the actual executable
    const executablePath = path.join(appPath, 'Contents', 'MacOS', executableName);

    // Check if executable exists
    if (!fs.existsSync(executablePath)) {
      throw new Error(
        `Invalid .app bundle: Executable not found at expected location\nExpected: ${executablePath}\nBundle: ${appPath}\nRemediation: Ensure your build places the binary at Contents/MacOS/<CFBundleExecutable>.`
      );
    }

    // Check if file is executable
    try {
      fs.accessSync(executablePath, fs.constants.X_OK);
    } catch {
      throw new Error(
        `Invalid .app bundle: File exists but is not executable\nPath: ${executablePath}\nRemediation: chmod +x the file or adjust your build to set executable permissions.`
      );
    }

    return executablePath;
  }

  supportsContainer(): boolean {
    // xctrace is macOS-only and requires host Instruments
    return false;
  }

  getDefaultMode(_args: string[]): 'host' | 'container' | 'auto' {
    // xctrace only supports host mode
    return 'host';
  }

  getContainerCacheVolumes(): DockerVolume[] {
    // xctrace doesn't support container mode, so no volumes needed
    return [];
  }

  getContainerImage(): string {
    // xctrace doesn't support container mode
    throw new Error('Container mode is not supported for macOS xctrace profiling');
  }

  getProfilerProcessNames(): string[] {
    return ['xcrun', 'xctrace', 'instruments'];
  }

  async runProfilerInContainer(
    _args?: string[],
    _outputPath?: string,
    _options?: RecordOptions,
    _context?: ProfileContext
  ): Promise<void> {
    throw new Error(
      'Container mode is not supported for macOS xctrace profiling. Use --mode host instead.'
    );
  }

  buildLocalProfilerCommand(
    args: string[],
    _outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): string[] {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniprof-trace-'));
    const tempTraceFile = path.join(tempDir, 'profile.trace');
    setRawArtifact(context, 'instruments-trace', tempTraceFile);
    addTempFile(context, tempTraceFile);
    addTempDir(context, tempDir);

    // Resolve .app bundle if needed
    const executablePath = this.resolveAppBundle(args[0]);

    const xctraceArgs = [
      'xcrun',
      'xctrace',
      'record',
      '--template',
      'Time Profiler',
      '--launch',
      executablePath,
      '--output',
      tempTraceFile,
      '--no-prompt',
    ];

    if (options.extraProfilerArgs) {
      const outStrip = stripOutputPathFlags(options.extraProfilerArgs, ['--output', '-o']);
      if (outStrip.removed.length) {
        printWarning(
          `Ignoring output-related flags in --extra-profiler-args for xctrace: ${outStrip.removed.join(' ')}`
        );
      }
      xctraceArgs.push(...outStrip.filtered);
    }

    if (args.length > 1) {
      xctraceArgs.push('--', ...args.slice(1));
    }

    return xctraceArgs;
  }

  async needsSudo(): Promise<boolean> {
    return false;
  }

  async postProcessProfile(
    _rawOutputPath: string,
    finalOutputPath: string,
    context: ProfileContext
  ): Promise<void> {
    const traceFile =
      context.rawArtifact?.type === 'instruments-trace' ? context.rawArtifact.path : null;

    if (!traceFile || !fs.existsSync(traceFile)) {
      // Check if it was created in the current directory instead
      const cwdTrace = 'profile.trace';
      if (fs.existsSync(cwdTrace)) {
        const dest = context.rawArtifact?.path || path.join(process.cwd(), 'profile.trace');
        const from = path.resolve(cwdTrace);
        printWarning(`Trace file was created at ${from}. Moving it to ${dest} for processing.`);
        fs.renameSync(cwdTrace, dest);
      } else {
        throw new Error(`Trace file not found: ${traceFile || 'undefined'}`);
      }
    }

    const inputTrace = context.rawArtifact?.path ?? (traceFile as string);
    const speedscopeData = await this.convertInstrumentsToSpeedscope(inputTrace);
    await fs.promises.writeFile(finalOutputPath, JSON.stringify(speedscopeData, null, 2));

    // Normalize exporter and perform temp cleanup for consistency with other platforms
    const { finalizeProfile } = await import('../utils/profile-context.js');
    await finalizeProfile(context, finalOutputPath, finalOutputPath, this.getExporterName());
  }

  protected async convertInstrumentsToSpeedscope(traceFile: string): Promise<any> {
    const { parseInstrumentsTrace } = await import('../utils/instruments-trace.js');
    return parseInstrumentsTrace(traceFile, this.getExporterName());
  }

  async cleanup(context: ProfileContext): Promise<void> {
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

  getExamples(): { simple: string[]; advanced: string[] } {
    return {
      simple: ['uniprof /Applications/MyApp.app', 'uniprof --visualize /Applications/MyApp.app'],
      advanced: ['uniprof record -o profile.json -- /Applications/MyApp.app'],
    };
  }

  getSamplingRate(_extraProfilerArgs?: string[]): number | null {
    // xctrace doesn't expose sampling rate configuration
    // It uses macOS Instruments' default sampling rate
    return null;
  }

  getAdvancedOptions() {
    return {
      description:
        'macOS Instruments profiling (xctrace). Pass additional options with --extra-profiler-args',
      options: [
        { flag: '--time-limit <duration>', description: 'Recording duration (e.g., 30s, 2m)' },
      ],
      example: {
        description: 'Profile a native application for 60 seconds',
        command:
          'uniprof record -o profile.json --extra-profiler-args "--time-limit 60s" -- ./my-app',
      },
    };
  }
}
