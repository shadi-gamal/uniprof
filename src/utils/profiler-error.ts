import type chalk from 'chalk';

// Build a plain-text diagnostic for profiler failures that includes exit code and streams.
// Intentionally avoid color here; callers colorize the header/error as needed.
export function makeProfilerExitMessage(
  exitCode: number | null | undefined,
  stdout?: string,
  stderr?: string
): string {
  const lines: string[] = [];
  lines.push(`Profiler exited with code ${exitCode ?? 0}`);

  const err = (stderr || '').trim();
  const out = (stdout || '').trim();

  if (err) {
    lines.push('', 'stderr:', err);
  }
  if (out) {
    lines.push('', 'stdout:', out);
  }

  return lines.join('\n');
}

