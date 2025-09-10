export interface Platform {
  name: string;
  profiler: string;
  detectCommand: (command: string[]) => boolean;
  detectExtension: (command: string) => boolean;
}

export type RunMode = 'container' | 'host';
export type Mode = 'auto' | 'host' | 'container';

export interface RuntimeOptions {
  mode: RunMode;
}

export interface ProfilerEnvironmentCheck {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  setupInstructions: string[];
}

export interface SpeedscopeProfile {
  $schema: string;
  version: string;
  name: string;
  activeProfileIndex: number;
  profiles: Profile[];
  shared: {
    frames: Frame[];
  };
  exporter?: string;
  [key: string]: any;
}

export interface Profile {
  type: string;
  name: string;
  unit: string;
  startValue: number;
  endValue: number;
  samples: number[][];
  weights?: number[];
}

export interface Frame {
  name: string;
  file?: string;
  line?: number;
  col?: number;
}

export interface AggregatedFunction {
  name: string;
  file: string;
  line: number;
  selfTime: number;
  totalTime: number;
  selfTimePercent: number;
  totalTimePercent: number;
  callCount: number;
  samples: number[];
}

export interface ThreadInfo {
  name: string;
  samples: number;
  cpuTime: number;
  cpuTimePercent: number;
}

export interface HotPath {
  path: string[];
  samples: number;
  percentage: number;
}

export interface FunctionStats {
  min: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
  stdDev: number;
  mean: number;
}
