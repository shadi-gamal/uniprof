import { printError } from './output-formatter.js';

/**
 * Ensure a default flag is present in an argument array.
 * If any of the provided flags is present (either as a separate token or
 * as --flag=value), the args are returned unchanged. Otherwise, the first
 * flag is appended along with the default value.
 */
export function ensureDefaultFlag(
  args: string[] | undefined,
  flags: string[],
  defaultValue: string
): string[] {
  const input = Array.isArray(args) ? [...args] : [];
  const has = input.some((t) => flags.some((f) => t === f || t.startsWith(`${f}=`)));
  if (has) return input;
  if (flags.length === 0) return input;
  return [...input, flags[0], defaultValue];
}

/**
 * Strip any output-path related flags from a user-provided extra args array.
 *
 * Rationale: uniprof controls the profiler output location to post-process reliably.
 * Some profilers accept flags like "-o", "--output", "--output-dir", or "--file" that
 * can redirect the output; if users pass them via --extra-profiler-args, they can break
 * our post-processing. This helper removes such flags and returns both the filtered args
 * and a list of removed tokens for user-facing warnings.
 */
export function stripOutputPathFlags(
  args: string[] | undefined,
  flagsToStrip: string[]
): { filtered: string[]; removed: string[] } {
  const input = Array.isArray(args) ? [...args] : [];
  const removed: string[] = [];
  const filtered: string[] = [];

  for (let i = 0; i < input.length; i++) {
    const tok = input[i];
    // Equals-form: --output=path
    const equalsFlag = flagsToStrip.find((f) => tok.startsWith(`${f}=`));
    if (equalsFlag) {
      removed.push(tok);
      continue;
    }
    // Separate value form: --output path or -o path or --file path
    if (flagsToStrip.includes(tok)) {
      removed.push(tok);
      // Skip following value if present and not another flag
      if (i + 1 < input.length && !input[i + 1].startsWith('-')) {
        removed.push(input[i + 1]);
        i += 1;
      }
      continue;
    }
    filtered.push(tok);
  }

  return { filtered, removed };
}

// Single source of truth for recognized `record` options used by the alias parser.
// Keep these in sync with Commander option definitions in src/index.ts.
// Exported for test visibility to reduce drift with Commander options in index.ts
export const RECORD_BOOLEAN_OPTS = new Set([
  '-v',
  '--verbose',
  '--analyze',
  '--visualize',
  '--enable-host-networking',
]);
export const RECORD_VALUE_OPTS = new Set([
  '-o',
  '--output',
  '--mode',
  '--cwd',
  '--platform',
  '--format',
  // Treat as value option for scanning purposes; actual values may include tokens
  '--extra-profiler-args',
]);

function isEqualsFormValueOpt(t: string, valueOpts: Set<string>): boolean {
  if (t.startsWith('--')) {
    const key = t.includes('=') ? t.slice(0, t.indexOf('=')) : t;
    return valueOpts.has(key) && t.includes('=');
  }
  if (t.startsWith('-') && t.includes('=')) {
    const key = t.slice(0, t.indexOf('='));
    return valueOpts.has(key);
  }
  return false;
}

// Normalize tokens for a `record` invocation: extract record-level options, condense
// any --extra-profiler-args values (including tokens that start with '-') into a single
// value token, and identify the profiled command tokens. Robust against equals-form
// flags (e.g., --foo=bar=baz) and negative numeric values following flags.
function normalizeRecordInvocation(tokens: string[]): {
  recordOpts: string[];
  commandTokens: string[];
} {
  const booleanOpts = RECORD_BOOLEAN_OPTS;
  const valueOpts = RECORD_VALUE_OPTS;

  // Prefer the last separator as the command boundary if present
  const lastSep = tokens.lastIndexOf('--');
  const optsSlice = lastSep !== -1 ? tokens.slice(0, lastSep) : tokens;
  const commandSlice = lastSep !== -1 ? tokens.slice(lastSep + 1) : [];

  const recordOpts: string[] = [];
  let commandTokens: string[] = [];
  let i = 0;
  let collectingExtra = false;
  const extraParts: string[] = [];
  let lastAddedWasFlagWithoutValue = false;

  const finishExtra = () => {
    if (collectingExtra) {
      collectingExtra = false;
      if (extraParts.length > 0) {
        recordOpts.push('--extra-profiler-args', extraParts.join(' '));
      }
    }
    lastAddedWasFlagWithoutValue = false;
  };

  while (i < optsSlice.length) {
    const t = optsSlice[i];

    // Separator encountered inside optsSlice: stop; remaining becomes command tokens
    if (t === '--') {
      finishExtra();
      commandTokens = optsSlice.slice(i + 1);
      i = optsSlice.length;
      break;
    }

    // Handle equals-form first
    if (isEqualsFormValueOpt(t, valueOpts)) {
      finishExtra();
      // Special case: --extra-profiler-args=VALUE
      if (t.startsWith('--extra-profiler-args=')) {
        const val = t.slice('--extra-profiler-args='.length);
        recordOpts.push('--extra-profiler-args', val);
      } else {
        recordOpts.push(t);
      }
      i += 1;
      continue;
    }

    // Normal boolean options
    if (booleanOpts.has(t)) {
      finishExtra();
      recordOpts.push(t);
      i += 1;
      continue;
    }

    // Normal value options (single value)
    if (valueOpts.has(t) && t !== '--extra-profiler-args') {
      finishExtra();
      const val = i + 1 < optsSlice.length ? optsSlice[i + 1] : undefined;
      if (val === undefined || val.startsWith('-')) {
        printError(`${t} requires a value`);
        process.exit(1);
      }
      recordOpts.push(t, val);
      i += 2;
      continue;
    }

    // Start collecting extra-profiler-args values
    if (t === '--extra-profiler-args') {
      finishExtra();
      // If the immediate next token is '--', skip it and collect subsequent
      // tokens as extra-profiler-args up to the end of optsSlice. This allows
      // dashed values to be captured without ambiguity.
      const nextTok = optsSlice[i + 1];
      if (nextTok === '--') {
        const extras = optsSlice.slice(i + 2);
        if (extras.length > 0) recordOpts.push('--extra-profiler-args', extras.join(' '));
        i = optsSlice.length;
        continue;
      }
      collectingExtra = true;
      lastAddedWasFlagWithoutValue = false;
      i += 1;
      continue;
    }

    if (collectingExtra) {
      // Stop if next token looks like a record option boundary
      if (
        t === '--' ||
        booleanOpts.has(t) ||
        valueOpts.has(t) ||
        isEqualsFormValueOpt(t, valueOpts)
      ) {
        finishExtra();
        if (t === '--') {
          // Let outer logic decide command boundary later
          i += 1;
        }
        continue; // reprocess or advance as needed
      }

      // Equals-form extra flag (e.g., --rate=500 or -F=999)
      if ((t.startsWith('--') || t.startsWith('-')) && t.includes('=')) {
        extraParts.push(t);
        lastAddedWasFlagWithoutValue = false;
        i += 1;
        continue;
      }

      const isNegativeNumeric = /^-\d+(?:\.\d+)?$/.test(t);

      if (t.startsWith('-') && !isNegativeNumeric) {
        // New extra flag; may take a following value
        extraParts.push(t);
        lastAddedWasFlagWithoutValue = true;
        // If next token is a non-flag value, capture it as this flag's value
        if (i + 1 < optsSlice.length) {
          const nxt = optsSlice[i + 1];
          if (
            nxt !== '--' &&
            !nxt.startsWith('-') &&
            !booleanOpts.has(nxt) &&
            !valueOpts.has(nxt)
          ) {
            extraParts.push(nxt);
            lastAddedWasFlagWithoutValue = false;
            i += 2;
            continue;
          }
        }
        i += 1;
        continue;
      }

      // Value token: if immediately following a flag without a value, attach as its value
      if (lastAddedWasFlagWithoutValue) {
        extraParts.push(t);
        lastAddedWasFlagWithoutValue = false;
        i += 1;
        continue;
      }

      // Otherwise, hitting a bare token means we've reached the command
      finishExtra();
      commandTokens = optsSlice.slice(i);
      i = optsSlice.length;
      break;
    }

    // Reaching here means we found the start of the command without explicit separator
    if (!t.startsWith('-')) {
      finishExtra();
      commandTokens = optsSlice.slice(i);
      i = optsSlice.length;
      break;
    }

    // Unknown option at record level: treat as start of command to avoid misrouting
    finishExtra();
    commandTokens = optsSlice.slice(i);
    i = optsSlice.length;
    break;
  }

  // If lastSep existed, append its command slice to whatever we derived locally
  if (lastSep !== -1) {
    // Prefer explicit command slice
    commandTokens = commandSlice;
  }

  finishExtra();
  return { recordOpts, commandTokens };
}

// Normalize a top-level alias invocation (no explicit subcommand).
function normalizeAliasInvocation(tokens: string[]): {
  recordOpts: string[];
  commandTokens: string[];
  hasAnalyze: boolean;
  hasVisualize: boolean;
} {
  const { recordOpts, commandTokens } = normalizeRecordInvocation(tokens);
  const hasAnalyze = recordOpts.includes('--analyze');
  const hasVisualize = recordOpts.includes('--visualize');
  return { recordOpts, commandTokens, hasAnalyze, hasVisualize };
}

/**
 * Transform argv to support simplified aliases and consistent option handling.
 *
 * Goals:
 * - Allow both "uniprof python app.py" and "uniprof -- python app.py".
 * - Map implicit alias: "uniprof [opts] <cmd> [args]" -> "uniprof record [opts] --analyze -- <cmd> [args]".
 * - Preserve "--visualize" to map to "record --visualize" instead of analyze.
 * - For explicit subcommand "record", insert "--" automatically after the first non-option
 *   argument if not provided, so tokens after the profiled command are passed through.
 */
export function processAliases(args: string[]): string[] {
  const processedArgs = [...args];
  const scriptArgs = processedArgs.slice(2); // Skip executable and script name

  if (scriptArgs.length === 0) {
    return processedArgs;
  }

  // Handle --version and --help flags directly - let commander process them
  if (
    scriptArgs.includes('--version') ||
    scriptArgs.includes('-V') ||
    scriptArgs.includes('--help') ||
    scriptArgs.includes('-h')
  ) {
    return processedArgs;
  }

  const separatorIndex = processedArgs.indexOf('--');
  const knownCommands = ['bootstrap', 'record', 'analyze', 'visualize', 'mcp', 'help'];

  // If user invoked a known subcommand, normalize record args (handle extra-profiler-args and separator)
  if (knownCommands.includes(scriptArgs[0])) {
    if (scriptArgs[0] === 'record') {
      const tokens = scriptArgs.slice(1);

      // Normalize record options and capture extra-profiler-args into a single value token.
      const { recordOpts, commandTokens } = normalizeRecordInvocation(tokens);
      if (commandTokens.length === 0) return processedArgs;
      return [processedArgs[0], processedArgs[1], 'record', ...recordOpts, '--', ...commandTokens];
    }
    return processedArgs;
  }

  // If explicit separator is present and user provided only options before it,
  // transform to record and keep all options intact, placing command after --
  if (separatorIndex !== -1) {
    const before = processedArgs.slice(2, separatorIndex);
    const after = processedArgs.slice(separatorIndex + 1); // skip the '--' itself

    // Determine if there is any non-option token before --, accounting for value options
    const booleanOpts = RECORD_BOOLEAN_OPTS;
    const valueOpts = RECORD_VALUE_OPTS;
    const isEqualsForm = (t: string): boolean => {
      // Require explicit equals-form: --key=value or -k=value
      if (t.startsWith('--') && t.includes('=')) {
        const key = t.slice(0, t.indexOf('='));
        return valueOpts.has(key);
      }
      if (t.startsWith('-') && t.includes('=')) {
        const key = t.slice(0, t.indexOf('='));
        return valueOpts.has(key);
      }
      return false;
    };
    let i = 0;
    let hasCommandBefore = false;
    while (i < before.length) {
      const t = before[i];
      if (booleanOpts.has(t)) {
        i += 1;
        continue;
      }
      if (valueOpts.has(t)) {
        // Skip option and its value
        i += 2;
        continue;
      }
      if (isEqualsForm(t)) {
        i += 1;
        continue;
      }
      if (!t.startsWith('-')) {
        hasCommandBefore = true;
        break;
      }
      // Unknown option token; treat as start of command conservatively
      hasCommandBefore = true;
      break;
    }

    if (!hasCommandBefore) {
      const hasAnalyze = before.includes('--analyze');
      const hasVisualize = before.includes('--visualize');
      if (hasAnalyze && hasVisualize) {
        printError('Options --analyze and --visualize are mutually exclusive');
        process.exit(1);
      }

      // Normalize extra-profiler-args before emitting
      const { recordOpts } = normalizeRecordInvocation(before);

      const recordArgs = [processedArgs[0], processedArgs[1], 'record'];
      recordArgs.push(...recordOpts);
      recordArgs.push(hasVisualize ? '--visualize' : '--analyze');
      recordArgs.push('--', ...after);
      return recordArgs;
    }
    return processedArgs;
  }

  // No separator AND not a known subcommand: attempt smart alias transform
  // Recognize record options up front and keep them before the generated '--'.
  const tokens = [...scriptArgs];
  const { recordOpts, commandTokens, hasVisualize, hasAnalyze } = normalizeAliasInvocation(tokens);

  if (commandTokens.length === 0) return processedArgs;
  if (hasAnalyze && hasVisualize) {
    printError('Options --analyze and --visualize are mutually exclusive');
    process.exit(1);
  }

  const newArgv = [processedArgs[0], processedArgs[1], 'record', ...recordOpts];
  const alreadyHasMode = recordOpts.includes('--analyze') || recordOpts.includes('--visualize');
  if (!alreadyHasMode) newArgv.push(hasVisualize ? '--visualize' : '--analyze');
  newArgv.push('--', ...commandTokens);
  return newArgv;
}

/**
 * Split a single command string into argv-like tokens, honoring quotes.
 * - Whitespace splits tokens unless inside single/double quotes
 * - Backslash only escapes a double quote when inside double quotes
 * - Single quotes do not allow escapes
 */
export function splitArgsQuoted(input: string): string[] {
  const args: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inDouble && ch === '\\') {
      const nxt = input[i + 1];
      if (nxt === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      // Treat other backslashes literally inside double quotes
      cur += '\\';
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (cur.length) {
        args.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur.length) args.push(cur);
  return args;
}
