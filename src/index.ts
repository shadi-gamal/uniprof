#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import { analyzeCommand } from './commands/analyze.js';
import { bootstrapCommand } from './commands/bootstrap.js';
import { mcpCommand } from './commands/mcp.js';
import { recordCommand } from './commands/record.js';
import { visualizeCommand } from './commands/visualize.js';
import { platformRegistry } from './platforms/registry.js';
import { processAliases } from './utils/cli-parsing.js';
import { printError, printInfo } from './utils/output-formatter.js';
import { VERSION } from './version.js';

const program = new Command();

program
  .name('uniprof')
  .description('Universal profiling tool that wraps language/runtime-specific profilers')
  .version(VERSION)
  .addHelpText(
    'after',
    `

${chalk.bold('Examples')}

${chalk.gray('  # 1. Profile and analyze in one step (simplest)')}
  ${chalk.cyan('uniprof python app.py')}
  ${chalk.cyan('uniprof -- python app.py')}

${chalk.gray('  # 2. Profile and visualize flamegraph')}
  ${chalk.cyan('uniprof --visualize python app.py')}
  ${chalk.cyan('uniprof --visualize -- python app.py')}

${chalk.gray('  # 3. Save profile for later analysis')}
  ${chalk.cyan('uniprof record -o profile.json -- python app.py')}
  ${chalk.cyan('uniprof analyze profile.json')}

${chalk.gray('  # 4. Check your environment')}
  ${chalk.cyan('uniprof bootstrap')}

${chalk.bold('Profile any language:')}

  ${chalk.cyan('uniprof node server.js')}
  ${chalk.cyan('uniprof ruby script.rb')}
  ${chalk.cyan('uniprof java -jar app.jar')}
  ${chalk.cyan('uniprof dotnet MyApp.dll')}
  ${chalk.cyan('uniprof ./my-native-app')}

${chalk.bold('Advanced usage:')}

${chalk.gray('  # Profile with custom options')}
  ${chalk.cyan('uniprof --extra-profiler-args --rate 500 -- python app.py')}
  ${chalk.cyan('uniprof --extra-profiler-args "--rate 500 --native" -- python app.py')}
  ${chalk.cyan('uniprof --mode host -- python app.py')}
  ${chalk.cyan('uniprof --cwd ./examples -- python app.py')}
  ${chalk.cyan('uniprof --enable-host-networking -- npm start')}

${chalk.gray('  # Analyze with filters')}
  ${chalk.cyan('uniprof analyze profile.json --threshold 5')}  ${chalk.gray('# Functions >5% CPU')}

${chalk.bold('Argument parsing tips:')}

${chalk.gray('  # Options before the first non-option belong to uniprof')}
  ${chalk.cyan('uniprof --verbose python app.py')}   ${chalk.gray('# --verbose applies to uniprof')}

${chalk.gray('  # Options after the first non-option belong to your command')}
  ${chalk.cyan('uniprof python --verbose app.py')}   ${chalk.gray('# --verbose applies to python')}

${chalk.gray('  # record inserts "--" automatically if omitted')}
  ${chalk.cyan('uniprof record -o out.json --verbose python app.py')}   ${chalk.gray('# becomes: record -o out.json --verbose -- python app.py')}

${chalk.gray('  # Trailing options after the command are passed through')}
  ${chalk.cyan('uniprof record -o out.json --verbose python app.py --verbose')}

For more information, run ${chalk.bold('uniprof <command> --help')} or visit ${chalk.underline('https://github.com/indragiek/uniprof')}`
  );

program
  .command('bootstrap')
  .description('Check environment and print setup instructions for profiling')
  .option(
    '--platform <platform>',
    `Specify platform directly (supported: ${platformRegistry.getSupportedPlatforms().join(', ')})`
  )
  .option('--mode <mode>', 'Profiling mode: auto (default), host, or container', 'auto')
  .option('-v, --verbose', 'Enable verbose output, showing all script and bootstrap output')
  .allowUnknownOption()
  .action(async (options, command) => {
    const args = command.args;
    await bootstrapCommand(options, args);
  });

program
  .command('record')
  .description('Record a profile of the specified command')
  .argument('[command...]', 'Command to profile (e.g., python app.py)')
  .option('-o, --output <path>', 'Output path for the profile JSON file')
  .option(
    '--platform <platform>',
    `Specify platform directly (supported: ${platformRegistry.getSupportedPlatforms().join(', ')})`
  )
  .option('--extra-profiler-args <args...>', 'Extra arguments to pass to the profiler')
  .option('--mode <mode>', 'Profiling mode: auto (default), host, or container', 'auto')
  .option('-v, --verbose', 'Enable verbose output, showing all script and bootstrap output')
  .option(
    '--enable-host-networking',
    'Allow profiled applications to access the host network (requires Docker Desktop with host networking enabled)'
  )
  .option('--analyze', 'Analyze the profile immediately after recording')
  .option('--visualize', 'Visualize the profile immediately after recording')
  .option('--cwd <path>', 'Working directory for the command (default: current directory)')
  .option(
    '--format <format>',
    'Output format for analyze: pretty or json (only used with --analyze)'
  )
  .allowUnknownOption()
  .addHelpText(
    'after',
    () => `\nSupported platforms: ${platformRegistry.getSupportedPlatforms().join(', ')}`
  )
  .action(async (cmd: string[] | undefined, options: any) => {
    const args: string[] = Array.isArray(cmd) ? cmd : [];

    // Check for mutually exclusive options at CLI level as well
    if (options.analyze && options.visualize) {
      printError('Options --analyze and --visualize are mutually exclusive');
      process.exit(1);
    }

    // Make output optional when using --analyze or --visualize
    if (!options.output && !options.analyze && !options.visualize) {
      printError('Output path is required');
      printInfo(
        'Use -o/--output to specify the output file, or use --analyze/--visualize for immediate analysis'
      );
      process.exit(1);
    }

    await recordCommand(options, args);
  });

program
  .command('analyze <profile>')
  .description('Analyze a previously recorded profile')
  .option(
    '--platform <platform>',
    `Specify platform explicitly (${platformRegistry.getSupportedPlatforms().join(', ')})`
  )
  .option(
    '--threshold <percentage>',
    'Minimum percentage of CPU time to display function (default: 0.1)',
    Number.parseFloat
  )
  .option('--filter-regex <pattern>', 'Filter functions by regex pattern')
  .option('--min-samples <count>', 'Minimum sample count to display function', Number.parseInt)
  .option('--max-depth <depth>', 'Maximum call stack depth to analyze', Number.parseInt)
  .option(
    '--format <format>',
    'Output format: pretty (human-readable table) or json (structured JSON). Default: pretty for TTY, json for non-TTY'
  )
  .action(async (profilePath, options) => {
    await analyzeCommand(profilePath, options);
  });

program
  .command('visualize <profile>')
  .description('Visualize a profile in Speedscope web interface')
  .option('--port <port>', 'Port to run the web server on (default: random)', (v) => {
    const n = Number.parseInt(String(v), 10);
    return Number.isNaN(n) ? 0 : n;
  })
  .action(async (profilePath, options) => {
    await visualizeCommand(profilePath, options);
  });

program
  .command('mcp [subcommand] [client]')
  .description('Model Context Protocol (MCP) server for uniprof')
  .action(async (subcommand, client) => {
    await mcpCommand(subcommand, client);
  });

// Handle command aliases before parsing
// Process aliases and validate usage
const processedArgs = processAliases(process.argv);

program.parse(processedArgs);
