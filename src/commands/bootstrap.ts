import chalk from 'chalk';
import { platformRegistry } from '../platforms/registry.js';
import type { Mode, RunMode } from '../types/index.js';
import type { PlatformPlugin } from '../types/platform-plugin.js';
import { checkDockerEnvironment, pullContainerImage } from '../utils/docker.js';
import {
  createSpinner,
  printError,
  printInfo,
  printSection,
  printStep,
  printSuccess,
  printWarning,
} from '../utils/output-formatter.js';

interface BootstrapOptions {
  platform?: string;
  mode?: Mode;
  verbose?: boolean;
}

function printUsageExamples(platform: PlatformPlugin | null): void {
  const examples = platform?.getExamples?.();
  if (examples) {
    console.log();
    console.log(`${chalk.bold('Usage Examples')}`);
    printSection('Simple (one command to profile and analyze or visualize)');
    for (const line of examples.simple) console.log(chalk.cyan(line));
    console.log();
    printSection('Advanced (save profile output for later)');
    for (const line of examples.advanced) console.log(chalk.cyan(line));
  }
  console.log(chalk.cyan('uniprof analyze profile.json'));
  console.log(chalk.cyan('uniprof visualize profile.json'));
}

export async function bootstrapCommand(options: BootstrapOptions, args: string[]): Promise<void> {
  const userMode: Mode = options.mode || 'auto';

  // For bootstrap, if mode is 'auto', default to showing container setup
  // since that's the most common use case
  const mode: RunMode = userMode === 'host' ? 'host' : 'container';

  // Windows host mode is not supported
  if (process.platform === 'win32' && mode === 'host') {
    printError('Host mode is not supported on Windows');
    printInfo('Please use --mode container for Windows environments');
    process.exit(1);
  }

  if (mode === 'container') {
    printStep('Checking Docker environment');
    const spinner = createSpinner('Checking Docker environment...');
    spinner?.start();

    const dockerCheck = await checkDockerEnvironment();
    spinner?.stop();
    if (!dockerCheck.isValid) {
      for (const error of dockerCheck.errors) printError(error);
      for (const instruction of dockerCheck.setupInstructions) console.log(instruction);
      printError('Please resolve the Docker issues above before profiling');
      process.exit(1);
    }
    for (const warning of dockerCheck.warnings) printWarning(warning);
    printSuccess('Docker is ready');

    if (dockerCheck.isValid) {
      // Check host networking availability (warn only; user has not opted in yet)
      try {
        const { checkHostNetworkingEnabled } = await import('../utils/docker.js');
        const hostNet = await checkHostNetworkingEnabled();
        if (!hostNet.enabled) {
          console.log();
          printWarning(
            'Host networking is disabled. If your app needs access to the host network, enable host networking in Docker Desktop and run with --enable-host-networking.'
          );
        }
      } catch {}
      let platformToPull: string | null = null;

      if (options.platform) {
        platformToPull = options.platform;
      } else if (args.length > 0) {
        const detectedPlatform = await platformRegistry.detectFromCommand(args);
        if (detectedPlatform) {
          platformToPull = detectedPlatform.name;
        }
      }

      if (platformToPull) {
        const platform = platformRegistry.get(platformToPull);
        if (platform?.supportsContainer()) {
          printStep('Preparing profiler container');
          try {
            const platformSpinner = createSpinner(`Pulling ${platform.name} container...`);
            platformSpinner?.start();
            await pullContainerImage(platform.name, true);
            platformSpinner?.stop();
            printSuccess(`${platform.name} container ready`);
          } catch (error: any) {
            printWarning(`Could not pull ${platform.name} container: ${error.message}`);
          }

          // For native platform, validate the binary on the host prior to container usage
          if (platform.name === 'native' && args.length > 0) {
            printStep('Validating native binary');
            const executablePath = args[0];
            const validationSpinner = createSpinner('Validating binary on host...');
            validationSpinner?.start();

            try {
              const path = await import('node:path');
              const fs = await import('node:fs');
              const { validateBinary } = await import('../utils/validate-native-binary.js');

              const resolvedPath = path.resolve(executablePath);
              if (!fs.existsSync(resolvedPath)) {
                validationSpinner?.stop();
                printError(`Binary not found: ${executablePath}`);
                return;
              }

              // First validate format and metadata without enforcing container compatibility
              const basic = validateBinary(resolvedPath, false);

              // On macOS, Mach-O binaries must be profiled in host mode (Instruments/xctrace)
              // Do not treat container incompatibility as an error in this case.
              if (process.platform === 'darwin' && basic.format === 'Mach-O') {
                validationSpinner?.stop();
                // Report validation outcome (warnings are fine here)
                if (!basic.format) {
                  printError('Not a valid native executable');
                  process.exit(1);
                }
                if (basic.hasErrors) {
                  printError('Binary validation failed');
                  process.exit(1);
                } else if (basic.hasWarnings) {
                  printWarning('Binary validation completed with warnings');
                } else {
                  printSuccess('Binary validation passed');
                }

                printWarning(
                  'Detected Mach-O binary. macOS native binaries are profiled using Instruments (host mode).'
                );
                printInfo('Use --mode host or run:');
                console.log(chalk.cyan(`  uniprof bootstrap --mode host -- ${resolvedPath}`));
              } else {
                // For ELF (or other) binaries, check container compatibility as well
                const result = validateBinary(resolvedPath, true);
                validationSpinner?.stop();

                if (!result.format) {
                  printError('Not a valid native executable');
                  process.exit(1);
                }

                if (result.hasErrors) {
                  printError('Binary validation failed');
                  process.exit(1);
                } else if (result.hasWarnings) {
                  printWarning('Binary validation completed with warnings');
                } else {
                  printSuccess('Binary validation passed');
                }
              }
            } catch (error: any) {
              validationSpinner?.stop();
              printWarning(`Could not validate binary on host: ${error.message}`);
            }
          }
        }
      }

      // Examples from platform plugin API
      const selectedName = options.platform || platformToPull || null;
      const selected = selectedName ? platformRegistry.get(selectedName) : null;
      printUsageExamples(selected || platformRegistry.get('python'));
    } else {
      printError('Docker is not available');
      process.exit(1);
    }

    return;
  }

  printStep('Checking host environment');

  let platform: PlatformPlugin | null = null;
  let executablePath: string | undefined;

  if (options.platform) {
    platform = platformRegistry.get(options.platform);
    if (!platform) {
      printError(`Unknown platform: ${options.platform}`);
      printInfo(`Supported platforms: ${platformRegistry.getSupportedPlatforms().join(', ')}`);
      process.exit(1);
    }
    printInfo(`Platform specified: ${chalk.bold(platform.name)}`);

    const foundExecutable = await platform.findExecutableInPath();
    if (foundExecutable) {
      executablePath = foundExecutable;
      printInfo(`Found ${platform.name}: ${chalk.cyan(foundExecutable)}`);
    } else {
      printError(`${platform.name} is not installed in the environment`);
      printInfo(`No ${platform.executables.join(' or ')} executable found in PATH`);
    }
  } else if (args.length > 0) {
    platform = await platformRegistry.detectFromCommand(args);
    executablePath = args[0];
    if (platform) {
      printInfo(
        `Detected platform: ${chalk.bold(platform.name)} (from command: ${chalk.cyan(args.join(' '))})`
      );
    } else {
      printWarning('Could not auto-detect platform from command');
      printInfo(`Supported platforms: ${platformRegistry.getSupportedPlatforms().join(', ')}`);
      printInfo('Use --platform <platform> to specify explicitly');
      process.exit(1);
    }
  } else {
    printError('No command or platform specified');
    console.log();
    console.log('Usage:');
    console.log('  uniprof bootstrap -- /path/to/executable <args>');
    console.log('  uniprof bootstrap --platform python');
    process.exit(1);
  }

  const spinner = createSpinner('Checking environment...');
  spinner?.start();

  const environmentCheck = await platform.checkLocalEnvironment(executablePath);

  spinner?.stop();

  for (const error of environmentCheck.errors) printError(error);
  for (const warning of environmentCheck.warnings) printWarning(warning);

  if (environmentCheck.isValid && environmentCheck.warnings.length === 0) {
    printSuccess(`Environment is ready for ${platform.name}`);
    printInfo(`Profiler: ${chalk.bold(platform.profiler)}`);
  }
  for (const instruction of environmentCheck.setupInstructions) console.log(instruction);

  if (environmentCheck.isValid) {
    printUsageExamples(platform);

    const advancedOptions = platform.getAdvancedOptions();
    if (advancedOptions) {
      printStep('Advanced options');
      console.log(
        advancedOptions.description.replace(
          '--extra-profiler-args',
          chalk.cyan('--extra-profiler-args')
        )
      );
      console.log();
      console.log(chalk.bold('Common options:'));

      const maxFlagWidth = Math.max(...advancedOptions.options.map((opt) => opt.flag.length)) + 4;

      for (const option of advancedOptions.options) {
        const flag = chalk.cyan(option.flag);
        console.log(`  ${flag.padEnd(maxFlagWidth)} - ${option.description}`);
      }

      console.log();
      console.log(chalk.bold('Example:'));
      console.log(chalk.gray(`  # ${advancedOptions.example.description}`));
      console.log(chalk.cyan(`  ${advancedOptions.example.command}`));
    }
  } else {
    console.log();
    printError('Please resolve the issues above before profiling');
    process.exit(1);
  }
}
