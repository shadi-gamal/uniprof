/**
 * Converter for Brendan Gregg's flamegraph "collapsed" format to Speedscope format
 * Format: https://github.com/brendangregg/FlameGraph#2-fold-stacks
 *
 * Each line contains a semicolon-separated stack followed by a count:
 * stack;frame1;frame2;frame3 123
 */

import * as fs from 'node:fs';

interface FrameInfo {
  key: string | number;
  name: string;
  file?: string;
  line?: number;
  col?: number;
}

interface BGSample {
  stack: FrameInfo[];
  duration: number;
}

interface SpeedscopeProfile {
  type: 'sampled';
  name: string;
  unit: 'none';
  startValue: number;
  endValue: number;
  samples: number[][];
  weights: number[];
  shared?: {
    frames: FrameInfo[];
  };
  exporter?: string;
}

/**
 * Parse Brendan Gregg folded stacks format
 */
function parseBGFoldedStacks(contents: string): BGSample[] {
  const samples: BGSample[] = [];
  const lines = contents.split('\n');

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // Match pattern: "stack;frame1;frame2 123"
    const match = /^(.*) (\d+)$/.exec(line);
    if (!match) continue;

    const stackStr = match[1];
    const count = match[2];

    // Split the stack by semicolons to get individual frames
    const frames = stackStr.split(';').map((name) => ({
      key: name,
      name: name,
    }));

    samples.push({
      stack: frames,
      duration: Number.parseInt(count, 10),
    });
  }

  return samples;
}

/**
 * Convert Brendan Gregg flamegraph format to Speedscope format
 */
export function convertBGFlameGraphToSpeedscope(
  contents: string,
  profileName?: string
): SpeedscopeProfile | null {
  const parsed = parseBGFoldedStacks(contents);

  if (parsed.length === 0) {
    return null;
  }

  // Build frame list and map frame names to indices
  const frameMap = new Map<string, number>();
  const frames: FrameInfo[] = [];

  for (const sample of parsed) {
    for (const frame of sample.stack) {
      const key = frame.key as string;
      if (!frameMap.has(key)) {
        frameMap.set(key, frames.length);
        frames.push(frame);
      }
    }
  }

  // Build samples and weights arrays
  const samples: number[][] = [];
  const weights: number[] = [];

  for (const sample of parsed) {
    const stackIndices = sample.stack.map((frame) => {
      const key = frame.key as string;
      return frameMap.get(key)!;
    });

    samples.push(stackIndices);
    weights.push(sample.duration);
  }

  // Calculate total duration
  const totalDuration = parsed.reduce((sum, sample) => sum + sample.duration, 0);

  return {
    type: 'sampled',
    name: profileName || 'Profile',
    unit: 'none',
    startValue: 0,
    endValue: totalDuration,
    samples,
    weights,
    shared: {
      frames,
    },
  };
}

/**
 * Convert a Brendan Gregg flamegraph file to Speedscope format
 */
export async function convertBGFlameGraphFile(
  inputPath: string,
  outputPath: string,
  exporter: string,
  profileName?: string
): Promise<void> {
  const contents = fs.readFileSync(inputPath, 'utf8');
  const profile = convertBGFlameGraphToSpeedscope(contents, profileName);

  if (!profile) {
    throw new Error('No valid samples found in flamegraph file');
  }

  // Add exporter metadata
  profile.exporter = exporter;

  // Wrap in Speedscope file format
  const { shared: _omitShared, ...profileNoShared } = profile as SpeedscopeProfile;
  const speedscopeFile = {
    $schema: 'https://www.speedscope.app/file-format-schema.json',
    profiles: [profileNoShared],
    shared: profile.shared,
    activeProfileIndex: 0,
    exporter: profile.exporter,
  };

  fs.writeFileSync(outputPath, JSON.stringify(speedscopeFile, null, 2));
}

/**
 * Parse Java method signatures and extract cleaner names
 */
export function cleanJavaMethodName(methodName: string): string {
  // Handle Java method signatures like:
  // java.util.HashMap.get(Ljava/lang/Object;)Ljava/lang/Object;
  // com.example.MyClass.method()V
  // com.example.MyClass$InnerClass.method()Z

  let cleanedName = methodName;

  // Remove parameter and return type signatures if present
  const parenIndex = cleanedName.indexOf('(');
  if (parenIndex !== -1) {
    cleanedName = cleanedName.substring(0, parenIndex);
  }

  // Handle array types [Lcom/example/Class; -> Class[]
  cleanedName = cleanedName.replace(/\[L([^;]+);/g, (_, className) => {
    const simpleName = className.split('/').pop() || className;
    return `${simpleName}[]`;
  });

  // Convert internal class names (com/example/Class -> com.example.Class)
  cleanedName = cleanedName.replace(/\//g, '.');

  return cleanedName;
}

/**
 * Post-process a profile to clean up Java method names
 */
export function cleanJavaProfile(profile: SpeedscopeProfile): void {
  if (profile.shared?.frames) {
    for (const frame of profile.shared.frames) {
      if (typeof frame.name === 'string') {
        frame.name = cleanJavaMethodName(frame.name);
      }
    }
  }
}
