#!/usr/bin/env node
/**
 * validate-native-binary.ts - Validate native binary for profiling
 *
 * This file is self-contained and can be executed directly with Node.js
 * Usage: node dist/utils/validate-native-binary.js [--check-container] <path-to-binary>
 * Returns: exit 0 = valid binary, exit 1 = invalid/warnings, exit 2 = error
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from './spawn.js';

// ----- Types and interfaces -------------------------------------------------
export interface BinaryValidation {
  valid: boolean;
  format: 'ELF' | 'Mach-O' | 'unknown' | 'error';
  error?: string;
  architecture?: string;
}

export interface DwarfCheckResult {
  hasDwarf: boolean;
  format: 'ELF' | 'Mach-O';
}

export interface DependencyCheckResult {
  missing: string[];
  errors: string[];
}

export interface ValidationResult {
  isValid: boolean;
  hasErrors: boolean;
  hasWarnings: boolean;
  format?: string;
  architecture?: string;
  hasDwarf?: boolean;
  dependencies?: DependencyCheckResult;
  containerCompatibility?: {
    compatible: boolean;
    reason?: string;
  };
}

// ----- Helper functions -----------------------------------------------------
function run(cmd: string, args: string[] = []): string {
  const res = spawnSync([cmd, ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (res.exitCode !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${res.stderr?.toString() || ''}`);
  }
  return res.stdout?.toString() || '';
}

function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch (_) {
    return false;
  }
}

// ----- Architecture detection -----------------------------------------------
function getELFArchitecture(buf: Buffer): string | undefined {
  if (buf.length < 20) return undefined;

  // Check ELF magic
  if (buf.readUInt32LE(0) !== 0x464c457f) return undefined;

  // Check endianness (byte 5)
  const isLittleEndian = buf[5] === 1;

  // e_machine is at offset 18 (2 bytes)
  const machine = isLittleEndian ? buf.readUInt16LE(18) : buf.readUInt16BE(18);

  // Common machine types
  switch (machine) {
    case 0x03:
      return 'x86';
    case 0x3e:
      return 'x86_64';
    case 0xb7:
      return 'aarch64';
    case 0x28:
      return 'arm';
    case 0xf3:
      return 'riscv';
    default:
      return `unknown(${machine})`;
  }
}

function getMachOArchitecture(buf: Buffer, off = 0): string | undefined {
  if (buf.length < off + 8) return undefined;

  const magicBE = buf.readUInt32BE(off);
  const magicLE = buf.readUInt32LE(off);

  // FAT binaries (big-endian magic constants). For swapped magic, try LE as well.
  if (magicBE === 0xcafebabe /* FAT_MAGIC */ || magicBE === 0xcafebabf /* FAT_MAGIC_64 */) {
    const cpuType = buf.readUInt32BE(off + 8);
    return getMachOCpuTypeName(cpuType);
  }
  if (magicLE === 0xbebafeca /* FAT_CIGAM */ || magicLE === 0xbfbafeca /* FAT_CIGAM_64 */) {
    const cpuType = buf.readUInt32LE(off + 8);
    return getMachOCpuTypeName(cpuType);
  }

  // Thin binaries: determine endianness and 32/64
  let le: boolean | null = null;
  if (magicLE === 0xfeedface /* MH_MAGIC */ || magicLE === 0xfeedfacf /* MH_MAGIC_64 */) {
    le = true;
  } else if (magicBE === 0xcefaedfe /* MH_CIGAM */ || magicBE === 0xcffaedfe /* MH_CIGAM_64 */) {
    le = false;
  }

  if (le === null) return undefined;
  const cpuType = le ? buf.readUInt32LE(off + 4) : buf.readUInt32BE(off + 4);
  return getMachOCpuTypeName(cpuType);
}

function getMachOCpuTypeName(cpuType: number): string {
  const CPU_TYPE_X86 = 7;
  const CPU_TYPE_X86_64 = 0x01000007;
  const CPU_TYPE_ARM = 12;
  const CPU_TYPE_ARM64 = 0x0100000c;

  switch (cpuType) {
    case CPU_TYPE_X86:
      return 'x86';
    case CPU_TYPE_X86_64:
      return 'x86_64';
    case CPU_TYPE_ARM:
      return 'arm';
    case CPU_TYPE_ARM64:
      return 'aarch64';
    default:
      return `unknown(${cpuType})`;
  }
}

// ----- Binary format validation ---------------------------------------------
export function isValidBinary(filePath: string): BinaryValidation {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 4) return { valid: false, format: 'unknown' };

    const magicLE = buf.readUInt32LE(0);
    const magicBE = buf.readUInt32BE(0);

    // ELF magic number: 0x7F454C46 ("\x7FELF")
    if (magicLE === 0x464c457f) {
      const architecture = getELFArchitecture(buf);
      return { valid: true, format: 'ELF', architecture };
    }

    // Mach-O magic numbers
    const MACHO_MAGICS = [0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xcafebabf];
    if (MACHO_MAGICS.includes(magicBE)) {
      const architecture = getMachOArchitecture(buf);
      return { valid: true, format: 'Mach-O', architecture };
    }

    return { valid: false, format: 'unknown' };
  } catch (error: any) {
    return { valid: false, format: 'error', error: error.message };
  }
}

// ----- DWARF detection ------------------------------------------------------
const u16 = (b: Buffer, o: number, le: boolean) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
const u32 = (b: Buffer, o: number, le: boolean) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
const u64 = (b: Buffer, o: number, le: boolean) =>
  Number(le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o));
const cstr = (b: Buffer, off: number) => {
  let e = off;
  while (e < b.length && b[e]) e++;
  return b.toString('utf8', off, e);
};

function elfHasDwarf(buf: Buffer): boolean {
  const little = buf[5] === 1;
  const is64 = buf[4] === 2;
  const shOff = is64 ? u64(buf, 0x28, little) : u32(buf, 0x20, little);
  const shEntSz = u16(buf, is64 ? 0x3a : 0x2e, little);
  const shNum = u16(buf, is64 ? 0x3c : 0x30, little);
  const strIdx = u16(buf, is64 ? 0x3e : 0x32, little);
  if (!shOff || !shNum) return false;

  const strHdr = shOff + strIdx * shEntSz;
  const strOff = is64 ? u64(buf, strHdr + 0x18, little) : u32(buf, strHdr + 0x10, little);
  const strSize = is64 ? u64(buf, strHdr + 0x20, little) : u32(buf, strHdr + 0x14, little);
  const strTab = buf.subarray(strOff, strOff + strSize);

  for (let i = 0; i < shNum; i++) {
    const base = shOff + i * shEntSz;
    const name = cstr(strTab, u32(buf, base, little));
    if (name.startsWith('.debug_') || name.startsWith('.zdebug_')) return true;
  }
  return false;
}

function machoHasDwarf(buf: Buffer, off = 0): boolean {
  const magicBE = buf.readUInt32BE(off);
  const magicLE = buf.readUInt32LE(off);

  // FAT / "Universal" header
  if (magicBE === 0xcafebabe || magicBE === 0xcafebabf) {
    const is64 = magicBE === 0xcafebabf;
    const n = buf.readUInt32BE(off + 4);
    const stride = is64 ? 32 : 20;
    for (let i = 0; i < n; i++) {
      const mOff = is64
        ? u64(buf, off + 8 + i * stride + 8, false)
        : u32(buf, off + 8 + i * stride + 8, false);
      if (machoHasDwarf(buf, mOff)) return true;
    }
    return false;
  }
  if (magicLE === 0xbebafeca || magicLE === 0xbfbafeca) {
    const is64 = magicLE === 0xbfbafeca;
    const n = buf.readUInt32LE(off + 4);
    const stride = is64 ? 32 : 20;
    for (let i = 0; i < n; i++) {
      const mOff = is64
        ? Number(u64(buf, off + 8 + i * stride + 8, true))
        : u32(buf, off + 8 + i * stride + 8, true);
      if (machoHasDwarf(buf, mOff)) return true;
    }
    return false;
  }

  // thin Mach-O
  let is64: boolean;
  let le: boolean;
  if (magicLE === 0xfeedface) {
    is64 = false;
    le = true;
  } else if (magicBE === 0xcefaedfe) {
    is64 = false;
    le = false;
  } else if (magicLE === 0xfeedfacf) {
    is64 = true;
    le = true;
  } else if (magicBE === 0xcffaedfe) {
    is64 = true;
    le = false;
  } else {
    return false;
  }

  const nCmds = u32(buf, off + 16, le);
  const hdrSize = is64 ? 32 : 28;
  let cursor = off + hdrSize;

  const LC_SEGMENT = 0x1;
  const LC_SEGMENT64 = 0x19;

  for (let i = 0; i < nCmds; i++) {
    const cmd = u32(buf, cursor, le);
    const cmdSize = u32(buf, cursor + 4, le);

    if (cmd === LC_SEGMENT || cmd === LC_SEGMENT64) {
      const segName = buf.toString('ascii', cursor + 8, cursor + 24).replace(/\0+$/, '');
      if (segName === '__DWARF') return true;

      const nSects = u32(buf, cursor + (cmd === LC_SEGMENT ? 48 : 64), le);
      const secHdr = cursor + (cmd === LC_SEGMENT ? 56 : 72);
      const secSz = cmd === LC_SEGMENT ? 68 : 80;

      for (let s = 0; s < nSects; s++) {
        const so = secHdr + s * secSz;
        const sName = buf.toString('ascii', so, so + 16).replace(/\0+$/, '');
        if (sName.startsWith('__debug_')) return true;
      }
    }
    cursor += cmdSize;
  }
  return false;
}

export function hasDwarf(filePath: string, format: 'ELF' | 'Mach-O'): boolean {
  try {
    const buf = fs.readFileSync(filePath);
    if (format === 'ELF') {
      return elfHasDwarf(buf);
    }
    if (format === 'Mach-O') {
      return machoHasDwarf(buf);
    }
    return false;
  } catch (_error) {
    return false;
  }
}

// ----- Dependency checking --------------------------------------------------

// macOS (Mach-O) dependency checking
function getMachODependencies(binPath: string): string[] {
  const out = run('otool', ['-L', binPath]);
  const lines = out.split(/\n/).slice(1); // first line is the binary itself
  const deps: string[] = [];
  for (const line of lines) {
    const m = line.trim().match(/^(\S+)/);
    if (m) deps.push(m[1]);
  }
  return deps;
}

function getMachORPaths(binPath: string): string[] {
  const out = run('otool', ['-l', binPath]);
  const rpaths: string[] = [];
  const lines = out.split(/\n/);
  for (let i = 0; i < lines.length; ++i) {
    if (lines[i].includes('cmd LC_RPATH')) {
      // look ahead for "path <value> (offset ..."
      for (let j = i + 1; j < i + 10 && j < lines.length; ++j) {
        const m = lines[j].trim().match(/^path\s+(\S+)/);
        if (m) {
          rpaths.push(m[1]);
          break;
        }
      }
    }
  }
  return rpaths;
}

function resolveMacOSPath(dep: string, binPath: string, rpaths: string[]): string | null {
  const exeDir = path.dirname(binPath);
  const replacements: Record<string, string> = {
    '@loader_path': exeDir,
    '@executable_path': exeDir,
  };

  const candidates: string[] = [];

  if (dep.startsWith('@rpath')) {
    for (const rp of rpaths) {
      let rpExpanded = rp;
      // rpath may itself contain placeholders
      for (const [key, val] of Object.entries(replacements)) {
        rpExpanded = rpExpanded.replace(new RegExp(key, 'g'), val);
      }
      const full = dep.replace('@rpath', rpExpanded);
      candidates.push(full);
    }
  } else if (dep.startsWith('@loader_path') || dep.startsWith('@executable_path')) {
    let full = dep;
    for (const [key, val] of Object.entries(replacements)) {
      full = full.replace(new RegExp(key, 'g'), val);
    }
    candidates.push(full);
  } else {
    candidates.push(dep);
  }

  return candidates.find(fileExists) || null;
}

function checkMacOSDependencies(binPath: string): DependencyCheckResult {
  try {
    const deps = getMachODependencies(binPath);
    const rpaths = getMachORPaths(binPath);
    const missing: string[] = [];

    for (const dep of deps) {
      // skip non-paths that the loader supplies
      if (dep === 'libSystem.B.dylib' || dep === '/usr/lib/libSystem.B.dylib') continue;
      const resolved = resolveMacOSPath(dep, binPath, rpaths);
      if (!resolved) missing.push(dep);
    }
    return { missing, errors: [] };
  } catch (_err: any) {
    // Most likely otool is unavailable (e.g., in a container)
    return {
      missing: [],
      errors: ['otool not available - cannot check Mach-O dependencies in container'],
    };
  }
}

// Linux (ELF) dependency checking
function getELFDependencies(binPath: string): string[] {
  let out: string;
  try {
    out = run('readelf', ['-d', binPath]);
  } catch (_) {
    out = run('objdump', ['-p', binPath]);
  }
  const deps: string[] = [];
  for (const line of out.split(/\n/)) {
    const m = line.match(/\(NEEDED\).*\[([^\]]+)\]/) || line.match(/Shared library: \[([^\]]+)\]/);
    if (m) deps.push(m[1]);
  }
  return deps;
}

function getLdconfigMap(): Map<string, string> {
  const mapping = new Map<string, string>();
  try {
    const out = run('ldconfig', ['-p']);
    for (const line of out.split(/\n/)) {
      const m = line.match(/\s*(\S+\.so(?:\.[^\s]*)?)\s+\([^)]*\) => (\S+)/);
      if (m) {
        mapping.set(m[1], m[2]);
      }
    }
  } catch (_) {
    // ldconfig absent
  }
  return mapping;
}

function collectSearchDirs(): string[] {
  const dirs = [
    '/lib',
    '/usr/lib',
    '/lib64',
    '/usr/lib64',
    ...(process.env.LD_LIBRARY_PATH?.split(':').filter(Boolean) || []),
  ];
  return [...new Set(dirs.filter(fs.existsSync))];
}

function resolveLinuxPath(
  lib: string,
  ldMap: Map<string, string>,
  searchDirs: string[]
): string | null {
  if (path.isAbsolute(lib)) return fileExists(lib) ? lib : null;
  if (ldMap.has(lib)) return ldMap.get(lib)!;
  for (const dir of searchDirs) {
    const cand = path.join(dir, lib);
    if (fileExists(cand)) return cand;
  }
  return null;
}

function checkLinuxDependencies(binPath: string): DependencyCheckResult {
  try {
    const deps = getELFDependencies(binPath);
    const ldMap = getLdconfigMap();
    const searchDirs = collectSearchDirs();
    const missing: string[] = [];

    for (const lib of deps) {
      const resolved = resolveLinuxPath(lib, ldMap, searchDirs);
      if (!resolved) missing.push(lib);
    }
    return { missing, errors: [] };
  } catch (err: any) {
    return { missing: [], errors: [err.message] };
  }
}

export function checkDependencies(
  binPath: string,
  format: 'ELF' | 'Mach-O'
): DependencyCheckResult {
  if (format === 'ELF' && process.platform === 'linux') {
    return checkLinuxDependencies(binPath);
  }
  if (format === 'Mach-O' && process.platform === 'darwin') {
    return checkMacOSDependencies(binPath);
  }
  return { missing: [], errors: [] };
}

// ----- Container compatibility ----------------------------------------------
export function getSystemArchitecture(): string {
  const arch = process.arch;
  switch (arch) {
    case 'x64':
      return 'x86_64';
    case 'arm64':
      return 'aarch64';
    case 'ia32':
      return 'x86';
    case 'arm':
      return 'arm';
    default:
      return arch;
  }
}

export function checkContainerCompatibility(
  binaryArch: string | undefined,
  format: string
): { compatible: boolean; reason?: string } {
  // Only check ELF binaries
  if (format !== 'ELF') {
    return { compatible: false, reason: `Container requires ELF binary, but got ${format}` };
  }

  if (!binaryArch) {
    return { compatible: false, reason: 'Could not determine binary architecture' };
  }

  const systemArch = getSystemArchitecture();

  // Direct match
  if (binaryArch === systemArch) {
    return { compatible: true };
  }

  // x86 can run on x86_64
  if (systemArch === 'x86_64' && binaryArch === 'x86') {
    return { compatible: true };
  }

  return {
    compatible: false,
    reason: `Binary architecture (${binaryArch}) is not compatible with container architecture (${systemArch})`,
  };
}

// ----- Main validation function ---------------------------------------------
export function validateBinary(filePath: string, checkContainer = false): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    hasErrors: false,
    hasWarnings: false,
  };

  // Check binary format
  const binaryCheck = isValidBinary(filePath);
  if (!binaryCheck.valid) {
    result.isValid = false;
    result.hasErrors = true;
    return result;
  }

  result.format = binaryCheck.format;
  result.architecture = binaryCheck.architecture;

  // Check container compatibility if requested
  if (checkContainer) {
    result.containerCompatibility = checkContainerCompatibility(
      binaryCheck.architecture,
      binaryCheck.format
    );
    if (!result.containerCompatibility.compatible) {
      result.hasErrors = true;
      result.isValid = false;
    }
  }

  // Check DWARF debug info
  if (binaryCheck.format === 'ELF' || binaryCheck.format === 'Mach-O') {
    result.hasDwarf = hasDwarf(filePath, binaryCheck.format);
    if (!result.hasDwarf) {
      result.hasWarnings = true;
    }

    // Check dependencies
    result.dependencies = checkDependencies(filePath, binaryCheck.format);
    if (result.dependencies.errors.length > 0) {
      // Don't treat tool availability as a hard error in containers
      if (result.dependencies.errors.some((err) => err.includes('otool not available'))) {
        result.hasWarnings = true;
      } else {
        result.hasErrors = true;
        result.isValid = false;
      }
    }
    if (result.dependencies.missing.length > 0) {
      result.hasWarnings = true;
    }
  }

  return result;
}

// ----- CLI interface --------------------------------------------------------
function main() {
  // ANSI color codes
  const red = '\x1b[31m';
  const yellow = '\x1b[33m';
  const reset = '\x1b[0m';

  const args = process.argv.slice(2);
  const checkContainer = args.includes('--check-container');
  const file = args.find((arg) => !arg.startsWith('--'));

  if (!file) {
    console.error('Usage: node dist/utils/validate-native-binary.js [--check-container] <binary>');
    process.exit(2);
  }

  const filePath = path.resolve(file);
  if (!fileExists(filePath)) {
    console.error(`${red}Error:${reset} ${filePath} not found`);
    process.exit(2);
  }

  const result = validateBinary(filePath, checkContainer);

  if (!result.format) {
    console.error(`${red}Error:${reset} ${filePath} is not a valid native binary`);
    process.exit(2);
  }

  // Simple, compact output
  console.log(); // Add newline after progress indicator
  console.log(`Format: ${result.format}`);
  if (result.architecture) {
    console.log(`Architecture: ${result.architecture}`);
  }

  // Container compatibility (only shown if checked)
  if (result.containerCompatibility) {
    if (!result.containerCompatibility.compatible) {
      console.error(`${red}Error:${reset} ${result.containerCompatibility.reason}`);
    }
  }

  // Debug information
  if (result.hasDwarf !== undefined) {
    if (result.hasDwarf) {
      console.log('DWARF debug info: present');
    } else {
      console.log(
        `${yellow}Warning:${reset} DWARF debug info absent - profiling will have limited symbol information`
      );
    }
  }

  // Dependencies
  if (result.dependencies) {
    if (result.dependencies.errors.length > 0) {
      for (const err of result.dependencies.errors) {
        if (err.includes('otool not available')) {
          console.log(`${yellow}Warning:${reset} ${err}`);
        } else {
          console.error(`${red}Error:${reset} ${err}`);
        }
      }
    }

    if (result.dependencies.missing.length > 0) {
      console.log(
        `${yellow}Warning:${reset} Missing ${result.dependencies.missing.length} dependencies:`
      );
      for (const dep of result.dependencies.missing) {
        console.log(`  • ${dep}`);
      }
    } else if (result.format === 'ELF' || result.format === 'Mach-O') {
      console.log('Dependencies: all resolved');
    }
  }

  if (result.hasErrors) {
    process.exit(2);
  } else if (result.hasWarnings) {
    process.exit(1);
  } else {
    console.log('Binary validation: passed');
    process.exit(0);
  }
}

// Run CLI if executed directly
const isMain = (() => {
  try {
    return (
      fileURLToPath(import.meta.url) === (process.argv[1] ? path.resolve(process.argv[1]) : '')
    );
  } catch {
    return false;
  }
})();

if (isMain) {
  main();
}
