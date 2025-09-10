# uniprof CLI Reference

This page documents the uniprof command‑line interface: commands, flags, aliasing behavior, examples, and output formats. It reflects the current implementation in `src/index.ts`, `src/commands/{record,analyze,visualize}.ts`, and related helpers.

## Quick Start

Profile and analyze in one go (simplest):

```bash
uniprof python app.py
uniprof -- python app.py

# Visualize instead of analyze
uniprof --visualize python app.py
uniprof --visualize -- python app.py
```

Save a profile for later:

```bash
uniprof record -o profile.json -- python app.py
uniprof analyze profile.json
uniprof visualize profile.json
```

Works across languages:

```bash
uniprof node server.js
uniprof ruby script.rb
uniprof java -jar app.jar
uniprof dotnet MyApp.dll
uniprof ./my-native-app
```

Advanced examples:

```bash
uniprof --extra-profiler-args --rate 500 -- python app.py
uniprof --extra-profiler-args "--rate 500 --native" -- python app.py
uniprof --mode host -- python app.py
uniprof --cwd ./examples -- python app.py
uniprof record --mode host -o profile.json -- python app.py
```

## Argument Parsing & Aliases

- Implicit vs. explicit: `uniprof python app.py` is an alias for `uniprof record --analyze -- python app.py`.
  - If you include `--visualize` before the target command, it maps to `record --visualize` instead of analyze.
  - If you explicitly run `record`, uniprof will insert `--` before your target command automatically if omitted.
- Ownership of flags:
  - Options before the first non‑option belong to uniprof: `uniprof --verbose python app.py` → `--verbose` applies to uniprof.
  - Options after the first non‑option belong to your program: `uniprof python --verbose app.py` → `--verbose` goes to Python.
- Separator rules:
  - For `record`, a `--` is auto‑inserted right before the target command so trailing options are passed through verbatim.
  - `--extra-profiler-args` can be provided without a special separator. uniprof collects dashed tokens that follow and passes them to the profiler. You may also pass a single quoted string:
    ```bash
    # All equivalent
    uniprof record -o out.json --extra-profiler-args --rate 500 -- python app.py
    uniprof record -o out.json --extra-profiler-args "--rate 500" -- python app.py
    uniprof --extra-profiler-args --rate 500 python app.py   # alias form
    ```
    An explicit `--` before your program is still auto-inserted by uniprof when omitted.
- Mutual exclusion: `--analyze` and `--visualize` cannot be used together (enforced in aliasing and `record`).

## Commands

### `uniprof bootstrap`

Check environment and print setup instructions for profiling.

Flags:

- `--platform <platform>`: Specify a platform explicitly (see supported list in `--help`).
- `--mode <mode>`: `auto` (default), `host`, or `container`. On Windows, host mode is not supported.
- `-v, --verbose`: Enable verbose output.

Behavior highlights:

- In container mode (default), validates Docker and tries to pull the platform’s profiler image.
- Warns if Docker Desktop host networking is disabled (useful with `--enable-host-networking` in `record`).
- If a command is provided, attempts platform detection and shows tailored examples.
- For native binaries on macOS, advises using Instruments in host mode; validates ELF vs. Mach‑O accordingly.

Usage:

```bash
uniprof bootstrap --                 # Just check Docker and environment
uniprof bootstrap -- python app.py   # Detect platform from command
uniprof bootstrap --platform python  # Force a platform
```

---

### `uniprof record`

Record a profile for a command.

Arguments: none before `--`; the profiled command follows the separator (uniprof auto‑inserts `--` if omitted).

Flags:

- `-o, --output <path>`: Output path for the profile (Speedscope JSON). Optional when using `--analyze` or `--visualize` (a temporary file is created).
- `--platform <platform>`: Force a platform (overrides auto‑detection).
- `--extra-profiler-args <args...>`: Extra arguments passed to the underlying profiler. You may provide dashed tokens directly after this flag, or a single quoted string. uniprof will auto‑insert the final `--` before your program if omitted.
- `--mode <mode>`: `auto` (default), `host`, or `container`.
- `-v, --verbose`: Show all script/profiler output.
- `--enable-host-networking`: Allow containerized apps to access the host network (requires Docker Desktop host networking).
- `--analyze`: Analyze immediately after recording.
- `--visualize`: Visualize immediately after recording (mutually exclusive with `--analyze`).
- `--cwd <path>`: Working directory for the command; applied for platform detection and path validation.
- `--format <format>`: `pretty` or `json` (only used when `--analyze` is set).

Modes and OS notes:

- `auto`: Uses platform default; otherwise prefers container if Docker is available, else host.
- Host mode is not supported on Windows.
- macOS native binaries: container mode is not allowed for Mach‑O executables; use host mode (Instruments).

Path validation behavior:

- In container mode, uniprof validates argument paths against the working directory. Any absolute paths outside it are errors (they won’t be mounted). It also warns about absolute paths embedded inside option values (e.g., `--opt=/abs/path`).
- In host mode, these checks aren’t enforced (host tools can access arbitrary paths).

Output and follow‑ups:

- If `--analyze` is set:
  - `--format pretty` prints a human‑readable table.
  - `--format json` prints structured JSON to stdout; log lines are routed to stderr to keep stdout clean for tools.
- If `--visualize` is set: starts a local Speedscope server and opens your browser.
- Without either, the command prints “Next steps” with `analyze`/`visualize` suggestions.

Cancellation and exit codes:

- Press Ctrl+C once to request graceful stop of the profiled program; twice to exit uniprof.
- Exit code `130` (or `143`) is treated as user cancellation. Non‑zero exit codes otherwise are reported as failures.

Examples:

```bash
uniprof record -o out.json -- python app.py
uniprof record --analyze -- python app.py
uniprof record --visualize -- node server.js
uniprof record --mode host -o out.json -- ./my-native-app
uniprof record -o out.json --extra-profiler-args --rate 500 -- python app.py
```

---

### `uniprof analyze <profile>`

Analyze a previously recorded Speedscope JSON profile and print hotspots.

Flags:

- `--platform <platform>`: Force a platform if auto‑detection fails (e.g., `.NET`).
- `--threshold <percentage>`: Minimum percentage of total time to display (default: `0.1`).
- `--filter-regex <pattern>`: Include only functions whose name or file location matches the regex.
- `--min-samples <count>`: Include only functions with at least this many samples.
- `--max-depth <depth>`: Consider only the leaf‑most N frames per sample.
- `--format <format>`: `pretty` (default for TTY) or `json` (default for non‑TTY). JSON mode prints data to stdout, warnings to stderr.

Profile types and analysis:

- Sampled profiles (Python, Ruby, PHP, JVM, Node.js, perf/BEAM): analysis uses sample counts or uniform weights; output shows `Total samples: N`.
- Evented profiles (.NET, macOS Instruments): event streams are converted to synthetic samples by attributing elapsed time to the current open stack; output shows `Total events: N` and `Synthetic samples: M`.
- When sample weights vary, analysis computes P50/P90/P99 percentiles per function.

Pretty output columns:

- Function, Samples, Total %, Total, Self, optionally p50/p90/p99, and Location.

JSON output shape (note on semantics):

```jsonc
{
  "summary": {
    "totalSamples": number,
    "totalTime": number,           // unit‑scaled total weight
    "unit": "milliseconds" | "microseconds" | "nanoseconds" | "seconds" | "none",
    "profileName": string,
    "profiler": string,
    "threadCount": number,
    "profileType": "sampled" | "evented",
    "totalEvents": number          // present for evented profiles
  },
  "hotspots": [
    {
      "name": string,
      "file": string | undefined,
      "line": number | undefined,
      "percentage": number,        // of total time
      "self": number,              // leaf‑time weight
      "total": number,             // inclusive weight
      "samples": number,           // number of samples in which this frame appears at least once (not call count)
      "percentiles": { "p50": number, "p90": number, "p99": number } | undefined
    }
  ]
}
```

Examples:

```bash
uniprof analyze profile.json
uniprof analyze profile.json --threshold 5
uniprof analyze profile.json --filter-regex "^MyApp" --min-samples 100 --max-depth 10
uniprof analyze profile.json --platform dotnet --format json
```

---

### `uniprof visualize <profile>`

Serve a local Speedscope web UI and open your profile in the browser.

Flags:

- `--port <port>`: Port for the web server (default: random free port). Use `0` for random.

Details:

- Serves from `dist/speedscope` after build, or falls back to repo `speedscope/` in dev.
- If Speedscope assets are missing, run `npm run build` to bundle them.
- The server binds to `127.0.0.1`; press Ctrl+C to stop.

Examples:

```bash
uniprof visualize profile.json
uniprof visualize profile.json --port 4000
```

Note: this command uses [Speedscope](https://github.com/jlfwong/speedscope), an interactive web-based viewer for flamegraphs. Speedscope is bundled with uniprof, so no additional installation is required.

---

### `uniprof mcp <subcommand> [client]`

Model Context Protocol (MCP) server integration.

Subcommands:

- `run`: Start the MCP server.
- `install <client>`: Install into a supported client (`amp`, `claudecode`, `codex`, `cursor`, `gemini`, `vscode`, `zed`).

Examples:

```bash
uniprof mcp run
uniprof mcp install vscode
```

## Options Reference (by feature)

Aliasing and separators:

- `--visualize` at top level switches alias from analyze to visualize.
- `record` auto‑inserts `--` before your command if omitted.
- `--extra-profiler-args` does not require an explicit `--` after the flag; uniprof collects dashed tokens and auto-inserts the final `--` before your program.

Mode selection:

- `--mode auto|host|container` (default: `auto`). Auto prefers container when Docker is available.
- Windows host mode is not supported.
- macOS native binaries (Mach‑O) must run in host mode (Instruments/xctrace).

Output control:

- `-v, --verbose` increases logging. Ignored when `record --analyze --format json` is used to keep stdout clean JSON.
- `--format pretty|json` controls analyze output.

Networking:

- `--enable-host-networking` (record, container mode only) enables container access to host network if configured in Docker Desktop.

Working directory:

- `--cwd <path>` changes the working directory for platform detection and path validation.

Path validation (container mode):

- Absolute paths outside the working directory are rejected for command args; absolute paths in option values are warned about. Use relative paths under your project directory or switch to `--mode host`.

## Exit Codes

- `0`: Success.
- `1`: Error (invalid input, environment/setup failure, profiler failure, etc.).
- `130` (and `143`): User cancellation (Ctrl+C).

## Notes & Tips

- Sampling rate: When available, uniprof prints the configured sampling rate (Hz) for the selected platform at start.
- py‑spy may exit with code `1` on normal target exit; uniprof treats the run as successful if the expected profile file exists (handled in platform implementations).
- For `.NET` EventPipe profiles or macOS Instruments, times are event‑derived and converted to synthetic samples for consistent analysis output.
- If profile visualization doesn’t start, open the printed URL manually and ensure Speedscope assets are present (`npm run build`).
