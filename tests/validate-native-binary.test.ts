import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { hasDwarf, isValidBinary, validateBinary } from '../src/utils/validate-native-binary.js';

function writeTmpFile(prefix: string, buf: Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniprof-vnb-'));
  const file = path.join(dir, `${prefix}.bin`);
  fs.writeFileSync(file, buf);
  return file;
}

function makeMinimalELF(machine: number, little = true, is64 = true): Buffer {
  const buf = Buffer.alloc(96, 0);
  // Magic (ELF, little-endian interpretation)
  buf.writeUInt32LE(0x464c457f, 0);
  // EI_CLASS (1=32, 2=64)
  buf[4] = is64 ? 2 : 1;
  // EI_DATA (1=little, 2=big)
  buf[5] = little ? 1 : 2;
  // e_machine at offset 18 (2 bytes)
  if (little) buf.writeUInt16LE(machine, 18);
  else buf.writeUInt16BE(machine, 18);
  return buf;
}

function makeMinimalMachO(cpuType: number, is64 = true, little = true): Buffer {
  const buf = Buffer.alloc(64, 0);
  const MH_MAGIC = 0xfeedface;
  const MH_MAGIC_64 = 0xfeedfacf;
  const MH_CIGAM = 0xcefaedfe;
  const MH_CIGAM_64 = 0xcffaedfe;
  const magic = little ? (is64 ? MH_MAGIC_64 : MH_MAGIC) : is64 ? MH_CIGAM_64 : MH_CIGAM;
  if (little) buf.writeUInt32LE(magic, 0);
  else buf.writeUInt32BE(magic, 0);
  // cpuType at +4
  if (little) buf.writeUInt32LE(cpuType, 4);
  else buf.writeUInt32BE(cpuType, 4);
  return buf;
}

describe('validate-native-binary: isValidBinary', () => {
  it('returns invalid for unknown/short files', () => {
    const file = writeTmpFile('short', Buffer.from([0, 1, 2]));
    const res = isValidBinary(file);
    expect(res.valid).toBe(false);
    expect(res.format === 'unknown' || res.format === 'error').toBe(true);
  });

  it('detects ELF format and architecture', () => {
    const arch = os.arch();
    const machine = arch === 'x64' ? 0x3e : arch === 'arm64' ? 0xb7 : 0x3e; // x86_64 or aarch64
    const buf = makeMinimalELF(machine, true, true);
    const file = writeTmpFile('elf', buf);
    const res = isValidBinary(file);
    expect(res.valid).toBe(true);
    expect(res.format).toBe('ELF');
    if (arch === 'x64') expect(res.architecture).toBe('x86_64');
    if (arch === 'arm64') expect(res.architecture).toBe('aarch64');
  });

  it('detects Mach-O format and architecture', () => {
    // Map os.arch to Mach-O cputype
    const CPU_TYPE_X86_64 = 0x01000007;
    const CPU_TYPE_ARM64 = 0x0100000c;
    const arch = os.arch();
    const cpu = arch === 'arm64' ? CPU_TYPE_ARM64 : CPU_TYPE_X86_64;
    const buf = makeMinimalMachO(cpu, true, true);
    const file = writeTmpFile('macho', buf);
    const res = isValidBinary(file);
    expect(res.valid).toBe(true);
    expect(res.format).toBe('Mach-O');
    if (arch === 'x64') expect(res.architecture).toBe('x86_64');
    if (arch === 'arm64') expect(res.architecture).toBe('aarch64');
  });
});

describe('validate-native-binary: hasDwarf (minimal binaries)', () => {
  it('returns false for minimal ELF without DWARF sections', () => {
    const arch = os.arch();
    const machine = arch === 'x64' ? 0x3e : arch === 'arm64' ? 0xb7 : 0x3e;
    const file = writeTmpFile('elf-nodwarf', makeMinimalELF(machine));
    expect(hasDwarf(file, 'ELF')).toBe(false);
  });

  it('returns false for minimal Mach-O without __DWARF segment', () => {
    const CPU_TYPE_X86_64 = 0x01000007;
    const CPU_TYPE_ARM64 = 0x0100000c;
    const cpu = os.arch() === 'arm64' ? CPU_TYPE_ARM64 : CPU_TYPE_X86_64;
    const file = writeTmpFile('macho-nodwarf', makeMinimalMachO(cpu));
    expect(hasDwarf(file, 'Mach-O')).toBe(false);
  });
});

describe('validate-native-binary: validateBinary', () => {
  it('reports invalid when format cannot be determined', () => {
    const file = writeTmpFile('junk', Buffer.alloc(8, 0));
    const res = validateBinary(file, false);
    expect(res.isValid).toBe(false);
    expect(res.hasErrors).toBe(true);
  });

  it('sets containerCompatibility when requested', () => {
    const arch = os.arch();
    const machine = arch === 'x64' ? 0x3e : arch === 'arm64' ? 0xb7 : 0x3e;
    const file = writeTmpFile('elf-cc', makeMinimalELF(machine));
    const res = validateBinary(file, true);
    expect(res.containerCompatibility).toBeDefined();
    expect(typeof res.containerCompatibility?.compatible).toBe('boolean');
  });

  it('does not crash when dependency tools are unavailable', () => {
    // Craft Mach-O minimal; on systems without otool, dependency check yields a warning
    const CPU_TYPE_X86_64 = 0x01000007;
    const CPU_TYPE_ARM64 = 0x0100000c;
    const cpu = os.arch() === 'arm64' ? CPU_TYPE_ARM64 : CPU_TYPE_X86_64;
    const file = writeTmpFile('macho-deps', makeMinimalMachO(cpu));
    const res = validateBinary(file, false);
    // Structure should be complete regardless of environment
    expect(typeof res.isValid).toBe('boolean');
    expect(Array.isArray(res.errors || [])).toBe(true);
    expect(Array.isArray(res.warnings || [])).toBe(true);
  });

  it('handles ELF dependencies check gracefully (likely no tools)', () => {
    const arch = os.arch();
    const machine = arch === 'x64' ? 0x3e : arch === 'arm64' ? 0xb7 : 0x3e;
    const file = writeTmpFile('elf-deps', makeMinimalELF(machine));
    const res = validateBinary(file, false);
    expect(typeof res.isValid).toBe('boolean');
    expect(res.format).toBe('ELF');
  });
});
