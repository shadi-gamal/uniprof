import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';
import type { ProfilerEnvironmentCheck } from '../types/index.js';
import type { PlatformPlugin, ProfileContext, RecordOptions } from '../types/platform-plugin.js';
import { runContainer } from '../utils/docker.js';
import { toContainerPath } from '../utils/path-utils.js';
import {
  addTempDir,
  addTempFile,
  mergeRuntimeEnv,
  setRawArtifact,
} from '../utils/profile-context.js';
import { spawnSync } from '../utils/spawn.js';
import { buildBashTrampoline } from '../utils/trampoline.js';
import { BasePlatform } from './base-platform.js';

export class PhpPlatform extends BasePlatform implements PlatformPlugin {
  name = 'php';
  profiler = 'excimer';
  extensions = ['.php', '.phar'];
  executables = ['php', 'composer'];

  detectCommand(args: string[]): boolean {
    if (args.length === 0) return false;

    const cmd = args[0].toLowerCase();
    const basename = path.basename(cmd);

    if (super.detectCommand(args)) {
      return true;
    }

    // Direct script invocation (e.g., ./script.php)
    if (this.extensions.some((ext) => basename.endsWith(ext))) {
      return true;
    }

    return basename === 'composer';
  }

  async checkLocalEnvironment(executablePath?: string): Promise<ProfilerEnvironmentCheck> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const setupInstructions: string[] = [];

    // Determine the executable path to use
    let actualExecutablePath = executablePath;

    if (!actualExecutablePath) {
      const foundPath = await this.findExecutableInPath();
      if (!foundPath) {
        errors.push('PHP is not installed or not in PATH');
        setupInstructions.push(
          chalk.bold('Install PHP:'),
          '  macOS: brew install php',
          '  Ubuntu/Debian: sudo apt-get install php php-dev',
          '  RHEL/CentOS: sudo dnf install php php-devel',
          '  Windows: Download from https://windows.php.net/download/'
        );
      } else {
        actualExecutablePath = foundPath;
      }
    }

    if (actualExecutablePath) {
      try {
        const res = spawnSync([actualExecutablePath, '--version'], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        if (res.exitCode === 0) {
          const version = res.stdout?.toString() || '' || res.stderr?.toString() || '';

          const versionMatch = version.match(/PHP (\d+)\.(\d+)\.(\d+)/);
          if (versionMatch) {
            const major = Number.parseInt(versionMatch[1], 10);
            const minor = Number.parseInt(versionMatch[2], 10);

            if (major < 7 || (major === 7 && minor < 2)) {
              errors.push(`PHP version ${major}.${minor} is too old. Excimer requires PHP 7.2+`);
              setupInstructions.push(chalk.bold('Upgrade PHP to 7.2 or newer'));
            }
          }
        }
      } catch (_error) {
        warnings.push('Could not determine PHP version');
      }
    }

    if (actualExecutablePath) {
      try {
        const res = spawnSync([actualExecutablePath, '-m'], { stdout: 'pipe', stderr: 'pipe' });
        if (res.exitCode === 0) {
          const modules = (
            (res.stdout?.toString() || '') + (res.stderr?.toString() || '')
          ).toLowerCase();

          if (!modules.includes('excimer')) {
            errors.push('Excimer extension is not installed');
            setupInstructions.push(
              chalk.bold('Install Excimer:'),
              '',
              chalk.bold('macOS:'),
              '  brew install php',
              '  pecl install excimer',
              '  # Identify your loaded php.ini (if none, create one first):',
              '  php --ini',
              '  # Then add the extension line to the loaded php.ini:',
              '  echo "extension=excimer.so" >> /path/to/your/php.ini',
              '',
              chalk.bold('Ubuntu/Debian:'),
              '  sudo apt-get install php-dev php-pear',
              '  sudo pecl install excimer',
              '  echo "extension=excimer.so" | sudo tee -a /etc/php/*/cli/php.ini',
              '',
              chalk.bold('From source:'),
              '  git clone https://github.com/wikimedia/mediawiki-php-excimer.git',
              '  cd mediawiki-php-excimer',
              '  phpize',
              '  ./configure',
              '  make',
              '  sudo make install',
              '  # Then add "extension=excimer.so" to your php.ini'
            );
          }
        }
      } catch (_error) {
        warnings.push('Could not check for Excimer extension');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      setupInstructions,
    };
  }

  getContainerCacheVolumes(cacheBaseDir: string, cwd: string) {
    const volumes: Array<{ hostPath: string; containerPath: string }> = [];

    const composerCacheDir = path.join(cacheBaseDir, 'composer');
    if (!fs.existsSync(composerCacheDir)) {
      fs.mkdirSync(composerCacheDir, { recursive: true });
    }
    volumes.push({
      hostPath: composerCacheDir,
      containerPath: '/root/.composer/cache',
    });

    const vendorCacheDir = this.getProjectCacheDir(cacheBaseDir, cwd, 'vendor');
    if (!fs.existsSync(vendorCacheDir)) {
      fs.mkdirSync(vendorCacheDir, { recursive: true });
    }
    volumes.push({
      hostPath: vendorCacheDir,
      containerPath: '/workspace/vendor',
    });

    return volumes;
  }

  async runProfilerInContainer(
    args: string[],
    _outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): Promise<void> {
    const cwd = path.resolve(options.cwd || process.cwd());
    const containerOutputPath = '/workspace/profile.speedscope.json';

    // Determine sampling period in SECONDS (default ≈ 0.001001001s => ~999Hz)
    const periodIdx = (options.extraProfilerArgs || []).indexOf('--period');
    let samplingPeriod = '0.001001001';
    if (periodIdx !== -1 && periodIdx + 1 < (options.extraProfilerArgs || []).length) {
      const secStr = String((options.extraProfilerArgs as string[])[periodIdx + 1]);
      const sec = Number.parseFloat(secStr);
      if (Number.isFinite(sec) && sec > 0) {
        samplingPeriod = secStr;
      }
    }

    const profilerScript = this.buildExcimerScript(containerOutputPath, samplingPeriod);

    // Write profiler bootstrap PHP script into workspace
    const tempScriptPath = path.join(cwd, '.uniprof-php-profiler.php');
    fs.writeFileSync(tempScriptPath, profilerScript);

    // Create a drop-in INI directory with auto_prepend_file to avoid mutating argv
    const iniDir = path.join(cwd, '.uniprof-php-ini');
    try {
      if (!fs.existsSync(iniDir)) fs.mkdirSync(iniDir, { recursive: true });
      const iniFile = path.join(iniDir, 'uniprof.ini');
      fs.writeFileSync(
        iniFile,
        `auto_prepend_file=${path.posix.join('/workspace', path.basename(tempScriptPath))}\n`
      );
    } catch {}

    const bootstrapCmd = '/usr/local/bin/bootstrap.sh';

    const containerArgs = args.map((arg, index) => {
      if (index === 0 && ['php', 'composer'].includes(arg)) {
        return arg;
      }
      return toContainerPath(cwd, arg);
    });

    const cacheBaseDir = path.join(os.homedir(), '.cache', 'uniprof');
    const volumes = [
      { hostPath: cwd, containerPath: '/workspace' },
      ...this.getContainerCacheVolumes(cacheBaseDir, cwd),
    ];

    // const containerScriptPath = `/workspace/${path.basename(tempScriptPath)}`;

    // Build container trampoline script
    const script = `set -e
source ${bootstrapCmd}

# Use INI scan directory to inject auto_prepend_file without altering argv
export PHP_INI_SCAN_DIR="/workspace/.uniprof-php-ini:\${PHP_INI_SCAN_DIR:-}"

# Split pre-args (unused) and app args at '::'
if [ "$1" = "::" ]; then shift; fi

exec "$@"`;

    // No pre-args needed; pass through all args so launchers like composer are preserved
    const fullCommand = buildBashTrampoline(script, [], containerArgs);

    const result = await runContainer({
      image: this.getContainerImage(),
      command: fullCommand,
      workdir: '/workspace',
      volumes: volumes.map((v) => `${v.hostPath}:${v.containerPath}`),
      verbose: options.verbose,
      captureOutput: !options.verbose,
      hostNetwork: !!options.enableHostNetworking,
      profilerProcessNames: [],
    });

    try {
      fs.unlinkSync(tempScriptPath);
    } catch {}

    if (result.exitCode !== 0) {
      if (result.exitCode === 130 || result.exitCode === 143) {
        throw new Error('SIGINT');
      }
      const { makeProfilerExitMessage } = await import('../utils/profiler-error.js');
      throw new Error(makeProfilerExitMessage(result.exitCode, result.stdout, result.stderr));
    }

    const containerProfilePath = path.join(cwd, 'profile.speedscope.json');
    if (fs.existsSync(containerProfilePath)) {
      setRawArtifact(context, 'speedscope', containerProfilePath);
      addTempFile(context, containerProfilePath);
      if (iniDir) addTempDir(context, iniDir);
    } else {
      throw new Error('Profile file was not created');
    }
  }

  buildLocalProfilerCommand(
    args: string[],
    outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): string[] {
    // Create the profiler script for local execution
    const cwd = path.resolve(options.cwd || process.cwd());
    const samplePeriod = this.extractSamplePeriod(options.extraProfilerArgs);

    // Write profiler bootstrap script
    const profilerScript = this.buildExcimerScript(outputPath, samplePeriod);
    const tempScriptPath = path.join(cwd, '.uniprof-php-profiler.php');
    fs.writeFileSync(tempScriptPath, profilerScript);
    addTempFile(context, tempScriptPath);

    // Create a drop-in INI directory and set PHP_INI_SCAN_DIR via environment variables
    const iniDir = path.join(cwd, '.uniprof-php-ini');
    if (!fs.existsSync(iniDir)) fs.mkdirSync(iniDir, { recursive: true });
    const iniFile = path.join(iniDir, 'uniprof.ini');
    fs.writeFileSync(iniFile, `auto_prepend_file=${tempScriptPath}\n`);
    const prev = process.env.PHP_INI_SCAN_DIR || '';
    mergeRuntimeEnv(context, { PHP_INI_SCAN_DIR: `${iniDir}${prev ? `:${prev}` : ''}` });
    addTempDir(context, iniDir);

    // Return the user's command unchanged; injection happens via INI scan dir
    return [...args];
  }

  async needsSudo(): Promise<boolean> {
    return false;
  }

  async postProcessProfile(
    _rawOutputPath: string,
    finalOutputPath: string,
    context: ProfileContext
  ): Promise<void> {
    const inPath = context.rawArtifact?.path || finalOutputPath;
    const { finalizeProfile } = await import('../utils/profile-context.js');
    await finalizeProfile(context, inPath, finalOutputPath, this.getExporterName());
  }

  async cleanup(context: ProfileContext): Promise<void> {
    if (context.tempFiles) {
      for (const f of context.tempFiles) {
        try {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        } catch {}
      }
    }
    if (context.tempDirs) {
      for (const d of context.tempDirs) {
        try {
          fs.rmSync(d, { recursive: true, force: true });
        } catch {}
      }
    }
  }

  getExampleCommand(): string {
    return 'php script.php';
  }

  getSamplingRate(extraProfilerArgs?: string[]): number | null {
    // --period is in SECONDS. Convert period (s) to frequency (Hz)
    if (extraProfilerArgs) {
      for (let i = 0; i < extraProfilerArgs.length; i++) {
        if (extraProfilerArgs[i] === '--period') {
          if (i + 1 < extraProfilerArgs.length) {
            const periodSec = Number.parseFloat(extraProfilerArgs[i + 1]);
            if (!Number.isNaN(periodSec) && periodSec > 0) {
              return Math.round(1 / periodSec);
            }
          }
        }
      }
    }
    // Default to ~999Hz (0.001001001 seconds)
    return 999;
  }

  private extractSamplePeriod(extraProfilerArgs?: string[]): string {
    if (extraProfilerArgs) {
      for (let i = 0; i < extraProfilerArgs.length; i++) {
        if (extraProfilerArgs[i] === '--period') {
          if (i + 1 < extraProfilerArgs.length) {
            const period = extraProfilerArgs[i + 1];
            // Validate it's a number
            if (!Number.isNaN(Number.parseFloat(period))) {
              return period;
            }
          }
        }
      }
    }
    // Default 999Hz = 0.001001001 seconds
    return '0.001001001';
  }

  getAdvancedOptions() {
    return {
      description: 'PHP profiling uses Excimer with auto_prepend_file injection',
      options: [
        {
          flag: '--period <seconds>',
          description: 'sampling period in seconds (default: ~0.001001s for ~999 Hz)',
        },
        { flag: '--max-depth <n>', description: 'stack depth limit for samples' },
      ],
      example: {
        description: 'Profile a PHP web application',
        command: 'uniprof record -o profile.json -- php -S localhost:8000',
      },
    };
  }

  private buildExcimerScript(outputPath: string, samplePeriod: string): string {
    return `<?php
// Auto-generated Excimer profiling script
if (!extension_loaded('excimer')) {
    fwrite(STDERR, "Excimer extension not loaded\n");
    exit(1);
}

$profiler = new ExcimerProfiler();
$profiler->setEventType(EXCIMER_REAL); // Wall-clock time
$profiler->setPeriod(${samplePeriod});
$profiler->start();

register_shutdown_function(function() use ($profiler) {
    $profiler->stop();
    $log = $profiler->flush();
    $speedscopeData = $log->getSpeedscopeData();

    // Add metadata
    $speedscopeData['name'] = 'PHP Profile';
    $speedscopeData['activeProfileIndex'] = 0;

    file_put_contents(
        '${outputPath}',
        json_encode($speedscopeData, JSON_PRETTY_PRINT)
    );
});
?>`;
  }
}
