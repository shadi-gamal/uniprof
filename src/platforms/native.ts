import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProfilerEnvironmentCheck } from '../types/index.js';
import type {
  DockerVolume,
  PlatformPlugin,
  ProfileContext,
  RecordOptions,
} from '../types/platform-plugin.js';
import { PerfPlatform } from './perf.js';
import { XctracePlatform } from './xctrace.js';

/**
 * NativePlatform is a wrapper that delegates to the appropriate platform-specific
 * profiler based on the operating system.
 */
export class NativePlatform implements PlatformPlugin {
  readonly name = 'native';
  readonly profiler: string;
  readonly extensions: string[] = [];
  readonly executables: string[];

  private delegate: PlatformPlugin;

  constructor() {
    // Choose the appropriate delegate based on the OS
    this.delegate = process.platform === 'darwin' ? new XctracePlatform() : new PerfPlatform();

    this.profiler = this.delegate.profiler;
    this.executables = this.delegate.executables;
  }

  detectCommand(args: string[]): boolean {
    if (args.length === 0) return false;

    // On macOS, support profiling ELF binaries via perf in container mode
    if (process.platform === 'darwin') {
      const candidate = path.resolve(args[0]);
      try {
        const stat = fs.existsSync(candidate) ? fs.statSync(candidate) : null;
        if (stat?.isFile()) {
          const fd = fs.openSync(candidate, 'r');
          const buf = Buffer.allocUnsafe(4);
          try {
            fs.readSync(fd, buf, 0, 4, 0);
          } finally {
            fs.closeSync(fd);
          }
          // ELF magic: 0x7F 45 4C 46
          if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
            return true;
          }
        }
      } catch {
        // Ignore I/O errors and fall through to delegate detection
      }
    }

    return this.delegate.detectCommand(args);
  }

  detectExtension(fileName: string): boolean {
    return this.delegate.detectExtension(fileName);
  }

  getExporterName(): string {
    // Always use 'uniprof-native' regardless of the delegate
    // This ensures consistent platform detection in analyze command
    return 'uniprof-native';
  }

  getProfilerName(mode: 'host' | 'container'): string {
    if (mode === 'container') {
      // In container mode, we always use perf regardless of host OS
      return 'perf';
    }
    return this.delegate.getProfilerName(mode);
  }

  async checkLocalEnvironment(executablePath?: string): Promise<ProfilerEnvironmentCheck> {
    return this.delegate.checkLocalEnvironment(executablePath);
  }

  getContainerCacheVolumes(cacheBaseDir: string, cwd: string): DockerVolume[] {
    return this.delegate.getContainerCacheVolumes(cacheBaseDir, cwd);
  }

  getContainerImage(): string {
    // For native profiling, we always use the native container which has perf
    return 'ghcr.io/indragiek/uniprof-native:latest';
  }

  async runProfilerInContainer(
    args: string[],
    outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): Promise<void> {
    // In container mode, always use perf, and always report exporter as uniprof-native
    class NativePerfPlatform extends PerfPlatform {
      getExporterName(): string {
        return 'uniprof-native';
      }
    }
    const perfDelegate = new NativePerfPlatform();
    return perfDelegate.runProfilerInContainer(args, outputPath, options, context);
  }

  buildLocalProfilerCommand(
    args: string[],
    outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): string[] {
    return this.delegate.buildLocalProfilerCommand(args, outputPath, options, context);
  }

  async needsSudo(): Promise<boolean> {
    return this.delegate.needsSudo();
  }

  async postProcessProfile(
    rawOutputPath: string,
    finalOutputPath: string,
    context: ProfileContext
  ): Promise<void> {
    // Route post-processing based on raw artifact type. Container-mode on macOS uses perf.
    const type = context.rawArtifact?.type;
    if (type === 'perfscript' || type === 'perfdata') {
      class NativePerfPlatform extends PerfPlatform {
        getExporterName(): string {
          return 'uniprof-native';
        }
      }
      const perfDelegate = new NativePerfPlatform();
      await perfDelegate.postProcessProfile(rawOutputPath, finalOutputPath, context);
    } else {
      await this.delegate.postProcessProfile?.(rawOutputPath, finalOutputPath, context);
      // Ensure exporter is consistently 'uniprof-native' for all native profiles
      try {
        const { setProfileExporter } = await import('../utils/profile.js');
        await setProfileExporter(finalOutputPath, this.getExporterName());
      } catch {}
    }
  }

  async cleanup(context: ProfileContext): Promise<void> {
    const type = context.rawArtifact?.type;
    if (type === 'perfscript' || type === 'perfdata') {
      class NativePerfPlatform extends PerfPlatform {}
      const perfDelegate = new NativePerfPlatform();
      await perfDelegate.cleanup?.(context);
      return;
    }
    if (typeof this.delegate.cleanup === 'function') {
      await this.delegate.cleanup(context);
    }
  }

  getExampleCommand(): string {
    return this.delegate.getExampleCommand();
  }

  getAdvancedOptions() {
    if (
      'getAdvancedOptions' in this.delegate &&
      typeof this.delegate.getAdvancedOptions === 'function'
    ) {
      return this.delegate.getAdvancedOptions();
    }
    return {
      description: 'Native profiling',
      options: [],
      example: {
        description: 'Profile a native application',
        command: 'uniprof record -o profile.json -- ./my-app',
      },
    };
  }

  getExamples?(): { simple: string[]; advanced: string[] } {
    if (typeof this.delegate.getExamples === 'function') {
      return this.delegate.getExamples();
    }
    const cmd = this.getExampleCommand();
    return {
      simple: [`uniprof --analyze ${cmd}`, `uniprof --visualize ${cmd}`],
      advanced: [`uniprof record -o profile.json -- ${cmd}`],
    };
  }

  async findExecutableInPath(): Promise<string | null> {
    return this.delegate.findExecutableInPath();
  }

  supportsContainer(): boolean {
    // On macOS with XctracePlatform as delegate, we need to check if it's an ELF binary
    // ELF binaries can be profiled in container mode even on macOS
    if (process.platform === 'darwin' && this.delegate.name === 'xctrace') {
      // We can't check the binary here without the args, so we'll return true
      // and let the runtime validation handle it
      return true;
    }

    return this.delegate.supportsContainer();
  }

  getDefaultMode(args: string[]): 'host' | 'container' | 'auto' {
    // On macOS, ELF binaries should run in container mode with perf
    if (process.platform === 'darwin') {
      const candidate = path.resolve(args[0] || '');
      try {
        const stat = fs.existsSync(candidate) ? fs.statSync(candidate) : null;
        if (stat?.isFile()) {
          const fd = fs.openSync(candidate, 'r');
          const buf = Buffer.allocUnsafe(4);
          try {
            fs.readSync(fd, buf, 0, 4, 0);
          } finally {
            fs.closeSync(fd);
          }
          if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
            return 'container';
          }
        }
      } catch {
        // Ignore and fall back to delegate
      }
    }
    return this.delegate.getDefaultMode(args);
  }

  async analyzeProfile(profilePath: string, options: any): Promise<any> {
    if ('analyzeProfile' in this.delegate && typeof this.delegate.analyzeProfile === 'function') {
      return this.delegate.analyzeProfile(profilePath, options);
    }
    // Default implementation using speedscope analyzer
    const { analyzeSpeedscopeProfile } = await import('../commands/analyze.js');
    return analyzeSpeedscopeProfile(profilePath, options);
  }

  async formatAnalysis(analysis: any, options: any): Promise<void> {
    if ('formatAnalysis' in this.delegate && typeof this.delegate.formatAnalysis === 'function') {
      return this.delegate.formatAnalysis(analysis, options);
    }
    // Default implementation
    const { formatAnalysis } = await import('../commands/analyze.js');
    formatAnalysis(analysis, options);
  }

  getSamplingRate(extraProfilerArgs?: string[]): number | null {
    if ('getSamplingRate' in this.delegate && typeof this.delegate.getSamplingRate === 'function') {
      return this.delegate.getSamplingRate(extraProfilerArgs);
    }
    return null;
  }
}
