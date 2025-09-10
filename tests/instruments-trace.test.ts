import { beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import { parseInstrumentsTrace } from '../src/utils/instruments-trace';
import { spawnSync } from '../src/utils/spawn.js';

describe('Instruments Trace Parser', () => {
  let testTraceDir: string;
  let xmlContent: string;
  let parsedXml: any;

  beforeAll(async () => {
    // Extract the test fixture
    const fixtureZip = path.join(__dirname, 'fixtures', 'test-simple.trace.zip');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instruments-test-'));

    // Unzip the fixture
    const unzipResult = spawnSync(['unzip', '-q', fixtureZip, '-d', tempDir]);
    if (unzipResult.exitCode !== 0) {
      throw new Error('Failed to unzip test fixture');
    }
    testTraceDir = path.join(tempDir, 'test-simple.trace');

    // Load the pre-exported XML fixture
    const xmlFixture = path.join(__dirname, 'fixtures', 'test-simple-export.xml.gz');
    const gzipped = fs.readFileSync(xmlFixture);
    xmlContent = zlib.gunzipSync(gzipped).toString('utf8');

    // Parse XML for validation
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: false,
      trimValues: true,
    });
    parsedXml = parser.parse(xmlContent);
  });

  it('should parse a valid Instruments trace file', async () => {
    const result = await parseInstrumentsTrace(testTraceDir);

    // Verify basic structure
    expect(result).toHaveProperty('$schema', 'https://www.speedscope.app/file-format-schema.json');
    expect(result).toHaveProperty('name', 'test-simple.trace');
    expect(result).toHaveProperty('shared');
    expect(result).toHaveProperty('profiles');

    // Verify frames exist
    expect(result.shared.frames).toBeInstanceOf(Array);
    expect(result.shared.frames.length).toBeGreaterThan(0);

    // Verify at least one profile exists
    expect(result.profiles).toBeInstanceOf(Array);
    expect(result.profiles.length).toBeGreaterThan(0);
  });

  it('should correctly parse frame information with proper names', async () => {
    const result = await parseInstrumentsTrace(testTraceDir);

    // Check that frames have the required properties
    const frames = result.shared.frames;
    for (const frame of frames) {
      expect(frame).toHaveProperty('name');
      expect(typeof frame.name).toBe('string');

      // File is optional but should be a string if present
      if ('file' in frame && frame.file !== undefined) {
        expect(typeof frame.file).toBe('string');
      }
    }

    // Verify that we have actual function names, not just addresses
    const frameNames = frames.map((f) => f.name);

    // Should have some actual function names from our test program
    expect(frameNames).toContain('expensive_loop');
    expect(frameNames).toContain('main');

    // Should also have system functions with proper names
    const systemFunctions = frameNames.filter(
      (name) =>
        !name.startsWith('0x') &&
        (name.includes('dyld') || name.includes('System') || name.includes('start'))
    );
    expect(systemFunctions.length).toBeGreaterThan(0);

    // Verify source file references
    const framesWithSource = frames.filter((f) => f.file?.includes('test-simple.c'));
    expect(framesWithSource.length).toBeGreaterThan(0);
    expect(framesWithSource[0].file).toMatch(/test-simple\.c$/);
    expect(framesWithSource[0].line).toBeGreaterThan(0);
  });

  it('should correctly resolve thread, process, and weight references', async () => {
    const result = await parseInstrumentsTrace(testTraceDir);

    // Check the first profile (main thread)
    const mainProfile = result.profiles[0];
    expect(mainProfile.name).toContain('Main Thread');
    expect(mainProfile.name).toContain('test-simple');
    expect(mainProfile.name).toContain('pid:');

    // Verify all weights are resolved to actual values
    for (const weight of mainProfile.weights) {
      expect(typeof weight).toBe('number');
      expect(weight).toBeGreaterThan(0);
      // Most weights should be 1ms (1000000 nanoseconds)
      expect(weight).toBe(1000000);
    }
  });

  it('should correctly resolve frame references in backtraces', async () => {
    const result = await parseInstrumentsTrace(testTraceDir);

    // Get frame indices for known functions
    const frameMap = new Map<string, number>();
    result.shared.frames.forEach((frame, index) => {
      frameMap.set(frame.name, index);
    });

    const expensiveLoopIndex = frameMap.get('expensive_loop');
    const mainIndex = frameMap.get('main');

    expect(expensiveLoopIndex).toBeDefined();
    expect(mainIndex).toBeDefined();

    // Check that samples reference these frames correctly
    const mainProfile = result.profiles[0];
    let foundExpensiveLoopSample = false;

    for (const sample of mainProfile.samples) {
      if (sample.includes(expensiveLoopIndex!) && sample.includes(mainIndex!)) {
        foundExpensiveLoopSample = true;
        // expensive_loop should be called from main (so main should be deeper in stack)
        const expensiveLoopPos = sample.indexOf(expensiveLoopIndex!);
        const mainPos = sample.indexOf(mainIndex!);
        expect(mainPos).toBeGreaterThan(expensiveLoopPos);
      }
    }

    expect(foundExpensiveLoopSample).toBe(true);
  });

  it('should correctly resolve backtrace references', async () => {
    const result = await parseInstrumentsTrace(testTraceDir);

    // Verify that we don't have any unresolved references
    // All frame indices in samples should be valid
    for (const profile of result.profiles) {
      for (const sample of profile.samples) {
        for (const frameIndex of sample) {
          expect(frameIndex).toBeGreaterThanOrEqual(0);
          expect(frameIndex).toBeLessThan(result.shared.frames.length);
        }
      }
    }
  });

  it('should handle XML reference system correctly', async () => {
    const result = await parseInstrumentsTrace(testTraceDir);

    // Analyze the XML structure to ensure references are resolved
    const rows = parsedXml['trace-query-result'].node.row;
    const rowArray = Array.isArray(rows) ? rows : [rows];

    // Find examples of references in the XML
    let foundThreadRef = false;
    let foundWeightRef = false;
    let foundFrameRef = false;

    for (const row of rowArray.slice(0, 100)) {
      // Check first 100 rows
      if (row.thread?.['@_ref']) foundThreadRef = true;
      if (row.weight?.['@_ref']) foundWeightRef = true;

      if (row.backtrace?.frame) {
        const frames = Array.isArray(row.backtrace.frame)
          ? row.backtrace.frame
          : [row.backtrace.frame];
        for (const frame of frames) {
          if (frame['@_ref']) foundFrameRef = true;
        }
      }
    }

    // We should have found references
    expect(foundThreadRef).toBe(true);
    expect(foundWeightRef).toBe(true);
    expect(foundFrameRef).toBe(true);

    // And the parser should have resolved them all
    expect(result.profiles.length).toBeGreaterThan(0);
    expect(result.shared.frames.length).toBeGreaterThan(0);
  });

  it('should parse profile samples with correct time values', async () => {
    const result = await parseInstrumentsTrace(testTraceDir);

    for (const profile of result.profiles) {
      // Verify profile structure
      expect(profile).toHaveProperty('type', 'sampled');
      expect(profile).toHaveProperty('name');
      expect(profile).toHaveProperty('unit', 'nanoseconds');
      expect(profile).toHaveProperty('startValue', 0);
      expect(profile).toHaveProperty('endValue');
      expect(profile).toHaveProperty('samples');
      expect(profile).toHaveProperty('weights');

      // Verify samples and weights arrays
      expect(profile.samples).toBeInstanceOf(Array);
      expect(profile.weights).toBeInstanceOf(Array);
      expect(profile.samples.length).toBe(profile.weights.length);

      // Each sample should be an array of frame indices
      for (const sample of profile.samples) {
        expect(sample).toBeInstanceOf(Array);
        for (const frameIndex of sample) {
          expect(typeof frameIndex).toBe('number');
          expect(frameIndex).toBeGreaterThanOrEqual(0);
          expect(frameIndex).toBeLessThan(result.shared.frames.length);
        }
      }

      // Each weight should be a positive number
      for (const weight of profile.weights) {
        expect(typeof weight).toBe('number');
        expect(weight).toBeGreaterThan(0);
      }
    }
  });

  it('should handle binary path references correctly', async () => {
    const result = await parseInstrumentsTrace(testTraceDir);

    // Find frames with binary paths
    const framesWithBinary = result.shared.frames.filter(
      (f) => f.file && (f.file.includes('/usr/lib/') || f.file.includes('test-simple'))
    );

    expect(framesWithBinary.length).toBeGreaterThan(0);

    // Check specific binaries are referenced
    const binaryPaths = framesWithBinary.map((f) => f.file);
    expect(binaryPaths.some((p) => p!.includes('dyld'))).toBe(true);
    expect(binaryPaths.some((p) => p!.includes('test-simple'))).toBe(true);
  });
});
