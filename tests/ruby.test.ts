import { describe, expect, it } from 'bun:test';
import { RubyPlatform } from '../src/platforms/ruby.js';

describe('RubyPlatform', () => {
  const platform = new RubyPlatform();

  describe('detectCommand', () => {
    it('detects ruby command', () => {
      expect(platform.detectCommand(['ruby', 'script.rb'])).toBe(true);
    });

    it('detects bundle exec command', () => {
      expect(platform.detectCommand(['bundle', 'exec', 'rails', 'server'])).toBe(true);
      expect(platform.detectCommand(['bundle', 'exec', 'rspec'])).toBe(true);
    });

    it('detects rails command', () => {
      expect(platform.detectCommand(['rails', 'server'])).toBe(true);
      expect(platform.detectCommand(['rails', 'console'])).toBe(true);
    });

    it('detects rake command', () => {
      expect(platform.detectCommand(['rake', 'db:migrate'])).toBe(true);
    });

    it('detects .rb files directly', () => {
      expect(platform.detectCommand(['./script.rb'])).toBe(true);
      expect(platform.detectCommand(['/usr/local/bin/app.rb'])).toBe(true);
    });

    it('does not detect non-Ruby commands', () => {
      expect(platform.detectCommand(['python', 'script.py'])).toBe(false);
      expect(platform.detectCommand(['node', 'app.js'])).toBe(false);
      expect(platform.detectCommand(['go', 'run', 'main.go'])).toBe(false);
    });

    it('returns false for empty args', () => {
      expect(platform.detectCommand([])).toBe(false);
    });
  });

  describe('detectExtension', () => {
    it('detects .rb files', () => {
      expect(platform.detectExtension('script.rb')).toBe(true);
      expect(platform.detectExtension('/path/to/app.rb')).toBe(true);
      expect(platform.detectExtension('test.rb')).toBe(true);
    });

    it('detects Gemfile', () => {
      expect(platform.detectExtension('Gemfile')).toBe(true);
      expect(platform.detectExtension('/project/Gemfile')).toBe(true);
    });

    it('detects Rakefile', () => {
      expect(platform.detectExtension('Rakefile')).toBe(true);
      expect(platform.detectExtension('/project/Rakefile')).toBe(true);
    });

    it('does not detect non-Ruby extensions', () => {
      expect(platform.detectExtension('script.py')).toBe(false);
      expect(platform.detectExtension('app.js')).toBe(false);
      expect(platform.detectExtension('main.go')).toBe(false);
      expect(platform.detectExtension('binary')).toBe(false);
    });
  });

  describe('platform properties', () => {
    it('has correct name', () => {
      expect(platform.name).toBe('ruby');
    });

    it('uses rbspy as profiler', () => {
      expect(platform.profiler).toBe('rbspy');
    });

    it('has correct executables', () => {
      expect(platform.executables).toContain('ruby');
      expect(platform.executables).toContain('bundle');
      expect(platform.executables).toContain('rails');
      expect(platform.executables).toContain('rake');
    });

    it('has correct extensions', () => {
      expect(platform.extensions).toContain('.rb');
      expect(platform.extensions).toContain('Gemfile');
      expect(platform.extensions).toContain('Rakefile');
    });
  });

  describe('getContainerImage', () => {
    it('returns correct container image', () => {
      expect(platform.getContainerImage()).toBe('ghcr.io/indragiek/uniprof-ruby:latest');
    });
  });

  describe('getExampleCommand', () => {
    it('returns an example command', () => {
      const example = platform.getExampleCommand();
      expect(example).toBeTruthy();
      expect(typeof example).toBe('string');
      expect(example).toContain('ruby');
    });
  });

  describe('getAdvancedOptions', () => {
    it('returns advanced options with Ruby-specific information', () => {
      const options = platform.getAdvancedOptions();
      expect(options).toBeDefined();
      expect(options.description).toContain('rbspy');
      expect(options.options).toBeInstanceOf(Array);
      expect(options.example).toBeDefined();
      expect(options.example.command).toContain('ruby');
    });

    it('includes sampling rate option', () => {
      const options = platform.getAdvancedOptions();
      const rateOption = options.options.find((o) => o.flag.includes('--rate'));
      expect(rateOption).toBeDefined();
      expect(rateOption?.description).toContain('Sampling rate');
    });

    it('includes subprocesses option', () => {
      const options = platform.getAdvancedOptions();
      const subprocessOption = options.options.find((o) => o.flag.includes('--subprocesses'));
      expect(subprocessOption).toBeDefined();
      expect(subprocessOption?.description).toContain('subprocess');
    });

    it('includes with-idle option', () => {
      const options = platform.getAdvancedOptions();
      const idleOption = options.options.find((o) => o.flag.includes('--with-idle'));
      expect(idleOption).toBeDefined();
      expect(idleOption?.description).toContain('idle');
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
    it('builds correct rbspy command with default rate', () => {
      const args = ['ruby', 'script.rb', '--arg1', 'value1'];
      const outputPath = '/tmp/profile.json';
      const options = {};
      const context: any = {};

      const command = platform.buildLocalProfilerCommand(args, outputPath, options, context);

      expect(command).toContain('rbspy');
      expect(command).toContain('record');
      expect(command).toContain('--format');
      expect(command).toContain('speedscope');
      expect(command).toContain('--file');
      expect(command).toContain(outputPath);
      expect(command).toContain('--rate');
      expect(command).toContain('999');
      expect(command).toContain('--');
      expect(command).toContain('ruby');
      expect(command).toContain('script.rb');
    });

    it('includes extra profiler args', () => {
      const args = ['ruby', 'script.rb'];
      const outputPath = '/tmp/profile.json';
      const options = { extraProfilerArgs: ['--rate', '500', '--subprocesses'] };
      const context: any = {};

      const command = platform.buildLocalProfilerCommand(args, outputPath, options, context);

      expect(command).toContain('--rate');
      expect(command).toContain('500');
      expect(command).toContain('--subprocesses');
    });

    it('strips --file from extra args', () => {
      const args = ['ruby', 'script.rb'];
      const outputPath = '/tmp/profile.json';
      const options = { extraProfilerArgs: ['--file', '/tmp/other.json'] };
      const context: any = {};

      const command = platform.buildLocalProfilerCommand(args, outputPath, options, context);
      // Should include our managed output path
      const fidx = command.indexOf('--file');
      expect(fidx).toBeGreaterThan(-1);
      expect(command[fidx + 1]).toBe(outputPath);
      // User-provided path should not appear
      expect(command).not.toContain('/tmp/other.json');
    });
  });

  describe('getContainerCacheVolumes', () => {
    it('includes bundle cache directory', () => {
      const cacheBaseDir = '/tmp/cache';
      const cwd = '/project';

      const volumes = platform.getContainerCacheVolumes(cacheBaseDir, cwd);

      const bundleVolume = volumes.find((v) => v.containerPath === '/usr/local/bundle');
      expect(bundleVolume).toBeDefined();
    });

    it('includes gem cache directory', () => {
      const cacheBaseDir = '/tmp/cache';
      const cwd = '/project';

      const volumes = platform.getContainerCacheVolumes(cacheBaseDir, cwd);

      const gemVolume = volumes.find((v) => v.containerPath === '/root/.gem');
      expect(gemVolume).toBeDefined();
    });
  });

  describe('needsSudo', () => {
    it('returns true', async () => {
      const needsSudo = await platform.needsSudo();
      expect(needsSudo).toBe(true);
    });
  });

  describe('bundle exec detection', () => {
    it('detects various bundle exec commands', () => {
      const bundleCommands = [
        ['bundle', 'exec', 'rails', 'server'],
        ['bundle', 'exec', 'rails', 'console'],
        ['bundle', 'exec', 'rspec'],
        ['bundle', 'exec', 'rake', 'test'],
        ['bundle', 'exec', 'puma'],
        ['bundle', 'exec', 'sidekiq'],
      ];

      for (const cmd of bundleCommands) {
        expect(platform.detectCommand(cmd)).toBe(true);
      }
    });
  });

  describe('Rails-specific detection', () => {
    it('detects Rails commands', () => {
      const railsCommands = [
        ['rails', 'server'],
        ['rails', 'console'],
        ['rails', 'generate', 'model', 'User'],
        ['rails', 'db:migrate'],
        ['rails', 'test'],
      ];

      for (const cmd of railsCommands) {
        expect(platform.detectCommand(cmd)).toBe(true);
      }
    });
  });
});
