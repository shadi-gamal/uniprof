import * as crypto from 'node:crypto';
import * as path from 'node:path';
import type { ProfilerEnvironmentCheck } from '../types/index.js';
import type {
  AnalyzeOptions,
  DockerVolume,
  PlatformPlugin,
  ProfileAnalysis,
  ProfileContext,
  RecordOptions,
} from '../types/platform-plugin.js';
import { spawnSync } from '../utils/spawn.js';

/**
 * Base implementation of PlatformPlugin with common functionality
 */
export abstract class BasePlatform implements PlatformPlugin {
  abstract readonly name: string;
  abstract readonly profiler: string;
  abstract readonly extensions: string[];
  abstract readonly executables: string[];

  detectCommand(args: string[]): boolean {
    if (args.length === 0) return false;
    const cmd = args[0].toLowerCase();
    const basename = path.basename(cmd);

    return this.executables.some((exec) => basename === exec || basename.startsWith(`${exec}.`));
  }

  detectExtension(filename: string): boolean {
    return this.extensions.some((ext) => filename.endsWith(ext));
  }

  getProfilerName(_mode: 'host' | 'container'): string {
    // eslint-disable-line @typescript-eslint/no-unused-vars
    // Default implementation: return the same profiler for all modes
    return this.profiler;
  }

  getExporterName(): string {
    return `uniprof-${this.name}`;
  }

  async findExecutableInPath(): Promise<string | null> {
    for (const executable of this.executables) {
      try {
        const whichCmd = process.platform === 'win32' ? 'where' : 'which';
        const res = spawnSync([whichCmd, executable], { stdout: 'pipe', stderr: 'pipe' });
        if (res.exitCode === 0) {
          const stdout = res.stdout?.toString() || '';
          const first = stdout
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find((l) => l.length > 0);
          if (first) return first;
        }
      } catch {}
    }
    return null;
  }

  supportsContainer(): boolean {
    return true;
  }

  getProfilerProcessNames(): string[] {
    // Default: the primary profiler name if it's an external process
    return [this.profiler].filter(Boolean);
  }

  getExamples(): { simple: string[]; advanced: string[] } {
    // Generic defaults; platforms should override with richer examples
    const cmd = this.getExampleCommand();
    return {
      simple: [`uniprof --analyze ${cmd}`, `uniprof --visualize ${cmd}`],
      advanced: [`uniprof record -o profile.json -- ${cmd}`],
    };
  }

  getDefaultMode(_args: string[]): 'host' | 'container' | 'auto' {
    return 'container';
  }

  getContainerImage(): string {
    return `ghcr.io/indragiek/uniprof-${this.name}:latest`;
  }

  protected getProjectCacheDir(cacheBaseDir: string, cwd: string, prefix: string): string {
    const projectHash = crypto.createHash('md5').update(cwd).digest('hex').substring(0, 8);
    const projectName = path.basename(cwd).replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(cacheBaseDir, prefix, `${projectName}-${projectHash}`);
  }

  async analyzeProfile(profilePath: string, options: AnalyzeOptions): Promise<ProfileAnalysis> {
    const { analyzeSpeedscopeProfile } = await import('../commands/analyze.js');
    return analyzeSpeedscopeProfile(profilePath, options);
  }

  async formatAnalysis(analysis: ProfileAnalysis, options: AnalyzeOptions): Promise<void> {
    const { formatAnalysis } = await import('../commands/analyze.js');
    formatAnalysis(analysis, options);
  }

  abstract checkLocalEnvironment(executablePath?: string): Promise<ProfilerEnvironmentCheck>;
  abstract getContainerCacheVolumes(cacheBaseDir: string, cwd: string): DockerVolume[];
  abstract runProfilerInContainer(
    args: string[],
    outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): Promise<void>;
  abstract buildLocalProfilerCommand(
    args: string[],
    outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): string[];
  abstract needsSudo(): Promise<boolean>;
  abstract getExampleCommand(): string;
  abstract getAdvancedOptions(): {
    description: string;
    options: Array<{
      flag: string;
      description: string;
    }>;
    example: {
      description: string;
      command: string;
    };
  } | null;
}
