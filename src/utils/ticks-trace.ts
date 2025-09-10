import * as fs from 'node:fs';
import * as path from 'node:path';

interface TicksFrame {
  name?: string;
  file?: string;
  line?: number;
  column?: number;
  type?: 'CODE' | 'CPP' | 'JS' | 'SHARED_LIB' | string;
  kind?:
    | 'Builtin'
    | 'BytecodeHandler'
    | 'Handler'
    | 'KeyedLoadIC'
    | 'KeyedStoreIC'
    | 'LoadGlobalIC'
    | 'LoadIC'
    | 'Opt'
    | 'StoreIC'
    | 'Stub'
    | 'Unopt'
    | 'RegExp'
    | string;
  func?: number;
  tm?: number;
  source?: any;
}

// The ticks data can be either an array of stacks or an object with ticks property
type TicksData = TicksFrame[][] | { ticks?: { stack?: TicksFrame[] }[] };

interface SpeedscopeFrame {
  name: string;
  file?: string;
  line?: number;
  col?: number;
}

type SpeedscopeUnit =
  | 'bytes'
  | 'microseconds'
  | 'milliseconds'
  | 'nanoseconds'
  | 'none'
  | 'seconds';

interface SpeedscopeProfile {
  type: 'sampled';
  name: string;
  unit: SpeedscopeUnit;
  startValue: number;
  endValue: number;
  samples: number[][];
  weights: number[];
}

interface SpeedscopeFile {
  $schema: string;
  shared: { frames: SpeedscopeFrame[] };
  profiles: SpeedscopeProfile[];
  name: string;
  exporter?: string;
}

export function convertTicksToSpeedscope(ticksPath: string, exporter = '0x'): SpeedscopeFile {
  // Read the 0x ticks.json file
  const ticksData: TicksData = JSON.parse(fs.readFileSync(ticksPath, 'utf8'));

  // Convert to speedscope format
  const speedscopeData: SpeedscopeFile = {
    $schema: 'https://www.speedscope.app/file-format-schema.json',
    shared: {
      frames: [],
    },
    profiles: [
      {
        type: 'sampled',
        name: 'CPU Profile',
        unit: 'milliseconds',
        startValue: 0,
        endValue: 0,
        samples: [],
        weights: [],
      },
    ],
    name: path.basename(ticksPath, '.json'),
    exporter,
  };

  // Build frame index
  const frameMap = new Map<string, number>();

  // Convert frame to speedscope format with sophisticated parsing
  const frameToSpeedscopeFrame = (frame: TicksFrame): SpeedscopeFrame => {
    let frameName = (frame.name || '').trim(); // Trim whitespace
    let frameFile = frame.file;
    let frameLine = frame.line;
    let frameCol = frame.column;

    // Handle different frame types similar to V8 reference
    if (frame.type) {
      switch (frame.type) {
        case 'CPP': {
          // Try to extract C++ function name
          const cppMatch = frameName.match(/[tT] ([^(<]*)/);
          if (cppMatch) {
            frameName = `(c++) ${cppMatch[1]}`;
          } else {
            frameName = `(c++) ${frameName}`;
          }
          break;
        }

        case 'SHARED_LIB':
          frameName = `(LIB) ${frameName}`;
          break;

        case 'JS': {
          // Parse JS frames - multiple possible formats
          // Format 1: Just path with line:col (e.g., "file:///path:1:1" or "node:module:1:1")
          const pathOnlyMatch = frameName.match(
            /^((?:file:\/\/\/?.+)|(?:node:.+)|(?:[^:\s]+\.js)):(\d+):(\d+)$/
          );
          if (pathOnlyMatch) {
            const filePath = pathOnlyMatch[1];
            frameLine = frameLine || Number.parseInt(pathOnlyMatch[2], 10);
            frameCol = frameCol || Number.parseInt(pathOnlyMatch[3], 10);
            frameFile = frameFile || filePath;

            // Extract filename for anonymous functions
            const fileName = filePath.includes('/')
              ? filePath.split('/').pop()
              : filePath.replace('node:', '');
            frameName = `(anonymous ${fileName}:${frameLine})`;
          } else {
            // Format 2: "functionName file:///path/to/file.js:line:col"
            const jsMatch1 = frameName.match(/^(.+?)\s+(file:\/\/\/?.+):(\d+):(\d+)$/);
            if (jsMatch1) {
              frameName = jsMatch1[1];
              frameFile = frameFile || jsMatch1[2];
              frameLine = frameLine || Number.parseInt(jsMatch1[3], 10);
              frameCol = frameCol || Number.parseInt(jsMatch1[4], 10);
            } else {
              // Format 3: "functionName path/to/file.js:line:col" (including node: paths)
              const jsMatch2 = frameName.match(
                /^([^\s]+)\s+([^:\s]+(?:\.js)?|node:[^:]+):(\d+):(\d+)$/
              );
              if (jsMatch2) {
                const functionName = jsMatch2[1];
                const file = jsMatch2[2];
                const line = Number.parseInt(jsMatch2[3], 10);
                const col = Number.parseInt(jsMatch2[4], 10);

                frameName = functionName;
                frameFile = frameFile || file;
                frameLine = frameLine || line;
                frameCol = frameCol || col;
              }
            }
          }
          break;
        }

        case 'CODE': {
          // Handle different code kinds with appropriate prefixes
          if (frame.kind) {
            switch (frame.kind) {
              case 'LoadIC':
              case 'StoreIC':
              case 'KeyedStoreIC':
              case 'KeyedLoadIC':
              case 'LoadGlobalIC':
              case 'Handler':
                frameName = `(IC) ${frameName}`;
                break;
              case 'BytecodeHandler':
                frameName = `(bytecode) ~${frameName}`;
                break;
              case 'Stub':
                frameName = `(stub) ${frameName}`;
                break;
              case 'Builtin':
                frameName = `(builtin) ${frameName}`;
                break;
              case 'RegExp':
                frameName = `(regexp) ${frameName}`;
                break;
              default:
                frameName = `(code) ${frameName}`;
                break;
            }
          } else {
            frameName = `(code) ${frameName}`;
          }
          break;
        }

        default:
          // For unknown types, add type prefix
          if (frame.type && !frameName.startsWith(`(${frame.type})`)) {
            frameName = `(${frame.type}) ${frameName}`;
          }
          break;
      }
    } else {
      // No type specified - try to parse embedded file location
      // First check for path-only format (e.g., "file:///path:1:1" or "node:module:1:1")
      const pathOnlyMatch = frameName.match(
        /^((?:file:\/\/\/?.+)|(?:node:.+)|(?:[^:\s]+\.js)):(\d+):(\d+)$/
      );
      if (pathOnlyMatch) {
        const filePath = pathOnlyMatch[1];
        frameLine = frameLine || Number.parseInt(pathOnlyMatch[2], 10);
        frameCol = frameCol || Number.parseInt(pathOnlyMatch[3], 10);
        frameFile = frameFile || filePath;

        // Extract filename for anonymous functions
        const fileName = filePath.includes('/')
          ? filePath.split('/').pop()
          : filePath.replace('node:', '');
        frameName = `(anonymous ${fileName}:${frameLine})`;
      } else {
        // Check for "functionName path:line:col" format
        const match = frameName.match(
          /^(.+?)\s+((?:file:\/\/\/?.+)|(?:node:.+)|(?:[^:\s]+)):(\d+):(\d+)$/
        );
        if (match) {
          frameName = match[1];
          frameFile = frameFile || match[2];
          frameLine = frameLine || Number.parseInt(match[3], 10);
          frameCol = frameCol || Number.parseInt(match[4], 10);
        }
      }
    }

    // Handle anonymous functions
    if (!frameName || frameName === 'anonymous' || frameName === '') {
      if (frameFile && frameLine) {
        const fileName = frameFile.split('/').pop() || frameFile;
        frameName = `(anonymous ${fileName}:${frameLine})`;
      } else {
        frameName = '(anonymous)';
      }
    }

    return {
      name: frameName,
      file: frameFile,
      line: frameLine,
      col: frameCol,
    };
  };

  const getFrameIndex = (frame: TicksFrame) => {
    const speedscopeFrame = frameToSpeedscopeFrame(frame);

    // Create unique key including all frame properties
    const key = `${speedscopeFrame.name}:${speedscopeFrame.file || ''}:${speedscopeFrame.line || ''}:${speedscopeFrame.col || ''}`;

    if (!frameMap.has(key)) {
      const index = speedscopeData.shared.frames.length;
      frameMap.set(key, index);
      speedscopeData.shared.frames.push(speedscopeFrame);
    }
    return frameMap.get(key)!;
  };

  // Process ticks
  // 0x samples at regular intervals (default 1ms)
  // Each tick represents one sampling interval
  const samplingInterval = 1; // 1 millisecond per sample
  let totalTime = 0;

  // Handle both formats: array of stacks or object with ticks property
  if (Array.isArray(ticksData)) {
    // Direct array format
    for (const stack of ticksData as TicksFrame[][]) {
      const frameIndices = stack.map((frame: TicksFrame) => getFrameIndex(frame)).reverse();
      if (frameIndices.length > 0) {
        speedscopeData.profiles[0].samples.push(frameIndices);
        speedscopeData.profiles[0].weights.push(samplingInterval);
        totalTime += samplingInterval;
      }
    }
  } else if (ticksData.ticks) {
    // Object format with ticks property
    for (const tick of ticksData.ticks) {
      const stack = tick.stack?.map((frame: TicksFrame) => getFrameIndex(frame)).reverse() || [];
      if (stack.length > 0) {
        speedscopeData.profiles[0].samples.push(stack);
        speedscopeData.profiles[0].weights.push(samplingInterval);
        totalTime += samplingInterval;
      }
    }
  }

  speedscopeData.profiles[0].endValue = totalTime;

  return speedscopeData;
}

export function writeSpeedscopeFile(speedscopeData: SpeedscopeFile, outputPath: string): void {
  fs.writeFileSync(outputPath, JSON.stringify(speedscopeData, null, 2));
}
