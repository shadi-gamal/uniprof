import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  analyzeCommand,
  analyzeSpeedscopeProfile,
  formatAnalysis,
} from '../src/commands/analyze.js';

describe('analyze evented profiles (mismatched closes)', () => {
  it('handles mismatched close events without throwing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uniprof-test-'));
    const file = path.join(tmp, 'evented.json');

    const speedscope = {
      $schema: 'https://www.speedscope.app/file-format-schema.json',
      name: 'Test Evented',
      shared: { frames: [{ name: 'f0' }, { name: 'f1' }] },
      profiles: [
        {
          type: 'evented',
          name: 'thread-1',
          unit: 'microseconds',
          startValue: 0,
          endValue: 4,
          events: [
            { type: 'O', at: 0, frame: 0 },
            { type: 'O', at: 1, frame: 1 },
            // Mismatched close: tries to close f0 while f1 on top
            { type: 'C', at: 2, frame: 0 },
            { type: 'C', at: 3, frame: 1 },
          ],
        },
      ],
      exporter: 'test-evented',
    };

    fs.writeFileSync(file, JSON.stringify(speedscope), 'utf8');
    const result = analyzeSpeedscopeProfile(file, {});
    expect(result.summary.totalSamples).toBeGreaterThan(0);
    expect(result.hotspots.length).toBeGreaterThan(0);
  });
});

describe('analyze evented profiles (trailing time attribution)', () => {
  it('attributes time from last event to endValue when stack is open', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uniprof-test-'));
    const file = path.join(tmp, 'evented-trailing.json');

    const speedscope = {
      $schema: 'https://www.speedscope.app/file-format-schema.json',
      name: 'Evented Trailing',
      shared: { frames: [{ name: 'root' }] },
      profiles: [
        {
          type: 'evented',
          name: 'thread-1',
          unit: 'microseconds',
          startValue: 0,
          endValue: 10,
          events: [
            { type: 'O', at: 2, frame: 0 },
            // no close; trailing from 5 to endValue=10 should be counted
            { type: 'O', at: 5, frame: 0 },
          ],
        },
      ],
      exporter: 'test-evented',
    };

    fs.writeFileSync(file, JSON.stringify(speedscope), 'utf8');
    const result = analyzeSpeedscopeProfile(file, { threshold: 0 });
    // Total time should include deltas: [2->5]=3 and [5->10]=5 => total 8
    expect(result.summary.totalTime).toBe(8);
    const hotspot = result.hotspots.find((h) => h.name === 'root');
    expect(hotspot?.total).toBe(8);
  });
});

describe('analyze command format option', () => {
  it('outputs valid JSON when format is json', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uniprof-test-'));
    const file = path.join(tmp, 'profile.json');

    const speedscope = {
      $schema: 'https://www.speedscope.app/file-format-schema.json',
      name: 'Test Profile',
      shared: {
        frames: [
          { name: 'function1', file: 'app.py', line: 10 },
          { name: 'function2', file: 'app.py', line: 20 },
          { name: 'function3', file: 'lib.py', line: 30 },
        ],
      },
      profiles: [
        {
          type: 'sampled',
          name: 'thread-1',
          unit: 'milliseconds',
          startValue: 0,
          endValue: 100,
          samples: [[0, 1], [0, 1, 2], [1, 2], [2], [0, 1]],
          weights: [10, 20, 30, 15, 25],
        },
      ],
      exporter: 'test',
    };

    fs.writeFileSync(file, JSON.stringify(speedscope), 'utf8');

    // Mock process.exit to prevent test from terminating
    const originalExit = process.exit;
    let exitCode: number | null = null;
    process.exit = ((code?: number | undefined) => {
      exitCode = code;
      throw new Error('process.exit');
    }) as typeof process.exit;

    // Mock console.log to capture JSON output
    const originalLog = console.log;
    let jsonOutput: unknown = null;
    console.log = ((data: unknown) => {
      // Try to parse as JSON if it's a string
      if (typeof data === 'string') {
        try {
          jsonOutput = JSON.parse(data);
        } catch {
          // Not JSON, ignore
        }
      }
    }) as typeof console.log;

    try {
      await analyzeCommand(file, { format: 'json' });
    } catch (e: any) {
      // Expected if process.exit was called
      if (e.message !== 'process.exit') throw e;
    } finally {
      console.log = originalLog;
      process.exit = originalExit;
    }

    // Should not have exited with error
    expect(exitCode).toBeNull();

    // Verify the JSON output
    expect(jsonOutput).toBeDefined();
    expect(jsonOutput.summary).toBeDefined();
    expect(jsonOutput.summary.totalSamples).toBe(5);
    expect(jsonOutput.summary.totalTime).toBe(100);
    expect(jsonOutput.hotspots).toBeDefined();
    expect(Array.isArray(jsonOutput.hotspots)).toBe(true);
  });

  it('analyzeSpeedscopeProfile returns structured data for JSON format', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uniprof-test-'));
    const file = path.join(tmp, 'profile.json');

    const speedscope = {
      $schema: 'https://www.speedscope.app/file-format-schema.json',
      name: 'Test Profile',
      shared: {
        frames: [
          { name: 'main', file: 'main.js', line: 1 },
          { name: 'helper', file: 'helper.js', line: 10 },
          { name: 'process', file: 'process.js', line: 5 },
        ],
      },
      profiles: [
        {
          type: 'sampled',
          name: 'thread-1',
          unit: 'milliseconds',
          startValue: 0,
          endValue: 50,
          samples: [[0], [0, 1], [0, 1, 2], [1, 2], [2]],
          weights: [10, 10, 10, 10, 10],
        },
      ],
      exporter: 'test',
    };

    fs.writeFileSync(file, JSON.stringify(speedscope), 'utf8');
    const result = analyzeSpeedscopeProfile(file, { threshold: 0.1 });

    // Verify structure matches expected JSON format
    expect(result.summary).toBeDefined();
    expect(result.summary.totalSamples).toBe(5);
    expect(result.summary.totalTime).toBe(50);
    expect(result.summary.unit).toBe('milliseconds');
    expect(result.summary.profileName).toBe('Test Profile');
    expect(result.summary.profiler).toBe('test');
    expect(result.summary.threadCount).toBe(1);
    expect(result.summary.profileType).toBe('sampled');

    expect(result.hotspots).toBeDefined();
    expect(Array.isArray(result.hotspots)).toBe(true);
    expect(result.hotspots.length).toBeGreaterThan(0);

    // Check hotspot structure
    const hotspot = result.hotspots[0];
    expect(hotspot.name).toBeDefined();
    expect(typeof hotspot.percentage).toBe('number');
    expect(typeof hotspot.total).toBe('number');
    expect(typeof hotspot.self).toBe('number');
    expect(typeof hotspot.samples).toBe('number');
  });

  it('applies filters correctly with JSON output', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uniprof-test-'));
    const file = path.join(tmp, 'profile.json');

    const speedscope = {
      $schema: 'https://www.speedscope.app/file-format-schema.json',
      name: 'Test Profile',
      shared: {
        frames: [
          { name: 'MyApp.main', file: 'app.py', line: 1 },
          { name: 'MyApp.helper', file: 'app.py', line: 10 },
          { name: 'OtherLib.process', file: 'lib.py', line: 5 },
          { name: 'MyApp.compute', file: 'app.py', line: 20 },
        ],
      },
      profiles: [
        {
          type: 'sampled',
          name: 'thread-1',
          unit: 'milliseconds',
          samples: [[0], [0, 1], [0, 1, 3], [2], [2], [0, 3], [3], [1, 3]],
          weights: [10, 10, 10, 10, 10, 10, 10, 10],
        },
      ],
      exporter: 'test',
    };

    fs.writeFileSync(file, JSON.stringify(speedscope), 'utf8');

    // Test with filter regex
    const result = analyzeSpeedscopeProfile(file, {
      filterRegex: 'MyApp\\.',
      threshold: 0,
    });

    // Should only include functions matching the regex
    expect(result.hotspots.every((h) => h.name?.includes('MyApp.'))).toBe(true);
    expect(result.hotspots.some((h) => h.name === 'OtherLib.process')).toBe(false);
  });

  it('applies maxDepth correctly by truncating stacks to leaf-most frames', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uniprof-test-'));
    const file = path.join(tmp, 'profile.json');

    // Frames: 0=root, 1=mid, 2=leaf
    const speedscope = {
      $schema: 'https://www.speedscope.app/file-format-schema.json',
      name: 'MaxDepth Test',
      shared: {
        frames: [{ name: 'root' }, { name: 'mid' }, { name: 'leaf' }],
      },
      profiles: [
        {
          type: 'sampled',
          name: 't',
          unit: 'milliseconds',
          startValue: 0,
          endValue: 30,
          samples: [[0], [0, 1], [0, 1, 2]],
          weights: [10, 10, 10],
        },
      ],
      exporter: 'test',
    };

    fs.writeFileSync(file, JSON.stringify(speedscope), 'utf8');

    // Without maxDepth: totals should accumulate across full stacks
    const full = analyzeSpeedscopeProfile(file, { threshold: 0 });
    const fRoot = full.hotspots.find((h) => h.name === 'root');
    const fMid = full.hotspots.find((h) => h.name === 'mid');
    const fLeaf = full.hotspots.find((h) => h.name === 'leaf');
    expect(fRoot?.total).toBe(30);
    expect(fMid?.total).toBe(20);
    expect(fLeaf?.total).toBe(10);

    // With maxDepth = 1: only leaf-most frames of each sample should be counted
    const trimmed = analyzeSpeedscopeProfile(file, { threshold: 0, maxDepth: 1 });
    const tRoot = trimmed.hotspots.find((h) => h.name === 'root');
    const tMid = trimmed.hotspots.find((h) => h.name === 'mid');
    const tLeaf = trimmed.hotspots.find((h) => h.name === 'leaf');
    expect(tRoot?.total).toBe(10); // only the [0] sample contributes to root
    expect(tMid?.total).toBe(10); // only the [0,1] sample contributes to mid
    expect(tLeaf?.total).toBe(10); // only the [0,1,2] sample contributes to leaf
  });

  describe('formatAnalysis pretty output (omit percentiles for uniform weights)', () => {
    it('does not print p50/p90/p99 when weights are uniform', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uniprof-test-'));
      const file = path.join(tmp, 'uniform.json');

      const speedscope = {
        $schema: 'https://www.speedscope.app/file-format-schema.json',
        name: 'Uniform',
        shared: { frames: [{ name: 'A' }, { name: 'B' }] },
        profiles: [
          {
            type: 'sampled',
            name: 't',
            unit: 'milliseconds',
            startValue: 0,
            endValue: 3,
            samples: [[0], [0, 1], [1]],
            weights: [1, 1, 1],
          },
        ],
        exporter: 'test',
      };

      fs.writeFileSync(file, JSON.stringify(speedscope), 'utf8');
      const analysis = analyzeSpeedscopeProfile(file, { threshold: 0 });

      let out = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any, ..._rest: any[]) => {
        out += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        return true;
      }) as typeof process.stdout.write;
      const origLog = console.log;
      console.log = ((...args: unknown[]) => {
        out += `${args.join(' ')}\n`;
      }) as typeof console.log;
      try {
        // Should not include p50/p90/p99 headers
        formatAnalysis(analysis, { threshold: 0 });
      } finally {
        process.stdout.write = origWrite;
        console.log = origLog;
      }
      expect(out).not.toMatch(/\bp50\b/);
      expect(out).not.toMatch(/\bp90\b/);
      expect(out).not.toMatch(/\bp99\b/);
    });
  });
});

describe('analyze handles profiles with zero total weight', () => {
  it('returns empty hotspots and zero totals when no samples/weights', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uniprof-test-'));
    const file = path.join(tmp, 'zero.json');
    const speedscope = {
      $schema: 'https://www.speedscope.app/file-format-schema.json',
      name: 'Empty',
      shared: { frames: [{ name: 'f' }] },
      profiles: [
        {
          type: 'sampled',
          name: 't',
          unit: 'milliseconds',
          startValue: 0,
          endValue: 0,
          samples: [],
          weights: [],
        },
      ],
      exporter: 'test',
    };
    fs.writeFileSync(file, JSON.stringify(speedscope), 'utf8');
    const result = analyzeSpeedscopeProfile(file, {});
    expect(result.summary.totalTime).toBe(0);
    expect(result.hotspots.length).toBe(0);
  });
});
