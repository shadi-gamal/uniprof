import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NativePlatform } from '../src/platforms/native.js';
import { PerfPlatform } from '../src/platforms/perf.js';
import { platformRegistry } from '../src/platforms/registry.js';

function makeTempFileWithBytes(bytes: number[]): string {
  const p = path.join(
    os.tmpdir(),
    `uniprof-test-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
}

describe('NativePlatform routing on macOS', () => {
  const originalPlatform = process.platform;

  function setPlatformDarwin() {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  }

  function restorePlatform() {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  }

  it('ELF binaries are detected as native and default to container mode (perf)', async () => {
    setPlatformDarwin();
    try {
      // ELF magic: 0x7F 45 4C 46
      const elfPath = makeTempFileWithBytes([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x00, 0x00, 0x00]);

      const detected = await platformRegistry.detectFromCommand([elfPath]);
      expect(detected?.name).toBe('native');

      const native = new NativePlatform();
      const mode = native.getDefaultMode([elfPath]);
      expect(mode).toBe('container');

      fs.unlinkSync(elfPath);
    } finally {
      restorePlatform();
    }
  });

  it('Mach-O binaries are detected as native and default to host mode (xctrace)', async () => {
    setPlatformDarwin();
    try {
      // Mach-O 64-bit magic (little-endian): 0xFE ED FA CF in LE is 0xCF FA ED FE in BE read
      // Using BE read in xctrace, we need to place bytes so readUInt32BE(0) equals 0xFEEDFACF
      const machoMagic = [0xfe, 0xed, 0xfa, 0xcf];
      const machoPath = makeTempFileWithBytes(machoMagic.concat([0x00, 0x00, 0x00, 0x00]));

      const detected = await platformRegistry.detectFromCommand([machoPath]);
      expect(detected?.name).toBe('native');

      const native = new NativePlatform();
      const mode = native.getDefaultMode([machoPath]);
      expect(mode).toBe('host');

      fs.unlinkSync(machoPath);
    } finally {
      restorePlatform();
    }
  });
});

describe('PerfPlatform frequency flag parsing', () => {
  it('does not inject default -F when user provides compact -F1000', () => {
    const perf = new PerfPlatform();
    const context: any = {};
    const cmd = perf.buildLocalProfilerCommand(
      ['./my-app'],
      '/tmp/out.json',
      { output: '/tmp/out.json', extraProfilerArgs: ['-F1000'] },
      context
    );
    // Should contain -F1000 but not the default "-F", "999" pair
    const hasCompact = cmd.some((t) => typeof t === 'string' && t.startsWith('-F') && t !== '-F');
    const hasDefaultPair = cmd.includes('-F') && cmd.includes('999');
    expect(hasCompact).toBe(true);
    expect(hasDefaultPair).toBe(false);
  });

  it('respects separate -F 1000 without adding default', () => {
    const perf = new PerfPlatform();
    const context: any = {};
    const cmd = perf.buildLocalProfilerCommand(
      ['./my-app'],
      '/tmp/out.json',
      { output: '/tmp/out.json', extraProfilerArgs: ['-F', '1000'] },
      context
    );
    // Should include -F and its value, but not add another default -F 999
    const fIdx = cmd.indexOf('-F');
    expect(fIdx).toBeGreaterThan(-1);
    expect(cmd[fIdx + 1]).toBe('1000');
    const defaultPair = cmd.findIndex((t, i) => t === '-F' && cmd[i + 1] === '999');
    expect(defaultPair).toBe(-1);
  });

  it('strips -o from extra args and preserves managed perf file', () => {
    const perf = new PerfPlatform();
    const context: any = {};
    const cmd = perf.buildLocalProfilerCommand(
      ['./my-app'],
      '/tmp/out.json',
      { output: '/tmp/out.json', extraProfilerArgs: ['-o', '/tmp/other.perf'] },
      context
    );
    const oidx = cmd.indexOf('-o');
    expect(oidx).toBeGreaterThan(-1);
    // Next token should be our managed perf data path (from context.rawArtifact)
    expect(cmd[oidx + 1]).toBe(context.rawArtifact?.path);
    // User-provided path should not be present
    expect(cmd).not.toContain('/tmp/other.perf');
  });
});
