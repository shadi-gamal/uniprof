import { describe, expect, it } from 'bun:test';
import { PythonPlatform } from '../src/platforms/python.js';

describe('PythonPlatform', () => {
  const platform = new PythonPlatform();

  describe('detectCommand', () => {
    it('detects python command', () => {
      expect(platform.detectCommand(['python', 'script.py'])).toBe(true);
      expect(platform.detectCommand(['python3', 'script.py'])).toBe(true);
      expect(platform.detectCommand(['python2', 'script.py'])).toBe(true);
    });

    it('detects uv run command', () => {
      expect(platform.detectCommand(['uv', 'run', 'python', 'script.py'])).toBe(true);
      expect(platform.detectCommand(['uv', 'run', 'app.py'])).toBe(true);
    });

    it('detects .py files directly', () => {
      expect(platform.detectCommand(['./script.py'])).toBe(true);
      expect(platform.detectCommand(['/usr/local/bin/script.py'])).toBe(true);
    });

    it('does not detect non-Python commands', () => {
      expect(platform.detectCommand(['node', 'app.js'])).toBe(false);
      expect(platform.detectCommand(['ruby', 'script.rb'])).toBe(false);
      expect(platform.detectCommand(['go', 'run', 'main.go'])).toBe(false);
    });

    it('returns false for empty args', () => {
      expect(platform.detectCommand([])).toBe(false);
    });
  });

  describe('detectExtension', () => {
    it('detects .py files', () => {
      expect(platform.detectExtension('script.py')).toBe(true);
      expect(platform.detectExtension('/path/to/module.py')).toBe(true);
      expect(platform.detectExtension('test.py')).toBe(true);
    });

    it('does not detect non-Python extensions', () => {
      expect(platform.detectExtension('script.js')).toBe(false);
      expect(platform.detectExtension('app.rb')).toBe(false);
      expect(platform.detectExtension('main.go')).toBe(false);
      expect(platform.detectExtension('binary')).toBe(false);
    });
  });

  describe('platform properties', () => {
    it('has correct name', () => {
      expect(platform.name).toBe('python');
    });

    it('uses py-spy as profiler', () => {
      expect(platform.profiler).toBe('py-spy');
    });

    it('has correct executables', () => {
      expect(platform.executables).toContain('python');
      expect(platform.executables).toContain('python3');
      expect(platform.executables).toContain('python2');
    });

    it('has correct extensions', () => {
      expect(platform.extensions).toContain('.py');
    });
  });

  describe('getContainerImage', () => {
    it('returns correct container image', () => {
      expect(platform.getContainerImage()).toBe('ghcr.io/indragiek/uniprof-python:latest');
    });
  });

  describe('getExampleCommand', () => {
    it('returns an example command', () => {
      const example = platform.getExampleCommand();
      expect(example).toBeTruthy();
      expect(typeof example).toBe('string');
      expect(example).toContain('python');
    });
  });

  describe('getAdvancedOptions', () => {
    it('returns advanced options with Python-specific information', () => {
      const options = platform.getAdvancedOptions();
      expect(options).toBeDefined();
      expect(options.description).toContain('py-spy');
      expect(options.options).toBeInstanceOf(Array);
      expect(options.example).toBeDefined();
      expect(options.example.command).toContain('python');
    });

    it('includes sampling rate option', () => {
      const options = platform.getAdvancedOptions();
      const rateOption = options.options.find((o) => o.flag.includes('--rate'));
      expect(rateOption).toBeDefined();
      expect(rateOption?.description).toContain('sampling rate');
    });

    it('includes subprocesses option', () => {
      const options = platform.getAdvancedOptions();
      const subprocessOption = options.options.find((o) => o.flag.includes('--subprocesses'));
      expect(subprocessOption).toBeDefined();
      expect(subprocessOption?.description).toContain('subprocess');
    });
  });

  describe('getSamplingRate', () => {
    it('should default to 999Hz', () => {
      const rate = platform.getSamplingRate();
      expect(rate).toBe(999);
    });

    it('should respect user override with --rate flag', () => {
      const rate = platform.getSamplingRate(['--rate', '500']);
      expect(rate).toBe(500);
    });

    it('should use default when invalid rate provided', () => {
      const rate = platform.getSamplingRate(['--rate', 'invalid']);
      expect(rate).toBe(999);
    });
  });

  describe('buildLocalProfilerCommand', () => {
    it('builds correct py-spy command with default rate', () => {
      const args = ['python', 'script.py', '--arg1', 'value1'];
      const outputPath = '/tmp/profile.json';
      const options = {};
      const context: any = {};

      const command = platform.buildLocalProfilerCommand(args, outputPath, options, context);

      expect(command).toContain('py-spy');
      expect(command).toContain('record');
      expect(command).toContain('--format');
      expect(command).toContain('speedscope');
      expect(command).toContain('-o');
      expect(command).toContain(outputPath);
      expect(command).toContain('--rate');
      expect(command).toContain('999');
      expect(command).toContain('--');
      expect(command).toContain('python');
      expect(command).toContain('script.py');
    });

    it('includes extra profiler args', () => {
      const args = ['python', 'script.py'];
      const outputPath = '/tmp/profile.json';
      const options = { extraProfilerArgs: ['--rate', '500', '--subprocesses'] };
      const context: any = {};

      const command = platform.buildLocalProfilerCommand(args, outputPath, options, context);

      expect(command).toContain('--rate');
      expect(command).toContain('500');
      expect(command).toContain('--subprocesses');
    });

    it('strips output path flags from extra args', () => {
      const args = ['python', 'script.py'];
      const outputPath = '/tmp/profile.json';
      const options = {
        extraProfilerArgs: ['-o', '/tmp/other.json', '--output', '/tmp/other2.json'],
      };
      const context: any = {};

      const command = platform.buildLocalProfilerCommand(args, outputPath, options, context);
      // Should include our managed output path
      const oidx = command.indexOf('-o');
      expect(oidx).toBeGreaterThan(-1);
      expect(command[oidx + 1]).toBe(outputPath);
      // User-provided outputs must not appear
      expect(command).not.toContain('/tmp/other.json');
      expect(command).not.toContain('/tmp/other2.json');
    });
  });

  describe('getContainerCacheVolumes', () => {
    it('includes pip cache directory', () => {
      const cacheBaseDir = '/tmp/cache';
      const cwd = '/project';

      const volumes = platform.getContainerCacheVolumes(cacheBaseDir, cwd);

      const pipVolume = volumes.find((v) => v.containerPath === '/root/.cache/pip');
      expect(pipVolume).toBeDefined();
    });

    it('includes UV cache directory', () => {
      const cacheBaseDir = '/tmp/cache';
      const cwd = '/project';

      const volumes = platform.getContainerCacheVolumes(cacheBaseDir, cwd);

      const uvVolume = volumes.find((v) => v.containerPath === '/root/.cache/uv');
      expect(uvVolume).toBeDefined();
    });
  });

  describe('needsSudo', () => {
    it('returns true', async () => {
      const needsSudo = await platform.needsSudo();
      expect(needsSudo).toBe(true);
    });
  });

  describe('uv run detection', () => {
    it('detects uv run with Python script', () => {
      expect(platform.detectCommand(['uv', 'run', 'python', 'script.py'])).toBe(true);
    });

    it('detects uv run with direct script', () => {
      expect(platform.detectCommand(['uv', 'run', 'app.py'])).toBe(true);
    });

    it('detects uv run with additional args', () => {
      expect(platform.detectCommand(['uv', 'run', '--no-sync', 'python', 'script.py'])).toBe(true);
    });
  });
});
