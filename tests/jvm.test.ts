import { describe, expect, it } from 'bun:test';
import { injectAsyncProfilerAgent, JvmPlatform } from '../src/platforms/jvm.js';
import { platformRegistry } from '../src/platforms/registry.js';

describe('JvmPlatform', () => {
  const platform = new JvmPlatform();

  describe('detectCommand', () => {
    it('detects java command', () => {
      expect(platform.detectCommand(['java', '-jar', 'app.jar'])).toBe(true);
      expect(platform.detectCommand(['java', 'MainClass'])).toBe(true);
      expect(platform.detectCommand(['java', '-cp', 'lib/*', 'Main'])).toBe(true);
    });

    it('detects gradlew command', () => {
      expect(platform.detectCommand(['./gradlew', 'run'])).toBe(true);
      expect(platform.detectCommand(['./gradlew', 'test'])).toBe(true);
      expect(platform.detectCommand(['/path/to/gradlew', 'build'])).toBe(true);
    });

    it('detects mvnw command', () => {
      expect(platform.detectCommand(['./mvnw', 'compile'])).toBe(true);
      expect(platform.detectCommand(['./mvnw', 'test'])).toBe(true);
      expect(platform.detectCommand(['/path/to/mvnw', 'package'])).toBe(true);
    });

    it('detects JAR files directly', () => {
      expect(platform.detectCommand(['app.jar'])).toBe(true);
      expect(platform.detectCommand(['/path/to/app.jar'])).toBe(true);
      expect(platform.detectCommand(['mylib.jar'])).toBe(true);
    });

    it('does not detect gradle or mvn commands (without wrapper)', () => {
      expect(platform.detectCommand(['gradle', 'build'])).toBe(false);
      expect(platform.detectCommand(['mvn', 'compile'])).toBe(false);
    });

    it('does not detect other JVM language commands', () => {
      expect(platform.detectCommand(['kotlin', 'script.kts'])).toBe(false);
      expect(platform.detectCommand(['scala', 'Main'])).toBe(false);
      expect(platform.detectCommand(['groovy', 'script.groovy'])).toBe(false);
      expect(platform.detectCommand(['clojure', 'script.clj'])).toBe(false);
    });

    it('does not detect non-JVM commands', () => {
      expect(platform.detectCommand(['python', 'script.py'])).toBe(false);
      expect(platform.detectCommand(['node', 'app.js'])).toBe(false);
      expect(platform.detectCommand(['ruby', 'script.rb'])).toBe(false);
    });

    it('does not detect non-JAR files', () => {
      expect(platform.detectCommand(['script.java'])).toBe(false);
      expect(platform.detectCommand(['Main.class'])).toBe(false);
      expect(platform.detectCommand(['app.kt'])).toBe(false);
      expect(platform.detectCommand(['build.gradle'])).toBe(false);
    });

    it('returns false for empty args', () => {
      expect(platform.detectCommand([])).toBe(false);
    });
  });

  describe('detectExtension', () => {
    it('detects .jar files', () => {
      expect(platform.detectExtension('app.jar')).toBe(true);
      expect(platform.detectExtension('/path/to/library.jar')).toBe(true);
      expect(platform.detectExtension('test.jar')).toBe(true);
    });

    it('does not detect other Java-related extensions', () => {
      expect(platform.detectExtension('Main.java')).toBe(false);
      expect(platform.detectExtension('Main.class')).toBe(false);
      expect(platform.detectExtension('script.kt')).toBe(false);
      expect(platform.detectExtension('app.scala')).toBe(false);
      expect(platform.detectExtension('build.gradle')).toBe(false);
      expect(platform.detectExtension('pom.xml')).toBe(false);
    });

    it('does not detect non-JVM extensions', () => {
      expect(platform.detectExtension('script.py')).toBe(false);
      expect(platform.detectExtension('app.js')).toBe(false);
      expect(platform.detectExtension('main.go')).toBe(false);
      expect(platform.detectExtension('binary')).toBe(false);
    });
  });

  describe('platform properties', () => {
    it('has correct name', () => {
      expect(platform.name).toBe('jvm');
    });

    it('uses async-profiler as profiler', () => {
      expect(platform.profiler).toBe('async-profiler');
    });

    it('has only java as executable', () => {
      expect(platform.executables).toEqual(['java']);
      expect(platform.executables).not.toContain('kotlin');
      expect(platform.executables).not.toContain('scala');
      expect(platform.executables).not.toContain('groovy');
    });

    it('has only .jar as extension', () => {
      expect(platform.extensions).toEqual(['.jar']);
      expect(platform.extensions).not.toContain('.java');
      expect(platform.extensions).not.toContain('.class');
      expect(platform.extensions).not.toContain('.kt');
    });
  });

  describe('getContainerImage', () => {
    it('returns correct container image', () => {
      expect(platform.getContainerImage()).toBe('ghcr.io/indragiek/uniprof-jvm:latest');
    });
  });

  describe('getExporterName', () => {
    it('returns correct exporter name', () => {
      expect(platform.getExporterName()).toBe('uniprof-jvm');
    });
  });

  describe('getExampleCommand', () => {
    it('returns an example command', () => {
      const example = platform.getExampleCommand();
      expect(example).toBeTruthy();
      expect(typeof example).toBe('string');
      expect(example).toContain('java');
      expect(example).toContain('.jar');
    });
  });

  describe('getSamplingRate', () => {
    it('should default to 999Hz', () => {
      const rate = platform.getSamplingRate();
      expect(rate).toBe(999);
    });
  });

  describe('injectAgentPath', () => {
    it('should include default interval when no rate specified', () => {
      const result = injectAsyncProfilerAgent(
        ['java', '-jar', 'app.jar'],
        '/tmp/profile.collapsed',
        undefined,
        '/opt/async-profiler'
      );

      // Check that the agent path includes the default interval
      expect(result.args[1]).toContain('interval=1001001ns');
    });

    it('should not include default interval when --interval is specified', () => {
      const result = injectAsyncProfilerAgent(
        ['java', '-jar', 'app.jar'],
        '/tmp/profile.collapsed',
        ['--interval', '2000000'],
        '/opt/async-profiler'
      );

      // Check that the agent path includes the user-specified interval
      expect(result.args[1]).toContain('interval=2000000ns');
      // Should not contain the default interval
      expect(result.args[1]).not.toContain('interval=1001001ns');
    });
  });

  describe('getAdvancedOptions', () => {
    it('returns advanced options with async-profiler information', () => {
      const options = platform.getAdvancedOptions();
      expect(options).toBeDefined();
      expect(options.description).toContain('async-profiler');
      expect(options.options).toBeInstanceOf(Array);
      expect(options.example).toBeDefined();
      expect(options.example.command).toContain('java');
    });

    it('includes interval option', () => {
      const options = platform.getAdvancedOptions();
      const intervalOption = options.options.find((o) => o.flag.includes('--interval'));
      expect(intervalOption).toBeDefined();
      expect(intervalOption?.description).toContain('interval');
    });

    it('includes threads option', () => {
      const options = platform.getAdvancedOptions();
      const threadsOption = options.options.find((o) => o.flag.includes('--threads'));
      expect(threadsOption).toBeDefined();
      expect(threadsOption?.description).toContain('threads separately');
    });

    it('includes simple option for class names', () => {
      const options = platform.getAdvancedOptions();
      const simpleOption = options.options.find((o) => o.flag.includes('--simple'));
      expect(simpleOption).toBeDefined();
      expect(simpleOption?.description).toContain('simple class names');
    });
  });

  describe('buildLocalProfilerCommand', () => {
    it('ignores user-provided --file in extra args', () => {
      // Ensure async-profiler home is set for command construction
      process.env.ASYNC_PROFILER_HOME = process.env.ASYNC_PROFILER_HOME || '/opt/async-profiler';
      const platform = new JvmPlatform();
      const args = ['java', '-jar', 'app.jar'];
      const outputPath = '/tmp/profile.json';
      const options = {
        output: outputPath,
        extraProfilerArgs: ['--file', '/tmp/other.collapsed'],
      } as import('../src/types/platform-plugin.js').RecordOptions;
      const context: import('../src/types/platform-plugin.js').ProfileContext = {};
      const cmd = platform.buildLocalProfilerCommand(args, outputPath, options, context);
      // Find the -agentpath arg which contains file=<temp>
      const agentArg = cmd.find(
        (t) => typeof t === 'string' && t.startsWith('-agentpath:')
      ) as string;
      expect(agentArg).toBeTruthy();
      expect(agentArg).toContain(`file=${outputPath.replace('.json', '.collapsed')}`);
      expect(agentArg).not.toContain('/tmp/other.collapsed');
    });
  });

  describe('agent insertion ordering for java options', () => {
    it('inserts -agentpath after JVM options and before main class', () => {
      const prev = process.env.ASYNC_PROFILER_HOME;
      process.env.ASYNC_PROFILER_HOME = '/opt/async-profiler';
      const ctx: import('../src/types/platform-plugin.js').ProfileContext = {};
      const args = ['java', '-Xmx1g', '-Dfoo=bar', '-cp', 'lib/*', 'Main', 'arg1'];
      const cmd = platform.buildLocalProfilerCommand(
        args,
        '/tmp/out.json',
        { output: '/tmp/out.json' } as import('../src/types/platform-plugin.js').RecordOptions,
        ctx
      );
      const agentIdx = cmd.findIndex(
        (t) => typeof t === 'string' && (t as string).startsWith('-agentpath:')
      );
      const mainIdx = cmd.indexOf('Main');
      expect(agentIdx).toBeGreaterThan(0);
      expect(mainIdx).toBeGreaterThan(0);
      // Agent must precede the main class
      expect(agentIdx).toBeLessThan(mainIdx);
      if (prev === undefined) process.env.ASYNC_PROFILER_HOME = undefined;
      else process.env.ASYNC_PROFILER_HOME = prev;
    });
  });

  describe('registry integration', () => {
    it('is registered in platform registry', () => {
      const jvmPlatform = platformRegistry.get('jvm');
      expect(jvmPlatform).not.toBeNull();
      expect(jvmPlatform?.name).toBe('jvm');
      expect(jvmPlatform?.profiler).toBe('async-profiler');
    });

    it('is detected by registry from java command', async () => {
      const detected = await platformRegistry.detectFromCommand(['java', '-jar', 'app.jar']);
      expect(detected).not.toBeNull();
      expect(detected?.name).toBe('jvm');
    });

    it('is detected by registry from gradlew command', async () => {
      const detected = await platformRegistry.detectFromCommand(['./gradlew', 'run']);
      expect(detected).not.toBeNull();
      expect(detected?.name).toBe('jvm');
    });

    it('is detected by registry from mvnw command', async () => {
      const detected = await platformRegistry.detectFromCommand(['./mvnw', 'test']);
      expect(detected).not.toBeNull();
      expect(detected?.name).toBe('jvm');
    });

    it('is detected by registry from jar file', async () => {
      const detected = await platformRegistry.detectFromCommand(['app.jar']);
      expect(detected).not.toBeNull();
      expect(detected?.name).toBe('jvm');
    });
  });

  describe('agent injection', () => {
    // Note: These tests validate the behavior conceptually
    // Actual agent injection is tested through integration tests

    it('supports different command types', () => {
      // Java command
      expect(() => platform.detectCommand(['java', '-jar', 'app.jar'])).not.toThrow();

      // Gradle wrapper
      expect(() => platform.detectCommand(['./gradlew', 'run'])).not.toThrow();

      // Maven wrapper
      expect(() => platform.detectCommand(['./mvnw', 'test'])).not.toThrow();
    });

    it('requires specific executable formats', () => {
      // Must use wrapper scripts, not direct gradle/mvn
      expect(platform.detectCommand(['gradle', 'build'])).toBe(false);
      expect(platform.detectCommand(['mvn', 'test'])).toBe(false);

      // Wrappers must be properly formatted
      expect(platform.detectCommand(['./gradlew', 'build'])).toBe(true);
      expect(platform.detectCommand(['./mvnw', 'test'])).toBe(true);
    });
  });

  describe('host-mode env propagation (context)', () => {
    it('sets JAVA_TOOL_OPTIONS in context for Gradle wrapper', () => {
      const prev = process.env.ASYNC_PROFILER_HOME;
      process.env.ASYNC_PROFILER_HOME = '/opt/async-profiler';
      const ctx: import('../src/types/platform-plugin.js').ProfileContext = {};
      const cmd = platform.buildLocalProfilerCommand(
        ['./gradlew', 'run'],
        '/tmp/out.json',
        { output: '/tmp/out.json' },
        ctx
      );
      // Command should be preserved for wrapper and env populated
      expect(cmd[0]).toMatch(/gradlew$/);
      expect(ctx.runtimeEnv?.JAVA_TOOL_OPTIONS).toBeDefined();
      expect(String(ctx.runtimeEnv.JAVA_TOOL_OPTIONS)).toContain('-agentpath:');
      if (prev === undefined) process.env.ASYNC_PROFILER_HOME = undefined;
      else process.env.ASYNC_PROFILER_HOME = prev;
    });

    it('sets MAVEN_OPTS in context for Maven wrapper', () => {
      const prev = process.env.ASYNC_PROFILER_HOME;
      process.env.ASYNC_PROFILER_HOME = '/opt/async-profiler';
      const ctx: import('../src/types/platform-plugin.js').ProfileContext = {};
      const cmd = platform.buildLocalProfilerCommand(
        ['./mvnw', 'test'],
        '/tmp/out.json',
        { output: '/tmp/out.json' },
        ctx
      );
      expect(cmd[0]).toMatch(/mvnw$/);
      expect(ctx.runtimeEnv?.MAVEN_OPTS).toBeDefined();
      expect(String(ctx.runtimeEnv.MAVEN_OPTS)).toContain('-agentpath:');
      if (prev === undefined) process.env.ASYNC_PROFILER_HOME = undefined;
      else process.env.ASYNC_PROFILER_HOME = prev;
    });
  });

  describe('needsSudo', () => {
    it('returns boolean for sudo requirement', async () => {
      const needsSudo = await platform.needsSudo();
      expect(typeof needsSudo).toBe('boolean');
    });
  });
});
