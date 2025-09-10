# Node.js Profiler

uniprof supports profiling Node.js applications using [0x](https://github.com/davidmarkclements/0x), a powerful flamegraph profiling tool specifically designed for Node.js.

## Quick Start

```bash
# Profile a Node.js script
uniprof record -o profile.json -- node app.js

# Profile with npm scripts
uniprof record -o profile.json -- npm start

# Profile with other package managers
uniprof record -o profile.json -- yarn start
uniprof record -o profile.json -- pnpm run dev
```

## Features

- **V8 Sampling Profiler**: Uses V8's built-in sampling profiler for accurate JavaScript profiling
- **Automatic Dependency Installation**: Installs required dependencies automatically in container mode
- **Multiple Runtime Support**: Works with Node.js
- **Package Manager Support**: Compatible with npm, yarn, and pnpm
- **TypeScript Support**: Automatically handles TypeScript files

## Requirements

### Host Mode
- Node.js 14+ (Node.js 16+ recommended)
- 0x installed globally: `npm install -g 0x`

### Container Mode (Recommended)
- Docker installed
- No other requirements - everything is handled automatically

## How It Works

### Host Mode
When running on the host, uniprof:
1. Invokes 0x with your Node.js application
2. 0x uses V8's sampling profiler to collect performance data
3. Converts the collected data to speedscope format

### Container Mode
When running in a container, uniprof:
1. Detects your Node.js version from `.nvmrc` or `.node-version`
2. Installs the appropriate Node.js version using nvm
3. Detects and installs your package manager (npm, yarn, pnpm)
4. Installs project dependencies
5. Installs and runs 0x to profile your application
6. Caches dependencies for faster subsequent runs

## Package Manager Detection

uniprof automatically detects your package manager based on lock files:
- `package-lock.json` → npm
- `yarn.lock` → yarn
- `pnpm-lock.yaml` → pnpm

## Caching

Container mode caches the following for improved performance:
- Node.js versions (via nvm)
- Global npm packages (including 0x)
- npm/yarn/pnpm caches
- Project-specific node_modules

## Advanced Options

### Sampling Rate
**Note**: The sampling rate for Node.js profiling is NOT configurable. 0x uses V8's built-in sampling profiler which operates at its default rate. This is a limitation of the V8 profiler API.

### Kernel Tracing (Linux only)
Enable kernel-level tracing for more detailed profiling:

```bash
# Requires perf to be installed
uniprof record -o profile.json --extra-profiler-args --kernel-tracing -- node app.js
```

### Server Profiling
Profile a server and run a command when it opens a port:

```bash
uniprof record -o profile.json --extra-profiler-args "--on-port 'curl localhost:3000/api/test'" -- node server.js
```

## TypeScript Support

TypeScript files are automatically supported. In container mode, TypeScript tools are installed automatically when `.ts` files are detected.

```bash
# Direct TypeScript execution
uniprof record -o profile.json -- tsx app.ts
uniprof record -o profile.json -- ts-node app.ts

# Or with Node.js and tsx loader
uniprof record -o profile.json -- node --loader tsx app.ts
```

## Troubleshooting

### "0x is not installed"
Install 0x globally:
```bash
npm install -g 0x
```

Or use container mode which handles this automatically:
```bash
uniprof record --mode container -o profile.json -- node app.js
```

### "Cannot find module"
Ensure dependencies are installed:
```bash
npm install  # or yarn/pnpm install
```

Container mode handles this automatically.

### Performance Overhead
0x is designed to have minimal performance impact (~1-3% overhead). The profiler samples the call stack at regular intervals rather than instrumenting every function call.

## Examples

### Basic Express Server
```bash
# Profile an Express server
uniprof record -o profile.json -- node server.js

# Profile with automatic load testing
uniprof record -o profile.json --extra-profiler-args "--on-port 'ab -n 1000 -c 10 http://localhost:3000/'" -- node server.js
```

### Production Build
```bash
# Profile a production build
NODE_ENV=production uniprof record -o profile.json -- node dist/app.js
```

### Memory-Intensive Application
```bash
# Increase heap size while profiling
uniprof record -o profile.json -- node --max-old-space-size=4096 memory-intensive-app.js
```

### Microservices
```bash
# Profile a specific microservice
uniprof record -o profile.json -- npm run start:auth-service
```

## Understanding the Results

The generated profile shows:
- **Function names**: JavaScript function calls in your code
- **Time spent**: How much CPU time each function consumed
- **Call stacks**: The chain of function calls leading to each sample
- **Hot paths**: The most expensive code paths in your application

Use `uniprof analyze` to get a summary of the hottest functions:
```bash
uniprof analyze profile.json
```

Or open the profile in speedscope for interactive visualization:
```bash
uniprof visualize profile.json
```
## Behavior Under Uniprof

Uniprof runs 0x in “collect-only” mode and converts the captured V8 ticks to Speedscope JSON automatically:

- Forces `--collect-only --write-ticks` with 0x.
- Converts `ticks.json` to Speedscope and cleans up the 0x output directory.
- Ignores 0x’s HTML generation flags (e.g., `--output-html`, `--name`) because uniprof provides its own visualization with `uniprof visualize`.

Use `uniprof visualize profile.json` to view results in the bundled Speedscope UI.
