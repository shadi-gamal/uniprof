import { describe, expect, it } from 'bun:test';
import { DotnetPlatform } from '../src/platforms/dotnet.js';
import { platformRegistry } from '../src/platforms/registry.js';

describe('DotnetPlatform', () => {
  const platform = new DotnetPlatform();

  describe('detectCommand', () => {
    it('detects dotnet command', () => {
      expect(platform.detectCommand(['dotnet', 'run'])).toBe(true);
      expect(platform.detectCommand(['dotnet', 'build'])).toBe(true);
      expect(platform.detectCommand(['dotnet', 'test'])).toBe(true);
      expect(platform.detectCommand(['dotnet', 'MyApp.dll'])).toBe(true);
    });

    it('detects .cs files', () => {
      expect(platform.detectCommand(['Program.cs'])).toBe(true);
      expect(platform.detectCommand(['./MyApp.cs'])).toBe(true);
      expect(platform.detectCommand(['/path/to/script.cs'])).toBe(true);
    });

    it('detects .dll files', () => {
      expect(platform.detectCommand(['MyApp.dll'])).toBe(true);
      expect(platform.detectCommand(['./build/MyLibrary.dll'])).toBe(true);
      expect(platform.detectCommand(['/path/to/Application.dll'])).toBe(true);
    });

    it('detects .exe files', () => {
      expect(platform.detectCommand(['MyApp.exe'])).toBe(true);
      expect(platform.detectCommand(['./bin/Application.exe'])).toBe(true);
      expect(platform.detectCommand(['/path/to/program.exe'])).toBe(true);
    });

    it('does not detect non-.NET commands', () => {
      expect(platform.detectCommand(['python', 'script.py'])).toBe(false);
      expect(platform.detectCommand(['node', 'app.js'])).toBe(false);
      expect(platform.detectCommand(['java', '-jar', 'app.jar'])).toBe(false);
      expect(platform.detectCommand(['ruby', 'script.rb'])).toBe(false);
    });

    it('does not detect non-.NET files', () => {
      expect(platform.detectCommand(['script.py'])).toBe(false);
      expect(platform.detectCommand(['app.js'])).toBe(false);
      expect(platform.detectCommand(['main.go'])).toBe(false);
      expect(platform.detectCommand(['app.jar'])).toBe(false);
    });

    it('returns false for empty args', () => {
      expect(platform.detectCommand([])).toBe(false);
    });

    it('does not misclassify non-.NET ELF-like files with weak strings', async () => {
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uniprof-dotnet-test-'));
      const fakePath = path.join(tmp, 'fakebin');
      // Write arbitrary content containing only a single common CLR string
      fs.writeFileSync(fakePath, 'this is not dotnet\n... coreclr ...');
      try {
        expect(platform.detectCommand([fakePath])).toBe(false);
      } finally {
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
        } catch {}
      }
    });

    it('detects self-contained single-file apps via DOTNET_BUNDLE signature', async () => {
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uniprof-dotnet-test-'));
      const fakePath = path.join(tmp, 'fakeapp');
      // Embed DOTNET_BUNDLE marker used by single-file apps
      fs.writeFileSync(fakePath, 'random\0binary\0data DOTNET_BUNDLE some');
      try {
        expect(platform.detectCommand([fakePath])).toBe(true);
      } finally {
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
        } catch {}
      }
    });
  });

  describe('detectExtension', () => {
    it('detects .cs files', () => {
      expect(platform.detectExtension('Program.cs')).toBe(true);
      expect(platform.detectExtension('/path/to/MyClass.cs')).toBe(true);
      expect(platform.detectExtension('script.cs')).toBe(true);
    });

    it('detects .dll files', () => {
      expect(platform.detectExtension('MyLibrary.dll')).toBe(true);
      expect(platform.detectExtension('/path/to/Application.dll')).toBe(true);
      expect(platform.detectExtension('System.Core.dll')).toBe(true);
    });

    it('detects .exe files', () => {
      expect(platform.detectExtension('MyApp.exe')).toBe(true);
      expect(platform.detectExtension('/path/to/program.exe')).toBe(true);
      expect(platform.detectExtension('console.exe')).toBe(true);
    });

    it('does not detect other C# related extensions', () => {
      expect(platform.detectExtension('project.csproj')).toBe(false);
      expect(platform.detectExtension('solution.sln')).toBe(false);
      expect(platform.detectExtension('config.json')).toBe(false);
      expect(platform.detectExtension('app.config')).toBe(false);
    });

    it('does not detect non-.NET extensions', () => {
      expect(platform.detectExtension('script.py')).toBe(false);
      expect(platform.detectExtension('app.js')).toBe(false);
      expect(platform.detectExtension('main.go')).toBe(false);
      expect(platform.detectExtension('app.jar')).toBe(false);
      expect(platform.detectExtension('binary')).toBe(false);
    });
  });

  describe('platform properties', () => {
    it('has correct name', () => {
      expect(platform.name).toBe('dotnet');
    });

    it('uses dotnet-trace as profiler', () => {
      expect(platform.profiler).toBe('dotnet-trace');
    });

    it('has dotnet as executable', () => {
      expect(platform.executables).toEqual(['dotnet']);
      expect(platform.executables).not.toContain('csharp');
      expect(platform.executables).not.toContain('fsharp');
    });

    it('has .NET file extensions', () => {
      expect(platform.extensions).toEqual(['.cs', '.dll', '.exe']);
      expect(platform.extensions).toContain('.cs');
      expect(platform.extensions).toContain('.dll');
      expect(platform.extensions).toContain('.exe');
      expect(platform.extensions).not.toContain('.csproj');
      expect(platform.extensions).not.toContain('.sln');
    });
  });

  describe('getContainerImage', () => {
    it('returns correct container image', () => {
      expect(platform.getContainerImage()).toBe('ghcr.io/indragiek/uniprof-dotnet:latest');
    });
  });

  describe('getExporterName', () => {
    it('returns correct exporter name', () => {
      expect(platform.getExporterName()).toBe('uniprof-dotnet');
    });
  });

  describe('getExampleCommand', () => {
    it('returns an example command', () => {
      const example = platform.getExampleCommand();
      expect(example).toBeTruthy();
      expect(typeof example).toBe('string');
      expect(example).toContain('dotnet');
    });
  });

  describe('getSamplingRate', () => {
    it('should return null (dotnet-trace does not expose sampling rate)', () => {
      const rate = platform.getSamplingRate();
      expect(rate).toBe(null);
    });

    it('should return null even with extra args', () => {
      const rate = platform.getSamplingRate(['--duration', '00:00:30']);
      expect(rate).toBe(null);
    });
  });

  describe('transformCommand', () => {
    it('should transform .dll files to dotnet command', () => {
      const result = platform.transformCommand(['MyApp.dll', 'arg1']);
      expect(result).toEqual(['dotnet', 'MyApp.dll', 'arg1']);
    });

    it('should run self-contained .exe directly (no dotnet prefix)', () => {
      const result = platform.transformCommand(['MyApp.exe', 'arg1']);
      expect(result).toEqual(['MyApp.exe', 'arg1']);
    });

    it('should transform .cs files to dotnet run command with separator', () => {
      const result = platform.transformCommand(['Program.cs', 'arg1']);
      expect(result).toEqual(['dotnet', 'run', 'Program.cs', '--', 'arg1']);
    });

    it('should pass through dotnet commands unchanged', () => {
      const result = platform.transformCommand(['dotnet', 'run', 'MyApp']);
      expect(result).toEqual(['dotnet', 'run', 'MyApp']);
    });

    it('should pass through other commands unchanged', () => {
      const result = platform.transformCommand(['./MyApp']);
      expect(result).toEqual(['./MyApp']);
    });

    it('should handle empty args', () => {
      const result = platform.transformCommand([]);
      expect(result).toEqual([]);
    });
  });

  describe('getAdvancedOptions', () => {
    it('returns advanced options with dotnet-trace information', () => {
      const options = platform.getAdvancedOptions();
      expect(options).toBeDefined();
      expect(options.description).toContain('dotnet-trace');
      expect(options.options).toBeInstanceOf(Array);
      expect(options.example).toBeDefined();
      expect(options.example.command).toContain('dotnet');
    });

    it('includes duration option', () => {
      const options = platform.getAdvancedOptions();
      const durationOption = options.options.find((o) => o.flag.includes('--duration'));
      expect(durationOption).toBeDefined();
      expect(durationOption?.description).toContain('Duration');
    });

    it('includes buffer size option', () => {
      const options = platform.getAdvancedOptions();
      const bufferOption = options.options.find((o) => o.flag.includes('--buffersize'));
      expect(bufferOption).toBeDefined();
      expect(bufferOption?.description).toContain('buffer size');
    });

    it('includes providers option', () => {
      const options = platform.getAdvancedOptions();
      const providersOption = options.options.find((o) => o.flag.includes('--providers'));
      expect(providersOption).toBeDefined();
      expect(providersOption?.description).toContain('event providers');
    });

    it('includes profile option', () => {
      const options = platform.getAdvancedOptions();
      const profileOption = options.options.find((o) => o.flag.includes('--profile'));
      expect(profileOption).toBeDefined();
      expect(profileOption?.description).toContain('predefined profile');
    });
  });

  describe('registry integration', () => {
    it('is registered in platform registry', () => {
      const dotnetPlatform = platformRegistry.get('dotnet');
      expect(dotnetPlatform).not.toBeNull();
      expect(dotnetPlatform?.name).toBe('dotnet');
      expect(dotnetPlatform?.profiler).toBe('dotnet-trace');
    });

    it('is detected by registry from dotnet command', async () => {
      const detected = await platformRegistry.detectFromCommand(['dotnet', 'run']);
      expect(detected).not.toBeNull();
      expect(detected?.name).toBe('dotnet');
    });

    it('is detected by registry from .cs file', async () => {
      const detected = await platformRegistry.detectFromCommand(['Program.cs']);
      expect(detected).not.toBeNull();
      expect(detected?.name).toBe('dotnet');
    });

    it('is detected by registry from .dll file', async () => {
      const detected = await platformRegistry.detectFromCommand(['MyApp.dll']);
      expect(detected).not.toBeNull();
      expect(detected?.name).toBe('dotnet');
    });

    it('is detected by registry from .exe file', async () => {
      const detected = await platformRegistry.detectFromCommand(['MyApp.exe']);
      expect(detected).not.toBeNull();
      expect(detected?.name).toBe('dotnet');
    });
  });

  describe('command transformation', () => {
    it('handles different file types correctly', () => {
      // C# source files should use dotnet run
      expect(platform.detectCommand(['script.cs'])).toBe(true);

      // DLL files should be run with dotnet
      expect(platform.detectCommand(['app.dll'])).toBe(true);

      // EXE files should be run with dotnet
      expect(platform.detectCommand(['console.exe'])).toBe(true);

      // Direct dotnet commands should be detected
      expect(platform.detectCommand(['dotnet', 'build'])).toBe(true);
    });

    it('maintains command consistency', () => {
      // All .NET related commands should be properly detected
      const commands = [
        ['dotnet', 'run'],
        ['dotnet', 'build', 'MyProject.csproj'],
        ['dotnet', 'test'],
        ['MyApp.dll'],
        ['Program.cs'],
        ['console.exe'],
      ];

      for (const cmd of commands) {
        expect(platform.detectCommand(cmd)).toBe(true);
      }
    });
  });

  describe('needsSudo', () => {
    it('returns boolean for sudo requirement', async () => {
      const needsSudo = await platform.needsSudo();
      expect(typeof needsSudo).toBe('boolean');
      // dotnet-trace typically doesn't need sudo
      expect(needsSudo).toBe(false);
    });
  });

  describe('buildLocalProfilerCommand', () => {
    it('strips output path flags from extra args', () => {
      const p = new DotnetPlatform();
      const args = ['dotnet', 'run'];
      const outputPath = '/tmp/profile.json';
      const options: any = { output: outputPath, extraProfilerArgs: ['-o', '/tmp/other.nettrace'] };
      const context: any = {};
      const cmd = p.buildLocalProfilerCommand(args, outputPath, options, context);
      const idx = cmd.indexOf('-o');
      expect(idx).toBeGreaterThan(-1);
      expect(cmd[idx + 1]).toBe(outputPath.replace('.json', '.nettrace'));
      expect(cmd).not.toContain('/tmp/other.nettrace');
    });
  });
});
