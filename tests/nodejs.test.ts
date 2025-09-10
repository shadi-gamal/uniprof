import { describe, expect, it } from 'bun:test';
import { NodejsPlatform } from '../src/platforms/nodejs.js';

describe('NodejsPlatform', () => {
  const platform = new NodejsPlatform();

  describe('detectCommand', () => {
    it('detects node command', () => {
      expect(platform.detectCommand(['node', 'app.js'])).toBe(true);
    });

    it('detects npm run commands', () => {
      expect(platform.detectCommand(['npm', 'run', 'start'])).toBe(true);
      expect(platform.detectCommand(['npm', 'start'])).toBe(true);
      expect(platform.detectCommand(['npm', 'test'])).toBe(true);
      expect(platform.detectCommand(['npm', 'run', 'dev'])).toBe(true);
    });

    it('detects npx commands', () => {
      expect(platform.detectCommand(['npx', 'ts-node', 'app.ts'])).toBe(true);
      expect(platform.detectCommand(['npx', 'nodemon', 'server.js'])).toBe(true);
    });

    it('detects yarn commands', () => {
      expect(platform.detectCommand(['yarn', 'start'])).toBe(true);
      expect(platform.detectCommand(['yarn', 'run', 'dev'])).toBe(true);
      expect(platform.detectCommand(['yarn', 'test'])).toBe(true);
    });

    it('detects pnpm commands', () => {
      expect(platform.detectCommand(['pnpm', 'start'])).toBe(true);
      expect(platform.detectCommand(['pnpm', 'run', 'dev'])).toBe(true);
      expect(platform.detectCommand(['pnpm', 'test'])).toBe(true);
    });

    it('detects tsx command', () => {
      expect(platform.detectCommand(['tsx', 'app.ts'])).toBe(true);
    });

    it('detects ts-node command', () => {
      expect(platform.detectCommand(['ts-node', 'app.ts'])).toBe(true);
    });

    it('detects .js files directly', () => {
      expect(platform.detectCommand(['./script.js'])).toBe(true);
      expect(platform.detectCommand(['/usr/local/bin/app.js'])).toBe(true);
    });

    it('does not detect non-Node.js commands', () => {
      expect(platform.detectCommand(['python', 'script.py'])).toBe(false);
      expect(platform.detectCommand(['ruby', 'script.rb'])).toBe(false);
      expect(platform.detectCommand(['go', 'run', 'main.go'])).toBe(false);
    });

    it('returns false for empty args', () => {
      expect(platform.detectCommand([])).toBe(false);
    });
  });

  describe('detectExtension', () => {
    it('detects .js files', () => {
      expect(platform.detectExtension('script.js')).toBe(true);
      expect(platform.detectExtension('/path/to/app.js')).toBe(true);
    });

    it('detects .mjs files', () => {
      expect(platform.detectExtension('module.mjs')).toBe(true);
    });

    it('detects .cjs files', () => {
      expect(platform.detectExtension('common.cjs')).toBe(true);
    });

    it('detects .ts files', () => {
      expect(platform.detectExtension('app.ts')).toBe(true);
    });

    it('detects .tsx files', () => {
      expect(platform.detectExtension('component.tsx')).toBe(true);
    });

    it('detects .jsx files', () => {
      expect(platform.detectExtension('component.jsx')).toBe(true);
    });

    it('does not detect non-Node.js extensions', () => {
      expect(platform.detectExtension('script.py')).toBe(false);
      expect(platform.detectExtension('app.rb')).toBe(false);
      expect(platform.detectExtension('main.go')).toBe(false);
      expect(platform.detectExtension('binary')).toBe(false);
    });
  });

  describe('platform properties', () => {
    it('has correct name', () => {
      expect(platform.name).toBe('nodejs');
    });

    it('uses 0x as profiler', () => {
      expect(platform.profiler).toBe('0x');
    });

    it('has correct executables', () => {
      expect(platform.executables).toContain('node');
      expect(platform.executables).toContain('npm');
      expect(platform.executables).toContain('npx');
      expect(platform.executables).toContain('yarn');
      expect(platform.executables).toContain('pnpm');
      expect(platform.executables).toContain('tsx');
      expect(platform.executables).toContain('ts-node');
    });

    it('has correct extensions', () => {
      expect(platform.extensions).toContain('.js');
      expect(platform.extensions).toContain('.mjs');
      expect(platform.extensions).toContain('.cjs');
      expect(platform.extensions).toContain('.ts');
      expect(platform.extensions).toContain('.tsx');
      expect(platform.extensions).toContain('.jsx');
    });
  });

  describe('getContainerImage', () => {
    it('returns correct container image', () => {
      expect(platform.getContainerImage()).toBe('ghcr.io/indragiek/uniprof-nodejs:latest');
    });
  });

  describe('getExampleCommand', () => {
    it('returns an example command', () => {
      const example = platform.getExampleCommand();
      expect(example).toBeTruthy();
      expect(typeof example).toBe('string');
      expect(example).toContain('node');
    });
  });

  describe('getSamplingRate', () => {
    it('should return null (not configurable)', () => {
      const rate = platform.getSamplingRate();
      expect(rate).toBeNull();
    });

    it('should still return null with extra args', () => {
      const rate = platform.getSamplingRate(['--some-flag']);
      expect(rate).toBeNull();
    });
  });

  describe('getAdvancedOptions', () => {
    it('returns advanced options with Node.js-specific information', () => {
      const options = platform.getAdvancedOptions();
      expect(options).toBeDefined();
      expect(options.description).toContain('0x');
      expect(options.options).toBeInstanceOf(Array);
      expect(options.example).toBeDefined();
      expect(options.example.command).toContain('node');
    });

    it('includes kernel tracing option', () => {
      const options = platform.getAdvancedOptions();
      const kernelOption = options.options.find((o) => o.flag.includes('--kernel-tracing'));
      expect(kernelOption).toBeDefined();
      expect(kernelOption?.description).toContain('kernel');
    });

    it('includes collect-only option', () => {
      const options = platform.getAdvancedOptions();
      const collectOption = options.options.find((o) => o.flag.includes('--collect-only'));
      expect(collectOption).toBeDefined();
      expect(collectOption?.description).toContain('visualization');
    });
  });

  describe('buildLocalProfilerCommand', () => {
    it('builds correct 0x command', () => {
      const args = ['node', 'app.js', '--port', '3000'];
      const outputPath = '/tmp/profile.json';
      const options = {};
      const context: any = {};

      const command = platform.buildLocalProfilerCommand(args, outputPath, options, context);

      expect(command).toContain('0x');
      expect(command).toContain('--output-dir');
      expect(command).toContain('--');
      expect(command).toContain('node');
      expect(command).toContain('app.js');
    });

    it('includes extra profiler args', () => {
      const args = ['node', 'app.js'];
      const outputPath = '/tmp/profile.json';
      const options = { extraProfilerArgs: ['--kernel-tracing', '--collect-only'] };
      const context: any = {};

      const command = platform.buildLocalProfilerCommand(args, outputPath, options, context);

      expect(command).toContain('--kernel-tracing');
      expect(command).toContain('--collect-only');
    });

    it('stores output ticks path in context.rawArtifact', () => {
      const args = ['node', 'app.js'];
      const outputPath = '/tmp/profile.json';
      const options = {};
      const context: any = {};

      platform.buildLocalProfilerCommand(args, outputPath, options, context);
      expect(context.rawArtifact?.type).toBe('ticks');
      expect(context.rawArtifact?.path).toMatch(/0x-profile-/);
    });

    it('strips --output-dir from extra args', () => {
      const args = ['node', 'app.js'];
      const outputPath = '/tmp/profile.json';
      const options = { extraProfilerArgs: ['--output-dir', 'custom-dir'] };
      const context: any = {};

      const command = platform.buildLocalProfilerCommand(args, outputPath, options, context);
      // Our managed outputDir should be present; derive from rawArtifact
      const idx = command.indexOf('--output-dir');
      expect(idx).toBeGreaterThan(-1);
      const outDir = (context.rawArtifact?.path || '').replace(/\/ticks\.json$/, '');
      expect(command[idx + 1]).toBe(outDir);
      // User-provided path should not appear
      expect(command).not.toContain('custom-dir');
    });
  });

  describe('getContainerCacheVolumes', () => {
    it('includes npm cache directory', () => {
      const cacheBaseDir = '/tmp/cache';
      const cwd = '/project';

      const volumes = platform.getContainerCacheVolumes(cacheBaseDir, cwd);

      const npmVolume = volumes.find((v) => v.containerPath === '/root/.npm');
      expect(npmVolume).toBeDefined();
    });

    it('includes local node_modules if exists', () => {
      // This test would need mocking of fs.existsSync
      // Skipping for now as it requires filesystem mocking
    });
  });

  describe('needsSudo', () => {
    it('returns false', async () => {
      const needsSudo = await platform.needsSudo();
      expect(needsSudo).toBe(false);
    });
  });

  describe('npm script detection', () => {
    it('detects various npm scripts', () => {
      const npmCommands = [
        ['npm', 'start'],
        ['npm', 'test'],
        ['npm', 'run', 'build'],
        ['npm', 'run', 'dev'],
        ['npm', 'run', 'lint'],
        ['npm', 'run', 'test:watch'],
      ];

      for (const cmd of npmCommands) {
        expect(platform.detectCommand(cmd)).toBe(true);
      }
    });
  });

  describe('TypeScript tool detection', () => {
    it('detects TypeScript execution tools', () => {
      const tsCommands = [
        ['tsx', 'app.ts'],
        ['ts-node', 'server.ts'],
        ['ts-node', '--transpile-only', 'app.ts'],
        ['tsx', 'watch', 'app.ts'],
      ];

      for (const cmd of tsCommands) {
        expect(platform.detectCommand(cmd)).toBe(true);
      }
    });
  });

  describe('Alternative package managers', () => {
    it('detects yarn commands', () => {
      const yarnCommands = [
        ['yarn', 'start'],
        ['yarn', 'dev'],
        ['yarn', 'test'],
        ['yarn', 'run', 'build'],
      ];

      for (const cmd of yarnCommands) {
        expect(platform.detectCommand(cmd)).toBe(true);
      }
    });

    it('detects pnpm commands', () => {
      const pnpmCommands = [
        ['pnpm', 'start'],
        ['pnpm', 'dev'],
        ['pnpm', 'test'],
        ['pnpm', 'run', 'build'],
      ];

      for (const cmd of pnpmCommands) {
        expect(platform.detectCommand(cmd)).toBe(true);
      }
    });
  });
});
