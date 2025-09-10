import * as fs from 'node:fs';
import chalk from 'chalk';
import { platformRegistry } from '../platforms/registry.js';
import type { AnalyzeOptions, ProfileAnalysis } from '../types/platform-plugin.js';
import {
  createSpinner,
  padToWidth,
  printError,
  printInfo,
  printStep,
  printWarning,
} from '../utils/output-formatter.js';

interface AnalyzeCommandOptions extends AnalyzeOptions {
  platform?: string;
  format?: 'pretty' | 'json';
}

/**
 * Print an analysis-time warning without corrupting JSON output when in JSON mode.
 * - When `jsonMode` is true, writes warnings to stderr only.
 * - When false, uses console.warn for standard pretty mode visibility.
 */
function printAnalyzeWarning(jsonMode: boolean, message: string): void {
  const text = String(message);
  if (jsonMode) {
    try {
      process.stderr.write(`Warning: ${text}\n`);
      return;
    } catch {
      // fall through
    }
  }
  // Route through the standard formatter to avoid corrupting pretty output
  try {
    printWarning(text);
  } catch {
    console.warn(text);
  }
}

export async function analyzeCommand(
  profilePath: string,
  options: AnalyzeCommandOptions
): Promise<void> {
  // Determine output format: default to pretty for TTY, json for non-TTY
  const format = options.format || (process.stdout.isTTY ? 'pretty' : 'json');
  const jsonMode = format === 'json';

  // Sanitize numeric options to avoid NaN/invalid values silently filtering everything
  const sanitize = (n: unknown): number | undefined =>
    typeof n === 'number' && Number.isFinite(n) ? n : undefined;

  let threshold = sanitize(options.threshold);
  if (options.threshold !== undefined && threshold === undefined) {
    printAnalyzeWarning(jsonMode, 'Invalid --threshold value; using default 0.1');
  }
  if (typeof threshold === 'number' && threshold <= 0) {
    printAnalyzeWarning(jsonMode, 'Non-positive --threshold value; using default 0.1');
    threshold = undefined;
  }

  let minSamples = sanitize(options.minSamples);
  if (options.minSamples !== undefined && minSamples === undefined) {
    printAnalyzeWarning(jsonMode, 'Invalid --min-samples value; ignoring');
  }
  if (typeof minSamples === 'number' && minSamples < 0) {
    printAnalyzeWarning(jsonMode, 'Negative --min-samples value; ignoring');
    minSamples = undefined;
  }

  let maxDepth = sanitize(options.maxDepth);
  if (options.maxDepth !== undefined && maxDepth === undefined) {
    printAnalyzeWarning(jsonMode, 'Invalid --max-depth value; ignoring');
  }
  if (typeof maxDepth === 'number' && maxDepth <= 0) {
    printAnalyzeWarning(jsonMode, 'Non-positive --max-depth value; ignoring');
    maxDepth = undefined;
  }

  const sanitizedOptions: AnalyzeOptions = {
    threshold,
    minSamples,
    maxDepth,
    // Defer regex validation to the analyzer to ensure consistent behavior
    filterRegex: options.filterRegex,
  };

  if (!fs.existsSync(profilePath)) {
    if (format === 'json') {
      console.error(JSON.stringify({ error: `Profile file not found: ${profilePath}` }));
    } else {
      printError(`Profile file not found: ${profilePath}`);
    }
    process.exit(1);
  }

  let profileData;
  try {
    const fileContent = fs.readFileSync(profilePath, 'utf8');
    profileData = JSON.parse(fileContent);
  } catch (error) {
    if (format === 'json') {
      console.error(
        JSON.stringify({
          error: 'Failed to read or parse profile file',
          details: error instanceof Error ? error.message : 'Unknown error',
        })
      );
    } else {
      printError('Failed to read or parse profile file');
      if (error instanceof Error) {
        console.log(chalk.red(error.message));
      }
    }
    process.exit(1);
  }

  let platform;

  if (options.platform) {
    platform = platformRegistry.get(options.platform);
    if (!platform) {
      if (format === 'json') {
        console.error(
          JSON.stringify({
            error: `Unknown platform: ${options.platform}`,
            supportedPlatforms: platformRegistry.getSupportedPlatforms(),
          })
        );
      } else {
        printError(`Unknown platform: ${options.platform}`);
        printInfo(`Supported platforms: ${platformRegistry.getSupportedPlatforms().join(', ')}`);
      }
      process.exit(1);
    }
  } else {
    platform = platformRegistry.detectFromProfile(profileData);
  }

  // Platform is optional — fall back to generic analyzer when unknown

  // Only show spinner in pretty mode
  const spinner = format === 'pretty' ? createSpinner('Analyzing profile...') : null;
  spinner?.start();

  try {
    const analysis = platform?.analyzeProfile
      ? await platform.analyzeProfile(profilePath, sanitizedOptions)
      : analyzeSpeedscopeProfile(profilePath, sanitizedOptions, jsonMode);
    spinner?.stop();

    if (format === 'json') {
      // JSON output: emit only structured data to stdout
      console.log(JSON.stringify(analysis, null, 2));
    } else {
      // Pretty output: use existing formatters
      if (platform?.formatAnalysis) {
        await platform.formatAnalysis(analysis, sanitizedOptions);
      } else {
        formatAnalysis(analysis, sanitizedOptions);
      }
    }
  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.error(
        JSON.stringify({
          error: 'Failed to analyze profile',
          details: error instanceof Error ? error.message : 'Unknown error',
        })
      );
    } else {
      printError('Failed to analyze profile');
      if (error instanceof Error) {
        console.log(chalk.red(error.message));
      }
    }
    process.exit(1);
  }
}

/**
 * Analyze a speedscope format profile (common for all platforms)
 */
export function analyzeSpeedscopeProfile(
  profilePath: string,
  options: AnalyzeOptions,
  jsonMode = false
): ProfileAnalysis {
  const profileData = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

  const profiles = profileData.profiles || [];
  if (profiles.length === 0) {
    throw new Error('No profile data found in file');
  }

  const threadCount = profiles.length;

  let unit = 'milliseconds';
  let profileName = profileData.name || 'Unknown';
  const profiler = profileData.exporter || 'Unknown';

  if (profiles[0].unit) {
    unit = profiles[0].unit;
  }
  if (profiles[0].name && profileName === 'Unknown') {
    profileName = profiles[0].name;
  }

  // Verify that all profiles use the same unit; warn if mixed
  try {
    const hasMixedUnits = profiles.some((p: any) => p?.unit && p.unit !== unit);
    if (hasMixedUnits) {
      printAnalyzeWarning(
        jsonMode,
        `Profiles use mixed time units; results may be inconsistent (expected: ${unit})`
      );
    }
  } catch {
    // Non-fatal
  }

  const firstProfileType = profiles[0].type;
  let allSamples: number[][] = [];
  let allWeights: number[] = [];
  let totalSamples = 0;
  let totalEvents = 0;

  if (firstProfileType === 'evented') {
    const result = processEventedProfiles(profiles, jsonMode);
    allSamples = result.samples;
    allWeights = result.weights;
    totalSamples = result.totalSamples;
    totalEvents = result.totalEvents;
  } else {
    for (const profile of profiles) {
      const samples = profile.samples || [];
      const weights = profile.weights || [];

      if (weights.length > 0 && samples.length !== weights.length) {
        throw new Error(
          `Samples (${samples.length}) and weights (${weights.length}) arrays must have the same length in profile ${profile.name}`
        );
      }

      const normalizedWeights = weights.length > 0 ? weights : samples.map(() => 1);

      allSamples = allSamples.concat(samples);
      allWeights = allWeights.concat(normalizedWeights);
      totalSamples += samples.length;
    }
  }

  // Apply maxDepth if provided by truncating stacks to the leaf-most frames
  const maxDepth = options.maxDepth && options.maxDepth > 0 ? options.maxDepth : undefined;
  if (maxDepth) {
    allSamples = allSamples.map((stack) =>
      stack.length > maxDepth ? stack.slice(stack.length - maxDepth) : stack
    );
  }

  const totalWeight = allWeights.reduce((sum: number, w: number) => sum + w, 0);

  // If there is no weight/time, return early with empty hotspots to avoid divide-by-zero
  if (totalWeight === 0) {
    return {
      summary: {
        totalSamples,
        totalTime: 0,
        unit,
        profileName,
        profiler,
        threadCount,
        profileType: firstProfileType as 'sampled' | 'evented',
        totalEvents,
      },
      hotspots: [],
    };
  }

  const frameCounts = new Map<number, number>();
  const selfCounts = new Map<number, number>();
  const frameSampleCounts = new Map<number, number>();
  const frameSampleWeights = new Map<number, number[]>();

  allSamples.forEach((stack: number[], index: number) => {
    const weight = allWeights[index];

    // Use a Set to ensure each frame is only counted once per sample
    const uniqueFramesInStack = new Set(stack);
    for (const frameIndex of uniqueFramesInStack) {
      frameCounts.set(frameIndex, (frameCounts.get(frameIndex) || 0) + weight);
      frameSampleCounts.set(frameIndex, (frameSampleCounts.get(frameIndex) || 0) + 1);

      if (!frameSampleWeights.has(frameIndex)) {
        frameSampleWeights.set(frameIndex, []);
      }
      frameSampleWeights.get(frameIndex)!.push(weight);
    }

    if (stack.length > 0) {
      const leafFrame = stack[stack.length - 1];
      selfCounts.set(leafFrame, (selfCounts.get(leafFrame) || 0) + weight);
    }
  });

  function calculatePercentiles(values: number[]): { p50: number; p90: number; p99: number } {
    if (values.length === 0) {
      return { p50: 0, p90: 0, p99: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);

    const getPercentile = (p: number) => {
      const index = (sorted.length - 1) * p;
      const lower = Math.floor(index);
      const upper = Math.ceil(index);
      const weight = index - lower;

      if (lower === upper) {
        return sorted[lower];
      }

      return sorted[lower] * (1 - weight) + sorted[upper] * weight;
    };

    return {
      p50: getPercentile(0.5),
      p90: getPercentile(0.9),
      p99: getPercentile(0.99),
    };
  }

  const frames = profileData.shared?.frames || [];

  // Compile filter regex if provided
  let filterRegex: RegExp | null = null;
  if (options.filterRegex) {
    try {
      filterRegex = new RegExp(options.filterRegex);
    } catch {
      throw new Error(`Invalid --filter-regex pattern: ${options.filterRegex}`);
    }
  }
  const hotspots = Array.from(frameCounts.entries())
    .map(([frameIndex, totalTime]) => {
      // Validate frame index
      const frame = frameIndex >= 0 && frameIndex < frames.length ? frames[frameIndex] : null;
      if (!frame && frames.length > 0) {
        printAnalyzeWarning(
          jsonMode,
          `Invalid frame index ${frameIndex} (frames array has ${frames.length} items)`
        );
      }

      const selfTime = selfCounts.get(frameIndex) || 0;
      const sampleCount = frameSampleCounts.get(frameIndex) || 0;
      const sampleWeights = frameSampleWeights.get(frameIndex) || [];
      const weightsVary =
        sampleWeights.length > 1 && sampleWeights.some((w) => w !== sampleWeights[0]);
      const percentiles = weightsVary ? calculatePercentiles(sampleWeights) : undefined;

      return {
        name: frame?.name || 'Unknown',
        file: frame?.file,
        line: frame?.line,
        percentage: (totalTime / totalWeight) * 100,
        self: selfTime,
        total: totalTime,
        samples: sampleCount,
        percentiles,
      };
    })
    .filter((hotspot) => hotspot.percentage >= (options.threshold ?? 0.1))
    .filter((hotspot) =>
      typeof options.minSamples === 'number' && options.minSamples > 0
        ? hotspot.samples >= (options.minSamples as number)
        : true
    )
    .filter((hotspot) => {
      if (!filterRegex) return true;
      const name = hotspot.name || '';
      const loc = hotspot.file ? `${hotspot.file}:${hotspot.line || ''}` : '';
      return filterRegex.test(name) || (loc && filterRegex.test(loc));
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 50);

  return {
    summary: {
      totalSamples,
      totalTime: totalWeight,
      unit,
      profileName,
      profiler,
      threadCount,
      profileType: firstProfileType as 'sampled' | 'evented',
      totalEvents,
    },
    hotspots,
  };
}

/**
 * Process evented profiles and convert them to sample-like data for analysis.
 *
 * Assumptions and behavior:
 * - Events are an ordered stream of frame open/close markers with timestamps `at`.
 * - The stack is treated as LIFO; an unmatched close will pop back to the matching frame.
 * - Elapsed time between consecutive events is attributed to the current (open) stack.
 * - Trailing time from the last event to `endValue` is attributed to the final stack if non-empty.
 * - We produce synthetic "samples" by recording the stack at each interval with weight = elapsed time.
 *   These weights preserve absolute time in the profile's unit and integrate cleanly with sampled analysis.
 */
function processEventedProfiles(
  profiles: any[],
  jsonMode: boolean
): {
  samples: number[][];
  weights: number[];
  totalSamples: number;
  totalEvents: number;
} {
  const allSamples: number[][] = [];
  const allWeights: number[] = [];
  let totalSamples = 0;
  let totalEvents = 0;

  for (const profile of profiles) {
    const events = (profile.events || []).slice();
    if (events.length === 0) continue;

    totalEvents += events.length;

    // Ensure chronological order
    events.sort((a: any, b: any) => (a.at as number) - (b.at as number));

    const stack: number[] = [];
    let lastTime: number | null = null;

    for (const ev of events) {
      const t = ev.at as number;
      // Validate event shape
      const frameIndex = ev.frame;
      if (!Number.isFinite(frameIndex)) {
        printAnalyzeWarning(jsonMode, 'Invalid event frame index encountered; skipping event');
        continue;
      }
      if (lastTime !== null) {
        const delta = Math.max(0, t - lastTime);
        if (delta > 0 && stack.length > 0) {
          allSamples.push([...stack]);
          allWeights.push(delta);
          totalSamples++;
        }
      }

      if (ev.type === 'O') {
        stack.push(frameIndex);
      } else if (ev.type === 'C') {
        // Stricter validation: prefer LIFO close; if mismatched, pop until match
        if (stack.length === 0) {
          printAnalyzeWarning(jsonMode, `Close event for frame ${frameIndex} with empty stack`);
        } else if (stack[stack.length - 1] === frameIndex) {
          stack.pop();
        } else {
          const idx = stack.lastIndexOf(frameIndex);
          if (idx !== -1) {
            printAnalyzeWarning(
              jsonMode,
              `Mismatched close for frame ${frameIndex}; popping ${stack.length - idx} frame(s)`
            );
            stack.splice(idx);
          } else {
            printAnalyzeWarning(jsonMode, `Closing frame ${frameIndex} that is not in call stack`);
          }
        }
      }

      lastTime = t;
    }

    // Attribute trailing time from last event to endValue when stack is non-empty
    const endValue = typeof profile.endValue === 'number' ? (profile.endValue as number) : null;
    if (lastTime !== null && endValue !== null && endValue > lastTime && stack.length > 0) {
      const delta = Math.max(0, endValue - lastTime);
      if (delta > 0) {
        allSamples.push([...stack]);
        allWeights.push(delta);
        totalSamples++;
      }
    }
  }

  return { samples: allSamples, weights: allWeights, totalSamples, totalEvents };
}

/**
 * Format a time value with appropriate precision based on its magnitude
 */
function formatTime(value: number, unit?: string): string {
  let msValue = value;
  switch (unit) {
    case 'none':
      // Non-time unit (e.g., sample counts). Show as integer without unit.
      return `${Math.round(value)}`;
    case 'seconds':
      msValue = value * 1000;
      break;
    case 'microseconds':
      msValue = value / 1000;
      break;
    case 'nanoseconds':
      msValue = value / 1000000;
      break;
    case 'milliseconds':
      msValue = value;
      break;
    default:
      // For unknown units, return the raw value with unit suffix
      if (unit && unit !== 'milliseconds') {
        return `${value.toFixed(2)} ${unit}`;
      }
      msValue = value;
  }

  if (msValue >= 1000) {
    return `${(msValue / 1000).toFixed(2)}s`;
  }
  if (msValue >= 100) {
    return `${msValue.toFixed(0)}ms`;
  }
  if (msValue >= 10) {
    return `${msValue.toFixed(1)}ms`;
  }
  if (msValue >= 1) {
    return `${msValue.toFixed(2)}ms`;
  }
  return `${msValue.toFixed(3)}ms`;
}

/**
 * Format analysis results for display
 */
export function formatAnalysis(analysis: ProfileAnalysis, options: AnalyzeOptions): void {
  const unit = analysis.summary.unit;

  // Compact heading for top functions with sample count
  console.log();
  printStep(
    `${chalk.bold.white('Top Functions by Time')} ${chalk.gray(`(${analysis.summary.totalSamples} samples)`)}`
  );
  if (analysis.summary.profileType === 'evented') {
    console.log(
      chalk.gray(
        `Evented profile: total events ${analysis.summary.totalEvents ?? 0}; synthetic samples ${analysis.summary.totalSamples}`
      )
    );
  }
  console.log(chalk.gray(`Showing functions with ≥${options.threshold ?? 0.1}% of total time`));
  console.log();

  // Determine whether any hotspot has percentiles (i.e., variable weights)
  const showPercentiles = analysis.hotspots.some((h) => !!h.percentiles);

  const headers = showPercentiles
    ? ['Function', 'Samples', 'Total %', 'Total', 'Self', 'p50', 'p90', 'p99', 'Location']
    : ['Function', 'Samples', 'Total %', 'Total', 'Self', 'Location'];
  const widths = showPercentiles ? [30, 7, 8, 10, 10, 10, 10, 10, 30] : [30, 7, 8, 10, 10, 30];

  headers.forEach((header, i) => {
    const cell = chalk.bold(header);
    process.stdout.write(padToWidth(cell, widths[i]));
  });
  console.log();
  console.log(chalk.gray('─'.repeat(widths.reduce((sum, w) => sum + w, 0))));

  for (const hotspot of analysis.hotspots) {
    const baseCols = [
      hotspot.name.substring(0, widths[0] - 1),
      hotspot.samples.toString(),
      `${hotspot.percentage.toFixed(1)}%`,
      formatTime(hotspot.total, unit),
      formatTime(hotspot.self, unit),
    ];
    const pctCols = showPercentiles
      ? hotspot.percentiles
        ? [
            formatTime(hotspot.percentiles.p50, unit),
            formatTime(hotspot.percentiles.p90, unit),
            formatTime(hotspot.percentiles.p99, unit),
          ]
        : ['-', '-', '-']
      : [];
    const locCol = hotspot.file ? `${hotspot.file}:${hotspot.line || '?'}` : '';
    const columns = showPercentiles ? [...baseCols, ...pctCols, locCol] : [...baseCols, locCol];

    columns.forEach((col, i) => {
      const color =
        i === 2 && hotspot.percentage > 10
          ? chalk.red
          : i === 2 && hotspot.percentage > 5
            ? chalk.yellow
            : chalk.white;
      process.stdout.write(padToWidth(color(col), widths[i]));
    });
    console.log();
  }

  console.log();
  console.log(chalk.gray(`Showing top ${analysis.hotspots.length} functions`));
}
