import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { spawn } from './spawn.js';

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

interface ParsedSample {
  time: number;
  threadId: string;
  threadName: string;
  processName: string;
  weight: number;
  frames: string[];
}

function parseTimeValue(_fmt: string, raw: string): number {
  // fmt format is like "00:00.360.881" and raw is nanoseconds
  return Number.parseInt(raw, 10);
}

function parseWeight(fmt: string): number {
  // fmt format is like "1.00 ms"
  const match = fmt.match(/^([\d.]+)\s*(\w+)$/);
  if (!match) return 1000000; // default 1ms

  const value = Number.parseFloat(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'ns':
      return value;
    case 'us':
    case 'µs':
      return value * 1000;
    case 'ms':
      return value * 1000000;
    case 's':
      return value * 1000000000;
    default:
      return 1000000; // default 1ms
  }
}

function collectDefinitions(obj: any, lookup: Map<string, any>): void {
  if (typeof obj !== 'object' || obj === null) return;

  // If this object has an @_id, store it in the lookup
  if (obj['@_id']) {
    lookup.set(obj['@_id'], obj);
  }

  // Recursively process all properties
  for (const key in obj) {
    if (key === '@_id' || key === '@_ref') continue;

    const value = obj[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        collectDefinitions(item, lookup);
      }
    } else if (typeof value === 'object' && value !== null) {
      collectDefinitions(value, lookup);
    }
  }
}

export async function parseInstrumentsTrace(
  traceDir: string,
  exporter = 'uniprof-xctrace'
): Promise<SpeedscopeFile> {
  // Create a temporary file for the XML export
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniprof-xctrace-'));
  const tempXmlFile = path.join(tempDir, 'export.xml');

  try {
    // Export the trace data to XML using xctrace (available on Xcode 14.3+)
    // https://benromano.com/blog/instruments-flame-graphs
    const exportProc = spawn([
      'xcrun',
      'xctrace',
      'export',
      '--input',
      traceDir,
      '--xpath',
      '/trace-toc[1]/run[1]/data[1]/table[@schema="time-profile"]',
      '--output',
      tempXmlFile,
    ]);
    const exitCode = await exportProc.exited;
    if (exitCode !== 0) {
      throw new Error('xctrace export failed');
    }

    // Read and parse the XML
    const xmlContent = await fs.promises.readFile(tempXmlFile, 'utf8');

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: false,
      trimValues: true,
    });

    const parsed = parser.parse(xmlContent);
    const traceResult = parsed['trace-query-result'];
    const node = traceResult.node;
    const rows = node.row;

    // Build lookup tables for referenced elements
    const elementLookup = new Map<string, any>();
    const frameIdToIndex = new Map<string, number>();
    const frames: SpeedscopeFrame[] = [];

    // First pass: collect all definitions (elements with id attribute)
    const rowArray = Array.isArray(rows) ? rows : [rows];
    for (const row of rowArray) {
      collectDefinitions(row, elementLookup);
    }

    // Process each row (sample)
    const samples: ParsedSample[] = [];

    for (const row of rowArray) {
      // Parse sample time
      const sampleTime = row['sample-time'];
      const time = parseTimeValue(sampleTime['@_fmt'], sampleTime['#text']);

      // Parse thread info (resolve references)
      let threadFmt = 'Unknown Thread';
      const thread = row.thread;
      if (thread) {
        if (thread['@_fmt']) {
          threadFmt = thread['@_fmt'];
        } else if (thread['@_ref']) {
          const referenced = elementLookup.get(thread['@_ref']);
          if (referenced?.['@_fmt']) {
            threadFmt = referenced['@_fmt'];
          }
        }
      }

      // Parse process info (resolve references)
      let processFmt = 'Unknown Process';
      const process = row.process;
      if (process) {
        if (process['@_fmt']) {
          processFmt = process['@_fmt'];
        } else if (process['@_ref']) {
          const referenced = elementLookup.get(process['@_ref']);
          if (referenced?.['@_fmt']) {
            processFmt = referenced['@_fmt'];
          }
        }
      }

      // Parse weight (resolve references)
      let weightValue = 1000000; // default 1ms
      const weight = row.weight;
      if (weight) {
        if (weight['@_fmt']) {
          weightValue = parseWeight(weight['@_fmt']);
        } else if (weight['@_ref']) {
          const referenced = elementLookup.get(weight['@_ref']);
          if (referenced?.['@_fmt']) {
            weightValue = parseWeight(referenced['@_fmt']);
          }
        }
      }

      // Parse backtrace
      const backtrace = row.backtrace;
      const frameIds: string[] = [];

      if (backtrace) {
        // Handle backtrace references
        let backtraceToProcess = backtrace;
        if (backtrace['@_ref']) {
          backtraceToProcess = elementLookup.get(backtrace['@_ref']) || backtrace;
        }

        if (backtraceToProcess?.frame) {
          const backtraceFrames = Array.isArray(backtraceToProcess.frame)
            ? backtraceToProcess.frame
            : [backtraceToProcess.frame];

          for (const frame of backtraceFrames) {
            let frameToProcess = frame;
            let frameId = frame['@_id'] || frame['@_ref'];

            // If this is a reference, resolve it
            if (frame['@_ref'] && !frame['@_id']) {
              frameToProcess = elementLookup.get(frame['@_ref']) || frame;
              frameId = frame['@_ref'];
            }

            if (!frameId) continue;

            frameIds.push(frameId);

            // Process frame definition if not already seen
            if (!frameIdToIndex.has(frameId) && frameToProcess['@_name']) {
              const frameName = frameToProcess['@_name'] || 'Unknown';

              let file: string | undefined;

              // Check for source information
              if (frameToProcess.source) {
                const source = frameToProcess.source;
                let pathText: string | undefined;

                if (source.path) {
                  if (typeof source.path === 'string') {
                    pathText = source.path;
                  } else if (source.path['#text']) {
                    pathText = source.path['#text'];
                  } else if (source.path['@_ref']) {
                    const pathRef = elementLookup.get(source.path['@_ref']);
                    pathText = pathRef ? pathRef['#text'] : undefined;
                  }
                }

                if (pathText) {
                  file = pathText;
                }
              }
              // Check for binary information
              else if (frameToProcess.binary) {
                let binary = frameToProcess.binary;
                if (binary['@_ref']) {
                  binary = elementLookup.get(binary['@_ref']) || binary;
                }
                if (binary['@_path']) {
                  file = binary['@_path'];
                }
              }

              const speedscopeFrame: SpeedscopeFrame = {
                name: frameName,
                file,
                line: frameToProcess.source?.['@_line']
                  ? Number.parseInt(frameToProcess.source['@_line'], 10)
                  : undefined,
              };

              frameIdToIndex.set(frameId, frames.length);
              frames.push(speedscopeFrame);
            }
          }
        }
      }

      samples.push({
        time,
        threadId: threadFmt,
        threadName: threadFmt,
        processName: processFmt,
        weight: weightValue,
        frames: frameIds,
      });
    }

    // Group samples by thread
    const samplesByThread = new Map<string, ParsedSample[]>();
    for (const sample of samples) {
      if (!samplesByThread.has(sample.threadId)) {
        samplesByThread.set(sample.threadId, []);
      }
      samplesByThread.get(sample.threadId)!.push(sample);
    }

    // Create profiles for each thread
    const profiles: SpeedscopeProfile[] = [];

    for (const [threadId, threadSamples] of samplesByThread) {
      if (threadSamples.length === 0) continue;

      // Sort samples by time
      threadSamples.sort((a, b) => a.time - b.time);

      const speedscopeSamples: number[][] = [];
      const weights: number[] = [];

      for (const sample of threadSamples) {
        const stack: number[] = [];

        // Build stack (frames are already in correct order from innermost to outermost)
        for (const frameId of sample.frames) {
          const frameIndex = frameIdToIndex.get(frameId);
          if (frameIndex !== undefined) {
            stack.push(frameIndex);
          }
        }

        speedscopeSamples.push(stack);
        weights.push(sample.weight);
      }

      const startTime = threadSamples[0].time;
      const endTime = threadSamples[threadSamples.length - 1].time;

      profiles.push({
        type: 'sampled',
        name: threadId,
        unit: 'nanoseconds',
        startValue: 0,
        endValue: endTime - startTime,
        samples: speedscopeSamples,
        weights,
      });
    }

    return {
      $schema: 'https://www.speedscope.app/file-format-schema.json',
      name: path.basename(traceDir),
      shared: { frames },
      profiles,
      exporter,
    };
  } finally {
    // Clean up temp directory
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
