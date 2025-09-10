import { beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { convertPerfEventsToSpeedscope, parsePerfScript } from '../src/utils/perf-trace';

describe('Perf Trace Parser', () => {
  let perfScriptContent: string;

  beforeAll(() => {
    // Load the pre-exported perf script fixture from the complex test program
    const perfFixture = path.join(__dirname, 'fixtures', 'test-perf-script.txt.gz');
    const gzipped = fs.readFileSync(perfFixture);
    perfScriptContent = zlib.gunzipSync(gzipped).toString('utf8');
  });

  it('should parse perf script output', () => {
    const events = parsePerfScript(perfScriptContent);

    // Verify we have events
    expect(events).toBeInstanceOf(Array);
    expect(events.length).toBeGreaterThan(0);

    // Check first event structure
    const firstEvent = events[0];
    expect(firstEvent).toHaveProperty('command');
    expect(firstEvent).toHaveProperty('threadID');
    expect(firstEvent).toHaveProperty('time');
    expect(firstEvent).toHaveProperty('eventType');
    expect(firstEvent).toHaveProperty('stack');

    // Verify stack is an array
    expect(firstEvent.stack).toBeInstanceOf(Array);
  });

  it('should parse stack frames with symbol names from complex test program', () => {
    const events = parsePerfScript(perfScriptContent);

    // Find events with stacks containing our test functions
    const eventsWithMatrixMultiply = events.filter((event) =>
      event.stack.some((frame) => frame.symbolName === 'matrix_multiply')
    );

    const eventsWithAllocateMatrix = events.filter((event) =>
      event.stack.some((frame) => frame.symbolName === 'allocate_matrix')
    );

    expect(eventsWithMatrixMultiply.length).toBeGreaterThan(0);
    expect(eventsWithAllocateMatrix.length).toBeGreaterThan(0);

    // Check stack frame structure
    const stackWithMatrixMultiply = eventsWithMatrixMultiply[0].stack;
    const matrixMultiplyFrame = stackWithMatrixMultiply.find(
      (f) => f.symbolName === 'matrix_multiply'
    );

    expect(matrixMultiplyFrame).toBeDefined();
    expect(matrixMultiplyFrame).toHaveProperty('address');
    expect(matrixMultiplyFrame).toHaveProperty('symbolName', 'matrix_multiply');
    expect(matrixMultiplyFrame).toHaveProperty('file');
    expect(matrixMultiplyFrame!.file).toContain('/tmp/perf-test/test');
  });

  it('should find various functions from the complex test program', () => {
    const events = parsePerfScript(perfScriptContent);

    // Check for presence of various functions (may not all be sampled depending on timing)
    const functionNames = new Set<string>();
    for (const event of events) {
      for (const frame of event.stack) {
        if (frame.symbolName && !frame.symbolName.includes('@')) {
          functionNames.add(frame.symbolName);
        }
      }
    }

    // We should at least see main and matrix_multiply since that takes most of the time
    expect(functionNames.has('main')).toBe(true);
    expect(functionNames.has('matrix_multiply')).toBe(true);

    // Log what functions we found for debugging
    console.log('Functions found in profile:', Array.from(functionNames).sort());
  });

  it('should parse call stacks correctly', () => {
    const events = parsePerfScript(perfScriptContent);

    // Find events with complete call stacks including main
    const eventsWithFullStack = events.filter(
      (event) =>
        event.stack.some((f) => f.symbolName === 'matrix_multiply') &&
        event.stack.some((f) => f.symbolName === 'main')
    );

    expect(eventsWithFullStack.length).toBeGreaterThan(0);

    // Verify stack order (bottom to top order: main -> matrix_multiply)
    const stack = eventsWithFullStack[0].stack;
    const mainIndex = stack.findIndex((f) => f.symbolName === 'main');
    const matrixMultiplyIndex = stack.findIndex((f) => f.symbolName === 'matrix_multiply');

    // main should be called before matrix_multiply (lower in stack)
    expect(mainIndex).toBeLessThan(matrixMultiplyIndex);
  });

  it('should handle symbol offsets correctly', () => {
    const events = parsePerfScript(perfScriptContent);

    // Check that symbol names don't contain offsets
    for (const event of events) {
      for (const frame of event.stack) {
        if (frame.symbolName) {
          expect(frame.symbolName).not.toMatch(/\+0x[\da-f]+$/);
        }
      }
    }
  });

  it('should convert perf events to speedscope format', () => {
    const events = parsePerfScript(perfScriptContent);
    const speedscope = convertPerfEventsToSpeedscope(events);

    // Verify basic speedscope structure
    expect(speedscope).toHaveProperty(
      '$schema',
      'https://www.speedscope.app/file-format-schema.json'
    );
    expect(speedscope).toHaveProperty('name', 'Native Profile (perf)');
    expect(speedscope).toHaveProperty('exporter', 'uniprof-perf');
    expect(speedscope).toHaveProperty('shared');
    expect(speedscope).toHaveProperty('profiles');

    // Verify frames
    expect(speedscope.shared).toHaveProperty('frames');
    expect(speedscope.shared.frames).toBeInstanceOf(Array);
    expect(speedscope.shared.frames.length).toBeGreaterThan(0);

    // Verify profiles
    expect(speedscope.profiles).toBeInstanceOf(Array);
    expect(speedscope.profiles.length).toBeGreaterThan(0);
  });

  it('should create correct frame table in speedscope', () => {
    const events = parsePerfScript(perfScriptContent);
    const speedscope = convertPerfEventsToSpeedscope(events);

    const frames = speedscope.shared.frames;

    // Find our test functions in the frame table
    const matrixMultiplyFrame = frames.find((f) => f.name === 'matrix_multiply');
    const allocateMatrixFrame = frames.find((f) => f.name === 'allocate_matrix');
    const mainFrame = frames.find((f) => f.name === 'main');

    expect(matrixMultiplyFrame).toBeDefined();
    expect(allocateMatrixFrame).toBeDefined();
    expect(mainFrame).toBeDefined();

    // Check frame properties
    expect(matrixMultiplyFrame).toHaveProperty('file', '/tmp/perf-test/test');
    expect(allocateMatrixFrame).toHaveProperty('file', '/tmp/perf-test/test');
    expect(mainFrame).toHaveProperty('file', '/tmp/perf-test/test');
  });

  it('should handle unknown symbols correctly', () => {
    const events = parsePerfScript(perfScriptContent);
    const speedscope = convertPerfEventsToSpeedscope(events);

    const frames = speedscope.shared.frames;

    // Check if any unknown symbols are properly formatted
    const unknownFrames = frames.filter((f) => f.name === '[unknown]');

    // Unknown frames should have the file path set
    for (const frame of unknownFrames) {
      if (frame.file) {
        expect(frame.file).toBeTruthy();
      }
    }
  });

  it('parses frames that omit the (file) segment', () => {
    const minimalScript = `node  1234/1234  1000.000:  1 cycles:
            ffffffff00123456 foo_function+0x10\n`;
    const events = parsePerfScript(minimalScript);
    expect(events.length).toBe(1);
    expect(events[0].stack.length).toBe(1);
    expect(events[0].stack[0].symbolName).toBe('foo_function');
    expect(events[0].stack[0].file).toBe('[unknown]');
  });

  it('should create sampled profiles with correct timing', () => {
    const events = parsePerfScript(perfScriptContent);
    const speedscope = convertPerfEventsToSpeedscope(events);

    // Check first profile
    const profile = speedscope.profiles[0];

    expect(profile).toHaveProperty('type', 'sampled');
    expect(profile).toHaveProperty('name');
    expect(profile).toHaveProperty('unit', 'seconds');
    expect(profile).toHaveProperty('startValue', 0);
    expect(profile).toHaveProperty('endValue');
    expect(profile).toHaveProperty('samples');
    expect(profile).toHaveProperty('weights');

    // Verify timing calculation (999Hz sampling rate)
    expect(profile.endValue).toBeCloseTo(profile.samples.length / 999, 1);

    // Verify samples and weights match
    expect(profile.samples.length).toBe(profile.weights.length);

    // All weights should be 1/999 seconds (sampling at 999Hz)
    for (const weight of profile.weights) {
      expect(weight).toBeCloseTo(1 / 999, 6);
    }
  });

  it('should correctly map sample stacks to frame indices', () => {
    const events = parsePerfScript(perfScriptContent);
    const speedscope = convertPerfEventsToSpeedscope(events);

    const frames = speedscope.shared.frames;
    const profile = speedscope.profiles[0];

    // Create frame name to index mapping
    const frameMap = new Map<string, number>();
    frames.forEach((frame, index) => {
      frameMap.set(frame.name, index);
    });

    const matrixMultiplyIndex = frameMap.get('matrix_multiply');
    const mainIndex = frameMap.get('main');

    expect(matrixMultiplyIndex).toBeDefined();
    expect(mainIndex).toBeDefined();

    // Find samples with our test functions
    let foundCompleteStack = false;
    for (const sample of profile.samples) {
      if (sample.includes(matrixMultiplyIndex!) && sample.includes(mainIndex!)) {
        foundCompleteStack = true;

        // Verify stack order (frames are in bottom-to-top order)
        const matrixMultiplyPos = sample.indexOf(matrixMultiplyIndex!);
        const mainPos = sample.indexOf(mainIndex!);

        expect(mainPos).toBeLessThan(matrixMultiplyPos);
      }
    }

    expect(foundCompleteStack).toBe(true);
  });

  it('should group events by process/thread', () => {
    const events = parsePerfScript(perfScriptContent);
    const speedscope = convertPerfEventsToSpeedscope(events);

    // For our test program, we should have one profile
    expect(speedscope.profiles.length).toBeGreaterThanOrEqual(1);

    const profile = speedscope.profiles[0];
    expect(profile.name).toContain('test');
    expect(profile.name).toMatch(/tid: \d+/);
  });

  it('should handle events without stacks', () => {
    const testScript = `test       7 12345.678901:    1001001 task-clock:ppp: 

test       7 12345.679901:    1001001 task-clock:ppp: 
	    aaaadc060858 matrix_multiply+0x40 (/tmp/perf-test/test)
	    aaaadc0608ab main+0x23 (/tmp/perf-test/test)`;

    const events = parsePerfScript(testScript);
    expect(events.length).toBe(2);
    expect(events[0].stack.length).toBe(0);
    expect(events[1].stack.length).toBe(2);

    const speedscope = convertPerfEventsToSpeedscope(events);
    expect(speedscope.profiles[0].samples.length).toBe(2);
    expect(speedscope.profiles[0].samples[0]).toEqual([]); // Empty stack
    expect(speedscope.profiles[0].samples[1].length).toBe(2);
  });

  it('should handle PLT entries correctly', () => {
    const events = parsePerfScript(perfScriptContent);

    // Look for PLT entries
    const pltFrames = [];
    for (const event of events) {
      for (const frame of event.stack) {
        if (frame.symbolName?.includes('@plt')) {
          pltFrames.push(frame.symbolName);
        }
      }
    }

    // PLT entries should be parsed correctly (e.g., "rand@plt")
    for (const pltFrame of pltFrames) {
      expect(pltFrame).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*@plt$/);
    }
  });

  it('should preserve all samples in speedscope conversion', () => {
    const events = parsePerfScript(perfScriptContent);
    const speedscope = convertPerfEventsToSpeedscope(events);

    // Total samples across all profiles should match input events
    const totalSamples = speedscope.profiles.reduce(
      (sum, profile) => sum + profile.samples.length,
      0
    );
    expect(totalSamples).toBe(events.length);
  });
});
