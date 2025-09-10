import { randomBytes } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v3';
import { platformRegistry } from '../platforms/registry.js';
import { splitArgsQuoted } from '../utils/cli-parsing.js';
import { readAll, spawn } from '../utils/spawn.js';

const supportedPlatforms = platformRegistry.getSupportedPlatforms();

// NOTE: We intentionally expose a Zod shape object (not wrapped in z.object).
// Some tooling has trouble inferring its exact generic type depth, so we relax typing here.
const runProfilerSchema: any = {
  command: z
    .string()
    .describe(
      'REQUIRED: The exact command line to profile. Examples: "python app.py", "node server.js", "java -jar app.jar", "./my-binary". ' +
        'This must be the complete command as you would type it in a terminal. Do NOT include shell operators like &&, ||, or |. ' +
        'For commands with arguments, include them all in this single string (e.g., "python main.py --port 8080").'
    ),
  platform: z
    .string()
    .optional()
    .describe(
      `OPTIONAL: Force a specific profiler platform. Valid values: ${supportedPlatforms.join(', ')}. Leave empty to auto-detect based on the command. Only specify if auto-detection fails or you need a specific profiler.`
    ),
  mode: z
    .enum(['auto', 'container', 'host'])
    .default('auto')
    .describe(
      'OPTIONAL: Profiling execution mode. "auto" (recommended) automatically chooses the best option. ' +
        '"container" runs profiling in Docker for consistency across environments. ' +
        '"host" uses locally installed profilers (requires manual setup). Use "auto" unless you have specific requirements.'
    ),
  output_path: z
    .string()
    .optional()
    .describe(
      'OPTIONAL: File path where the profile JSON will be saved (e.g., "/tmp/profile.json" or "./my-profile.json"). ' +
        'If not specified, a unique temporary file will be created automatically. The profile is always analyzed after recording.'
    ),
  cwd: z
    .string()
    .describe(
      'REQUIRED: Absolute path to the working directory where the command should run (e.g., "/home/user/myproject"). ' +
        'This is typically your project root directory. The command will be executed with this as the current directory. ' +
        'Must be an absolute path starting with / (Linux/Mac) or a drive letter (Windows).'
    ),
  enable_host_networking: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'OPTIONAL: Set to true if your application needs to connect to services on the host machine (default: false). ' +
        'Examples of when to enable: connecting to localhost database, accessing host APIs, inter-process communication. ' +
        'Only affects container mode. Requires Docker Desktop with host networking support.'
    ),
  extra_profiler_args: z
    .string()
    .optional()
    .describe(
      'OPTIONAL: Additional platform-specific profiler arguments as a single string (e.g., "-F 999"). ' +
        'Common examples: "--rate 500" (Python/Ruby), "-F 500" (native/perf), "--interval 1000000" (JVM). ' +
        'Multiple args: "--rate 500 --native" (Python with native extension profiling). ' +
        'See documentation for platform-specific options.'
    ),
};

// splitArgsQuoted moved to utils/cli-parsing.ts

export function registerRunProfiler(server: McpServer): void {
  server.registerTool(
    'run_profiler',
    {
      title: 'Profile Application Performance',
      description:
        'Profiles a command/application to identify performance bottlenecks and CPU usage patterns.\n\n' +
        'WHAT THIS DOES:\n' +
        '1. Runs your command with CPU profiling enabled (999Hz sampling by default)\n' +
        '2. Captures which functions consume CPU time during execution\n' +
        '3. Analyzes the profile and returns a breakdown of CPU usage\n' +
        '4. Shows top functions by CPU percentage with call counts\n\n' +
        'WHEN TO USE:\n' +
        '- Application is running slowly and you need to find bottlenecks\n' +
        '- Need to optimize code by finding expensive functions\n' +
        '- Want to understand CPU usage patterns\n\n' +
        'EXAMPLE PARAMETERS:\n' +
        '{\n' +
        '  "command": "python main.py --port 8080",\n' +
        '  "cwd": "/home/user/myproject"\n' +
        '}\n\n' +
        'The tool will automatically detect the language/platform and use the appropriate profiler.',
      // Keep as a plain Zod shape per design; cast to any to avoid deep generic expansion issues.
      inputSchema: runProfilerSchema as any,
      // Structured output schema describing analyze() result shape
      // Cast to any to sidestep excessive generic instantiation in some TS versions.
      outputSchema: {
        summary: z.object({
          totalSamples: z.number(),
          totalTime: z.number(),
          unit: z.string().optional(),
          profileName: z.string().optional(),
          profiler: z.string().optional(),
          threadCount: z.number().optional(),
          profileType: z.enum(['sampled', 'evented']).optional(),
          totalEvents: z.number().optional(),
        }),
        hotspots: z.array(
          z.object({
            name: z.string(),
            file: z.string().optional(),
            line: z.number().optional(),
            percentage: z.number(),
            self: z.number(),
            total: z.number(),
            samples: z.number(),
            percentiles: z.object({ p50: z.number(), p90: z.number(), p99: z.number() }).optional(),
          })
        ),
      } as any,
    },
    async (args: any, _extra?: any) => {
      const {
        command,
        platform,
        mode,
        output_path,
        cwd,
        enable_host_networking,
        extra_profiler_args,
      } = args as any;
      try {
        const recordArgs: string[] = ['record', '--analyze', '--format', 'json'];

        let outputPath = output_path;
        if (!outputPath) {
          const tmpDir = os.tmpdir();
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
          const randomId = randomBytes(4).toString('hex');
          outputPath = path.join(tmpDir, `uniprof-mcp-${timestamp}-${randomId}.json`);
        }
        recordArgs.push('-o', outputPath);

        if (platform) {
          recordArgs.push('--platform', platform);
        }

        if (mode && mode !== 'auto') {
          recordArgs.push('--mode', mode);
        }

        if (cwd) {
          recordArgs.push('--cwd', cwd);
        }

        if (enable_host_networking) {
          recordArgs.push('--enable-host-networking');
        }

        if (extra_profiler_args) {
          // Pass profiler args as a single value token; recordCommand will split safely.
          recordArgs.push('--extra-profiler-args', splitArgsQuoted(extra_profiler_args).join(' '));
        }

        recordArgs.push('--', ...splitArgsQuoted(command));

        // Reuse the current process runtime and entry path to avoid mismatches.
        // This ensures we invoke uniprof with the same runtime that launched the MCP server.
        const uniprofPath = path.resolve(process.argv[1]);
        const runtime = process.argv[0];

        const proc = spawn([runtime, uniprofPath, ...recordArgs], {
          stdout: 'pipe',
          stderr: 'pipe',
          cwd,
          env: { ...process.env },
        });
        const [output, stderr, exitCode] = await Promise.all([
          readAll(proc.stdout),
          readAll(proc.stderr),
          proc.exited,
        ]);

        if (exitCode !== 0 && exitCode !== 130) {
          // 130 is SIGINT
          return {
            content: [
              {
                type: 'text',
                text: `Profiling failed with exit code ${exitCode}\n\nOutput:\n${output}\n\nErrors:\n${stderr}`,
              },
            ],
            isError: true,
          } as any;
        }

        // Parse the JSON output from analyze command
        try {
          const analysis = JSON.parse(output);
          // Return structured data matching the outputSchema
          return {
            content: [
              {
                type: 'text',
                text: output,
              },
            ],
            structuredContent: analysis,
          } as any;
        } catch (parseError) {
          // If parsing fails, return error message
          return {
            content: [
              {
                type: 'text',
                text: `Failed to parse profiler output as JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
              },
            ],
            isError: true,
          } as any;
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Error running profiler: ${error.message}`,
            },
          ],
          isError: true,
        } as any;
      }
    }
  );
}
