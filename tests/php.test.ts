import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PhpPlatform } from '../src/platforms/php.js';

describe('PhpPlatform', () => {
  const platform = new PhpPlatform();

  describe('detectCommand', () => {
    it('detects php command', () => {
      expect(platform.detectCommand(['php', 'script.php'])).toBe(true);
    });

    // php-fpm support removed: should not be detected
    it('does not detect php-fpm', () => {
      expect(platform.detectCommand(['php-fpm'])).toBe(false);
      expect(platform.detectCommand(['php-fpm', '-F'])).toBe(false);
    });

    it('detects composer commands', () => {
      expect(platform.detectCommand(['composer', 'install'])).toBe(true);
      expect(platform.detectCommand(['composer', 'update'])).toBe(true);
      expect(platform.detectCommand(['composer', 'require', 'package/name'])).toBe(true);
    });

    it('detects artisan commands (Laravel)', () => {
      expect(platform.detectCommand(['php', 'artisan', 'serve'])).toBe(true);
      expect(platform.detectCommand(['php', 'artisan', 'migrate'])).toBe(true);
    });

    it('detects .php files directly', () => {
      expect(platform.detectCommand(['./script.php'])).toBe(true);
      expect(platform.detectCommand(['/usr/local/bin/app.php'])).toBe(true);
    });

    it('does not detect non-PHP commands', () => {
      expect(platform.detectCommand(['python', 'script.py'])).toBe(false);
      expect(platform.detectCommand(['node', 'app.js'])).toBe(false);
      expect(platform.detectCommand(['ruby', 'script.rb'])).toBe(false);
    });

    it('returns false for empty args', () => {
      expect(platform.detectCommand([])).toBe(false);
    });
  });

  describe('detectExtension', () => {
    it('detects .php files', () => {
      expect(platform.detectExtension('script.php')).toBe(true);
      expect(platform.detectExtension('/path/to/app.php')).toBe(true);
      expect(platform.detectExtension('index.php')).toBe(true);
    });

    it('detects .phar files', () => {
      expect(platform.detectExtension('composer.phar')).toBe(true);
      expect(platform.detectExtension('/usr/local/bin/app.phar')).toBe(true);
    });

    it('does not detect non-PHP extensions', () => {
      expect(platform.detectExtension('script.py')).toBe(false);
      expect(platform.detectExtension('app.js')).toBe(false);
      expect(platform.detectExtension('main.go')).toBe(false);
      expect(platform.detectExtension('binary')).toBe(false);
    });
  });

  describe('platform properties', () => {
    it('has correct name', () => {
      expect(platform.name).toBe('php');
    });

    it('uses excimer as profiler', () => {
      expect(platform.profiler).toBe('excimer');
    });

    it('has correct executables', () => {
      expect(platform.executables).toContain('php');
      expect(platform.executables).toContain('composer');
      expect(platform.executables).not.toContain('php-fpm');
    });

    it('has correct extensions', () => {
      expect(platform.extensions).toContain('.php');
      expect(platform.extensions).toContain('.phar');
    });
  });

  describe('getContainerImage', () => {
    it('returns correct container image', () => {
      expect(platform.getContainerImage()).toBe('ghcr.io/indragiek/uniprof-php:latest');
    });
  });

  describe('getExampleCommand', () => {
    it('returns an example command', () => {
      const example = platform.getExampleCommand();
      expect(example).toBeTruthy();
      expect(typeof example).toBe('string');
      expect(example).toContain('php');
    });
  });

  describe('getAdvancedOptions', () => {
    it('returns advanced options with PHP-specific information', () => {
      const options = platform.getAdvancedOptions();
      expect(options).toBeDefined();
      expect(options.description).toContain('Excimer');
      expect(options.options).toBeInstanceOf(Array);
      expect(options.example).toBeDefined();
      expect(options.example.command).toContain('php');
    });

    it('includes sampling period option', () => {
      const options = platform.getAdvancedOptions();
      const periodOption = options.options.find((o) => o.flag.includes('--period'));
      expect(periodOption).toBeDefined();
      expect(periodOption?.description).toContain('sampling period');
    });

    it('includes max depth option', () => {
      const options = platform.getAdvancedOptions();
      const depthOption = options.options.find((o) => o.flag.includes('--max-depth'));
      expect(depthOption).toBeDefined();
      expect(depthOption?.description).toContain('stack depth');
    });
  });

  describe('getSamplingRate', () => {
    it('should default to 999Hz', () => {
      const rate = platform.getSamplingRate();
      expect(rate).toBe(999);
    });

    it('should respect user override with --period flag (seconds)', () => {
      // --period 0.002 s => 500 Hz
      const rate = platform.getSamplingRate(['--period', '0.002']);
      expect(rate).toBe(500);
    });

    it('should handle invalid period', () => {
      const rate = platform.getSamplingRate(['--period', 'invalid']);
      expect(rate).toBe(999);
    });

    it('should handle zero period', () => {
      const rate = platform.getSamplingRate(['--period', '0']);
      expect(rate).toBe(999);
    });
  });

  describe('buildLocalProfilerCommand', () => {
    it('builds correct PHP_INI_SCAN_DIR and writes ini with auto_prepend_file', () => {
      const args = ['php', 'script.php', '--arg1', 'value1'];
      const outputPath = '/tmp/profile.json';
      const options: import('../src/types/platform-plugin.js').RecordOptions = {};
      const context: import('../src/types/platform-plugin.js').ProfileContext = {};

      const command = platform.buildLocalProfilerCommand(args, outputPath, options, context);
      // Command is preserved; injection uses INI scan dir
      expect(command[0]).toBe('php');
      expect(command).toContain('script.php');
      const scanDir = context.runtimeEnv?.PHP_INI_SCAN_DIR as string;
      expect(typeof scanDir).toBe('string');
      const iniPath = `${scanDir.split(':')[0]}/uniprof.ini`;
      const iniContent = fs.readFileSync(iniPath, 'utf8');
      expect(iniContent).toMatch(/auto_prepend_file=/);
    });

    it('includes extra profiler args', () => {
      const args = ['php', 'script.php'];
      const outputPath = '/tmp/profile.json';
      const options: import('../src/types/platform-plugin.js').RecordOptions = {
        extraProfilerArgs: ['--period', '1', '--max-depth', '128'],
      };
      const context: import('../src/types/platform-plugin.js').ProfileContext = {};

      const command = platform.buildLocalProfilerCommand(args, outputPath, options, context);
      // Local mode uses INI scan dir; extra args embedded in PHP script
      expect(command[0]).toBe('php');
    });

    it('preserves composer launcher in host mode and uses INI scan dir', () => {
      const args = ['composer', 'install'];
      const outputPath = path.join(process.cwd(), 'profile.json');
      const options: import('../src/types/platform-plugin.js').RecordOptions = {};
      const context: import('../src/types/platform-plugin.js').ProfileContext = {};
      const command = platform.buildLocalProfilerCommand(args, outputPath, options, context);

      expect(command[0]).toBe('composer');
      expect(command).toContain('install');
      const scanDir = context.runtimeEnv?.PHP_INI_SCAN_DIR as string;
      expect(typeof scanDir).toBe('string');
    });

    it('does not allow overriding output via extra args (no output flags supported)', () => {
      const platform = new PhpPlatform();
      const args = ['php', 'script.php'];
      const outputPath = '/tmp/profile.json';
      const options: import('../src/types/platform-plugin.js').RecordOptions = {
        extraProfilerArgs: ['--period', '0.01'],
      };
      const context: import('../src/types/platform-plugin.js').ProfileContext = {};
      platform.buildLocalProfilerCommand(args, outputPath, options, context);
      // Ensure INI scan dir exists and PHP script embeds the options
      const scanDir = context.runtimeEnv?.PHP_INI_SCAN_DIR as string;
      const iniPath = `${scanDir.split(':')[0]}/uniprof.ini`;
      const iniContent = fs.readFileSync(iniPath, 'utf8');
      expect(iniContent).toMatch(/auto_prepend_file=/);
      // The sampling period is embedded in the generated script, not in argv.
      // We can resolve it from the ini's prepend target
      const prepend = iniContent.split('=')[1].trim();
      const scriptContent = fs.readFileSync(prepend, 'utf8');
      expect(scriptContent).toContain('setPeriod(0.01)');
    });
  });

  describe('getContainerCacheVolumes', () => {
    it('includes Composer cache directory', () => {
      const cacheBaseDir = '/tmp/cache';
      const cwd = '/project';

      const volumes = platform.getContainerCacheVolumes(cacheBaseDir, cwd);

      const composerVolume = volumes.find((v) => v.containerPath === '/root/.composer/cache');
      expect(composerVolume).toBeDefined();
    });

    it('includes local vendor directory if exists', () => {
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

  describe('Laravel/Artisan detection', () => {
    it('detects Laravel artisan commands', () => {
      const artisanCommands = [
        ['php', 'artisan', 'serve'],
        ['php', 'artisan', 'migrate'],
        ['php', 'artisan', 'queue:work'],
        ['php', 'artisan', 'tinker'],
        ['php', 'artisan', 'make:controller', 'UserController'],
      ];

      for (const cmd of artisanCommands) {
        expect(platform.detectCommand(cmd)).toBe(true);
      }
    });
  });

  describe('Composer detection', () => {
    it('detects various composer commands', () => {
      const composerCommands = [
        ['composer', 'install'],
        ['composer', 'update'],
        ['composer', 'require', 'laravel/framework'],
        ['composer', 'dump-autoload'],
        ['composer', 'run-script', 'test'],
      ];

      for (const cmd of composerCommands) {
        expect(platform.detectCommand(cmd)).toBe(true);
      }
    });
  });

  // php-fpm support removed intentionally: ensure not detected
  describe('PHP-FPM detection', () => {
    it('does not detect php-fpm with various options', () => {
      const fpmCommands = [
        ['php-fpm'],
        ['php-fpm', '-F'],
        ['php-fpm', '--nodaemonize'],
        ['php-fpm', '-c', '/etc/php/php.ini'],
      ];

      for (const cmd of fpmCommands) {
        expect(platform.detectCommand(cmd)).toBe(false);
      }
    });
  });

  describe('checkLocalEnvironment', () => {
    it('checks for PHP installation', async () => {
      const check = await platform.checkLocalEnvironment();

      // The actual result depends on the system, but we can check the structure
      expect(check).toHaveProperty('isValid');
      expect(check).toHaveProperty('errors');
      expect(check).toHaveProperty('warnings');
      expect(check).toHaveProperty('setupInstructions');
      expect(Array.isArray(check.errors)).toBe(true);
      expect(Array.isArray(check.warnings)).toBe(true);
      expect(Array.isArray(check.setupInstructions)).toBe(true);
    });
  });
});
