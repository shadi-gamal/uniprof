/**
 * Utilities for running container commands via a reusable bash trampoline.
 *
 * The trampoline allows us to keep user arguments as argv tokens and avoid
 * embedding them inside shell strings. It also supports splitting argv into
 * two segments separated by a sentinel token "::" so scripts can consume
 * optional "pre-args" (e.g., extra profiler args) distinctly from the app args.
 */

/**
 * Build a bash -lc command array that executes the provided script, then
 * forwards positional parameters to the script. The arguments are passed after
 * a dummy $0 ("sh"). If you need to split the arguments into two groups in the
 * script, pass them as: [...preArgs, '::', ...appArgs] and parse inside the
 * script.
 */
export function buildBashTrampoline(
  script: string,
  preArgs: string[],
  appArgs: string[]
): string[] {
  return ['bash', '-lc', script, 'sh', ...preArgs, '::', ...appArgs];
}

/**
 * Shell-escape a string for safe embedding in single-quoted contexts.
 */
export function shellEscape(value: string): string {
  // Replace single quotes by closing, escaping, and reopening the quote.
  return `'${value.replace(/'/g, "'\\''")}'`;
}
