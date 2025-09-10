# JVM Profiling (Java/Kotlin/Scala)

`uniprof` supports profiling JVM applications using async-profiler, a low-overhead sampling profiler for Java and other JVM languages. It provides accurate CPU profiling with minimal performance impact.

## How It Works

async-profiler uses a combination of technologies to provide accurate profiling:
- **AsyncGetCallTrace**: JVM-specific API for sampling Java stacks
- **perf_events**: Linux kernel interface for hardware performance counters
- **Frame Pointer Walking**: For native code profiling
- **JVMTI**: JVM Tool Interface for additional metadata

`uniprof` automatically injects async-profiler as a Java agent when profiling JVM applications, handling the complexity of different command types (java, gradlew, mvnw).

### Profiler Details
- **Tool**: async-profiler 4.1
- **Output Format**: Brendan Gregg's collapsed flamegraph format (converted to Speedscope)
- **Sampling Rate**: 999 Hz (default)
- **Event Type**: CPU cycles
- **Agent Injection**: Via `-agentpath` for java, `-Dorg.gradle.jvmargs` for Gradle, `MAVEN_OPTS` for Maven

## Requirements

- **Java**: OpenJDK 8 or later
- **Docker**: For container mode (recommended)
- **Linux**: For host profiling (macOS users must use container mode)
- **Build Tools**: Gradle or Maven (optional, for build tool integration)

## Usage Examples

### Basic Java Application
```bash
# Profile a JAR file
uniprof record -o profile.json -- java -jar myapp.jar

# Profile a Java class
uniprof record -o profile.json -- java com.example.Main

# Profile with classpath
uniprof record -o profile.json -- java -cp "lib/*:classes" com.example.Main
```

### JAR Files Directly
```bash
# Profile a JAR file directly (if executable)
uniprof record -o profile.json -- ./myapp.jar

# Profile with absolute path
uniprof record -o profile.json -- /path/to/myapp.jar
```

### Gradle Projects
```bash
# Profile Gradle application run
uniprof record -o profile.json -- ./gradlew run

# Profile Gradle tests
uniprof record -o profile.json -- ./gradlew test

# Profile Spring Boot application
uniprof record -o profile.json -- ./gradlew bootRun

# Profile with specific tasks
uniprof record -o profile.json -- ./gradlew clean build integrationTest
```

### Maven Projects
```bash
# Profile Maven application
uniprof record -o profile.json -- ./mvnw spring-boot:run

# Profile Maven tests
uniprof record -o profile.json -- ./mvnw test

# Profile with specific goals
uniprof record -o profile.json -- ./mvnw clean compile exec:java
```

### Kotlin Applications
```bash
# Profile Kotlin application (compiled to JAR)
uniprof record -o profile.json -- java -jar myapp.jar

# Profile with Gradle
uniprof record -o profile.json -- ./gradlew run
```

### Scala Applications
```bash
# Profile Scala application (compiled to JAR)
uniprof record -o profile.json -- java -jar myapp.jar

# Profile with sbt (not directly supported, compile to JAR first)
sbt assembly
uniprof record -o profile.json -- java -jar target/scala-2.13/myapp-assembly.jar
```

## Profiling Modes

### Container Mode (Default)
Container mode is the default and recommended approach. It works on all platforms:

```bash
# Explicitly use container mode (default)
uniprof record --mode container -o profile.json -- java -jar myapp.jar
```

**Advantages:**
- Works on macOS, Linux, and Windows (WSL2)
- No local setup required
- Consistent OpenJDK 24 environment
- Includes Maven and Gradle
- Automatic async-profiler configuration

### Host Mode
Host mode uses your system's Java installation and async-profiler. Only available on Linux:

```bash
# Use host mode (Linux only)
uniprof record --mode host -o profile.json -- java -jar myapp.jar
```

**Requirements:**
- Linux operating system
- Java 8+ installed
- async-profiler installed and in PATH
- Appropriate kernel permissions for perf_events

**Note**: Host mode is not supported on macOS due to async-profiler's dependency on Linux perf_events.

## Advanced Options

### Custom Sampling Rate
```bash
# Profile at 500Hz instead of default 999Hz
uniprof record -o profile.json --extra-profiler-args "--interval 2000000" -- java -jar myapp.jar

# Increase to 2000Hz for more detail
uniprof record -o profile.json --extra-profiler-args "--interval 500000" -- java -jar myapp.jar
```

## Async-profiler Flags Under Uniprof

Uniprof injects the async-profiler agent into your JVM process. It supports a subset of long-form flags which are converted to agent options:

- Provide sampling interval explicitly: `--interval <ns>` (e.g., 1,001,001 ns ≈ 999 Hz)
- `--duration <sec>` → `duration=<sec>`
- `--threads`, `--simple`, `--sig`, `--lib`, `--total`, `--ann`

Notes:
- Short flags like `-e`, `-j`, or `-k` are not recognized by uniprof’s converter; please use the long-form equivalents above where applicable.
- The sampling interval defaults to ~999 Hz when not provided.

### Profile All Threads Separately
```bash
# Generate separate profiles for each thread
uniprof record -o profile.json --extra-profiler-args "--threads" -- java -jar myapp.jar
```

### Use Simple Class Names
```bash
# Show simple class names without packages
uniprof record -o profile.json --extra-profiler-args "--simple" -- java -jar myapp.jar
```

### Combine Multiple Options
```bash
# High-frequency sampling with simple names
uniprof record -o profile.json --extra-profiler-args "--interval 2000000 --simple" -- java -jar myapp.jar
```

## Agent Injection Methods

`uniprof` automatically handles agent injection differently based on the command type:

### Direct Java Command
For `java` commands, the agent is injected via `-agentpath`:
```bash
# uniprof automatically adds:
# -agentpath:/path/to/libasyncProfiler.so=start,event=cpu,...
java -jar myapp.jar
```

### Gradle Wrapper
For `./gradlew` commands, the agent is injected via JVM arguments:
```bash
# uniprof automatically adds:
# -Dorg.gradle.jvmargs="-agentpath:/path/to/libasyncProfiler.so=..."
./gradlew run
```

### Maven Wrapper
For `./mvnw` commands, the agent is injected via environment variable:
```bash
# uniprof automatically sets:
# MAVEN_OPTS="-agentpath:/path/to/libasyncProfiler.so=..."
./mvnw spring-boot:run
```

## Troubleshooting

### No Symbols in Profile
**Problem**: Profile shows memory addresses instead of method names.

**Solution**: Ensure debug symbols are available:
```bash
# For Gradle projects, enable debug info
./gradlew build -Dorg.gradle.daemon.debug=true

# For Maven projects
./mvnw compile -Dmaven.compiler.debug=true
```

### macOS Host Mode Error
**Problem**: "Host mode is not supported on macOS for JVM profiling"

**Solution**: Use container mode (default):
```bash
# Don't use --mode host on macOS
uniprof record -o profile.json -- java -jar myapp.jar
```

### Permission Denied (Host Mode)
**Problem**: "Failed to initialize perf events" or permission errors.

**Solution**: Check kernel settings:
```bash
# Check perf_event_paranoid level
cat /proc/sys/kernel/perf_event_paranoid

# Temporarily allow profiling (requires sudo)
echo 1 | sudo tee /proc/sys/kernel/perf_event_paranoid
```

### High Memory Usage
**Problem**: Application uses excessive memory during profiling.

**Solution**: Reduce sampling rate or profile duration:
```bash
# Lower sampling rate
uniprof record -o profile.json --extra-profiler-args "--interval 100000000" -- java -jar myapp.jar

# Profile for specific duration (in app code)
```

### Gradle Daemon Issues
**Problem**: Gradle daemon interferes with profiling.

**Solution**: Disable the daemon for profiling:
```bash
# Disable Gradle daemon
uniprof record -o profile.json -- ./gradlew run --no-daemon
```

### Missing Gradle/Maven Wrapper
**Problem**: "gradlew not found" or "mvnw not found"

**Solution**: Use direct commands (without wrapper) or generate wrapper:
```bash
# Generate Gradle wrapper
gradle wrapper

# Generate Maven wrapper
mvn wrapper:wrapper

# Or use java directly
uniprof record -o profile.json -- java -cp build/libs/myapp.jar com.example.Main
```

## Performance Considerations

1. **Sampling Overhead**: Default 999Hz sampling has minimal overhead (~1-2%). Higher rates increase overhead proportionally.

2. **Warmup Time**: JVM needs time for JIT compilation. Profile after warmup for production-representative results:
   ```java
   // Wait for JIT warmup
   Thread.sleep(10000); // 10 seconds
   // Start actual workload
   ```

3. **Memory Profiling**: async-profiler supports allocation profiling with different overhead characteristics:
   ```bash
   # Profile allocations (higher overhead)
   uniprof record -o profile.json --extra-profiler-args "--event alloc" -- java -jar myapp.jar
   ```

4. **Safe Points**: async-profiler avoids safe-point bias that affects some JVM profilers, providing more accurate results.

## Integration with Build Tools

### Gradle Configuration
For Gradle projects, `uniprof` handles:
- Wrapper script detection (`./gradlew`)
- JVM argument injection
- Multi-module projects

Example `build.gradle` optimization for profiling:
```gradle
tasks.withType(JavaCompile) {
    options.debug = true
    options.compilerArgs += ['-g:lines,vars,source']
}
```

### Maven Configuration
For Maven projects, `uniprof` handles:
- Wrapper script detection (`./mvnw`)
- Environment variable injection
- Multi-module projects

Example `pom.xml` optimization for profiling:
```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-compiler-plugin</artifactId>
    <configuration>
        <debug>true</debug>
        <debuglevel>lines,vars,source</debuglevel>
    </configuration>
</plugin>
```

### Direct Gradle/Maven Commands
Note that direct `gradle` and `mvn` commands (without wrappers) are **not** supported:
```bash
# NOT SUPPORTED
uniprof record -o profile.json -- gradle run
uniprof record -o profile.json -- mvn exec:java

# Use wrappers instead
uniprof record -o profile.json -- ./gradlew run
uniprof record -o profile.json -- ./mvnw exec:java
```

## Container Environment

The JVM container includes:
- **OpenJDK 24.0.2**: Latest LTS Java version
- **Maven**: Latest version via SDKMAN
- **Gradle**: Latest version via SDKMAN
- **async-profiler 4.1**: Low-overhead JVM profiler

Container configuration handles:
- Architecture-specific async-profiler binaries (x64/arm64)
- Kernel parameter configuration for perf_events
- Automatic dependency resolution

## Limitations

1. **macOS Restrictions**: async-profiler requires Linux perf_events, so macOS users must use container mode.

2. **Wrapper Scripts Only**: Only `./gradlew` and `./mvnw` wrapper scripts are supported, not direct `gradle`/`mvn` commands.

3. **Native Methods**: JNI native methods appear in profiles but may lack detailed symbol information unless compiled with debug symbols.

4. **Dynamic Languages**: JVM dynamic languages (Groovy, Clojure) may show generated method names that are less readable.

5. **Inlined Methods**: Aggressively inlined methods may not appear in profiles. Use `-XX:-Inline` to disable inlining if needed (with performance impact).

## See Also

- [async-profiler Documentation](https://github.com/async-profiler/async-profiler)
- [JVM Profiling Guide](https://www.oracle.com/technical-resources/articles/java/architect-benchmarking.html)
- [Gradle Performance Guide](https://docs.gradle.org/current/userguide/performance.html)
- [Maven Performance Tips](https://maven.apache.org/guides/mini/guide-performance.html)
