# PHP Profiler

uniprof supports profiling PHP applications using [Excimer](https://github.com/wikimedia/php-excimer), a low-overhead sampling profiler for PHP that's used in production at Wikimedia.

## Quick Start

```bash
# Profile a PHP script
uniprof record -o profile.json -- php script.php

# Profile with arguments
uniprof record -o profile.json -- php app.php --arg1 value1

# Profile web server
uniprof record -o profile.json -- php -S localhost:8000

# Profile with Composer
uniprof record -o profile.json -- composer run-script serve
```

## Features

- **Low Overhead**: Sampling-based profiler with minimal performance impact (~1%)
- **Production Ready**: Designed for production use at scale
- **No Code Changes**: Profile existing PHP applications without modification
- **Memory Efficient**: Minimal memory overhead
- **Thread Safe**: Works with PHP-FPM and threaded SAPIs

## Requirements

### Host Mode
- PHP 7.2+ (PHP 8.0+ recommended)
- Excimer extension installed:
  ```bash
  # Install via PECL
  pecl install excimer
  
  # Enable in php.ini
  echo "extension=excimer.so" >> php.ini
  ```

### Container Mode (Recommended)
- Docker installed
- No other requirements - everything is handled automatically

## How It Works

### Host Mode
When running on the host, uniprof:
1. Sets up Excimer profiling via auto_prepend_file
2. Runs your PHP application with profiling enabled
3. Collects sampling data during execution
4. Converts the data to speedscope format

### Container Mode
When running in a container, uniprof:
1. Detects PHP version requirements from composer.json
2. Installs appropriate PHP version
3. Installs and configures Excimer extension
4. Installs Composer dependencies if needed
5. Profiles your application
6. Caches dependencies for faster subsequent runs

## Dependency Management

uniprof automatically handles PHP dependencies:
- **composer.json**: Installs dependencies via Composer
- **composer.lock**: Ensures reproducible installations
- **Platform requirements**: Respects PHP version constraints
- **Extensions**: Installs commonly needed extensions

## Profiling Modes

### CLI Scripts
Profile command-line PHP scripts:
```bash
uniprof record -o profile.json -- php script.php
```

### Built-in Web Server
Profile the PHP development server:
```bash
uniprof record -o profile.json -- php -S localhost:8000 -t public/
```

### Long-Running Processes
Profile daemons and workers:
```bash
uniprof record -o profile.json -- php worker.php
```

### Web Applications
For production web apps, consider:
1. Using Excimer's timeline mode
2. Profiling specific requests
3. Sampling a percentage of production traffic

## Advanced Options

### Sampling Interval
The default sampling period is 0.001001001 seconds (999Hz). You can customize it:

```bash
# Reduce to 500Hz (0.002 second period) for lower overhead
uniprof record -o profile.json --extra-profiler-args --period 0.002 -- php app.php

# Increase to 2000Hz (0.0005 second period) for more detail
uniprof record -o profile.json --extra-profiler-args --period 0.0005 -- php app.php
```

### Maximum Samples
Limit the number of samples collected (not currently supported by uniprof’s injected script).

### Maximum Depth
Control stack trace depth (not currently supported by uniprof’s injected script).

## Caching

Container mode caches:
- PHP installations
- PECL extensions including Excimer
- Composer global installations
- Project vendor directories
- Downloaded packages

## Common Use Cases

### Laravel Applications
```bash
# Profile Artisan commands
uniprof record -o profile.json -- php artisan serve

# Profile queue workers
uniprof record -o profile.json -- php artisan queue:work

# Profile specific command
uniprof record -o profile.json -- php artisan migrate
```

### Symfony Applications
```bash
# Profile console commands
uniprof record -o profile.json -- php bin/console server:run

# Profile specific command
uniprof record -o profile.json -- php bin/console cache:clear

# Profile messenger worker
uniprof record -o profile.json -- php bin/console messenger:consume
```

### WordPress
```bash
# Profile WP-CLI commands
uniprof record -o profile.json -- wp cron event run --all

# Profile imports
uniprof record -o profile.json -- wp import data.xml
```

### Composer Scripts
```bash
# Profile test suites
uniprof record -o profile.json -- composer test

# Profile custom scripts
uniprof record -o profile.json -- composer run-script build
```

## Troubleshooting

### "Excimer extension not found"
Install the Excimer extension:
```bash
# Via PECL
pecl install excimer

# Or use container mode which handles this automatically
uniprof record -o profile.json -- php app.php
```

### "Failed to initialize timer"
Excimer requires timer support. On some systems:
```bash
# Check if CONFIG_HIGH_RES_TIMERS is enabled
zcat /proc/config.gz | grep CONFIG_HIGH_RES_TIMERS
```

### Profile is Empty
For short scripts:
- Decrease sampling period: `--extra-profiler-args --period 0.0005`
- Ensure script runs long enough (>0.1 seconds)
- Check that code is actually executing

### Missing Function Names
If you see incomplete stack traces:
- Ensure PHP has debug symbols
- Check that OPcache doesn't strip comments
- Verify Excimer can read the symbol table

## Performance Considerations

Excimer is designed for production use:
- **Sampling overhead**: <1% CPU usage
- **Memory overhead**: ~100 bytes per sample
- **No code changes**: Works transparently
- **Thread safe**: Safe for concurrent requests
- **Async safe**: Minimal impact on I/O operations

## Understanding the Results

The generated profile shows:
- **PHP functions**: User and internal functions
- **Include/require**: File loading overhead
- **Call stacks**: Complete execution paths
- **File locations**: Source file and line numbers
- **Built-in functions**: Time in PHP internals

Use `uniprof analyze` for a summary:
```bash
uniprof analyze profile.json --threshold 5
```

Or visualize interactively:
```bash
uniprof visualize profile.json
```

## PHP-Specific Considerations

### OPcache Impact
OPcache affects profiling:
- First run includes compilation time
- Subsequent runs show cached performance
- Consider warming OPcache before profiling

### Autoloading
Composer autoloading overhead:
- Shows in profiles as include/require time
- Optimize autoloader for production: `composer dump-autoload -o`
- Consider classmap optimization

### Memory Usage
While Excimer focuses on CPU profiling:
- Peak memory is shown in analysis
- For detailed memory profiling, consider Xdebug or Blackfire
- Memory allocations affect CPU performance

## Best Practices

1. **Warm up OPcache**: Run the code once before profiling
2. **Use production settings**: Enable OPcache, disable Xdebug
3. **Profile under load**: Use realistic request patterns
4. **Long enough runs**: 10+ seconds for statistical validity
5. **Multiple samples**: Profile several runs and average
6. **Optimize autoloading**: Use Composer's optimization flags

## Integration with CI/CD

```yaml
# GitHub Actions example
- name: Setup PHP
  uses: shivammathur/setup-php@v2
  with:
    php-version: '8.2'
    extensions: excimer
    tools: composer

- name: Profile application
  run: |
    composer install
    uniprof bootstrap -- php artisan db:seed
    uniprof record -o profile.json -- php artisan db:seed
    uniprof analyze profile.json --threshold 10
```

## Web Application Profiling

For web applications behind a web server:

1. **Development**: Use built-in server
   ```bash
   uniprof record -o profile.json -- php -S localhost:8000
   ```

2. **Production**: Configure Excimer in PHP:
   ```php
   // In your bootstrap file
   $profiler = new ExcimerProfiler();
   $profiler->setPeriod(0.01); // 10ms
   $profiler->setMaxDepth(100);
   $profiler->start();
   
   register_shutdown_function(function() use ($profiler) {
       $profiler->stop();
       // Save or send profile data
   });
   ```

## Excimer Configuration Reference

| Option | Description | Default |
|--------|-------------|---------|
| `period` | Sampling period in seconds | 0.001001001 (999Hz) |
| `maxDepth` | Maximum stack depth | 100 |
| `maxSamples` | Maximum samples to collect | Unlimited |
| `timestampMode` | EXCIMER_TIMESTAMP_* constant | MONOTONIC |

## Alternative Profilers

While uniprof uses Excimer by default, other PHP profilers include:
- **Xdebug**: More detailed but higher overhead
- **Blackfire**: Commercial with excellent UI
- **Tideways**: Production-focused commercial solution
- **SPX**: Simple profiling extension

## Known Limitations

- Requires PHP 7.2 or later
- Limited support for async PHP (Swoole, ReactPHP)
- May miss very short function calls
- Requires timer support in the kernel
- No built-in memory profiling (CPU only)

## Scope Under Uniprof

Uniprof enables Excimer via an auto-prepended PHP script. The following behaviors apply:

- Event type is wall-clock time (`EXCIMER_REAL`) in both container and host modes.
- Supported option: `--period <seconds>` (sampling period). Default ≈ 0.001001001 s (~999 Hz).
- Options like `--max-depth`, `--max-samples`, and `--memory` are not currently wired through uniprof’s injected script and have no effect.
