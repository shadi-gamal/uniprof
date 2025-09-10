import type { PlatformPlugin } from '../types/platform-plugin.js';
import { BeamPlatform } from './beam.js';
import { DotnetPlatform } from './dotnet.js';
import { JvmPlatform } from './jvm.js';
import { NativePlatform } from './native.js';
import { NodejsPlatform } from './nodejs.js';
import { PhpPlatform } from './php.js';
import { PythonPlatform } from './python.js';
import { RubyPlatform } from './ruby.js';

/**
 * Registry for platform plugins
 */
class PlatformRegistry {
  private platforms = new Map<string, PlatformPlugin>();

  constructor() {
    // Register built-in platforms
    this.register(new PythonPlatform());
    this.register(new NodejsPlatform());
    this.register(new RubyPlatform());
    this.register(new PhpPlatform());
    this.register(new JvmPlatform());
    this.register(new DotnetPlatform());
    this.register(new BeamPlatform());
    this.register(new NativePlatform());
  }

  /**
   * Register a platform plugin
   */
  register(platform: PlatformPlugin): void {
    this.platforms.set(platform.name, platform);
  }

  /**
   * Unregister a platform plugin by name (test-only utility)
   */
  unregister(name: string): void {
    this.platforms.delete(name);
  }

  /**
   * Get a platform by name
   */
  get(name: string): PlatformPlugin | null {
    return this.platforms.get(name) || null;
  }

  /**
   * Get all registered platforms
   */
  getAll(): PlatformPlugin[] {
    return Array.from(this.platforms.values());
  }

  /**
   * Detect platform from command arguments
   */
  async detectFromCommand(args: string[]): Promise<PlatformPlugin | null> {
    if (args.length === 0) {
      return null;
    }

    // Try all non-native platforms first (they have more specific detection)
    for (const platform of this.platforms.values()) {
      if (platform.name !== 'native' && platform.detectCommand(args)) {
        return platform;
      }
    }

    // Try native platform as fallback
    const nativePlatform = this.platforms.get('native');
    if (nativePlatform?.detectCommand(args)) {
      return nativePlatform;
    }

    return null;
  }

  /**
   * Detect platform from a speedscope profile
   */
  detectFromProfile(profile: any): PlatformPlugin | null {
    if (!profile || typeof profile !== 'object') {
      return null;
    }

    const exporter = profile.exporter;
    if (typeof exporter === 'string') {
      for (const platform of this.platforms.values()) {
        if (platform.getExporterName() === exporter) {
          return platform;
        }
      }
    }

    return null;
  }

  /**
   * Get supported platform names
   */
  getSupportedPlatforms(): string[] {
    return Array.from(this.platforms.keys());
  }
}

// Export singleton instance
export const platformRegistry = new PlatformRegistry();
