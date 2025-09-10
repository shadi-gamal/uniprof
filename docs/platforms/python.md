# Python Profiler

uniprof supports profiling Python applications using [py-spy](https://github.com/benfred/py-spy), a sampling profiler for Python programs that can profile running processes without any code changes.

## Quick Start

```bash
# Profile a Python script
uniprof record -o profile.json -- python app.py

# Profile with arguments
uniprof record -o profile.json -- python script.py --arg1 value1

# Profile with package managers
uniprof record -o profile.json -- uv run python app.py
uniprof record -o profile.json -- poetry run python script.py
uniprof record -o profile.json -- pipenv run python app.py
```

## Features

- **Zero Code Changes**: Profile existing Python programs without modification
- **Low Overhead**: Sampling-based profiler with minimal performance impact (~1-2%)
- **Native Extension Support**: Can profile C extensions when using `--native` flag
- **Subprocess Profiling**: Automatically profiles child processes
- **Thread Support**: Profile multi-threaded applications with thread information
- **Virtual Environment Compatible**: Works seamlessly with venv, virtualenv, conda, etc.

## Requirements

### Host Mode
- Python 3.7+ (Python 3.8+ recommended)
- py-spy installed: `pip install py-spy`
- Linux/macOS: May require sudo or adjusted kernel parameters

### Container Mode (Recommended)
- Docker installed
- No other requirements - everything is handled automatically

## How It Works

### Host Mode
When running on the host, uniprof:
1. Invokes py-spy with your Python application
2. py-spy samples the call stack at regular intervals
3. Generates a profile in speedscope format

Note: On macOS, host mode requires sudo. Use container mode to avoid this.

### Container Mode
When running in a container, uniprof:
1. Uses uv (fast Python package manager) to install Python if needed
2. Creates or activates a virtual environment
3. Installs dependencies from pyproject.toml, requirements.txt, or lock files
4. Runs py-spy to profile your application
5. Caches environments for faster subsequent runs

## Dependency Management

uniprof automatically detects and installs dependencies from:
- `pyproject.toml` - Modern Python projects
- `pylock.toml` / `pylock.*.toml` - uv lock files
- `requirements.txt` - Traditional Python projects
- `Pipfile` / `Pipfile.lock` - Pipenv projects
- `poetry.lock` - Poetry projects

## Virtual Environments

Container mode automatically:
- Creates a virtual environment at `.venv` if not present
- Activates existing virtual environments
- Installs dependencies into the isolated environment
- Caches environments between runs for performance

## Advanced Options

### Native Extension Profiling
Profile C extensions and native code:

```bash
uniprof record -o profile.json --extra-profiler-args --native -- python app.py
```

### Customizing Sampling Rate
The default sampling rate is 999Hz. You can customize it for specific needs:

```bash
# Reduce to 500Hz for lower overhead
uniprof record -o profile.json --extra-profiler-args --rate 500 -- python script.py

# Increase to 2000Hz for short-running scripts
uniprof record -o profile.json --extra-profiler-args --rate 2000 -- python quick.py
```

### Thread Information
Include thread names and profile idle threads:

```bash
uniprof record -o profile.json --extra-profiler-args --threads --idle -- python app.py
```

### GIL Profiling
Only sample threads holding the Global Interpreter Lock:

```bash
uniprof record -o profile.json --extra-profiler-args --gil -- python app.py
```

### Non-blocking Mode
Profile without pausing the Python program (less accurate but lower impact):

```bash
uniprof record -o profile.json --extra-profiler-args --nonblocking -- python app.py
```

### Duration Limit
Profile for a specific duration:

```bash
uniprof record -o profile.json --extra-profiler-args --duration 30 -- python server.py
```

## Caching

Container mode caches the following for improved performance:
- uv package manager cache
- Python virtual environments (per project)
- pip package cache
- Downloaded Python interpreters

## Common Use Cases

### Django Application
```bash
# Profile Django development server
uniprof record -o profile.json -- python manage.py runserver

# Profile Django with gunicorn
uniprof record -o profile.json -- gunicorn myapp.wsgi:application
```

### Flask Application
```bash
# Profile Flask development server
uniprof record -o profile.json -- python app.py

# Profile Flask with production server
uniprof record -o profile.json -- gunicorn -w 4 app:app
```

### Data Science Scripts
```bash
# Profile data processing script
uniprof record -o profile.json -- python process_data.py

# Profile Jupyter notebook conversion
uniprof record -o profile.json -- jupyter nbconvert --execute notebook.ipynb
```

### Async Applications
```bash
# Profile asyncio application
uniprof record -o profile.json -- python async_app.py

# Profile with uvloop
uniprof record -o profile.json -- python -m uvloop app.py
```

## Troubleshooting

### "Permission Denied" on macOS
py-spy requires elevated permissions on macOS. Solutions:
- Use container mode: `uniprof record -o profile.json -- python app.py`
- Or run with sudo: `sudo uniprof record --mode host -o profile.json -- python app.py`

### "Permission Denied" on Linux
Adjust kernel parameters:
```bash
echo 0 | sudo tee /proc/sys/kernel/yama/ptrace_scope
```
Or use container mode which handles this automatically.

### "py-spy is not installed"
Install py-spy:
```bash
pip install py-spy
# Or with cargo:
cargo install py-spy
```

### Profile Shows No Samples
For short-running scripts:
- Increase sampling rate: `--extra-profiler-args --rate 1000`
- Ensure script runs for at least 1 second
- Add a small delay at the end if needed

### Missing Function Names
If you see memory addresses instead of function names:
- Ensure Python has debug symbols
- Try the `--native` flag for C extensions
- Use official Python builds (not stripped versions)

## Performance Considerations

py-spy is designed for production use with minimal overhead:
- **Sampling overhead**: ~1-2% CPU usage
- **Memory overhead**: Negligible
- **No code changes**: Works with unmodified Python programs
- **Safe for production**: Read-only access to process memory

## Understanding the Results

The generated profile shows:
- **Python functions**: Time spent in each Python function
- **Native functions**: C extension calls (with `--native` flag)
- **Call stacks**: Complete stack traces for each sample
- **File locations**: Source file and line numbers
- **Thread activity**: Which threads are consuming CPU time

Use `uniprof analyze` for a quick summary:
```bash
uniprof analyze profile.json --threshold 5
```

Or visualize interactively:
```bash
uniprof visualize profile.json
```

## Best Practices

1. **Profile representative workloads**: Ensure your profiling captures typical application behavior
2. **Warm up the application**: Let caches and JIT compilation stabilize before profiling
3. **Profile long enough**: Aim for at least 10-30 seconds of data for statistical validity
4. **Use production-like data**: Profile with realistic data sizes and patterns
5. **Consider GC impact**: Python's garbage collector can skew results; profile multiple runs
6. **Profile in production mode**: Use production settings, not debug mode

## Integration with CI/CD

```yaml
# GitHub Actions example
- name: Profile application
  run: |
    uniprof bootstrap -- python app.py
    uniprof record -o profile.json -- python app.py
    uniprof analyze profile.json --threshold 10
```

## Advanced py-spy Options Reference

| Option | Description |
|--------|-------------|
| `--rate <Hz>` | Sampling rate in Hz (default: 999) |
| `--duration <seconds>` | How long to profile for |
| `--native` | Profile native C extensions |
| `--threads` | Show thread names in output |
| `--gil` | Only sample threads holding the GIL |
| `--idle` | Include idle threads |
| `--nonblocking` | Don't pause the target process |
| `--subprocesses` | Profile child processes (default: enabled) |
