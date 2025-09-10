import type { Mode, ProfilerEnvironmentCheck } from './index.js';

// Typed raw artifact produced by a platform prior to final speedscope JSON post-processing
export type RawArtifactType =
  | 'speedscope' // already in speedscope JSON
  | 'ticks' // 0x ticks.json
  | 'collapsed' // Brendan Gregg folded stacks
  | 'perfdata' // perf.data binary
  | 'perfscript' // perf script textual output
  | 'nettrace' // .NET .nettrace
  | 'instruments-trace'; // macOS Instruments .trace dir/file

export interface RawProfileArtifact {
  type: RawArtifactType;
  path: string;
}

export interface DockerVolume {
  hostPath: string;
  containerPath: string;
}

/**
 * Context object for maintaining state during profiling lifecycle
 */
export interface ProfileContext {
  /**
   * The raw profile output produced by the platform before conversion to speedscope JSON.
   */
  rawArtifact?: RawProfileArtifact;
  /**
   * Effective sampling frequency (Hz) for time attribution when converting.
   */
  samplingHz?: number;
  /**
   * Environment variables to inject when running the profiler/application.
   */
  runtimeEnv?: Record<string, string>;
  /**
   * Temporary files/dirs to cleanup at the end of the run (best-effort).
   */
  tempFiles?: string[];
  tempDirs?: string[];
  /**
   * Optional miscellaneous notes for platform-specific hints.
   */
  notes?: Record<string, unknown>;
}

export interface RecordOptions {
  output?: string;
  verbose?: boolean;
  extraProfilerArgs?: string[];
  mode?: Mode;
  cwd?: string;
  enableHostNetworking?: boolean;
}

export interface AnalyzeOptions {
  threshold?: number;
  filterRegex?: string;
  minSamples?: number;
  maxDepth?: number;
}

export interface ProfileAnalysis {
  summary: {
    totalSamples: number;
    totalTime: number;
    unit?: string;
    profileName?: string;
    profiler?: string;
    threadCount?: number;
    profileType?: 'sampled' | 'evented';
    totalEvents?: number;
  };
  hotspots: Array<{
    name: string;
    file?: string;
    line?: number;
    percentage: number;
    self: number;
    total: number;
    samples: number;
    percentiles?: {
      p50: number;
      p90: number;
      p99: number;
    };
  }>;
}

/**
 * Interface for platform-specific profiling implementations
 */
export interface PlatformPlugin {
  /**
   * Unique identifier for this platform
   */
  readonly name: string;

  /**
   * Name of the profiler tool used
   */
  readonly profiler: string;

  /**
   * Get the actual profiler name based on run mode
   */
  getProfilerName(mode: 'host' | 'container'): string;

  /**
   * File extensions associated with this platform
   */
  readonly extensions: string[];

  /**
   * Executable names that indicate this platform
   */
  readonly executables: string[];

  // Detection methods

  /**
   * Check if the given command arguments indicate this platform
   */
  detectCommand(args: string[]): boolean;

  /**
   * Check if the given filename indicates this platform
   */
  detectExtension(filename: string): boolean;

  /**
   * Get the exporter name to embed in speedscope JSON profiles
   * This identifies which platform/profiler generated the profile
   */
  getExporterName(): string;

  // Environment checking

  /**
   * Check if the local environment is properly configured for profiling
   */
  checkLocalEnvironment(executablePath?: string): Promise<ProfilerEnvironmentCheck>;

  /**
   * Find the platform executable in PATH
   */
  findExecutableInPath(): Promise<string | null>;

  // Container support

  /**
   * Whether this platform supports container-based profiling
   */
  supportsContainer(): boolean;

  /**
   * Get the preferred default mode for this platform
   * @param args - The command arguments that will be profiled
   * @returns The preferred mode: 'host', 'container', or 'auto' to let the system decide
   */
  getDefaultMode(args: string[]): 'host' | 'container' | 'auto';

  /**
   * Get the Docker image name for this platform
   */
  getContainerImage(): string;

  /**
   * Get the cache volume mounts for this platform
   */
  getContainerCacheVolumes(cacheBaseDir: string, cwd: string): DockerVolume[];

  /**
   * Run the profiler in a container
   */
  runProfilerInContainer(
    args: string[],
    outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): Promise<void>;

  // Local profiling

  /**
   * Build the profiler command for local execution
   */
  buildLocalProfilerCommand(
    args: string[],
    outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): string[];

  /**
   * Check if sudo is required for profiling
   */
  needsSudo(): Promise<boolean>;

  /**
   * Post-process the profile output if needed
   */
  postProcessProfile?(
    rawOutputPath: string,
    finalOutputPath: string,
    context: ProfileContext
  ): Promise<void>;

  /**
   * Clean up any resources created during profiling
   */
  cleanup?(context: ProfileContext): Promise<void>;

  // Analysis

  /**
   * Analyze a profile file and return structured data
   * (Optional - defaults to common speedscope analysis)
   */
  analyzeProfile?(profilePath: string, options: AnalyzeOptions): Promise<ProfileAnalysis>;

  /**
   * Format the analysis results for display
   * (Optional - defaults to common speedscope formatting)
   */
  formatAnalysis?(analysis: ProfileAnalysis, options: AnalyzeOptions): Promise<void>;

  // Bootstrap support

  /**
   * Get example command for this platform
   */
  getExampleCommand(): string;

  /**
   * Get advanced profiling options documentation
   */
  getAdvancedOptions(): {
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

  /**
   * Get the sampling rate being used for profiling (in Hz)
   * @param extraProfilerArgs - Extra profiler arguments that may override the default rate
   * @returns The sampling rate in Hz, or null if not applicable/unknown
   */
  getSamplingRate?(extraProfilerArgs?: string[]): number | null;

  /**
   * Names of profiler processes/binaries used by this platform.
   * These names are used to avoid signalling the profiler itself on first Ctrl+C.
   */
  getProfilerProcessNames?(): string[];

  /**
   * Example commands for quick start and traditional workflows.
   */
  getExamples?(): {
    simple: string[];
    advanced: string[];
  };
}
