# Ruby Profiler

uniprof supports profiling Ruby applications using [rbspy](https://rbspy.github.io/), a sampling profiler for Ruby that can profile any Ruby program without requiring code changes or special flags.

## Quick Start

```bash
# Profile a Ruby script
uniprof record -o profile.json -- ruby app.rb

# Profile with bundler
uniprof record -o profile.json -- bundle exec ruby script.rb

# Profile Rails application
uniprof record -o profile.json -- rails server

# Profile with Ruby version managers
uniprof record -o profile.json -- rbenv exec ruby app.rb
uniprof record -o profile.json -- rvm ruby-3.0.0 do ruby app.rb
```

## Features

- **Zero Configuration**: No gems to install or code to modify
- **Production Safe**: Low overhead sampling profiler (~1-2%)
- **Version Agnostic**: Works with Ruby 2.5+ including Ruby 3.x
- **C Extension Support**: Profiles both Ruby and native code
- **Multi-Process**: Can profile forked processes
- **Real-Time**: Profile running production applications

## Requirements

### Host Mode
- Ruby 2.5+ (Ruby 3.0+ recommended)
- rbspy installed: 
  ```bash
  # macOS
  brew install rbspy
  
  # Linux
  curl -L https://github.com/rbspy/rbspy/releases/latest/download/rbspy-x86_64-unknown-linux-gnu.tar.gz | tar xz
  sudo mv rbspy /usr/local/bin/
  ```
- Linux/macOS: May require sudo or adjusted permissions

### Container Mode (Recommended)
- Docker installed
- No other requirements - everything is handled automatically

## How It Works

### Host Mode
When running on the host, uniprof:
1. Invokes rbspy to attach to your Ruby process
2. rbspy samples the call stack at regular intervals
3. Generates a profile in speedscope format

Note: Host mode often requires elevated permissions.

### Container Mode
When running in a container, uniprof:
1. Detects Ruby version from `.ruby-version` or Gemfile
2. Installs the appropriate Ruby version using rbenv
3. Installs bundler and project dependencies
4. Runs rbspy to profile your application
5. Caches gems and Ruby installations for performance

## Dependency Management

uniprof automatically handles Ruby dependencies:
- **Gemfile**: Installs gems via bundler
- **Gemfile.lock**: Ensures exact versions are used
- **.ruby-version**: Installs specified Ruby version
- **.rvmrc**: Detects RVM Ruby version requirements

## Version Management

Container mode automatically:
- Installs Ruby versions using rbenv
- Detects version from `.ruby-version` or Gemfile
- Falls back to latest stable Ruby if not specified
- Caches Ruby installations between runs

## Advanced Options

### Customizing Sampling Rate
The default sampling rate is 999Hz. You can customize it for specific needs:

```bash
# Reduce to 500Hz for lower overhead
uniprof record -o profile.json --extra-profiler-args --rate 500 -- ruby app.rb

# Increase to 2000Hz for short-running scripts
uniprof record -o profile.json --extra-profiler-args --rate 2000 -- ruby quick.rb
```

### Profile for Specific Duration
Limit profiling time:

```bash
# Profile for 30 seconds
uniprof record -o profile.json --extra-profiler-args --duration 30 -- ruby server.rb
```

### Non-Blocking Mode
Profile without pausing the Ruby process (experimental):

```bash
uniprof record -o profile.json --extra-profiler-args --nonblocking -- ruby app.rb
```

### Profile Running Process
Attach to an already running Ruby process:

```bash
# Find Ruby process ID
ps aux | grep ruby

# Profile running process (host mode only)
uniprof record --mode host -o profile.json --extra-profiler-args --pid 12345
```

### Force Copy Method
Use copy method for stack traces (more reliable, slightly higher overhead):

```bash
uniprof record -o profile.json --extra-profiler-args --force-copy -- ruby app.rb
```

## Caching

Container mode caches the following:
- Ruby installations (via rbenv)
- Bundler and gem installations
- Global gems
- Project-specific gems in vendor/bundle

## Common Use Cases

### Rails Applications
```bash
# Profile Rails server
uniprof record -o profile.json -- rails server

# Profile Rails console session
uniprof record -o profile.json -- rails console

# Profile Rake task
uniprof record -o profile.json -- rake db:migrate

# Profile Rails with Puma
uniprof record -o profile.json -- bundle exec puma
```

### Sinatra Applications
```bash
# Profile Sinatra app
uniprof record -o profile.json -- ruby app.rb

# Profile with Thin server
uniprof record -o profile.json -- thin start

# Profile with Unicorn
uniprof record -o profile.json -- unicorn -c config/unicorn.rb
```

### Background Jobs
```bash
# Profile Sidekiq workers
uniprof record -o profile.json -- bundle exec sidekiq

# Profile Resque workers
uniprof record -o profile.json -- rake resque:work

# Profile delayed_job
uniprof record -o profile.json -- rake jobs:work
```

### Test Suites
```bash
# Profile RSpec tests
uniprof record -o profile.json -- rspec spec/

# Profile Minitest
uniprof record -o profile.json -- ruby -Itest test/test_helper.rb

# Profile specific test file
uniprof record -o profile.json -- rspec spec/models/user_spec.rb
```

## Troubleshooting

### "Permission Denied"
rbspy requires permissions to read process memory. Solutions:
- Use container mode (recommended)
- Run with sudo: `sudo uniprof record --mode host -o profile.json -- ruby app.rb`
- On Linux, adjust ptrace scope:
  ```bash
  echo 0 | sudo tee /proc/sys/kernel/yama/ptrace_scope
  ```

### "rbspy is not installed"
Install rbspy for host mode:
```bash
# macOS
brew install rbspy

# Linux - download binary
curl -L https://github.com/rbspy/rbspy/releases/latest/download/rbspy-x86_64-unknown-linux-gnu.tar.gz | tar xz
sudo mv rbspy /usr/local/bin/

# Or with cargo
cargo install rbspy
```

### "Could not find Ruby version"
rbspy needs to detect the Ruby version. Ensure:
- Ruby executable is in PATH
- Not using heavily customized Ruby builds
- Container mode handles this automatically

### Profile Shows No Data
For short-running scripts:
- Increase sampling rate: `--extra-profiler-args --rate 1000`
- Ensure script runs for at least 1 second
- Check that the process is actually using CPU time

### Missing Method Names
If you see addresses instead of method names:
- Ensure Ruby has debug symbols
- Use official Ruby builds
- Try `--force-copy` method for better accuracy

## Performance Considerations

rbspy is designed for production profiling:
- **Sampling overhead**: ~1-2% CPU usage
- **Memory overhead**: Minimal
- **No code changes**: Works with unmodified Ruby programs
- **Production safe**: Read-only process access
- **Non-intrusive**: Doesn't require special Ruby flags

## Understanding the Results

The generated profile shows:
- **Ruby methods**: Time spent in each Ruby method
- **C functions**: Native extension calls
- **Call stacks**: Complete stack traces
- **File locations**: Source file and line numbers
- **Thread information**: For multi-threaded applications

Use `uniprof analyze` for a quick summary:
```bash
uniprof analyze profile.json --threshold 5
```

Or visualize interactively:
```bash
uniprof visualize profile.json
```

## Ruby-Specific Considerations

### Garbage Collection
Ruby's GC can impact profiling results:
- GC time appears in profiles
- Consider GC tuning for accurate results
- Profile multiple runs to average out GC impact

### JIT Compilation (Ruby 3+)
With MJIT/YJIT enabled:
- Initial runs may show compilation overhead
- Warm up the application before profiling
- Profile after JIT has stabilized

### Multi-Process Servers
For forking servers (Unicorn, Puma in cluster mode):
- rbspy profiles the parent process by default
- Use `--pid` to profile specific workers
- Consider profiling individual workers

## Best Practices

1. **Warm up the application**: Let caches and lazy-loading complete
2. **Profile under load**: Use realistic traffic patterns
3. **Profile long enough**: 30+ seconds for statistical validity
4. **Multiple runs**: Average results across runs
5. **Production settings**: Use production configurations
6. **Consider GC impact**: Ruby's GC can skew results

## Integration with CI/CD

```yaml
# GitHub Actions example
- name: Setup Ruby
  uses: ruby/setup-ruby@v1
  with:
    ruby-version: '3.0'
    bundler-cache: true

- name: Profile application
  run: |
    uniprof bootstrap -- bundle exec ruby app.rb
    uniprof record -o profile.json -- bundle exec ruby app.rb
    uniprof analyze profile.json --threshold 10
```

## Advanced rbspy Options Reference

| Option | Description |
|--------|-------------|
| `--rate <Hz>` | Sampling rate in Hz (default: 999) |
| `--duration <seconds>` | How long to profile for |
| `--pid <PID>` | Profile existing process |
| `--nonblocking` | Don't pause the Ruby process |
| `--force-copy` | Use copy method (more reliable) |
| `--with-subprocesses` | Include child processes |

## Memory Profiling

While rbspy focuses on CPU profiling, for memory profiling consider:
- [memory_profiler](https://github.com/SamSaffron/memory_profiler) gem
- [derailed_benchmarks](https://github.com/schneems/derailed_benchmarks) for Rails
- `uniprof` may add memory profiling support in the future

## Known Limitations

- Cannot profile Ruby versions before 2.5
- Limited support for alternative Ruby implementations (JRuby, TruffleRuby)
- Some heavily optimized C extensions may show limited detail
- Requires process memory access permissions
