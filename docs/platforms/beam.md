# BEAM VM Profiling (Erlang/Elixir)

`uniprof` supports profiling BEAM VM applications (Erlang and Elixir) using Linux perf with JIT integration. This provides accurate stack traces for the BEAM VM's JIT-compiled code.

## How It Works

The Erlang VM (BEAM) includes JIT compilation support starting from OTP 24. When enabled with the `+JPperf true` flag, the VM emits metadata that allows Linux perf to correctly symbolize JIT-compiled functions. `uniprof` automatically sets this flag when profiling Erlang/Elixir applications.

### Profiler Details
- **Tool**: Linux perf
- **Sampling Rate**: 999 Hz (default)
- **Call Graph**: Frame pointers (`--call-graph=fp`)
- **JIT Support**: Enabled via `ERL_FLAGS="+JPperf true"`

## Requirements

- **Erlang/OTP**: Version 24 or later (for JIT support)
- **Elixir**: Version 1.12 or later (optional)
- **Linux**: For host profiling (macOS users must use container mode)
- **Docker**: For container mode (recommended)

## Usage Examples

### Basic Elixir Script
```bash
# Profile an Elixir script
uniprof record -o profile.json -- elixir my_script.exs
```

### Mix Application
```bash
# Profile a Mix application
uniprof record -o profile.json -- mix run --no-halt

# Profile Mix tests
uniprof record -o profile.json -- mix test

# Profile Phoenix server
uniprof record -o profile.json -- mix phx.server
```

### Erlang Applications
```bash
# Profile an escript
uniprof record -o profile.json -- escript my_script.erl

# Profile an Erlang module
uniprof record -o profile.json -- erl -noshell -s my_module start -s init stop

# Profile with rebar3
uniprof record -o profile.json -- rebar3 shell
```

### Interactive Elixir (IEx)
```bash
# Profile an IEx session (requires manual termination)
uniprof record -o profile.json -- iex -S mix
```

### Gleam Support
```bash
# Profile a Gleam application (compiles to Erlang)
uniprof record -o profile.json -- gleam run
```

## Profiling Modes

### Container Mode (Default)
Container mode is the default and recommended approach. It works on all platforms:

```bash
# Explicitly use container mode (default)
uniprof record --mode container -o profile.json -- elixir script.exs
```

**Advantages:**
- Works on macOS, Linux, and Windows (WSL2)
- No local setup required
- Consistent environment
- Automatic dependency installation

### Host Mode
Host mode uses your system's perf installation. Only available on Linux:

```bash
# Use host mode (Linux only)
uniprof record --mode host -o profile.json -- elixir script.exs
```

**Requirements:**
- Linux operating system
- perf installed (`apt-get install linux-tools-generic`)
- Appropriate kernel permissions

**Note**: Host mode is not supported on macOS. Use container mode instead.

## Advanced Options

### Custom Sampling Rate
The default sampling rate is 999Hz. You can customize it:

```bash
# Reduce to 500Hz for lower overhead
uniprof record -o profile.json --extra-profiler-args "-F 500" -- elixir script.exs

# Increase to 2000Hz for more detail  
uniprof record -o profile.json --extra-profiler-args "-F 2000" -- erl -noshell -s mymodule start
```

### Profile Specific Process
```bash
# Profile only a specific thread/process ID
uniprof record -o profile.json --extra-profiler-args "-t 12345" -- mix run --no-halt
```

## Troubleshooting

### No Symbols in Profile
**Problem**: Profile shows addresses instead of function names.

**Solution**: Ensure you're using OTP 24+ and the JIT is enabled:
```bash
# Check Erlang version
erl -eval 'io:format("~s~n", [erlang:system_info(otp_release)]), halt().' -noshell

# Check JIT status
erl -eval 'io:format("JIT: ~p~n", [erlang:system_info(jit)]), halt().' -noshell
```

### macOS Host Mode Error
**Problem**: "Host mode is not supported on macOS for Erlang/Elixir profiling"

**Solution**: Use container mode (default):
```bash
# Don't use --mode host on macOS
uniprof record -o profile.json -- elixir script.exs
```

### Permission Denied (Host Mode)
**Problem**: "Permission denied" or "Operation not permitted" errors.

**Solution**: Check kernel settings:
```bash
# Check perf_event_paranoid level
cat /proc/sys/kernel/perf_event_paranoid

# Temporarily allow profiling (requires sudo)
echo 1 | sudo tee /proc/sys/kernel/perf_event_paranoid
```

### Container Build Issues
**Problem**: Container fails to build or run.

**Solution**: Ensure Docker is running and you have the latest image:
```bash
# Pull the latest image
docker pull ghcr.io/indragiek/uniprof-erlang:latest

# Or rebuild locally
docker build -t ghcr.io/indragiek/uniprof-erlang:latest containers/erlang/
```

## Performance Considerations

1. **JIT Warmup**: The Erlang JIT needs time to compile hot code paths. Profile longer-running applications for more accurate results.

2. **Frame Pointers**: The profiler uses frame pointers (`--call-graph=fp`) which has minimal overhead but may miss some stack frames in highly optimized code.

3. **Sampling Rate**: The default 999Hz rate provides good accuracy with low overhead. Increase for short-lived processes or decrease for long-running applications.

4. **Memory Usage**: Profiling data is kept in memory during recording. For long sessions, consider periodic profiling instead of continuous.

## Integration with Build Tools

### Mix Projects
For Mix projects, `uniprof` automatically detects and handles dependencies:
- In container mode: runs `mix deps.get` and `mix compile`
- In host mode: uses existing compiled artifacts

### Rebar3 Projects
For Rebar3 projects:
- In container mode: runs `rebar3 get-deps` and `rebar3 compile`
- In host mode: uses existing `_build` directory

### Environment Variables
The `ERL_FLAGS="+JPperf true"` environment variable is automatically set. You can add additional flags:

```bash
# Add custom ERL_FLAGS
ERL_FLAGS="+JPperf true +S 4" uniprof record -o profile.json -- elixir script.exs
```

## Limitations

1. **JIT-only Profiling**: Only JIT-compiled code is profiled accurately. Interpreted code may show incomplete stack traces.

2. **macOS Restrictions**: Native Erlang profiling requires Linux perf, so macOS users must use container mode.

3. **NIF Functions**: Native Implemented Functions (NIFs) written in C/C++ will appear in profiles but may lack detailed symbol information unless compiled with debug symbols.

4. **BIF Functions**: Built-in functions are shown but internal implementation details are not exposed.

## See Also

- [Erlang JIT Documentation](https://www.erlang.org/doc/system/jit.html)
- [Linux perf Documentation](https://perf.wiki.kernel.org/)
- [Elixir Performance Guide](https://hexdocs.pm/elixir/performance.html)
