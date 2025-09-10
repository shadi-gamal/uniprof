import { describe, expect, it } from 'bun:test';
import { parsePidPpidChildren } from '../src/utils/process-tree.js';

describe('process-tree', () => {
  it('parses ps output and finds children recursively', () => {
    const sample =
      '  PID  PPID\n  100    1\n  101  100\n  102  100\n  200    1\n  201  200\n  300  999\n';
    expect(parsePidPpidChildren(sample, 1).sort((a, b) => a - b)).toEqual([
      100, 101, 102, 200, 201,
    ]);
    expect(parsePidPpidChildren(sample, 100).sort((a, b) => a - b)).toEqual([101, 102]);
    expect(parsePidPpidChildren(sample, 200)).toEqual([201]);
    expect(parsePidPpidChildren(sample, 300)).toEqual([]);
  });
});
