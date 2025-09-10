import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  findUnmappedPaths,
  isSubPath,
  isWindowsAbsolute,
  posixify,
  toContainerPath,
} from '../src/utils/path-utils.js';

describe('Path utilities', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'uniprof-path-'));

  it('detects absolute POSIX paths outside cwd', () => {
    if (process.platform === 'win32') return;
    const cwd = path.join(tmpBase, 'proj');
    fs.mkdirSync(cwd, { recursive: true });
    const unmapped = findUnmappedPaths(cwd, ['python', '/etc/hosts']);
    expect(unmapped).toContain('/etc/hosts');
  });

  it('detects Windows-style absolute paths outside cwd on non-Windows', () => {
    if (process.platform === 'win32') return;
    const cwd = path.join(tmpBase, 'proj2');
    fs.mkdirSync(cwd, { recursive: true });
    const winAbs = 'C:\\Projects\\foo\\bar.py';
    const unmapped = findUnmappedPaths(cwd, ['python', winAbs]);
    expect(unmapped).toContain(winAbs);
  });

  it('maps project-relative absolute paths to /workspace', () => {
    const cwd = fs.mkdtempSync(path.join(tmpBase, 'cwd-'));
    const filePath = path.join(cwd, 'app.js');
    fs.writeFileSync(filePath, '');
    const mapped = toContainerPath(cwd, filePath);
    expect(mapped).toBe('/workspace/app.js');
  });

  it('maps relative existing files to /workspace relative', () => {
    const cwd = fs.mkdtempSync(path.join(tmpBase, 'cwd-'));
    const rel = 'main.py';
    fs.writeFileSync(path.join(cwd, rel), '');
    const mapped = toContainerPath(cwd, rel);
    expect(mapped).toBe('/workspace/main.py');
  });

  it('isSubPath handles edge cases', () => {
    const parent = '/a/b';
    expect(isSubPath('/a/b/c', parent)).toBe(true);
    expect(isSubPath('/a/b', parent)).toBe(true);
    expect(isSubPath('/a/bc', parent)).toBe(false);
  });

  it('isWindowsAbsolute detects patterns', () => {
    expect(isWindowsAbsolute('C:/foo/bar')).toBe(true);
    expect(isWindowsAbsolute('C:\\foo\\bar')).toBe(true);
    expect(isWindowsAbsolute('\\\\server\\share')).toBe(true);
    expect(isWindowsAbsolute('foo/bar')).toBe(false);
    expect(isWindowsAbsolute('/foo/bar')).toBe(false);
  });

  it('posixify normalizes backslashes', () => {
    expect(posixify('C:\\foo\\bar')).toBe('C:/foo/bar');
  });

  it('WSL: maps Windows absolute paths under cwd to /workspace via /mnt/<drive>', () => {
    // Simulate WSL by setting env var
    const prev = process.env.WSL_DISTRO_NAME;
    process.env.WSL_DISTRO_NAME = 'Ubuntu-22.04';
    try {
      const cwd = '/mnt/c/Projects/myapp';
      const winPath = 'C:\\Projects\\myapp\\src\\index.php';
      const mapped = toContainerPath(cwd, winPath);
      expect(mapped).toBe('/workspace/src/index.php');
    } finally {
      if (prev === undefined) process.env.WSL_DISTRO_NAME = undefined;
      else process.env.WSL_DISTRO_NAME = prev;
    }
  });

  it('WSL: leaves Windows paths outside cwd unmapped', () => {
    const prev = process.env.WSL_DISTRO_NAME;
    process.env.WSL_DISTRO_NAME = 'Ubuntu-22.04';
    try {
      const cwd = '/mnt/c/Projects/app1';
      const outside = 'D:\\Other\\file.txt';
      const mapped = toContainerPath(cwd, outside);
      expect(mapped).toBe(outside);
      const unmapped = findUnmappedPaths(cwd, ['node', outside]);
      expect(unmapped).toContain(outside);
    } finally {
      if (prev === undefined) process.env.WSL_DISTRO_NAME = undefined;
      else process.env.WSL_DISTRO_NAME = prev;
    }
  });
});
