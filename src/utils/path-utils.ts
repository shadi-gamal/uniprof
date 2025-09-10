import * as fs from 'node:fs';
import * as path from 'node:path';

function isWSLHost(): boolean {
  // Heuristics: environment variables commonly set on WSL
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    const ver = fs.readFileSync('/proc/version', 'utf8');
    return /microsoft/i.test(ver);
  } catch {
    return false;
  }
}

export function isWindowsAbsolute(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

function windowsToPosixAbs(p: string): string {
  const s = p.replace(/\\/g, '/');
  // Drive letters like C:/...
  const m = s.match(/^([A-Za-z]):\/(.*)$/);
  if (m) {
    const drive = m[1].toLowerCase();
    const rest = m[2];
    if (isWSLHost()) {
      // Map to WSL mount point
      return `/mnt/${drive}/${rest}`;
    }
    // Generic POSIX-style absolute path without mount root
    return `/${rest}`;
  }
  // UNC paths remain //server/share/...
  if (s.startsWith('//')) return s;
  return s;
}

export function posixify(p: string): string {
  return p.replace(/\\/g, '/');
}

export function isSubPath(child: string, parent: string): boolean {
  try {
    const parentResolved = path.resolve(parent);
    const childResolved = path.resolve(child);
    const rel = path.relative(parentResolved, childResolved);
    if (!rel) return true;
    const isSub = !rel.startsWith('..') && !path.isAbsolute(rel);
    return isSub;
  } catch {
    return false;
  }
}

export function toContainerPath(cwd: string, arg: string): string {
  // Absolute path inside workspace => map to /workspace relative
  if (path.isAbsolute(arg)) {
    if (isSubPath(arg, cwd)) {
      const rel = path.relative(cwd, arg);
      return `/workspace/${posixify(rel)}`;
    }
    return arg;
  }
  // Handle Windows-style absolute paths passed on non-Windows hosts
  if (isWindowsAbsolute(arg)) {
    const cwdPosix = posixify(cwd);
    const posixAbs = windowsToPosixAbs(arg);
    if (posixAbs === cwdPosix || posixAbs.startsWith(`${cwdPosix}/`)) {
      const rel = posixAbs.slice(cwdPosix.length).replace(/^\//, '');
      return `/workspace/${posixify(rel)}`;
    }
    // Outside workspace; leave as-is (caller may warn or fail)
    return arg;
  }
  // Relative path that exists in cwd => map
  const candidate = path.join(cwd, arg);
  if (!arg.startsWith('-') && fs.existsSync(candidate)) {
    return `/workspace/${posixify(arg)}`;
  }
  return arg;
}

/**
 * Find absolute paths that are outside the workspace and thus won't be mounted
 * into the container (likely to cause file-not-found errors).
 */
export function findUnmappedPaths(cwd: string, args: string[]): string[] {
  const results: string[] = [];
  for (const a of args) {
    if (!a || a.startsWith('-')) continue;
    // Note: This only inspects positional arguments. Paths embedded in option values
    // (e.g., "--config=/abs/path/outside") are not analyzed here. Those may still
    // fail at runtime in container mode if outside the workspace. This limitation is
    // intentional to avoid guessing which options represent file paths across tools.
    // Posix absolute path outside workspace (existence check is not required)
    if (path.isAbsolute(a) && !isSubPath(a, cwd)) {
      results.push(a);
      continue;
    }
    // Windows-style absolute path outside workspace (cannot reliably fs.existsSync on posix)
    if (isWindowsAbsolute(a)) {
      const cwdPosix = posixify(cwd);
      const posixAbs = windowsToPosixAbs(a);
      if (!(posixAbs === cwdPosix || posixAbs.startsWith(`${cwdPosix}/`))) {
        results.push(a);
      }
    }
  }
  return results;
}

/**
 * Best-effort detection of absolute paths embedded in option values.
 *
 * This scans argv tokens for equals-form options (e.g., --config=/abs/path or -o=/abs/path)
 * and returns those whose values are absolute and outside the working directory.
 * No specific option keys are hardcoded — this is purely lexical.
 */
export function findUnmappedOptionValuePaths(cwd: string, args: string[]): string[] {
  const suspects: string[] = [];
  const cwdResolved = path.resolve(cwd);
  const cwdPosix = posixify(cwdResolved);

  for (const tok of args) {
    if (!tok || !tok.startsWith('-')) continue;
    const eqIdx = tok.indexOf('=');
    if (eqIdx <= 0 || eqIdx === tok.length - 1) continue;
    const val = tok.slice(eqIdx + 1);
    // Consider absolute and relative values; resolve relative to cwd
    if (path.isAbsolute(val)) {
      if (!isSubPath(val, cwdResolved)) {
        suspects.push(val);
      }
    } else if (isWindowsAbsolute(val)) {
      const posixAbs = windowsToPosixAbs(val);
      if (!(posixAbs === cwdPosix || posixAbs.startsWith(`${cwdPosix}/`))) {
        suspects.push(val);
      }
    } else {
      // Relative value: resolve and ensure it remains within cwd
      const abs = path.resolve(cwdResolved, val);
      if (!isSubPath(abs, cwdResolved)) {
        suspects.push(val);
      }
    }
  }
  return suspects;
}

/**
 * Best-effort detection of absolute paths provided as the separate value to an option.
 *
 * Example tokens: ["--config", "/etc/app.json"] or ["-o", "C:\\path\\file"].
 * Any option token (starting with '-') immediately followed by a value that looks like an
 * absolute path and lies outside the working directory is returned. No option names are hardcoded.
 */
export function findUnmappedFollowingOptionValuePaths(cwd: string, args: string[]): string[] {
  const results: string[] = [];
  const cwdResolved = path.resolve(cwd);
  const cwdPosix = posixify(cwdResolved);

  for (let i = 0; i < args.length - 1; i++) {
    const opt = args[i];
    const val = args[i + 1];
    if (!opt || !opt.startsWith('-')) continue;
    // Skip equals-form (--key=value) handled elsewhere
    if (opt.includes('=')) continue;
    if (!val || val.startsWith('-')) continue;
    // Consider absolute and relative values
    if (path.isAbsolute(val)) {
      if (!isSubPath(val, cwdResolved)) results.push(val);
      i++;
      continue;
    }
    if (isWindowsAbsolute(val)) {
      const posixAbs = windowsToPosixAbs(val);
      if (!(posixAbs === cwdPosix || posixAbs.startsWith(`${cwdPosix}/`))) {
        results.push(val);
      }
      i++;
      continue;
    }
    // Relative value
    const abs = path.resolve(cwdResolved, val);
    if (!isSubPath(abs, cwdResolved)) results.push(val);
    i++;
  }
  return results;
}
