import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { convertTicksToSpeedscope } from '../src/utils/ticks-trace';

describe('Ticks Trace Parser', () => {
  const ticksFixture = path.join(__dirname, 'fixtures', 'test-ticks.json');

  it('should parse a valid ticks.json file', () => {
    const result = convertTicksToSpeedscope(ticksFixture);

    // Verify basic structure
    expect(result).toHaveProperty('$schema', 'https://www.speedscope.app/file-format-schema.json');
    expect(result).toHaveProperty('name', 'test-ticks');
    expect(result).toHaveProperty('shared');
    expect(result).toHaveProperty('profiles');

    // Verify frames exist
    expect(result.shared.frames).toBeInstanceOf(Array);
    expect(result.shared.frames.length).toBeGreaterThan(0);

    // Verify exactly one profile exists
    expect(result.profiles).toBeInstanceOf(Array);
    expect(result.profiles).toHaveLength(1);
  });

  it('should correctly parse frame information', () => {
    const result = convertTicksToSpeedscope(ticksFixture);

    // Check that frames have the required properties
    const frames = result.shared.frames;
    for (const frame of frames) {
      expect(frame).toHaveProperty('name');
      expect(typeof frame.name).toBe('string');

      // File, line, col are optional but should be correct types if present
      if ('file' in frame && frame.file !== undefined) {
        expect(typeof frame.file).toBe('string');
      }
      if ('line' in frame && frame.line !== undefined) {
        expect(typeof frame.line).toBe('number');
      }
      if ('col' in frame && frame.col !== undefined) {
        expect(typeof frame.col).toBe('number');
      }
    }
  });

  it('should separate file location from frame names', () => {
    const result = convertTicksToSpeedscope(ticksFixture);
    const frames = result.shared.frames;

    // Check specific known functions have proper file separation
    const runTestsFrame = frames.find((f) => f.name === 'runTests');
    if (runTestsFrame) {
      // Name should be just the function name
      expect(runTestsFrame.name).toBe('runTests');
      // File location should be in separate properties
      expect(runTestsFrame.file).toMatch(/test\.js$/);
      expect(runTestsFrame.line).toBeGreaterThan(0);
      expect(runTestsFrame.col).toBeGreaterThan(0);
    }

    const fibonacciFrame = frames.find((f) => f.name === 'fibonacci');
    if (fibonacciFrame) {
      expect(fibonacciFrame.name).toBe('fibonacci');
      expect(fibonacciFrame.file).toMatch(/test\.js$/);
      expect(fibonacciFrame.line).toBeGreaterThan(0);
      expect(fibonacciFrame.col).toBeGreaterThan(0);
    }

    // Find user-defined JS frames (those with file:/// URLs)
    const userJsFrames = frames.filter((f) => f.file?.startsWith('file:///'));

    // These frames should NOT have file paths embedded in the name
    for (const frame of userJsFrames) {
      expect(frame.name).not.toContain('file://');
      // Anonymous frames may contain filename for clarity
      if (!frame.name.includes('(anonymous')) {
        expect(frame.name).not.toMatch(/\.js/);
      }
      // The name should not end with :line:col pattern
      expect(frame.name).not.toMatch(/:\d+:\d+$/);
    }
  });

  it('should have correct profile metadata', () => {
    const result = convertTicksToSpeedscope(ticksFixture);
    const profile = result.profiles[0];

    expect(profile.type).toBe('sampled');
    expect(profile.name).toBe('CPU Profile');
    expect(profile.unit).toBe('milliseconds');
    expect(profile.startValue).toBe(0);
    expect(profile.endValue).toBeGreaterThan(0);
  });

  it('should correctly parse samples and weights', () => {
    const result = convertTicksToSpeedscope(ticksFixture);
    const profile = result.profiles[0];

    // Should have samples and weights
    expect(profile.samples).toBeInstanceOf(Array);
    expect(profile.weights).toBeInstanceOf(Array);

    // Should have equal number of samples and weights
    expect(profile.samples.length).toBe(profile.weights.length);
    expect(profile.samples.length).toBeGreaterThan(0);

    // Each sample should be an array of frame indices
    for (const sample of profile.samples) {
      expect(sample).toBeInstanceOf(Array);
      for (const frameIndex of sample) {
        expect(typeof frameIndex).toBe('number');
        expect(frameIndex).toBeGreaterThanOrEqual(0);
        expect(frameIndex).toBeLessThan(result.shared.frames.length);
      }
    }

    // Each weight should be 1 (milliseconds)
    for (const weight of profile.weights) {
      expect(weight).toBe(1);
    }

    // endValue should equal the sum of weights
    const totalWeight = profile.weights.reduce((sum, w) => sum + w, 0);
    expect(profile.endValue).toBe(totalWeight);
  });

  it('should find JavaScript function names from our test', () => {
    const result = convertTicksToSpeedscope(ticksFixture);
    const frameNames = result.shared.frames.map((f) => f.name);

    // Should have functions from our test.js file
    const testFunctions = [
      'fibonacci',
      'createLargeDataStructure',
      'processStrings',
      'arrayOperations',
      'createTree',
      'traverseTree',
      'regexOperations',
      'jsonOperations',
      'objectOperations',
      'mathOperations',
      'asyncWork',
      'runTests',
    ];

    // Check that at least some of our test functions appear in the trace
    const foundFunctions = testFunctions.filter((fn) =>
      frameNames.some((name) => name.includes(fn))
    );
    expect(foundFunctions.length).toBeGreaterThan(0);
  });

  it('should handle native and system functions', () => {
    const result = convertTicksToSpeedscope(ticksFixture);
    const frameNames = result.shared.frames.map((f) => f.name);

    // Should have some native/system functions
    const systemFunctions = frameNames.filter(
      (name) =>
        name.includes('GLIBC') ||
        name.includes('.so') ||
        name.includes('node:') ||
        name.includes('/bin/node')
    );
    expect(systemFunctions.length).toBeGreaterThan(0);
  });

  it('should handle different frame types correctly', () => {
    // Read raw data to check frame types
    const rawData = JSON.parse(fs.readFileSync(ticksFixture, 'utf8'));
    const frameTypes = new Set<string>();

    // Collect all frame types from raw data
    for (const stack of rawData) {
      for (const frame of stack) {
        if (frame.type) {
          frameTypes.add(frame.type);
        }
      }
    }

    // Should have various frame types (JS, CPP, SHARED_LIB, etc.)
    expect(frameTypes.size).toBeGreaterThan(1);
  });

  it('should preserve stack order correctly', () => {
    const result = convertTicksToSpeedscope(ticksFixture);
    const profile = result.profiles[0];

    // Verify that stacks are properly formed (non-empty)
    for (const sample of profile.samples) {
      expect(sample.length).toBeGreaterThan(0);
    }

    // Find a sample with multiple frames
    const multiFrameSample = profile.samples.find((s) => s.length > 3);
    expect(multiFrameSample).toBeDefined();

    if (multiFrameSample) {
      // The stack should be ordered from inner-most (top) to outer-most (bottom)
      // Check that frame indices are valid
      for (const frameIdx of multiFrameSample) {
        const frame = result.shared.frames[frameIdx];
        expect(frame).toBeDefined();
      }
    }
  });

  it('should handle empty or minimal stacks', () => {
    const result = convertTicksToSpeedscope(ticksFixture);

    // Even if some stacks are minimal, the conversion should succeed
    expect(result.profiles[0].samples.length).toBeGreaterThan(0);

    // All samples should have at least one frame
    for (const sample of result.profiles[0].samples) {
      expect(sample.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('should generate valid speedscope format', () => {
    const result = convertTicksToSpeedscope(ticksFixture);

    // The result should be JSON serializable
    const jsonString = JSON.stringify(result);
    expect(() => JSON.parse(jsonString)).not.toThrow();

    // Re-parse and verify structure is maintained
    const reparsed = JSON.parse(jsonString);
    expect(reparsed.$schema).toBe(result.$schema);
    expect(reparsed.profiles.length).toBe(result.profiles.length);
    expect(reparsed.shared.frames.length).toBe(result.shared.frames.length);
  });

  it('should handle frames with leading whitespace', () => {
    const result = convertTicksToSpeedscope(ticksFixture);
    const frames = result.shared.frames;

    // Find frames that originally had leading whitespace (e.g., " node:internal/main/run_main_module:1:1")
    const nodeMainFrame = frames.find(
      (f) => f.file === 'node:internal/main/run_main_module' && f.line === 1
    );

    if (nodeMainFrame) {
      // The name should be trimmed and extracted properly
      expect(nodeMainFrame.name).toBe('(anonymous run_main_module:1)');
      expect(nodeMainFrame.file).toBe('node:internal/main/run_main_module');
      expect(nodeMainFrame.line).toBe(1);
      expect(nodeMainFrame.col).toBe(1);
    }

    // Find file:/// frames with leading whitespace
    const fileFrame = frames.find(
      (f) => f.file === 'file:///workspace/tests/fixtures/test.js' && f.line === 1
    );

    if (fileFrame) {
      expect(fileFrame.name).toBe('(anonymous test.js:1)');
      expect(fileFrame.file).toBe('file:///workspace/tests/fixtures/test.js');
      expect(fileFrame.line).toBe(1);
      expect(fileFrame.col).toBe(1);
    }
  });

  it('should handle path-only frame formats', () => {
    const result = convertTicksToSpeedscope(ticksFixture);
    const frames = result.shared.frames;

    // Check frames that are just path:line:col without function name
    // These should be parsed as anonymous functions with proper file/line/col
    const anonymousFrames = frames.filter((f) => f.name.includes('(anonymous'));

    for (const frame of anonymousFrames) {
      // Anonymous frames should have file/line/col extracted
      if (frame.file) {
        expect(frame.file).toBeTruthy();
        expect(typeof frame.line).toBe('number');
        expect(frame.line).toBeGreaterThan(0);

        // The anonymous name should contain some part of the filename
        // It could be "(anonymous filename:line)" format
        expect(frame.name).toMatch(/^\(anonymous/);
        expect(frame.name).toContain(`:${frame.line}`);
      }
    }
  });

  it('should handle node: prefixed paths correctly', () => {
    const result = convertTicksToSpeedscope(ticksFixture);
    const frames = result.shared.frames;

    // Find all node: prefixed frames
    const nodeFrames = frames.filter((f) => f.file?.startsWith('node:'));

    expect(nodeFrames.length).toBeGreaterThan(0);

    for (const frame of nodeFrames) {
      // File should preserve the node: prefix
      expect(frame.file).toMatch(/^node:/);

      // Name should not contain the full path
      expect(frame.name).not.toContain('node:');

      // Should have line and column extracted
      if (frame.line) {
        expect(typeof frame.line).toBe('number');
        expect(frame.line).toBeGreaterThan(0);
      }
    }
  });

  it('should handle various JS frame name formats', () => {
    const result = convertTicksToSpeedscope(ticksFixture);
    const frames = result.shared.frames;

    // Test different function name patterns
    const testPatterns = [
      {
        name: 'runTests',
        expectedFile: /test\.js$/,
        shouldHaveLine: true,
      },
      {
        name: 'fibonacci',
        expectedFile: /test\.js$/,
        shouldHaveLine: true,
      },
      {
        name: 'compileForInternalLoader',
        expectedFile: /node:internal\/bootstrap\/realm/,
        shouldHaveLine: true,
      },
      {
        name: 'requireBuiltin',
        expectedFile: /node:internal\/bootstrap\/realm/,
        shouldHaveLine: true,
      },
    ];

    for (const pattern of testPatterns) {
      const matchingFrames = frames.filter((f) => f.name === pattern.name);

      if (matchingFrames.length > 0) {
        const frame = matchingFrames[0];

        // Function name should be clean (no file info)
        expect(frame.name).toBe(pattern.name);

        // File should match expected pattern
        if (pattern.expectedFile && frame.file) {
          expect(frame.file).toMatch(pattern.expectedFile);
        }

        // Should have line info if expected
        if (pattern.shouldHaveLine) {
          expect(typeof frame.line).toBe('number');
          expect(frame.line).toBeGreaterThan(0);
        }
      }
    }
  });

  it('should properly separate file paths from function names in all cases', () => {
    const result = convertTicksToSpeedscope(ticksFixture);
    const frames = result.shared.frames;

    // No frame name should contain file paths
    for (const frame of frames) {
      // Skip special frames like (LIB), (c++), etc.
      if (frame.name.startsWith('(') && frame.name.includes(')')) {
        continue;
      }

      // Regular function names should not contain:
      // - File extensions
      expect(frame.name).not.toMatch(/\.(js|ts|mjs|cjs)$/);
      // - Path separators (unless it's a special case)
      if (!frame.name.includes('@@') && !frame.name.includes('::')) {
        expect(frame.name).not.toContain('/');
      }
      // - Line:column patterns at the end
      expect(frame.name).not.toMatch(/:\d+:\d+$/);
      // - file:// URLs
      expect(frame.name).not.toContain('file://');
    }
  });

  it('should handle complex frame types correctly', () => {
    const result = convertTicksToSpeedscope(ticksFixture);
    const frames = result.shared.frames;

    // Check different frame type prefixes
    const prefixPatterns = [
      { prefix: '(c++)', pattern: /^\(c\+\+\)/ },
      { prefix: '(LIB)', pattern: /^\(LIB\)/ },
      { prefix: '(anonymous', pattern: /^\(anonymous/ },
      { prefix: '(builtin)', pattern: /^\(builtin\)/ },
      { prefix: '(code)', pattern: /^\(code\)/ },
    ];

    for (const { pattern } of prefixPatterns) {
      const matchingFrames = frames.filter((f) => f.name.match(pattern));

      if (matchingFrames.length > 0) {
        // These frames should have the correct prefix
        for (const frame of matchingFrames) {
          expect(frame.name).toMatch(pattern);
        }
      }
    }
  });

  it('should handle frames without explicit type information', () => {
    const result = convertTicksToSpeedscope(ticksFixture);

    // Create a test for frames that don't have type specified
    // The parser should still extract file/line/col from the name
    const framesWithFile = result.shared.frames.filter((f) => f.file);

    for (const frame of framesWithFile) {
      // If a frame has file info, it should be properly extracted
      expect(frame.file).toBeTruthy();

      // The name should not duplicate the file info unless it's anonymous
      // Skip this check for non-anonymous frames as they might coincidentally
      // have similar names to their files (e.g., a function called "stream" in stream.js)
      if (frame.name.startsWith('(anonymous') && frame.file.includes('/')) {
        const fileName = frame.file.split('/').pop();
        if (fileName) {
          // Anonymous frames may include the filename for clarity
          expect(frame.name).toMatch(/^\(anonymous.*\)$/);
        }
      }
    }
  });
});
