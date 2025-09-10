# Uniprof MCP Server Documentation

## Overview

The uniprof MCP (Model Context Protocol) server enables AI agents and LLM applications to use uniprof's profiling capabilities through a standardized protocol. This allows AI assistants to automatically profile code, analyze performance bottlenecks, and help optimize applications.

## Installation

First, ensure uniprof is installed:

```bash
npm install -g uniprof
```

## Commands

### `uniprof mcp run`

Starts the MCP server that communicates via stdio (standard input/output).

```bash
uniprof mcp run
```

The server will start and display:
- Confirmation that the server is running
- The available tool
- Instructions to stop the server (Ctrl+C)

### `uniprof mcp install <client>`

Attempts to install the uniprof MCP server into a supported client application.

```bash
uniprof mcp install claudecode
uniprof mcp install vscode
uniprof mcp install cursor
```

**Supported clients:**
- `amp` - Amp IDE
- `claudecode` - Claude Code
- `codex` - Codex
- `cursor` - Cursor IDE
- `gemini` - Gemini
- `vscode` - Visual Studio Code
- `zed` - Zed Editor

### `uniprof mcp`

Shows help information about the MCP commands and available subcommands.

## MCP Tool

The uniprof MCP server provides a profiling tool that AI agents can use:

### Tool: `run_profiler`

**Description:** Profiles a command/application to identify performance bottlenecks and CPU usage patterns.

This tool:
1. Runs your command with CPU profiling enabled (999Hz sampling by default)
2. Captures which functions consume CPU time during execution
3. Analyzes the profile and returns a breakdown of CPU usage
4. Shows top functions by CPU percentage with call counts

**When to use:**
- Application is running slowly and you need to find bottlenecks
- Need to optimize code by finding expensive functions
- Want to understand CPU usage patterns

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `command` | string | **Yes** | - | The exact command line to profile. Examples: "python app.py", "node server.js", "java -jar app.jar". Include all arguments in this single string. |
| `cwd` | string | **Yes** | - | Absolute path to the working directory (e.g., "/home/user/myproject"). The command runs from this directory. |
| `platform` | string | No | auto-detect | Force a specific profiler platform. Valid: python, nodejs, ruby, php, jvm, dotnet, native, beam. Leave empty for auto-detection. |
| `mode` | enum | No | auto | Execution mode: "auto" (recommended), "container" (Docker isolation), or "host" (local profilers). |
| `output_path` | string | No | temp file | File path for the profile JSON (e.g., "/tmp/profile.json"). A unique temp file is created if not specified. |
| `enable_host_networking` | boolean | No | false | Set to true if your app needs to connect to services on the host machine (e.g., localhost database). |
| `extra_profiler_args` | string | No | - | Platform-specific profiler arguments (e.g., "--rate 500" for Python/Ruby, "-F 500" for native/perf). |
| `verbose` | boolean | No | false | Set to true for detailed output including profiler logs and application output. |

**Example Usage:**
```json
{
  "tool": "run_profiler",
  "arguments": {
    "command": "python app.py",
    "cwd": "/home/user/myproject",
    "mode": "container",
    "verbose": false
  }
}
```

**Returns:** Text output containing the profile analysis, showing:
- Total samples collected
- Top functions by CPU time percentage
- Call stack information
- Performance bottlenecks

## Manual Client Configuration

If automatic installation is not available for your client, configure manually:

1. Install uniprof globally:
   ```bash
   npm install -g uniprof
   ```

2. Add this MCP server configuration to your client:
   ```json
   {
     "name": "uniprof",
     "command": "uniprof",
     "args": ["mcp", "run"],
     "transport": "stdio"
  }
  ```

3. Restart your MCP client to load the server

## Notes on Extra Profiler Arguments

When using the CLI directly, `--extra-profiler-args` requires an explicit `--` separator in some alias forms to avoid ambiguity (see README examples). The MCP server constructs the `record` command directly and passes extra profiler arguments as tokens to the option, so you should provide them as a single string in `extra_profiler_args` without adding additional separators. For example:

```json
{
  "command": "python app.py",
  "cwd": "/home/user/myproject",
  "extra_profiler_args": "--rate 500 --native"
}
```

The server handles quoting and splitting so that profiler flags are correctly passed through.
