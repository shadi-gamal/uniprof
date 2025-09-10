import { describe, expect, it } from 'bun:test';
import * as os from 'node:os';
import * as path from 'node:path';
import { recordCommand } from '../src/commands/record.js';
import { platformRegistry } from '../src/platforms/registry.js';
import type {
  DockerVolume,
  PlatformPlugin,
  ProfileContext,
  RecordOptions,
} from '../src/types/platform-plugin.js';

class DummyPlatform implements PlatformPlugin {
  readonly name = 'dummy';
  readonly profiler = 'dummyprof';
  readonly extensions: string[] = [];
  readonly executables: string[] = [];

  getProfilerName(): string {
    return this.profiler;
  }
  detectCommand(): boolean {
    // Do not participate in auto-detection to avoid affecting other tests
    return false;
  }
  detectExtension(): boolean {
    return false;
  }
  getExporterName(): string {
    return 'uniprof-dummy';
  }
  async checkLocalEnvironment(): Promise<any> {
    return { isValid: true, errors: [], warnings: [], setupInstructions: [] };
  }
  async findExecutableInPath(): Promise<string | null> {
    return null;
  }
  supportsContainer(): boolean {
    return false;
  }
  getDefaultMode(): 'host' | 'container' | 'auto' {
    return 'host';
  }
  getContainerImage(): string {
    return 'dummy:image';
  }
  getContainerCacheVolumes(_cacheBaseDir: string, _cwd: string): DockerVolume[] {
    return [];
  }
  async runProfilerInContainer(): Promise<void> {
    throw new Error('not used');
  }
  buildLocalProfilerCommand(
    _args: string[],
    outputPath: string,
    _options: RecordOptions,
    _context: ProfileContext
  ): string[] {
    // Write a minimal speedscope file to outputPath
    const payload = JSON.stringify({
      $schema: 'https://www.speedscope.app/file-format-schema.json',
      profiles: [
        {
          type: 'sampled',
          name: 'p',
          unit: 'milliseconds',
          startValue: 0,
          endValue: 0,
          samples: [],
          weights: [],
        },
      ],
      shared: { frames: [] },
      name: 'dummy',
      exporter: this.getExporterName(),
    });
    const script = `printf '%s' ${JSON.stringify(payload)} > ${outputPath}`;
    return ['bash', '-lc', script];
  }
  async needsSudo(): Promise<boolean> {
    return false;
  }
  async postProcessProfile(
    _rawOutputPath: string,
    _finalOutputPath: string,
    _context: ProfileContext
  ): Promise<void> {
    // no-op
  }
  async cleanup(): Promise<void> {}
  getExampleCommand(): string {
    return 'dummy';
  }
  getAdvancedOptions() {
    return null;
  }
}

// Register dummy platform once
platformRegistry.register(new DummyPlatform());

// Ensure the dummy platform does not affect other tests in this run
// by removing it from the registry after this file completes.
const cleanupRegistry = () => {
  try {
    platformRegistry.unregister('dummy');
  } catch {}
};

// bun:test: emulate afterAll
process.on('exit', cleanupRegistry);

function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; out: string[]; err: string[] }>;
function captureLogs<T>(fn: () => T): Promise<{ result: T; out: string[]; err: string[] }>;
async function captureLogs<T>(fn: () => T | Promise<T>) {
  const origLog = console.log;
  const origErr = console.error;
  const out: string[] = [];
  const err: string[] = [];
  // @ts-expect-error
  console.log = (...a: any[]) => out.push(a.map(String).join(' '));
  // @ts-expect-error
  console.error = (...a: any[]) => err.push(a.map(String).join(' '));
  try {
    const result = await fn();
    return { result, out, err };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

describe('recordCommand output routing based on --format/--analyze', () => {
  it('routes human output to stderr only when --analyze and --format json are both set', async () => {
    const tmpOut = path.join(os.tmpdir(), `uniprof-test-${Date.now()}-1.json`);
    const { out, err } = await captureLogs(async () => {
      await recordCommand(
        {
          output: tmpOut,
          platform: 'dummy',
          analyze: true,
          format: 'json',
          mode: 'host',
        } as Parameters<typeof recordCommand>[0],
        ['dummy-app']
      );
    });

    // stdout should contain JSON (analysis), and not the human status lines
    const outJoined = out.join('\n');
    expect(outJoined.trim().startsWith('{')).toBe(true);
    expect(outJoined).not.toMatch(/Profiling completed/);
    // stderr should have human-readable lines
    const errJoined = err.join('\n');
    expect(errJoined).toMatch(/Profiling completed/);
  });

  it('does not route to stderr if --format json is set without --analyze', async () => {
    const tmpOut = path.join(os.tmpdir(), `uniprof-test-${Date.now()}-2.json`);
    const { out, err } = await captureLogs(async () => {
      await recordCommand(
        {
          output: tmpOut,
          platform: 'dummy',
          analyze: false,
          format: 'json',
          mode: 'host',
        } as Parameters<typeof recordCommand>[0],
        ['dummy-app']
      );
    });

    const outJoined = out.join('\n');
    const errJoined = err.join('\n');
    expect(outJoined).toMatch(/Profiling completed/);
    expect(errJoined).not.toMatch(/Profiling completed/);
  });
});
