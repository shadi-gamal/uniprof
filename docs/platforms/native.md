# Native Profiling Plugin

The native profiling plugin provides CPU profiling for compiled executables (C, C++, Rust, Go, etc.) on Linux and macOS. It automatically selects the appropriate system profiler: `perf` on Linux and Instruments on macOS.

## Overview

Native profiling works by periodically sampling the call stack of running processes to build a statistical picture of CPU usage. The plugin handles all platform differences and converts the results into a common format (Speedscope JSON) for visualization.

Key features:
- Automatic platform detection and tool selection
- Container support for consistent Linux environments
- Binary validation and dependency checking
- Debug symbol detection for accurate function names

## Platform Support

### Linux
Uses the kernel's `perf` tool with automatic call graph mode selection:
- DWARF unwinding when debug symbols are available (most accurate)
- Frame pointer unwinding as fallback (lower overhead)
- Default sampling rate is 999 Hz
- Supports x86, x86_64, ARM, AArch64, and RISC-V architectures

### macOS
Uses Instruments (`xctrace`) with the Time Profiler template. Requires Xcode Command Line Tools but no special permissions. Supports both Intel and Apple Silicon.

### Windows
Not directly supported. Use WSL2 or run profiling in a Linux container.

## Basic Usage

### Linux
```bash
# Basic profiling
uniprof record -o profile.json -- ./myapp

# With custom sampling frequency
uniprof record -o profile.json --extra-profiler-args "-F 2000" -- ./myapp

# Profile specific thread
uniprof record -o profile.json --extra-profiler-args "-t 1234" -- ./myapp
```

### macOS
```bash
# Basic profiling
uniprof record -o profile.json -- ./myapp

# With time limit
uniprof record -o profile.json --extra-profiler-args "--time-limit 30s" -- ./myapp
```

## Environment Setup

### Linux Requirements

**Install perf:**
- Ubuntu/Debian: `sudo apt-get install linux-tools-common linux-tools-generic`
- RHEL/Fedora: `sudo dnf install perf`
- Arch: `sudo pacman -S perf`

**Adjust kernel permissions if needed:**
```bash
# Check current setting
cat /proc/sys/kernel/perf_event_paranoid

# If > 1, temporarily allow profiling
echo 1 | sudo tee /proc/sys/kernel/perf_event_paranoid
```

### macOS Requirements

Install Xcode Command Line Tools:
```bash
xcode-select --install
```

## Binary Preparation

For best results, compile with debug information:

**C/C++:** Add `-g` flag
```bash
gcc -g -O2 myapp.c -o myapp
```

**Rust:** Enable debug info in release builds
```toml
[profile.release]
debug = true
```

**Go:** Debug info included by default

On Linux, the profiler automatically selects the best unwinding method:
- **With DWARF debug info**: Uses DWARF unwinding for accurate call stacks
- **Without DWARF**: Falls back to frame pointer unwinding

For frame pointer unwinding to work without DWARF, compile with:
```bash
gcc -O2 -fno-omit-frame-pointer myapp.c -o myapp
```

For best results, include both debug info and frame pointers:
```bash
gcc -g -O2 -fno-omit-frame-pointer myapp.c -o myapp
```

## Container Support

The plugin can run Linux profiling inside Docker containers for consistency across environments. This is particularly useful when profiling on macOS or when system configuration is restricted.

The container image (`ghcr.io/indragiek/uniprof-native:latest`) includes:
- Linux kernel 6.16 perf with full feature support
- Symbol resolution tools (binutils, elfutils)
- Development toolchain for binary inspection
- Automatic kernel parameter configuration

Binary paths are automatically translated between host and container using virtiofs mounts. The plugin creates symlinks to ensure perf can correctly resolve symbols for binaries accessed through the mount.

Architecture must match between binary and container. The plugin validates compatibility before profiling.

## Data Processing

The plugin transforms platform-specific profiler output into Speedscope format:

1. **Collection**: Raw profiler data captured to temporary files
2. **Parsing**: Platform-specific formats parsed into structured events
3. **Deduplication**: Unique frames stored in shared table
4. **Output**: Speedscope JSON with per-thread profiles

Multi-threaded applications produce separate profiles for each thread, labeled with process name and thread IDs.

## Common Issues

### Permission Denied (Linux)

The kernel restricts performance counter access. Solutions:
- Run with sudo: `sudo uniprof record ...`
- Adjust kernel setting: `echo 1 | sudo tee /proc/sys/kernel/perf_event_paranoid`
- Use container profiling which handles permissions

### Missing Symbols

Profiles showing `[unknown]` indicate missing debug information:
- Ensure binaries compiled with `-g`
- Install debug packages for system libraries
- Check binary isn't stripped

### No Samples Collected

Program may be exiting too quickly or not using CPU:
- Increase sampling rate with `-F` option
- Ensure program runs long enough (>1 second)
- Verify program is CPU-bound during profiling

### Container Architecture Mismatch

Binary and container must have compatible architectures:
- Use `file myapp` to check binary architecture
- x86 binaries work on x86_64 containers
- Other combinations will fail with clear error

## Performance Impact

Default settings add 1-5% overhead to running programs. Factors affecting overhead:
- **Sampling rate**: Higher rates increase overhead
- **Stack unwinding**: DWARF is accurate but slower than frame pointers
- **Thread count**: More threads mean more data collection

Profile size typically 1-10 MB per minute at default settings.

## Advanced Configuration

### Linux perf Options

Pass additional options via `--extra-profiler-args`:
- `-F <freq>`: Sampling frequency in Hz (default: 999)
- `-c <count>`: Sample every N events instead of time-based
- `--call-graph <mode>`: Override automatic call graph mode selection
  - `dwarf`: Force DWARF unwinding (requires debug symbols)
  - `fp`: Force frame pointer unwinding  
  - `lbr`: Use Last Branch Record (Intel CPUs only)
- `-t <tid>`: Profile specific thread ID only
- `-C <cpu>`: Profile specific CPU only

### macOS Instruments Options

**Note**: The sampling rate for Instruments/xctrace is NOT configurable. It uses the system's default sampling rate.

- `--time-limit <duration>`: Set recording duration (e.g., "30s", "2m")

## Implementation Notes

The plugin validates binaries before profiling, checking:
- Format (ELF/Mach-O)
- Architecture compatibility
- Debug symbol availability (DWARF sections)
- Dynamic library dependencies

This validation determines the optimal profiling configuration and prevents common runtime failures.

### Container Profiling

When running in container mode, the plugin:
1. Copies the binary to the workspace directory for consistent access
2. Creates virtiofs symlinks to match perf's recorded paths
3. Configures kernel parameters for optimal profiling:
   - `perf_event_paranoid=-1` (allow all event access)
   - `perf_event_mlock_kb=4096` (increase mlock limit)
   - `kptr_restrict=0` (enable kernel pointer visibility)

### Data Processing

Temporary files are created in system temp directories and cleaned up automatically. The ProfileContext tracks all temporary resources for reliable cleanup even on interruption.

Frame deduplication significantly reduces output size. Each unique function/file combination appears once in the frame table, with stack traces referencing frames by index.

## Best Practices

**Profile representative workloads** that exercise the code you want to optimize. Avoid including startup/shutdown unless specifically needed.

**Run for at least 10 seconds** to ensure statistical validity. Longer runs produce more reliable results.

**Focus on relative differences** when comparing profiles. Exact percentages are estimates based on sampling.

**Consider the full call stack** when analyzing hot functions. Sometimes the issue is excessive calls rather than slow functions.

**Use consistent environments** when comparing performance. Container profiling helps ensure reproducibility.