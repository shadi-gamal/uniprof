import { describe, expect, it, jest } from 'bun:test';
import * as fs from 'node:fs';
import { XctracePlatform } from '../src/platforms/xctrace.js';
import * as Spawn from '../src/utils/spawn.js';

describe('XctracePlatform', () => {
  const platform = new XctracePlatform();

  describe('detectCommand', () => {
    it('always returns false as xctrace is explicitly selected', () => {
      expect(platform.detectCommand(['./my-app'])).toBe(false);
      expect(platform.detectCommand(['./MyApp.app'])).toBe(false);
      expect(platform.detectCommand([])).toBe(false);
    });
  });

  describe('detectExtension', () => {
    it('has no extensions', () => {
      expect(platform.extensions).toEqual([]);
    });
  });

  describe('platform properties', () => {
    it('has correct name', () => {
      expect(platform.name).toBe('xctrace');
    });

    it('uses instruments as profiler', () => {
      expect(platform.profiler).toBe('instruments');
    });

    it('has xcrun as executable', () => {
      expect(platform.executables).toContain('xcrun');
    });
  });

  describe('getContainerImage', () => {
    it('throws error for container mode', () => {
      expect(() => platform.getContainerImage()).toThrow(
        'Container mode is not supported for macOS xctrace profiling'
      );
    });
  });

  describe('runProfilerInContainer', () => {
    it('throws error for container mode', async () => {
      await expect(platform.runProfilerInContainer([], '', {})).rejects.toThrow(
        'Container mode is not supported for macOS xctrace profiling'
      );
    });
  });

  describe('getExampleCommand', () => {
    it('returns an example command', () => {
      const example = platform.getExampleCommand();
      expect(example).toBeTruthy();
      expect(typeof example).toBe('string');
      expect(example).toContain('my-native-app');
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
    it('returns advanced options with xctrace-specific information', () => {
      const options = platform.getAdvancedOptions();
      expect(options).toBeDefined();
      expect(options.description).toContain('Instruments');
      expect(options.options).toBeInstanceOf(Array);
      expect(options.example).toBeDefined();
    });

    it('includes time limit option', () => {
      const options = platform.getAdvancedOptions();
      const timeLimitOption = options.options.find((o) => o.flag.includes('--time-limit'));
      expect(timeLimitOption).toBeDefined();
      expect(timeLimitOption?.description).toContain('Recording duration');
    });
  });

  describe('buildLocalProfilerCommand', () => {
    it('builds correct xctrace command for regular executable', () => {
      const args = ['./my-app', '--arg1', 'value1'];
      const outputPath = '/tmp/profile.json';
      const options = {};
      const context: import('../src/types/platform-plugin.js').ProfileContext = {};

      const command = platform.buildLocalProfilerCommand(args, outputPath, options, context);

      expect(command).toContain('xcrun');
      expect(command).toContain('xctrace');
      expect(command).toContain('record');
      expect(command).toContain('--template');
      expect(command).toContain('Time Profiler');
      expect(command).toContain('--launch');
      expect(command).toContain('./my-app');
      expect(command).toContain('--output');
      // The output path should end with .trace
      const outputIndex = command.indexOf('--output');
      expect(outputIndex).toBeGreaterThan(-1);
      expect(command[outputIndex + 1]).toMatch(/\.trace$/);
      expect(command).toContain('--no-prompt');
      expect(command).toContain('--');
      expect(command).toContain('--arg1');
      expect(command).toContain('value1');
      expect(context.rawArtifact?.type).toBe('instruments-trace');
      expect(context.rawArtifact?.path).toMatch(/\.trace$/);
    });

    it('includes extra profiler args', () => {
      const args = ['./my-app'];
      const outputPath = '/tmp/profile.json';
      const options = { extraProfilerArgs: ['--time-limit', '60s'] };
      const context: any = {};

      const command = platform.buildLocalProfilerCommand(args, outputPath, options, context);

      expect(command).toContain('--time-limit');
      expect(command).toContain('60s');
    });

    it('strips --output from extra args', () => {
      const args = ['./my-app'];
      const outputPath = '/tmp/profile.json';
      const options: import('../src/types/platform-plugin.js').RecordOptions = {
        extraProfilerArgs: ['--output', '/tmp/other.trace'],
      };
      const context: any = {};

      const command = platform.buildLocalProfilerCommand(args, outputPath, options, context);
      const idx = command.indexOf('--output');
      expect(idx).toBeGreaterThan(-1);
      expect(command[idx + 1]).toBe(context.rawArtifact?.path);
      expect(command).not.toContain('/tmp/other.trace');
    });
  });

  describe('resolveAppBundle', () => {
    it('returns path unchanged for non-.app bundles', () => {
      const result = platform.resolveAppBundle('./my-binary');
      expect(result).toBe('./my-binary');
    });

    it('returns path unchanged for regular executables', () => {
      const result = platform.resolveAppBundle('/usr/bin/ls');
      expect(result).toBe('/usr/bin/ls');
    });

    it('throws error when Info.plist is missing', () => {
      const mockPath = '/Applications/TestApp.app';

      // Mock fs.existsSync to return false for Info.plist
      const originalExistsSync = fs.existsSync;
      jest.spyOn(fs, 'existsSync').mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr.includes('Info.plist')) {
          return false;
        }
        return originalExistsSync(pathStr);
      });

      expect(() => platform.resolveAppBundle(mockPath)).toThrow(
        'Invalid .app bundle: Info.plist not found'
      );

      // @ts-expect-error - Restore mock
      fs.existsSync.mockRestore();
    });

    it('throws error when CFBundleExecutable key is missing', () => {
      const mockPath = '/Applications/TestApp.app';

      // Mock fs.existsSync to return true for Info.plist
      const originalExistsSync = fs.existsSync;
      jest.spyOn(fs, 'existsSync').mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr.includes('Info.plist')) {
          return true;
        }
        return originalExistsSync(pathStr);
      });

      // Mock Spawn.spawnSync to simulate missing CFBundleExecutable
      const spawnSpy = jest.spyOn(Spawn, 'spawnSync').mockImplementation((cmd: string[]) => {
        if (cmd[0] === '/usr/libexec/PlistBuddy') {
          return {
            exitCode: 1,
            stdout: Buffer.from(''),
            stderr: Buffer.from('Print: Entry, ":CFBundleExecutable", Does Not Exist'),
          } as any;
        }
        return { exitCode: 0, stdout: Buffer.from(''), stderr: Buffer.from('') } as any;
      });

      expect(() => platform.resolveAppBundle(mockPath)).toThrow(
        'Invalid .app bundle: CFBundleExecutable key not found'
      );

      // Restore mocks
      // @ts-expect-error
      fs.existsSync.mockRestore();
      spawnSpy.mockRestore();
    });

    it('throws error when CFBundleExecutable is empty', () => {
      const mockPath = '/Applications/TestApp.app';

      // Mock fs.existsSync to return true for Info.plist
      const originalExistsSync = fs.existsSync;
      jest.spyOn(fs, 'existsSync').mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr.includes('Info.plist')) {
          return true;
        }
        return originalExistsSync(pathStr);
      });

      // Mock Spawn.spawnSync to return empty CFBundleExecutable
      const spawnSpy = jest.spyOn(Spawn, 'spawnSync').mockImplementation((cmd: string[]) => {
        if (cmd[0] === '/usr/libexec/PlistBuddy') {
          return {
            exitCode: 0,
            stdout: Buffer.from(''),
            stderr: Buffer.from(''),
          } as any;
        }
        return { exitCode: 0, stdout: Buffer.from(''), stderr: Buffer.from('') } as any;
      });

      expect(() => platform.resolveAppBundle(mockPath)).toThrow(
        'Invalid .app bundle: CFBundleExecutable is empty in Info.plist'
      );

      // Restore mocks
      // @ts-expect-error
      fs.existsSync.mockRestore();
      spawnSpy.mockRestore();
    });

    it('throws error when executable does not exist', () => {
      const mockPath = '/Applications/TestApp.app';

      // Mock fs.existsSync
      const originalExistsSync = fs.existsSync;
      jest.spyOn(fs, 'existsSync').mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr.includes('Info.plist')) {
          return true;
        }
        if (pathStr.includes('MacOS/TestApp')) {
          return false; // Executable doesn't exist
        }
        return originalExistsSync(pathStr);
      });

      // Mock Spawn.spawnSync to return valid CFBundleExecutable
      const spawnSpy = jest.spyOn(Spawn, 'spawnSync').mockImplementation((cmd: string[]) => {
        if (cmd[0] === '/usr/libexec/PlistBuddy') {
          return {
            exitCode: 0,
            stdout: Buffer.from('TestApp\n'),
            stderr: Buffer.from(''),
          } as any;
        }
        return { exitCode: 0, stdout: Buffer.from(''), stderr: Buffer.from('') } as any;
      });

      expect(() => platform.resolveAppBundle(mockPath)).toThrow(
        'Invalid .app bundle: Executable not found at expected location'
      );

      // Restore mocks
      // @ts-expect-error
      fs.existsSync.mockRestore();
      spawnSpy.mockRestore();
    });

    it('throws error when executable is not executable', () => {
      const mockPath = '/Applications/TestApp.app';

      // Mock fs.existsSync to return true for all paths
      jest.spyOn(fs, 'existsSync').mockImplementation(() => true);

      // Mock fs.accessSync to throw for X_OK check
      const originalAccessSync = fs.accessSync;
      jest.spyOn(fs, 'accessSync').mockImplementation((p, mode) => {
        if (mode === fs.constants.X_OK) {
          throw new Error('Permission denied');
        }
        return originalAccessSync(p, mode);
      });

      // Mock Spawn.spawnSync to return valid CFBundleExecutable
      const spawnSpy = jest.spyOn(Spawn, 'spawnSync').mockImplementation((cmd: string[]) => {
        if (cmd[0] === '/usr/libexec/PlistBuddy') {
          return {
            exitCode: 0,
            stdout: Buffer.from('TestApp\n'),
            stderr: Buffer.from(''),
          } as any;
        }
        return { exitCode: 0, stdout: Buffer.from(''), stderr: Buffer.from('') } as any;
      });

      expect(() => platform.resolveAppBundle(mockPath)).toThrow(
        'Invalid .app bundle: File exists but is not executable'
      );

      // Restore mocks
      // @ts-expect-error
      fs.existsSync.mockRestore();
      // @ts-expect-error
      fs.accessSync.mockRestore();
      spawnSpy.mockRestore();
    });

    it('successfully resolves valid .app bundle', () => {
      const mockPath = '/Applications/TestApp.app';

      // Mock fs.existsSync to return true for all paths
      jest.spyOn(fs, 'existsSync').mockImplementation(() => true);

      // Mock fs.accessSync to succeed
      jest.spyOn(fs, 'accessSync').mockImplementation(() => undefined);

      // Mock Spawn.spawnSync to return valid CFBundleExecutable
      const spawnSpy = jest.spyOn(Spawn, 'spawnSync').mockImplementation((cmd: string[]) => {
        if (cmd[0] === '/usr/libexec/PlistBuddy') {
          return {
            exitCode: 0,
            stdout: Buffer.from('TestApp\n'),
            stderr: Buffer.from(''),
          } as any;
        }
        return { exitCode: 0, stdout: Buffer.from(''), stderr: Buffer.from('') } as any;
      });

      const result = platform.resolveAppBundle(mockPath);
      expect(result).toBe('/Applications/TestApp.app/Contents/MacOS/TestApp');

      // Restore mocks
      // @ts-expect-error
      fs.existsSync.mockRestore();
      // @ts-expect-error
      fs.accessSync.mockRestore();
      spawnSpy.mockRestore();
    });
  });

  describe('needsSudo', () => {
    it('returns false', async () => {
      const needsSudo = await platform.needsSudo();
      expect(needsSudo).toBe(false);
    });
  });

  describe('checkLocalEnvironment', () => {
    it('returns error on non-macOS platforms', async () => {
      // Mock process.platform
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      const result = await platform.checkLocalEnvironment();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('xctrace/Instruments is only available on macOS');

      // Restore platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });
  });
});
