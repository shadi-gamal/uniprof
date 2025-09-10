# .NET Profiling (C#/F#/VB.NET)

`uniprof` supports profiling .NET applications using dotnet-trace, Microsoft's cross-platform .NET profiler. It provides detailed profiling with EventPipe integration for modern .NET applications.

## How It Works

dotnet-trace uses .NET's built-in EventPipe technology to collect performance data:
- **EventPipe**: Cross-platform .NET event collection mechanism
- **ETW Integration**: Windows Event Tracing for Windows (ETW) when available
- **CLR Events**: Common Language Runtime event collection
- **Speedscope Format**: Direct export to speedscope format for analysis

`uniprof` automatically handles different .NET application types (.dll, .exe, .cs files) and transforms commands to proper dotnet-trace invocations.

### Profiler Details
- **Tool**: dotnet-trace (latest version)
- **Output Format**: Speedscope JSON (natively supported)
- **Sampling**: EventPipe-based collection (not configurable sampling rate)
- **Event Types**: CPU sampling, GC events, runtime events
- **Command Transformation**: Automatic conversion of file types to appropriate dotnet commands

## Requirements

- **.NET SDK**: .NET 5 or later (newer recommended)
- **Docker**: For container mode (recommended)
- **dotnet-trace**: Installed globally (for host mode)

## Usage Examples

### Basic .NET Applications

```bash
# Profile a compiled DLL
uniprof record -o profile.json -- dotnet MyApp.dll

# Profile a C# source file directly
uniprof record -o profile.json -- MyProgram.cs

# Profile a .NET executable
uniprof record -o profile.json -- ./MyApp.exe

# Profile with arguments
uniprof record -o profile.json -- dotnet MyApp.dll --verbose --config=production
```

### Direct File Profiling

```bash
# Profile DLL file directly (automatically converted to dotnet command)
uniprof record -o profile.json -- MyApp.dll

# Profile executable directly
uniprof record -o profile.json -- MyApp.exe

# Profile C# source directly (automatically uses dotnet run)
uniprof record -o profile.json -- Program.cs
```

### Console Applications

```bash
# Profile simple console app
uniprof record -o profile.json -- dotnet run

# Profile with project file
uniprof record -o profile.json -- dotnet run --project MyConsoleApp.csproj

# Profile from specific directory
cd MyProject && uniprof record -o profile.json -- dotnet run
```

### ASP.NET Core Applications

```bash
# Profile ASP.NET Core application
uniprof record -o profile.json -- dotnet run --project MyWebApp.csproj

# Profile with specific environment
uniprof record -o profile.json -- dotnet run --environment Production

# Profile published application
uniprof record -o profile.json -- dotnet MyWebApp.dll --urls=http://localhost:5000
```

### Worker Services and Background Services

```bash
# Profile worker service
uniprof record -o profile.json -- dotnet MyWorker.dll

# Profile with configuration
uniprof record -o profile.json -- dotnet MyWorker.dll --config appsettings.production.json
```

### F# Applications

```bash
# Profile F# application (compiled to DLL)
uniprof record -o profile.json -- dotnet MyFSharpApp.dll

# Profile F# script (not directly supported, compile first)
dotnet build MyFSharpApp.fsproj
uniprof record -o profile.json -- dotnet bin/Debug/net9.0/MyFSharpApp.dll
```

### VB.NET Applications

```bash
# Profile VB.NET application (compiled to DLL)
uniprof record -o profile.json -- dotnet MyVBApp.dll
```

## Profiling Modes

### Container Mode (Default)

Container mode is the default and recommended approach. It works on all platforms:

```bash
# Explicitly use container mode (default)
uniprof record --mode container -o profile.json -- dotnet MyApp.dll
```

**Advantages:**
- Works on macOS, Linux, and Windows (WSL2)
- No local setup required
- Consistent .NET 9.0 environment
- Includes dotnet-trace pre-installed
- Automatic package restoration

### Host Mode

Host mode uses your system's .NET installation and dotnet-trace:

```bash
# Use host mode
uniprof record --mode host -o profile.json -- dotnet MyApp.dll
```

**Requirements:**
- .NET SDK 6.0+ installed
- dotnet-trace installed globally: `dotnet tool install --global dotnet-trace`
- PATH configured to include ~/.dotnet/tools

## Advanced Options

### Custom Collection Duration

```bash
# Profile for specific duration (30 seconds)
uniprof record -o profile.json --extra-profiler-args "--duration 00:00:30" -- dotnet MyApp.dll
```

### Custom Buffer Size

```bash
# Increase buffer size for high-throughput applications
uniprof record -o profile.json --extra-profiler-args "--buffersize 512" -- dotnet MyApp.dll
```

### Custom Event Providers

```bash
# Profile with specific providers
uniprof record -o profile.json --extra-profiler-args "--providers Microsoft-Windows-DotNETRuntime" -- dotnet MyApp.dll

# Use predefined profiles
uniprof record -o profile.json --extra-profiler-args "--profile gc-verbose" -- dotnet MyApp.dll
```

### Verbose CLR Events

```bash
# Collect detailed CLR events
uniprof record -o profile.json --extra-profiler-args "--clreventlevel verbose --clrevents gc+gchandle+loader" -- dotnet MyApp.dll
```

### Combine Multiple Options

```bash
# Extended profiling with custom providers and buffer size
uniprof record -o profile.json --extra-profiler-args "--duration 00:01:00 --buffersize 256 --profile cpu-sampling" -- dotnet MyApp.dll
```

## Command Transformation

`uniprof` automatically transforms different file types to proper .NET commands:

### C# Source Files (.cs)
```bash
# Input command
Program.cs

# Transformed to
dotnet run Program.cs
```

### DLL Files (.dll)
```bash
# Input command  
MyApp.dll

# Transformed to
dotnet MyApp.dll
```

### Executable Files (.exe)
```bash
# Input command
MyApp.exe

# Run directly (self-contained .NET executables do not use the dotnet launcher)
MyApp.exe
```

### .NET Executable Detection

`uniprof` can automatically detect .NET executables (without extensions) by checking for:
- .NET runtime signatures in the binary
- Sidecar files (.dll, .runtimeconfig.json, .deps.json)
- Shim scripts that reference dotnet

## Predefined Profiling Profiles

dotnet-trace includes several predefined profiles:

### CPU Sampling (Default)
```bash
uniprof record -o profile.json --extra-profiler-args "--profile cpu-sampling" -- dotnet MyApp.dll
```

### Garbage Collection
```bash
# Detailed GC profiling
uniprof record -o profile.json --extra-profiler-args "--profile gc-verbose" -- dotnet MyApp.dll

# GC collection events only
uniprof record -o profile.json --extra-profiler-args "--profile gc-collect" -- dotnet MyApp.dll
```

## Troubleshooting

### Profile Contains No Data
**Problem**: Profile file is created but contains no samples.

**Solution**: Ensure the application runs long enough to be profiled:
```csharp
// Add delay for profiling
await Task.Delay(TimeSpan.FromSeconds(1));
// Actual workload here
```

### dotnet-trace Not Found (Host Mode)
**Problem**: "dotnet-trace is not installed"

**Solution**: Install dotnet-trace globally:
```bash
# Install dotnet-trace
dotnet tool install --global dotnet-trace

# Verify installation
dotnet-trace --version

# Update PATH if needed
export PATH="$PATH:$HOME/.dotnet/tools"
```

### Incomplete Profiles
**Problem**: Profile seems truncated or incomplete.

**Solution**: Increase buffer size or reduce event collection:
```bash
# Increase buffer size
uniprof record -o profile.json --extra-profiler-args "--buffersize 1024" -- dotnet MyApp.dll

# Use minimal event collection
uniprof record -o profile.json --extra-profiler-args "--profile cpu-sampling" -- dotnet MyApp.dll
```

### Memory Issues
**Problem**: High memory usage during profiling.

**Solution**: Reduce profiling scope:
```bash
# Shorter duration
uniprof record -o profile.json --extra-profiler-args "--duration 00:00:10" -- dotnet MyApp.dll

# Smaller buffer
uniprof record -o profile.json --extra-profiler-args "--buffersize 128" -- dotnet MyApp.dll
```

### Permission Issues (Linux)
**Problem**: Cannot collect ETW events or detailed runtime information.

**Solution**: Run with appropriate permissions or use container mode:
```bash
# Use container mode (recommended)
uniprof record --mode container -o profile.json -- dotnet MyApp.dll

# Or run with elevated permissions (host mode)
sudo uniprof record --mode host -o profile.json -- dotnet MyApp.dll
```

## Performance Considerations

1. **EventPipe Overhead**: Minimal overhead for CPU profiling (~1-3%). GC profiling has higher overhead.

2. **Buffer Size**: Larger buffers reduce event loss but increase memory usage. Default 256MB is suitable for most applications.

3. **Event Filtering**: Use specific event providers to reduce overhead:
   ```bash
   # CPU profiling only (lowest overhead)
   uniprof record -o profile.json --extra-profiler-args "--profile cpu-sampling" -- dotnet MyApp.dll
   ```

4. **JIT Warmup**: .NET needs time for JIT compilation. Profile after warmup:
   ```csharp
   // Warmup period
   for (int i = 0; i < 1000; i++) {
       DoWork(); // Exercise code paths
   }
   // Start actual workload
   ```

5. **AOT Applications**: Ahead-of-Time compiled applications (Native AOT) provide more consistent performance but may have different profiling characteristics.

## File Type Support

### Supported Extensions
- **.cs**: C# source files (uses `dotnet run`)
- **.dll**: .NET assemblies (uses `dotnet <file>`)
- **.exe**: .NET executables (uses `dotnet <file>`)

### Supported Commands
- **dotnet**: All dotnet CLI commands
- **.NET executables**: Automatically detected based on binary content and sidecar files

### Project Files
While .csproj, .fsproj, and .vbproj files are not directly supported for command detection, you can profile them:
```bash
# Profile project file
uniprof record -o profile.json -- dotnet run --project MyApp.csproj
```

## Container Environment

The .NET container includes:
- **.NET SDK 9.0**: Latest .NET version
- **ASP.NET Core Runtime 9.0**: For web applications
- **dotnet-trace**: Latest version pre-installed
- **NuGet Package Cache**: Persistent package caching

Container configuration handles:
- Automatic package restoration
- Multi-architecture support (x64/arm64)
- Consistent runtime environment

## Limitations

1. **Sampling Rate**: Unlike some profilers, dotnet-trace doesn't expose configurable sampling rates. It uses EventPipe's built-in collection mechanisms.

2. **Native Code**: Limited visibility into native P/Invoke calls and unmanaged code.

3. **Source Files**: Only C# source files (.cs) are supported for direct profiling. F# and VB.NET require compilation first.

4. **Real-time Analysis**: dotnet-trace collects data during execution; real-time analysis requires separate tools.

5. **Event Loss**: High-frequency applications may experience event loss if buffer size is insufficient.

## See Also

- [dotnet-trace Documentation](https://docs.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-trace)
- [EventPipe Overview](https://docs.microsoft.com/en-us/dotnet/core/diagnostics/eventpipe)
- [.NET Performance Profiling](https://docs.microsoft.com/en-us/dotnet/core/diagnostics/)
- [Speedscope](https://speedscope.app) - Profile visualization tool
