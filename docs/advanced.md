# Advanced Usage

## Table of Contents

- [Default Sampling Rates](#default-sampling-rates)
- [CLI Argument Parsing](#cli-argument-parsing)
- [Ctrl+C Behavior During Profiling](#ctrlc-behavior-during-profiling)
- [Host Networking (Containers)](#host-networking-containers)
- [Path Mapping Rules (Containers)](#path-mapping-rules-containers)
- [Profiler Options](#profiler-options)
  - [Python (py-spy)](#python-py-spy)
  - [Node.js (0x)](#nodejs-0x)
  - [Ruby (rbspy)](#ruby-rbspy)
  - [PHP (Excimer)](#php-excimer)
  - [JVM (async-profiler)](#jvm-async-profiler)
  - [.NET (dotnet-trace)](#net-dotnet-trace)
  - [BEAM VM (Erlang/Elixir)](#beam-vm-erlangelixir)
  - [Native (perf on Linux)](#native-perf-on-linux)
  - [Native (Instruments on macOS)](#native-instruments-on-macos)
- [Analyze Filters](#analyze-filters)
- [Analyze Output Formats](#analyze-output-formats)
- [Environment Variables](#environment-variables)

## Default Sampling Rates

All profilers default to 999Hz sampling frequency for consistency across platforms. This provides optimal balance between accuracy and overhead. The actual sampling rate used is displayed when profiling begins:

```bash
$ uniprof record -o profile.json -- python app.py
✓ Platform detected: python
✓ Using profiler: py-spy
✓ Mode: container
✓ Sampling rate: 999 Hz

# The simplified alias without "--" also works and auto-inserts the separator:
$ uniprof record -o profile.json python app.py
```

## CLI Argument Parsing

Both of the following are valid and equivalent ways to pass your command to uniprof:

```bash
uniprof python app.py      # Implicit alias (recommended)
uniprof -- python app.py   # Explicitly pass remaining args to the command
```

Rules when not using `--`:

- Options before the first non-option token are treated as uniprof options.
  - Example: `uniprof --verbose python app.py` → `--verbose` applies to uniprof.
- Options after the first non-option token are passed to your command.
  - Example: `uniprof python --verbose app.py` → `--verbose` goes to python.
- For `record`, if you omit `--`, uniprof will insert it automatically before the first non-option token so that all subsequent args are passed to your command.
  - Example: `uniprof record -o out.json --verbose python app.py` becomes `uniprof record -o out.json --verbose -- python app.py`.
- Trailing options after your command are passed through as-is.
  - Example: `uniprof record -o out.json python app.py --verbose` → the final `--verbose` goes to python.

Notes:
- `--analyze` and `--visualize` are mutually exclusive.
- `--extra-profiler-args` may be followed directly by profiler flags (even when they begin with dashes). uniprof collects them and auto‑inserts the final `--` before your program. You can also pass a single quoted string:
  - `uniprof record -o out.json --extra-profiler-args --rate 500 -- python app.py`
  - `uniprof record -o out.json --extra-profiler-args "--rate 500 --native" -- python app.py`

## Ctrl+C Behavior During Profiling

When recording a profile, uniprof distinguishes between the first and second Ctrl+C (SIGINT) within a short window:

- First Ctrl+C: Signals the profiled program(s) to terminate gracefully while keeping the profiler running so it can flush and write the profile file.
  - Host mode: Sends SIGINT to all child processes of the profiler process. A denylist avoids signalling profiler binaries themselves (py-spy, rbspy, 0x, perf/perf-record, dotnet-trace, xctrace/instruments, async-profiler/jattach, excimer). As a compatibility fallback, uniprof also attempts a process-group SIGINT for the profiler (negative PID).
  - Container mode: Enumerates descendants of PID 1 in the container and sends SIGINT to those processes (minus the profiler binaries from the denylist). The profiler continues running to finalize the profile.

- Second Ctrl+C within 2 seconds: Forces termination of the entire session.
  - Host mode: Sends SIGINT to the profiler process and exits uniprof.
  - Container mode: Sends SIGINT to PID 1 and the container (docker kill -s INT), then exits uniprof.

UI details:
- While profiling, uniprof shows a spinner with a dim, two-line message explaining Ctrl+C behavior.
- After the first Ctrl+C, the spinner updates to “Stopping profiled program…” and remains until the profile is saved.
- With `--verbose`, uniprof prints the list of PIDs that were signalled and notes when process-group signalling is used.

Retries and fallbacks (reliability details):
- Child process retry: On the first Ctrl+C, if no eligible child processes are found yet (for example, the program is still bootstrapping), uniprof retries detection up to 10 times at 100ms intervals (≈1s total) before falling back.
- Host fallback: If no eligible children were signalled after retries, uniprof sends SIGINT to the profiler’s process group (negative PID). This can reach foreground processes that don’t show up as children yet. As a trade‑off, this may also signal the profiler process itself depending on the platform’s process‑group semantics. Uniprof uses profiler denylists to avoid this when possible and only uses this fallback after retries.
- Container fallback: If no eligible container children were signalled after retries, uniprof inspects PID 1’s command. If it is not a known profiler binary, uniprof sends SIGINT to PID 1 as a last-resort fallback (e.g., to stop a shell wrapper that is still launching the app).

## Host Networking (Containers)

On Linux, host networking is available via Docker Engine and uniprof assumes it is enabled; no Desktop settings are required. On macOS, Docker Desktop 4.43.0+ supports enabling host networking in settings, subject to Enhanced Container Isolation (ECI) being disabled.

Usage:

- Enable host networking in Docker Desktop settings
- Run uniprof with:

```bash
uniprof --enable-host-networking -- python app.py
uniprof record --enable-host-networking -o out.json -- python app.py
```

Requirements checked by uniprof:

- macOS only: Docker Desktop version 4.43.0 or newer, with Host Networking enabled and Enhanced Container Isolation (ECI) disabled.
- Linux: no Desktop checks are performed; uniprof enables `--network=host` when requested.

Notes:

- If host networking is not available (macOS), uniprof continues without it and warns you when `--enable-host-networking` is specified (diagnostics included in the warning).
- During `uniprof bootstrap` (container mode) on macOS, uniprof emits a non-fatal warning if host networking appears disabled, so you can proactively enable it for workloads that require access to host services.
- When host networking is active, uniprof displays “Host networking: enabled” on the platform detected line and passes `--network=host` to Docker.

## Path Mapping Rules (Containers)

When running in container mode, uniprof mounts your current working directory into the container at `/workspace` and rewrites paths where safe:

- Run from your project root and prefer relative paths under it. Relative paths that exist are mapped to `/workspace/<path>`.
- Absolute paths that are under the working directory are mapped to `/workspace/<relative-path>`.
- Absolute paths outside the working directory are NOT mounted. These will fail to resolve inside the container.
  - For clear positional arguments (e.g., `/usr/bin/tool`, `/etc/app.json`), `record` blocks with an error in container mode.
  - For absolute paths embedded in option values (e.g., `--config=/etc/app.json`), uniprof performs best‑effort detection and emits warnings in container mode, but does not block execution (some option schemas can’t be reliably identified).
- Windows-style absolute paths on non-Windows hosts (e.g., `C:\\dir\\file`) are only mapped if they point under the working directory after normalization; otherwise they are passed through unchanged.
- Use `--cwd <dir>` to set the working directory uniprof uses for path mapping and platform detection.

Examples:

```bash
# Good: run from project root; relative paths are mapped
uniprof record -o out.json -- ./bin/mytool --config ./config/app.json

# Will warn or fail: absolute path outside project (not mounted)
uniprof record -o out.json -- ./bin/mytool --config /etc/app.json

# Use --cwd to point uniprof at your project root when running from elsewhere
uniprof --cwd ~/src/myproject -- ./bin/mytool
```

## Profiler Options

Each platform's profiler supports additional options that can be passed using `--extra-profiler-args`.

You can either follow the flag with dashed tokens directly, or provide a single quoted string. uniprof collects these and forwards them to the underlying profiler.

Below are the available options for each platform.

### Python (py-spy)

```bash
# Default sampling rate is 999Hz, customize with:
--extra-profiler-args --rate 500  # Set to 500Hz

# Profile C extensions
--extra-profiler-args --native

# Include threads
--extra-profiler-args --threads --idle

# Profile for specific duration
--extra-profiler-args --duration 10

# Include subprocesses
--extra-profiler-args --subprocesses
```

### Node.js (0x)

```bash
# Note: Sampling rate is NOT configurable - uses V8's default rate

# Kernel tracing (Linux)
--extra-profiler-args --kernel-tracing

# Wait for server ready
--extra-profiler-args --on-port 'curl localhost:3000'

# Generate additional output formats
--extra-profiler-args --output-html flamegraph.html
--extra-profiler-args --output-dir ./profiles

# Set title for the profile
--extra-profiler-args --name "Production Server"
```

### Ruby (rbspy)

```bash
# Default sampling rate is 999Hz, customize with:
--extra-profiler-args --rate 500  # Set to 500Hz

# Profile for specific duration
--extra-profiler-args --duration 30

# Non-blocking mode
--extra-profiler-args --nonblocking

# Include threads
--extra-profiler-args --with-subprocesses

# Fail silently if profiling fails
--extra-profiler-args --silent
```

### PHP (Excimer)

```bash
# Default sampling period is 0.001001001s (999Hz), customize with:
--extra-profiler-args --period 0.002  # Set to 0.002s (500Hz)

# Limit stack depth
--extra-profiler-args --max-depth 100

# Set maximum number of samples
--extra-profiler-args --max-samples 10000

# Enable memory profiling
--extra-profiler-args --memory
```

### JVM (async-profiler)

```bash
# Default sampling rate is 999Hz, customize with:
--extra-profiler-args --rate 500  # Set to 500Hz

# Profile all threads separately
--extra-profiler-args --threads

# Use simple class names
--extra-profiler-args --simple

# Include native methods
--extra-profiler-args -e cpu

# Profile heap allocations
--extra-profiler-args -e alloc

# Set stack depth
--extra-profiler-args -j 20

# Include kernel frames
--extra-profiler-args -k
```

### .NET (dotnet-trace)

```bash
# Note: Uses evented profiling (not statistical sampling) with EventPipe integration
# Output shows "Total events" and "Synthetic samples" instead of raw sample counts

# Profile for specific duration (30 seconds)
--extra-profiler-args --duration 00:00:30

# Increase buffer size for high-throughput applications
--extra-profiler-args --buffersize 512

# Use predefined profiles (default: cpu-sampling)
--extra-profiler-args --profile gc-verbose
--extra-profiler-args --profile gc-collect
--extra-profiler-args --profile cpu-sampling

# Custom event providers
--extra-profiler-args --providers Microsoft-Windows-DotNETRuntime
--extra-profiler-args --providers Microsoft-DotNETCore-SampleProfiler

# Set output format
--extra-profiler-args --format Chromium
--extra-profiler-args --format NetTrace

# Explicit platform specification for analysis (if auto-detection fails)
uniprof analyze profile.json --platform dotnet
```

### BEAM VM (Erlang/Elixir)

```bash
# Default sampling frequency is 999Hz, customize with:
--extra-profiler-args -F 500  # Set to 500Hz

# Note: Erlang/Elixir requires container mode on macOS
# The BEAM VM JIT integration is enabled automatically via ERL_FLAGS="+JPperf true"

# Sample every N events instead of frequency-based
--extra-profiler-args -c 10000

# Specify call graph mode (default: fp for frame pointers)
--extra-profiler-args --call-graph dwarf
--extra-profiler-args --call-graph lbr

# Include kernel symbols
--extra-profiler-args -k
```

### Native (perf on Linux)

```bash
# Default sampling frequency is 999Hz, customize with:
--extra-profiler-args -F 1000  # Set to 1000Hz

# Sample every N events
--extra-profiler-args -c 10000

# Profile specific thread
--extra-profiler-args -t 1234

# Different call graph mode
--extra-profiler-args --call-graph fp    # Frame pointers (default)
--extra-profiler-args --call-graph dwarf  # DWARF debug info
--extra-profiler-args --call-graph lbr    # Last Branch Record

# Include kernel symbols
--extra-profiler-args -k

# Profile specific events
--extra-profiler-args -e cpu-cycles
--extra-profiler-args -e cache-misses
--extra-profiler-args -e branch-misses

# Set stack dump size
--extra-profiler-args --call-graph dwarf,16384
```

### Native (Instruments on macOS)

```bash
# Note: Sampling rate is NOT configurable - uses system default

# Set recording duration
--extra-profiler-args --time-limit 30s
--extra-profiler-args --time-limit 2m

# Profile macOS app bundles
uniprof record -o profile.json -- /Applications/YourApp.app

# Attach to running process (requires process name or PID)
--extra-profiler-args --attach YourApp
--extra-profiler-args --attach 12345

# Set template (default: Time Profiler)
--extra-profiler-args --template "Time Profiler"
--extra-profiler-args --template "CPU Profiler"
```

## Analyze Filters

Fine-tune analysis output using these flags with `uniprof analyze` or when using aliases:

- `--threshold <percentage>`: Minimum percentage of total time to display a function. Default: `0.1` (%).
- `--filter-regex <pattern>`: Only include functions whose name or file location matches the JavaScript regex pattern. Example: `--filter-regex "MyApp\\."`.
- `--min-samples <count>`: Only include functions that appear in at least this many samples. Applies to synthetic samples for evented profiles as well.
- `--max-depth <depth>`: Limit call stack depth considered during analysis (keeps the leaf-most `<depth>` frames). Useful to focus on leaf hot spots.

Examples:

```bash
# Show hotspots with at least 5% of total time
uniprof analyze profile.json --threshold 5

# Focus on your app’s packages and ignore vendor code
uniprof analyze profile.json --filter-regex "^com\\.example\\.myapp"

# Hide infrequent frames
uniprof analyze profile.json --min-samples 100

# Focus on leaf hotspots only
uniprof analyze profile.json --max-depth 1
```

## Analyze Output Formats

The `analyze` command supports different output formats to suit various use cases:

- `--format <format>`: Choose output format. Options:
  - `pretty`: Human-readable table format with formatted columns (default for TTY)
  - `json`: Structured JSON output suitable for programmatic processing (default for non-TTY)

### Pretty Format (Default for TTY)

The default format when running in an interactive terminal displays results in a formatted table:
- Functions are sorted by CPU time percentage
- Long function names and file paths are truncated to fit column widths
- Color coding highlights hot functions (red >10%, yellow >5%)
- Shows number of samples (per frame), percentages, and timing information

### JSON Format (Default for Non-TTY, Pipes, and Automation)

When running in non-interactive environments or when explicitly specified, outputs structured JSON:

```bash
# Explicitly request JSON output
uniprof analyze profile.json --format json

# Pipe to other tools (automatically uses JSON format)
uniprof analyze profile.json | jq '.hotspots[] | select(.percentage > 5)'

# Use with record --analyze
uniprof record --analyze --format json -- python app.py

# In CI/CD pipelines (non-TTY, defaults to JSON)
uniprof analyze profile.json > results.json
```

JSON output structure:
```json
{
  "summary": {
    "totalSamples": 1234,
    "totalTime": 5000,
    "unit": "milliseconds",
    "profileName": "MyApp",
    "profiler": "py-spy",
    "threadCount": 4,
    "profileType": "sampled"
  },
  "hotspots": [
    {
      "name": "process_data",
      "file": "app.py",
      "line": 42,
      "percentage": 25.5,
      "total": 1275,
      "self": 800,
      "samples": 255,
      "percentiles": {
        "p50": 4.5,
        "p90": 6.2,
        "p99": 8.1
      }
    }
  ]
}
```

**Important Notes for JSON Format:**
- No progress messages or status updates are printed to stdout
- Only valid JSON is written to stdout
- Errors are written to stderr to keep stdout clean
- Ideal for integration with other tools and automated workflows

## Environment Variables

When running in container mode, you can set environment variables that will be passed to the container:

```bash
# Set environment variables for the profiled application
MYAPP_CONFIG=production uniprof record -o profile.json -- python app.py

# The variables are automatically passed to the container
```
