import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';
import type { ProfilerEnvironmentCheck } from '../types/index.js';
import type { DockerVolume, ProfileContext, RecordOptions } from '../types/platform-plugin.js';
import { stripOutputPathFlags } from '../utils/cli-parsing.js';
import { runContainer } from '../utils/docker.js';
import { printWarning } from '../utils/output-formatter.js';
import { toContainerPath } from '../utils/path-utils.js';
import { setRawArtifact } from '../utils/profile-context.js';
import { spawn, spawnSync } from '../utils/spawn.js';
import { buildBashTrampoline } from '../utils/trampoline.js';
import { BasePlatform } from './base-platform.js';

export class DotnetPlatform extends BasePlatform {
  readonly name = 'dotnet';
  readonly profiler = 'dotnet-trace';
  readonly extensions = ['.cs', '.dll', '.exe'];
  readonly executables = ['dotnet'];

  detectCommand(args: string[]): boolean {
    if (args.length === 0) return false;
    const cmd = args[0];
    const basename = path.basename(cmd);

    // Check for dotnet executable
    if (basename === 'dotnet') {
      return true;
    }

    // Check for .NET file extensions
    if (basename.endsWith('.cs') || basename.endsWith('.dll') || basename.endsWith('.exe')) {
      return true;
    }

    // Check for executables that might use .NET runtime
    // Allow paths like ./Test or /path/to/Test
    return this.isDotNetExecutable(cmd);
  }

  /**
   * Check if an executable path is likely a .NET program
   * Based on the bash script logic provided in the requirements
   */
  private isDotNetExecutable(executablePath: string): boolean {
    // Try to resolve via PATH if the direct path does not exist
    const resolveInPath = (cmd: string): string | null => {
      try {
        const whichCmd = process.platform === 'win32' ? 'where' : 'which';
        const res = spawnSync([whichCmd, cmd], { stdout: 'pipe', stderr: 'pipe' });
        if (res.exitCode === 0 && res.stdout) {
          // On Windows, `where` may return multiple lines; take the first
          const out = res.stdout
            .toString()
            .split(/\r?\n/)
            .find((l) => l.trim().length > 0);
          return out ? out.trim() : null;
        }
      } catch {}
      return null;
    };

    try {
      let pathToCheck = executablePath;
      if (!fs.existsSync(pathToCheck)) {
        const resolved = resolveInPath(executablePath);
        if (!resolved) return false;
        pathToCheck = resolved;
      }

      const stats = fs.statSync(pathToCheck);
      if (!stats.isFile()) {
        return false;
      }

      // Check if it's a text script that might be a dotnet shim
      try {
        const firstLine = fs.readFileSync(pathToCheck, 'utf8').split('\n')[0];
        if (
          firstLine.includes('/dotnet') &&
          (firstLine.includes('#!/') || firstLine.includes('dotnet'))
        ) {
          return true;
        }
      } catch {
        // Not a text file, continue with binary checks
      }

      // Check for strong .NET runtime signatures in the binary
      try {
        const content = fs.readFileSync(pathToCheck);
        const contentStr = content.toString('binary');

        // Heuristics tightened to avoid false positives:
        // - Self-contained single-file apps embed 'DOTNET_BUNDLE'
        // - Framework-dependent shims typically include both hostfxr and hostpolicy
        const hasBundle = contentStr.includes('DOTNET_BUNDLE');
        const hasHostFxr = contentStr.includes('hostfxr') || contentStr.includes('libhostfxr');
        const hasHostPolicy = contentStr.includes('hostpolicy');

        if (hasBundle || (hasHostFxr && hasHostPolicy)) {
          return true;
        }
      } catch {
        // Could not read as binary, continue with sidecar checks
      }

      // Check for sidecar managed files
      const dir = path.dirname(pathToCheck);
      const basename = path.basename(pathToCheck);
      const nameWithoutExt = basename.includes('.')
        ? basename.substring(0, basename.lastIndexOf('.'))
        : basename;

      const sidecarFiles = [
        path.join(dir, `${nameWithoutExt}.dll`),
        path.join(dir, `${nameWithoutExt}.runtimeconfig.json`),
        path.join(dir, `${nameWithoutExt}.deps.json`),
      ];

      for (const sidecarFile of sidecarFiles) {
        if (fs.existsSync(sidecarFile)) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  async checkLocalEnvironment(executablePath?: string): Promise<ProfilerEnvironmentCheck> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const setupInstructions: string[] = [];

    // Check .NET installation
    let actualExecutablePath = executablePath;
    if (!actualExecutablePath) {
      const foundPath = await this.findExecutableInPath();
      if (!foundPath) {
        errors.push('.NET SDK is not installed or not in PATH');
        const platform = os.platform();
        if (platform === 'darwin') {
          setupInstructions.push(
            chalk.bold('Install .NET SDK on macOS:'),
            '  Via Homebrew:',
            '    brew install dotnet',
            '  Or use the official installer:',
            '    https://dotnet.microsoft.com/download'
          );
        } else if (platform === 'linux') {
          setupInstructions.push(
            chalk.bold('Install .NET SDK on Linux (official script):'),
            '  curl -fsSL https://dot.net/v1/dotnet-install.sh -o dotnet-install.sh',
            '  chmod +x dotnet-install.sh',
            '  ./dotnet-install.sh --channel STS',
            '  # See distro-specific instructions as an alternative:',
            '  https://learn.microsoft.com/dotnet/core/install/linux'
          );
        } else {
          setupInstructions.push(
            chalk.bold('Install .NET SDK:'),
            '  https://dotnet.microsoft.com/download'
          );
        }
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
          const version = (res.stdout?.toString() || '').trim();
          if (version) {
            const versionMatch = version.match(/^(\d+)\.(\d+)/);
            if (versionMatch) {
              const major = Number.parseInt(versionMatch[1], 10);
              if (major < 6) {
                warnings.push(`.NET version ${version} is outdated. Recommend .NET 6+`);
              }
            }
          }
        }
      } catch (_error) {
        warnings.push('Could not determine .NET version');
      }
    }

    // Check for dotnet-trace
    try {
      const res = spawnSync(['dotnet-trace', '--version'], { stdout: 'pipe', stderr: 'pipe' });
      if (res.exitCode !== 0) throw new Error('dotnet-trace not found');
    } catch (_error) {
      errors.push('dotnet-trace is not installed');
      setupInstructions.push(
        chalk.bold('Install dotnet-trace:'),
        '  dotnet tool install --global dotnet-trace',
        '  ',
        '  Make sure ~/.dotnet/tools is in your PATH:',
        '  export PATH="$PATH:$HOME/.dotnet/tools"'
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      setupInstructions,
    };
  }

  getContainerCacheVolumes(cacheBaseDir: string, cwd: string): DockerVolume[] {
    const volumes: DockerVolume[] = [];

    // NuGet packages cache
    const nugetCacheDir = path.join(cacheBaseDir, 'nuget');
    if (!fs.existsSync(nugetCacheDir)) {
      fs.mkdirSync(nugetCacheDir, { recursive: true });
    }
    volumes.push({
      hostPath: nugetCacheDir,
      containerPath: '/root/.nuget',
    });

    // Project build output cache
    const buildCacheDir = this.getProjectCacheDir(cacheBaseDir, cwd, 'dotnet-build');
    if (!fs.existsSync(buildCacheDir)) {
      fs.mkdirSync(buildCacheDir, { recursive: true });
    }
    volumes.push({
      hostPath: buildCacheDir,
      containerPath: '/workspace/bin',
    });

    return volumes;
  }

  /**
   * Transform command arguments to proper dotnet format
   */
  public transformCommand(args: string[]): string[] {
    if (args.length === 0) return args;

    const firstArg = args[0];
    const basename = path.basename(firstArg);

    // Helper to resolve an executable from PATH (mirrors logic in isDotNetExecutable)
    const resolveInPath = (cmd: string): string | null => {
      try {
        const whichCmd = process.platform === 'win32' ? 'where' : 'which';
        const res = spawnSync([whichCmd, cmd], { stdout: 'pipe', stderr: 'pipe' });
        if (res.exitCode === 0 && res.stdout) {
          const out = res.stdout
            .toString()
            .split(/\r?\n/)
            .find((l) => l.trim().length > 0);
          return out ? out.trim() : null;
        }
      } catch {}
      return null;
    };

    // If already using the dotnet launcher, preserve as-is
    if (basename === 'dotnet') {
      return args;
    }

    // Handle .dll files - convert to "dotnet <path>"
    if (basename.endsWith('.dll')) {
      return ['dotnet', ...args];
    }

    // Handle .exe files - run directly. Self-contained .NET executables should not be invoked via 'dotnet'.
    if (basename.endsWith('.exe')) {
      return args;
    }

    // Handle .cs files - convert to "dotnet run <path> -- <program-args>"
    if (basename.endsWith('.cs')) {
      const [file, ...rest] = args;
      // .NET SDK 10+ supports: dotnet run <file.cs>
      const major = this.getDotnetSdkMajor();
      if (typeof major === 'number' && major < 10) {
        printWarning(
          'dotnet run <file.cs> requires .NET SDK 10+. Your SDK appears older; this may fail. Consider using a project (csproj) or upgrading the SDK.'
        );
      }
      return ['dotnet', 'run', file, '--', ...rest];
    }

    // Check for .NET executables without extensions
    // Native .NET executables (self-contained) should be run directly, not through dotnet
    if (!firstArg.includes('.') && this.isDotNetExecutable(firstArg)) {
      // Check if this is a native executable by examining its binary magic
      try {
        let pathToCheck = firstArg;
        if (!fs.existsSync(pathToCheck)) {
          const resolved = resolveInPath(firstArg);
          if (resolved) pathToCheck = resolved;
        }
        const stats = fs.statSync(pathToCheck);
        if (stats.isFile()) {
          const content = fs.readFileSync(pathToCheck);
          if (content.length >= 4) {
            const elf =
              content[0] === 0x7f &&
              content[1] === 0x45 &&
              content[2] === 0x4c &&
              content[3] === 0x46;
            const machoBE = content.readUInt32BE(0);
            const MACHO_MAGICS = new Set<number>([
              0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xcafebabf,
            ]);
            const mach = MACHO_MAGICS.has(machoBE);
            const mz = content[0] === 0x4d && content[1] === 0x5a; // Windows PE
            // If it looks like a native image for this OS family, run directly
            if (elf || mach || mz) {
              return args;
            }
          }
        }
      } catch {
        // If we can't read it, assume it needs dotnet
      }
      // Default to running through dotnet for framework-dependent executables
      return ['dotnet', ...args];
    }

    // If it's already a dotnet command, pass through
    return args;
  }

  private getDotnetSdkMajor(): number | null {
    try {
      const proc = spawnSync(['dotnet', '--version'], { stdout: 'pipe', stderr: 'pipe' });
      if (proc.exitCode !== 0) return null;
      const v = (proc.stdout?.toString() || '').trim();
      const m = v.match(/^(\d+)\./);
      if (!m) return null;
      return Number.parseInt(m[1], 10);
    } catch {
      return null;
    }
  }

  async runProfilerInContainer(
    args: string[],
    _outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): Promise<void> {
    const cwd = path.resolve(options.cwd || process.cwd());
    const containerOutputPath = '/workspace/profile.nettrace';

    const bootstrapCmd = '/usr/local/bin/bootstrap.sh';

    // Transform the command
    const transformedArgs = this.transformCommand(args);

    // Map paths to container paths
    const containerArgs = transformedArgs.map((arg, index) => {
      if (index === 0 && arg === 'dotnet') return arg;
      return toContainerPath(cwd, arg);
    });

    // Build dotnet-trace collect command outside and pass to the trampoline
    // Prevent overriding output path (-o/--output)
    const outStrip = stripOutputPathFlags(options.extraProfilerArgs as string[] | undefined, [
      '-o',
      '--output',
    ]);
    if (outStrip.removed.length) {
      printWarning(
        `Ignoring output-related flags in --extra-profiler-args for dotnet-trace: ${outStrip.removed.join(' ')}`
      );
    }

    const traceArgs = [
      'dotnet-trace',
      'collect',
      '--profile',
      'cpu-sampling',
      '-o',
      containerOutputPath,
      ...(outStrip.filtered || []),
      '--',
      ...containerArgs,
    ];

    const script = `set -e
source ${bootstrapCmd}

# Split pre-args (dotnet-trace collect + args) and app args at '::'
PRE=()
while [ "$#" -gt 0 ]; do
  if [ "$1" = "::" ]; then shift; break; fi
  PRE+=("$1"); shift
done

"\${PRE[@]}"
dotnet-trace convert ${containerOutputPath} --format Speedscope -o /workspace/profile.json`;

    const fullCommand = buildBashTrampoline(script, traceArgs, []);

    const cacheBaseDir = path.join(os.homedir(), '.cache', 'uniprof');
    const volumes = [
      { hostPath: cwd, containerPath: '/workspace' },
      ...this.getContainerCacheVolumes(cacheBaseDir, cwd),
    ];

    const containerResult = await runContainer({
      image: this.getContainerImage(),
      command: fullCommand,
      workdir: '/workspace',
      volumes: volumes.map((v) => `${v.hostPath}:${v.containerPath}`),
      capabilities: ['SYS_PTRACE'],
      verbose: options.verbose,
      captureOutput: !options.verbose,
      hostNetwork: !!options.enableHostNetworking,
      profilerProcessNames: ['dotnet-trace'],
    });

    if (
      containerResult.exitCode !== 0 &&
      containerResult.exitCode !== 130 &&
      containerResult.exitCode !== 143
    ) {
      const { makeProfilerExitMessage } = await import('../utils/profiler-error.js');
      throw new Error(
        makeProfilerExitMessage(
          containerResult.exitCode,
          containerResult.stdout,
          containerResult.stderr
        )
      );
    }

    // Look for the converted profile JSON from container and defer normalization
    const profilePath = path.join(cwd, 'profile.json');
    const speedscopeProfilePath = path.join(cwd, 'profile.speedscope.json');

    let actualProfilePath: string | null = null;
    if (fs.existsSync(profilePath)) {
      actualProfilePath = profilePath;
    } else if (fs.existsSync(speedscopeProfilePath)) {
      actualProfilePath = speedscopeProfilePath;
    }

    if (!actualProfilePath) {
      throw new Error('Profile file was not created in container');
    }

    // Defer normalization/exporter to postProcessProfile
    setRawArtifact(context, 'speedscope', actualProfilePath);
  }

  buildLocalProfilerCommand(
    args: string[],
    outputPath: string,
    options: RecordOptions,
    context: ProfileContext
  ): string[] {
    // Transform the command
    const transformedArgs = this.transformCommand(args);

    // Create a temporary file for the .nettrace output
    const tempOutputPath = outputPath.replace('.json', '.nettrace');
    setRawArtifact(context, 'nettrace', tempOutputPath);

    // Build dotnet-trace command
    const traceCmd = ['dotnet-trace', 'collect', '--profile', 'cpu-sampling', '-o', tempOutputPath];

    // Add extra profiler arguments if provided
    // Prevent overriding output path (-o/--output)
    const outStrip = stripOutputPathFlags(options.extraProfilerArgs as string[] | undefined, [
      '-o',
      '--output',
    ]);
    if (outStrip.removed.length) {
      printWarning(
        `Ignoring output-related flags in --extra-profiler-args for dotnet-trace: ${outStrip.removed.join(' ')}`
      );
    }

    if (outStrip.filtered.length > 0) {
      traceCmd.push(...outStrip.filtered);
    }

    // Add the application command after --
    traceCmd.push('--', ...transformedArgs);

    return traceCmd;
  }

  async postProcessProfile(
    rawOutputPath: string,
    finalOutputPath: string,
    context: ProfileContext
  ): Promise<void> {
    const artifact = context.rawArtifact;
    try {
      // Convert .nettrace to speedscope if needed (host mode)
      if (artifact?.type === 'nettrace' && fs.existsSync(artifact.path)) {
        const convertProc = spawn(
          [
            'dotnet-trace',
            'convert',
            artifact.path,
            '--format',
            'Speedscope',
            '-o',
            finalOutputPath,
          ],
          { stdout: 'pipe', stderr: 'pipe' }
        );

        const exitCode = await convertProc.exited;
        if (exitCode !== 0) {
          throw new Error('Failed to convert .nettrace to speedscope format');
        }

        // dotnet-trace creates .speedscope.json files even when we specify different output
        let resolved = finalOutputPath;
        if (!fs.existsSync(finalOutputPath)) {
          const speedscopeOutputPath = finalOutputPath.replace('.json', '.speedscope.json');
          if (fs.existsSync(speedscopeOutputPath)) {
            fs.renameSync(speedscopeOutputPath, finalOutputPath);
            resolved = finalOutputPath;
          } else {
            throw new Error('Converted profile file was not created');
          }
        }
        const { finalizeProfile } = await import('../utils/profile-context.js');
        await finalizeProfile(context, resolved, finalOutputPath, this.getExporterName());
      } else if (artifact?.type === 'speedscope' && fs.existsSync(artifact.path)) {
        const { finalizeProfile } = await import('../utils/profile-context.js');
        await finalizeProfile(context, artifact.path, finalOutputPath, this.getExporterName());
      } else {
        throw new Error(`Profile file was not created at ${rawOutputPath}`);
      }
    } finally {
      // Cleanup intermediate .nettrace even on errors (host mode)
      if (artifact?.type === 'nettrace' && fs.existsSync(artifact.path)) {
        try {
          fs.unlinkSync(artifact.path);
        } catch {}
      }
    }
  }

  async needsSudo(): Promise<boolean> {
    // dotnet-trace typically doesn't need elevated permissions
    return false;
  }

  getExampleCommand(): string {
    return 'dotnet run Program.cs';
  }

  getSamplingRate(_extraProfilerArgs?: string[]): number | null {
    // dotnet-trace doesn't expose sampling rate configuration directly
    // Return null to indicate rate is not configurable/known
    return null;
  }

  getAdvancedOptions() {
    return {
      description: 'dotnet-trace supports additional options via --extra-profiler-args:',
      options: [
        {
          flag: '--duration <time>',
          description: 'Duration to collect trace (e.g., 00:00:30 for 30 seconds)',
        },
        {
          flag: '--buffersize <size>',
          description: 'Set circular buffer size in MB (default: 256)',
        },
        { flag: '--providers <providers>', description: 'Specify custom event providers' },
        {
          flag: '--profile <profile>',
          description: 'Use predefined profile (cpu-sampling, gc-verbose, gc-collect)',
        },
        { flag: '--clreventlevel <level>', description: 'CLR event verbosity level' },
        { flag: '--clrevents <events>', description: 'CLR runtime provider keywords' },
      ],
      example: {
        description: 'Profile for 30 seconds with custom buffer size',
        command:
          'uniprof record -o profile.json --extra-profiler-args --duration 00:00:30 --buffersize 512 -- dotnet run',
      },
    };
  }
}
