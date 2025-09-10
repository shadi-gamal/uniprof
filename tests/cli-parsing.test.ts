import { describe, expect, it } from 'bun:test';
import {
  ensureDefaultFlag,
  processAliases,
  RECORD_BOOLEAN_OPTS,
  RECORD_VALUE_OPTS,
  splitArgsQuoted,
  stripOutputPathFlags,
} from '../src/utils/cli-parsing.js';
import {
  findUnmappedFollowingOptionValuePaths,
  findUnmappedOptionValuePaths,
} from '../src/utils/path-utils.js';

describe('splitArgsQuoted', () => {
  it('keeps Windows paths intact when quoted', () => {
    const input = '"C:\\Program Files\\MyApp\\app.exe" --flag';
    const out = splitArgsQuoted(input);
    expect(out).toEqual(['C:\\Program Files\\MyApp\\app.exe', '--flag']);
  });

  it('does not treat backslash as escape outside of quotes', () => {
    const input = 'C:\\temp\\app.exe --x';
    const out = splitArgsQuoted(input);
    expect(out[0]).toBe('C:\\temp\\app.exe');
    expect(out[1]).toBe('--x');
  });
});

describe('best-effort detection of paths in option values', () => {
  it('detects POSIX absolute path in equals-form option value outside cwd', () => {
    const cwd = '/home/user/project';
    const args = ['myapp', '--config=/etc/app.json', '--other=123'];
    const unmapped = findUnmappedOptionValuePaths(cwd, args);
    expect(unmapped).toContain('/etc/app.json');
  });

  it('does not flag equals-form path when under cwd', () => {
    const cwd = '/home/user/project';
    const args = ['myapp', `--file=${cwd}/config/app.json`];
    const unmapped = findUnmappedOptionValuePaths(cwd, args);
    expect(unmapped.length).toBe(0);
  });

  it('detects Windows absolute path in equals-form option value', () => {
    const cwd = '/home/user/project';
    const args = ['app', '--cfg=C:\\\\Program Files\\\\App\\\\cfg.json'];
    const unmapped = findUnmappedOptionValuePaths(cwd, args);
    expect(unmapped.length).toBeGreaterThan(0);
    expect(unmapped[0]).toContain('Program Files');
  });
});

describe('best-effort detection for separated option values', () => {
  it('warns for POSIX absolute path when provided as separate value', () => {
    const cwd = '/home/user/project';
    const args = ['myapp', '--config', '/etc/app.json', '-o', '/var/tmp/out'];
    // reuse internal util to detect; record.ts prints warnings using this
    const unmapped = findUnmappedFollowingOptionValuePaths(cwd, args);
    expect(unmapped).toContain('/etc/app.json');
    expect(unmapped).toContain('/var/tmp/out');
  });

  it('handles Windows-style absolute path as separate value', () => {
    const cwd = '/home/user/project';
    const args = ['app', '--cfg', 'C:\\\\Program Files\\\\App\\\\cfg.json'];
    const unmapped = findUnmappedFollowingOptionValuePaths(cwd, args);
    expect(unmapped.length).toBe(1);
    expect(unmapped[0]).toContain('Program Files');
  });
});

describe('processAliases equals-form options', () => {
  it('inserts -- for record when using --key=value', () => {
    const argv = ['node', 'uniprof', 'record', '-o=out.json', '--mode=host', 'python', 'app.py'];
    const processed = processAliases(argv);
    // Should still be a record subcommand
    expect(processed[2]).toBe('record');
    // Should insert '--' before the command
    const idx = processed.indexOf('--');
    expect(idx).toBeGreaterThan(0);
    expect(processed[idx + 1]).toBe('python');
    expect(processed[idx + 2]).toBe('app.py');
  });
});

describe('processAliases alias transformations', () => {
  it('maps "uniprof python app.py" to record --analyze with separator', () => {
    const argv = ['node', 'uniprof', 'python', 'app.py'];
    const processed = processAliases(argv);
    expect(processed[2]).toBe('record');
    expect(processed.includes('--analyze')).toBe(true);
    const idx = processed.indexOf('--');
    expect(idx).toBeGreaterThan(0);
    expect(processed.slice(idx + 1)).toEqual(['python', 'app.py']);
  });

  it('preserves --visualize when using alias form', () => {
    const argv = ['node', 'uniprof', '--visualize', 'node', 'server.js'];
    const processed = processAliases(argv);
    expect(processed[2]).toBe('record');
    expect(processed.includes('--visualize')).toBe(true);
    expect(processed.includes('--analyze')).toBe(false);
    const idx = processed.indexOf('--');
    expect(processed.slice(idx + 1)).toEqual(['node', 'server.js']);
  });
});

describe('processAliases record normalization', () => {
  it('inserts "--" automatically for record when omitted', () => {
    const argv = ['node', 'uniprof', 'record', '-o', 'out.json', '--verbose', 'python', 'app.py'];
    const processed = processAliases(argv);
    expect(processed[2]).toBe('record');
    const idx = processed.indexOf('--');
    expect(idx).toBeGreaterThan(0);
    expect(processed.slice(idx + 1)).toEqual(['python', 'app.py']);
  });

  it('normalizes record even when a separator is present', () => {
    const argv = ['node', 'uniprof', 'record', '-o', 'out.json', '--', 'python', 'app.py'];
    const processed = processAliases(argv);
    expect(processed[2]).toBe('record');
    const idx = processed.indexOf('--');
    expect(idx).toBeGreaterThan(0);
    expect(processed.slice(idx + 1)).toEqual(['python', 'app.py']);
    // record options should be preserved
    const before = processed.slice(3, idx);
    expect(before).toEqual(['-o', 'out.json']);
  });

  it('treats --format as a value option and still inserts separator', () => {
    const argv = [
      'node',
      'uniprof',
      'record',
      '-o',
      'out.json',
      '--format',
      'json',
      'python',
      'app.py',
    ];
    const processed = processAliases(argv);
    expect(processed[2]).toBe('record');
    // Ensure --format json stays before the separator
    const idx = processed.indexOf('--');
    expect(idx).toBeGreaterThan(0);
    const before = processed.slice(3, idx);
    expect(before).toContain('--format');
    expect(before).toContain('json');
    expect(processed.slice(idx + 1)).toEqual(['python', 'app.py']);
  });
});

describe('processAliases handles --extra-profiler-args without explicit separator', () => {
  it('normalizes record: condenses profiler args and inserts command separator', () => {
    const argv = [
      'node',
      'uniprof',
      'record',
      '-o',
      'out.json',
      '--extra-profiler-args',
      '--rate',
      '500',
      'python',
      'app.py',
    ];
    const processed = processAliases(argv);
    expect(processed[2]).toBe('record');
    const idx = processed.indexOf('--');
    expect(idx).toBeGreaterThan(0);
    const before = processed.slice(3, idx);
    const eIdx = before.indexOf('--extra-profiler-args');
    expect(eIdx).toBeGreaterThan(-1);
    expect(before[eIdx + 1]).toBe('--rate 500');
    expect(processed.slice(idx + 1)).toEqual(['python', 'app.py']);
  });

  it('normalizes alias mode: transforms to record and condenses profiler args', () => {
    const argv = ['node', 'uniprof', '--extra-profiler-args', '--rate', '500', 'python', 'app.py'];
    const processed = processAliases(argv);
    expect(processed.slice(0, 3)).toEqual(['node', 'uniprof', 'record']);
    const idx = processed.indexOf('--');
    expect(idx).toBeGreaterThan(0);
    const before = processed.slice(3, idx);
    const eIdx = before.indexOf('--extra-profiler-args');
    expect(eIdx).toBeGreaterThan(-1);
    expect(before[eIdx + 1]).toBe('--rate 500');
    expect(processed.slice(idx + 1)).toEqual(['python', 'app.py']);
  });
});

describe('processAliases explicit separator with options only before it', () => {
  it('transforms to record, preserving options and adding --analyze', () => {
    const argv = ['node', 'uniprof', '--verbose', '--', 'python', 'app.py'];
    const processed = processAliases(argv);
    expect(processed.slice(0, 3)).toEqual(['node', 'uniprof', 'record']);
    expect(processed.includes('--verbose')).toBe(true);
    expect(processed.includes('--analyze')).toBe(true);
    const idx = processed.indexOf('--');
    expect(processed.slice(idx + 1)).toEqual(['python', 'app.py']);
  });

  it('preserves --format json in alias mode and adds separator', () => {
    const argv = ['node', 'uniprof', '--format', 'json', '--', 'python', 'app.py'];
    const processed = processAliases(argv);
    expect(processed.slice(0, 3)).toEqual(['node', 'uniprof', 'record']);
    expect(processed).toContain('--format');
    const idx = processed.indexOf('--');
    expect(idx).toBeGreaterThan(0);
    expect(processed.slice(idx + 1)).toEqual(['python', 'app.py']);
  });
});

describe('processAliases with --extra-profiler-args and explicit separator', () => {
  it('normalizes by condensing profiler args before the command separator', () => {
    const argv = [
      'node',
      'uniprof',
      'record',
      '-o',
      'out.json',
      '--extra-profiler-args',
      '--',
      '--rate',
      '500',
      '--',
      'python',
      'app.py',
    ];
    const processed = processAliases(argv);
    expect(processed[2]).toBe('record');
    const idx = processed.indexOf('--');
    expect(idx).toBeGreaterThan(0);
    const before = processed.slice(3, idx);
    const eIdx = before.indexOf('--extra-profiler-args');
    expect(before[eIdx + 1]).toBe('--rate 500');
    expect(processed.slice(idx + 1)).toEqual(['python', 'app.py']);
  });
});

describe('processAliases extra-profiler-args edge cases', () => {
  it('condenses equals-form with additional equals signs intact', () => {
    const argv = [
      'node',
      'uniprof',
      'record',
      '-o',
      'out.json',
      '--extra-profiler-args',
      '--flag=a=b=c',
      'python',
      'app.py',
    ];
    const processed = processAliases(argv);
    const idx = processed.indexOf('--');
    const before = processed.slice(3, idx);
    const eIdx = before.indexOf('--extra-profiler-args');
    expect(before[eIdx + 1]).toBe('--flag=a=b=c');
  });

  it('treats negative numeric as a value of the preceding extra flag', () => {
    const argv = [
      'node',
      'uniprof',
      'record',
      '-o',
      'out.json',
      '--extra-profiler-args',
      '--threshold',
      '-1',
      'python',
      'app.py',
    ];
    const processed = processAliases(argv);
    const idx = processed.indexOf('--');
    const before = processed.slice(3, idx);
    const eIdx = before.indexOf('--extra-profiler-args');
    expect(before[eIdx + 1]).toBe('--threshold -1');
  });

  it('does not swallow subsequent record options after extra-profiler-args', () => {
    const argv = [
      'node',
      'uniprof',
      'record',
      '-o',
      'out.json',
      '--extra-profiler-args',
      '--rate',
      '500',
      '--format',
      'json',
      'python',
      'app.py',
    ];
    const processed = processAliases(argv);
    const idx = processed.indexOf('--');
    const before = processed.slice(3, idx);
    // Ensure --format json remains a record-level option and not part of extras
    const eIdx = before.indexOf('--extra-profiler-args');
    expect(before[eIdx + 1]).toBe('--rate 500');
    expect(before).toContain('--format');
    expect(before).toContain('json');
  });
});

describe('ensureDefaultFlag', () => {
  it('appends default when none of the flags present', () => {
    const inArgs = ['--alpha', '1'];
    const out = ensureDefaultFlag(inArgs, ['--rate'], '999');
    expect(out).toEqual(['--alpha', '1', '--rate', '999']);
  });

  it('does not append when equals-form exists', () => {
    const inArgs = ['--rate=500'];
    const out = ensureDefaultFlag(inArgs, ['--rate'], '999');
    expect(out).toEqual(['--rate=500']);
  });

  it('does not append when separate value exists', () => {
    const inArgs = ['--rate', '250'];
    const out = ensureDefaultFlag(inArgs, ['--rate'], '999');
    expect(out).toEqual(['--rate', '250']);
  });
});

describe('stripOutputPathFlags', () => {
  it('removes equals-form and returns removed list', () => {
    const res = stripOutputPathFlags(['--output=out.json', '--x', '1'], ['--output']);
    expect(res.filtered).toEqual(['--x', '1']);
    expect(res.removed).toEqual(['--output=out.json']);
  });

  it('removes separate value forms including -o and --file', () => {
    const res = stripOutputPathFlags(
      ['-o', 'a.json', '--rate', '999', '--file', 'b.json'],
      ['-o', '--output', '--file']
    );
    expect(res.filtered).toEqual(['--rate', '999']);
    expect(res.removed).toEqual(['-o', 'a.json', '--file', 'b.json']);
  });
});

describe('record option sync guard (internal)', () => {
  it('includes expected boolean and value flags for record', () => {
    // Boolean options expected for `record` in index.ts
    const expectedBoolean = [
      '-v',
      '--verbose',
      '--analyze',
      '--visualize',
      '--enable-host-networking',
    ];
    for (const flag of expectedBoolean) {
      expect(RECORD_BOOLEAN_OPTS.has(flag)).toBe(true);
    }

    // Value options expected for `record` in index.ts
    const expectedValue = [
      '-o',
      '--output',
      '--mode',
      '--cwd',
      '--platform',
      '--format',
      '--extra-profiler-args',
    ];
    for (const flag of expectedValue) {
      expect(RECORD_VALUE_OPTS.has(flag)).toBe(true);
    }
  });
});
