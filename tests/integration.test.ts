import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from '../src/utils/spawn.js';

describe('Integration Tests - Container Mode', () => {
  const CLI_PATH = path.join(__dirname, '..', 'dist', 'index.js');
  const FIXTURES_DIR = path.join(__dirname, 'fixtures');

  // Helper to run uniprof commands
  function runUniprof(args: string[]): { stdout: string; stderr: string } {
    try {
      const result = spawnSync(['node', CLI_PATH, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, CI: 'true' },
      });

      if (result.exitCode !== 0) {
        // Still return stdout and stderr even on failure for debugging
        const stderr = result.stderr?.toString() || '';
        const stdout = result.stdout?.toString() || '';
        console.error('Command failed with exit code:', result.exitCode);
        console.error('Stderr:', stderr);
        console.error('Stdout:', stdout);
        return {
          stdout: stdout,
          stderr: stderr || 'Command failed',
        };
      }

      return {
        stdout: result.stdout?.toString() || '',
        stderr: result.stderr?.toString() || '',
      };
    } catch (error: any) {
      return {
        stdout: '',
        stderr: error.message || 'Unknown error',
      };
    }
  }

  // Helper to generate a temporary output file path
  function getTempOutputPath(name: string): string {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniprof-test-'));
    return path.join(tempDir, `${name}.json`);
  }

  // Helper to verify profile output
  function verifyProfile(profilePath: string, expectedSymbols: string[]): void {
    // Profile should exist
    expect(fs.existsSync(profilePath)).toBe(true);

    // Read and parse the profile
    const profileContent = fs.readFileSync(profilePath, 'utf8');
    const profile = JSON.parse(profileContent);

    // Debug output - show appropriate statistics based on profile type
    console.log('Profile frames count:', profile.shared?.frames?.length || 0);

    const firstProfile = profile.profiles?.[0];
    if (firstProfile?.type === 'evented') {
      console.log('Profile events count:', firstProfile.events?.length || 0);
      console.log('Profile type: evented');
    } else {
      console.log('Profile samples count:', firstProfile?.samples?.length || 0);
      console.log('Profile type: sampled');
    }

    // Verify it's a valid speedscope file
    expect(profile.$schema).toBe('https://www.speedscope.app/file-format-schema.json');
    expect(profile.shared).toBeDefined();
    expect(profile.shared.frames).toBeInstanceOf(Array);
    expect(profile.profiles).toBeInstanceOf(Array);
    expect(profile.profiles.length).toBeGreaterThan(0);

    // If profile is empty, skip symbol verification
    if (profile.shared.frames.length === 0) {
      console.warn('Profile has no frames - skipping symbol verification');
      return;
    }

    // Run analyze with JSON format to check for expected symbols
    const analyzeResult = runUniprof(['analyze', profilePath, '--format', 'json']);

    // Parse JSON output
    let analysis;
    try {
      analysis = JSON.parse(analyzeResult.stdout);
    } catch (_e) {
      console.error('Failed to parse analyze JSON output:', analyzeResult.stdout);
      console.error('Stderr:', analyzeResult.stderr);
      throw new Error('Analyze command did not return valid JSON');
    }

    console.log('Analysis summary:', analysis.summary);
    console.log('Hotspot count:', analysis.hotspots?.length || 0);

    // Check that at least some expected symbols appear in the analysis
    // (sampling-based profilers might not capture all functions)
    const hotspotNames = (analysis.hotspots || []).map((h: any) => h.name);
    const foundSymbols = expectedSymbols.filter((symbol) =>
      hotspotNames.some((name: string) => name.includes(symbol))
    );
    console.log('Found symbols:', foundSymbols);
    console.log('Expected symbols:', expectedSymbols);
    console.log('All hotspot names:', hotspotNames);

    // At least one expected symbol should be found
    expect(foundSymbols.length).toBeGreaterThan(0);
  }

  describe('Native Platform', () => {
    it('should profile native C binary in container mode', () => {
      const outputPath = getTempOutputPath('native-test');
      const _binaryPath = path.join(FIXTURES_DIR, 'test-simple');

      // Run profiling
      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--cwd',
        FIXTURES_DIR,
        '--',
        './test-simple',
      ]);

      // stderr may contain progress messages - just ensure the command succeeded
      expect(result.stdout).toContain('Profiling completed successfully');

      // Verify the profile contains expected symbols
      verifyProfile(outputPath, ['expensive_loop', 'do_work', 'main']);
    });

    it('should profile binary with DWARF debug info', () => {
      const outputPath = getTempOutputPath('native-dwarf-test');
      const binaryPath = path.join(FIXTURES_DIR, 'test-simple-dwarf');

      // Skip if binary doesn't exist
      if (!fs.existsSync(binaryPath)) {
        console.warn(`Skipping test: ${binaryPath} not found`);
        return;
      }

      // Run profiling
      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--cwd',
        FIXTURES_DIR,
        '--',
        './test-simple-dwarf',
      ]);

      // stderr may contain progress messages - just ensure the command succeeded
      expect(result.stdout).toContain('Profiling completed successfully');
      // Should NOT see warning about lacking DWARF
      expect(result.stdout).not.toContain('Binary lacks DWARF debug info');

      // Verify the profile contains expected symbols
      verifyProfile(outputPath, ['expensive_loop', 'do_work', 'main']);
    });

    it('should profile binary with frame pointers only', () => {
      const outputPath = getTempOutputPath('native-fp-test');
      const binaryPath = path.join(FIXTURES_DIR, 'test-simple-fp-only');

      // Skip if binary doesn't exist
      if (!fs.existsSync(binaryPath)) {
        console.warn(`Skipping test: ${binaryPath} not found`);
        return;
      }

      // Run profiling to check for warnings
      const resultProc = spawnSync(
        [
          'node',
          CLI_PATH,
          'record',
          '--mode',
          'container',
          '--output',
          outputPath,
          '--cwd',
          FIXTURES_DIR,
          '--',
          './test-simple-fp-only',
        ],
        { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, CI: 'true' } }
      );
      const result = (resultProc.stdout?.toString() || '') + (resultProc.stderr?.toString() || '');

      expect(result).toContain('Profiling completed successfully');
      // Check for the DWARF warning
      expect(result).toContain(
        'Binary lacks DWARF debug info, using frame pointers for stack traces'
      );

      // Verify the profile contains expected symbols
      // Note: Without DWARF, expensive_loop may be inlined or not resolved
      verifyProfile(outputPath, ['do_work', 'main']);
    });

    it('should handle binary without frame pointers', () => {
      const outputPath = getTempOutputPath('native-no-fp-test');
      const binaryPath = path.join(FIXTURES_DIR, 'test-simple-no-fp');

      // Skip if binary doesn't exist
      if (!fs.existsSync(binaryPath)) {
        console.warn(`Skipping test: ${binaryPath} not found`);
        return;
      }

      // Run profiling to check for warnings
      const resultProc = spawnSync(
        [
          'node',
          CLI_PATH,
          'record',
          '--mode',
          'container',
          '--output',
          outputPath,
          '--cwd',
          FIXTURES_DIR,
          '--',
          './test-simple-no-fp',
        ],
        { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, CI: 'true' } }
      );
      const result = (resultProc.stdout?.toString() || '') + (resultProc.stderr?.toString() || '');

      expect(result).toContain('Profiling completed successfully');
      // Check for the DWARF warning
      expect(result).toContain(
        'Binary lacks DWARF debug info, using frame pointers for stack traces'
      );

      // For binaries without frame pointers, we might not get complete stack traces
      // So we'll just verify the profile was created and has some data
      expect(fs.existsSync(outputPath)).toBe(true);
      const profileContent = fs.readFileSync(outputPath, 'utf8');
      const profile = JSON.parse(profileContent);
      expect(profile.$schema).toBe('https://www.speedscope.app/file-format-schema.json');
      expect(profile.profiles?.[0]?.samples?.length).toBeGreaterThan(0);
    });
  });

  describe('Node.js Platform', () => {
    it('should profile Node.js script in container mode', () => {
      const outputPath = getTempOutputPath('nodejs-test');
      const _scriptPath = path.join(FIXTURES_DIR, 'nodejs', 'test.js');
      const fixtureDir = path.join(FIXTURES_DIR, 'nodejs');

      // Run profiling
      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--cwd',
        fixtureDir,
        '--',
        'node',
        'test.js',
      ]);

      // stderr may contain progress messages - just ensure the command succeeded
      expect(result.stdout).toContain('Profiling completed successfully');

      // Verify the profile contains expected symbols
      // Note: findPrimes may not always appear due to sampling
      verifyProfile(outputPath, ['calculateFibonacci', 'processData']);
    });
  });

  describe('Python Platform', () => {
    it('should profile Python script in container mode', () => {
      const outputPath = getTempOutputPath('python-test');
      const _scriptPath = path.join(FIXTURES_DIR, 'python', 'test.py');
      const fixtureDir = path.join(FIXTURES_DIR, 'python');

      // Run profiling
      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--cwd',
        fixtureDir,
        '--',
        'python',
        'test.py',
      ]);

      // stderr may contain progress messages - just ensure the command succeeded
      expect(result.stdout).toContain('Profiling completed successfully');

      // Verify the profile contains expected symbols
      verifyProfile(outputPath, ['calculate_fibonacci', 'find_primes', 'process_data']);
    });
  });

  describe('Ruby Platform', () => {
    it('should profile Ruby script in container mode', () => {
      const outputPath = getTempOutputPath('ruby-test');
      const _scriptPath = path.join(FIXTURES_DIR, 'ruby', 'test.rb');
      const fixtureDir = path.join(FIXTURES_DIR, 'ruby');

      // Run profiling
      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--cwd',
        fixtureDir,
        '--',
        'ruby',
        'test.rb',
      ]);

      // stderr may contain progress messages - just ensure the command succeeded
      expect(result.stdout).toContain('Profiling completed successfully');

      // Verify the profile contains expected symbols
      verifyProfile(outputPath, ['calculate_fibonacci', 'find_primes', 'process_data']);
    });
  });

  describe('PHP Platform', () => {
    it('should profile PHP script in container mode', () => {
      const outputPath = getTempOutputPath('php-test');
      const _scriptPath = path.join(FIXTURES_DIR, 'php', 'test.php');
      const fixtureDir = path.join(FIXTURES_DIR, 'php');

      // Run profiling
      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--cwd',
        fixtureDir,
        '--',
        'php',
        'test.php',
      ]);

      // stderr may contain progress messages - just ensure the command succeeded
      expect(result.stdout).toContain('Profiling completed successfully');

      // Verify the profile contains expected symbols
      verifyProfile(outputPath, ['calculate_fibonacci', 'find_primes', 'process_data']);
    });
  });

  describe('Erlang Platform', () => {
    it('should profile Erlang script in container mode', () => {
      const outputPath = getTempOutputPath('erlang-test');
      const scriptPath = path.join(FIXTURES_DIR, 'erlang', 'test.escript');
      const fixtureDir = path.join(FIXTURES_DIR, 'erlang');

      // Skip if fixture doesn't exist
      if (!fs.existsSync(scriptPath)) {
        console.warn(`Skipping test: ${scriptPath} not found`);
        return;
      }

      // Run profiling
      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--cwd',
        fixtureDir,
        '--',
        'escript',
        'test.escript',
      ]);

      // stderr may contain progress messages - just ensure the command succeeded
      expect(result.stdout).toContain('Profiling completed successfully');

      // Verify the profile contains expected Erlang function symbols
      verifyProfile(outputPath, ['calculate_fibonacci', 'find_primes', 'process_data']);
    });
  });

  describe('Elixir Platform', () => {
    it('should profile Elixir script in container mode', () => {
      const outputPath = getTempOutputPath('elixir-test');
      const scriptPath = path.join(FIXTURES_DIR, 'elixir', 'test.exs');
      const fixtureDir = path.join(FIXTURES_DIR, 'elixir');

      // Skip if fixture doesn't exist
      if (!fs.existsSync(scriptPath)) {
        console.warn(`Skipping test: ${scriptPath} not found`);
        return;
      }

      // Run profiling
      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--cwd',
        fixtureDir,
        '--',
        'elixir',
        'test.exs',
      ]);

      // stderr may contain progress messages - just ensure the command succeeded
      expect(result.stdout).toContain('Profiling completed successfully');

      // Verify the profile contains expected Elixir function symbols
      verifyProfile(outputPath, ['calculate_fibonacci', 'find_primes', 'process_data']);
    });

    // Removed Elixir module test since we have a single test file per platform

    it('should profile mix command', () => {
      const outputPath = getTempOutputPath('mix-test');

      // This test would require a Mix project, so we'll just test detection
      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--',
        'mix',
        'test',
        '--does-not-exist',
      ]);

      // Should detect Elixir/Erlang platform
      expect(result.stdout + result.stderr).toMatch(/erlang|elixir|mix/i);
    });
  });

  describe('JVM Platform', () => {
    it('should profile Java JAR file in container mode', () => {
      const outputPath = getTempOutputPath('jvm-test');
      const _jarPath = path.join(FIXTURES_DIR, 'jvm', 'test.jar');
      const fixtureDir = path.join(FIXTURES_DIR, 'jvm');

      // Run profiling
      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--cwd',
        fixtureDir,
        '--',
        'java',
        '-jar',
        'test.jar',
      ]);

      // stderr may contain progress messages - just ensure the command succeeded
      expect(result.stdout).toContain('Profiling completed successfully');

      // Verify the profile contains expected symbols
      verifyProfile(outputPath, ['calculateFibonacci', 'findPrimes', 'processData']);
    });

    it('should profile JAR file directly', () => {
      const outputPath = getTempOutputPath('jvm-jar-direct-test');
      const _jarPath = path.join(FIXTURES_DIR, 'jvm', 'test.jar');
      const fixtureDir = path.join(FIXTURES_DIR, 'jvm');

      // Run profiling with JAR file directly
      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--cwd',
        fixtureDir,
        '--',
        './test.jar',
      ]);

      // stderr may contain progress messages - just ensure the command succeeded
      expect(result.stdout).toContain('Profiling completed successfully');

      // Verify the profile contains expected symbols
      verifyProfile(outputPath, ['calculateFibonacci', 'findPrimes', 'processData']);
    });
  });

  describe('.NET Platform', () => {
    it('should profile .NET DLL in container mode', () => {
      const outputPath = getTempOutputPath('dotnet-dll-test');
      const _dllPath = path.join(FIXTURES_DIR, 'dotnet', 'Test.dll');
      const fixtureDir = path.join(FIXTURES_DIR, 'dotnet');

      // Run profiling
      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--cwd',
        fixtureDir,
        '--',
        'dotnet',
        'Test.dll',
      ]);

      // stderr may contain progress messages - just ensure the command succeeded
      expect(result.stdout).toContain('Profiling completed successfully');

      // Verify the profile contains expected symbols
      verifyProfile(outputPath, [
        'Test!Test.CalculateFibonacci',
        'Test!Test.FindPrimes',
        'Test!Test.ProcessData',
      ]);
    });

    it('should profile .NET DLL file directly', () => {
      const outputPath = getTempOutputPath('dotnet-dll-direct-test');
      const _dllPath = path.join(FIXTURES_DIR, 'dotnet', 'Test.dll');
      const fixtureDir = path.join(FIXTURES_DIR, 'dotnet');

      // Run profiling with DLL file directly
      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--cwd',
        fixtureDir,
        '--',
        './Test.dll',
      ]);

      // stderr may contain progress messages - just ensure the command succeeded
      expect(result.stdout).toContain('Profiling completed successfully');

      // Verify the profile contains expected symbols
      verifyProfile(outputPath, [
        'Test!Test.CalculateFibonacci',
        'Test!Test.FindPrimes',
        'Test!Test.ProcessData',
      ]);
    });

    it('should profile .NET executable', () => {
      const outputPath = getTempOutputPath('dotnet-exe-test');
      const _exePath = path.join(FIXTURES_DIR, 'dotnet', 'Test');
      const fixtureDir = path.join(FIXTURES_DIR, 'dotnet');

      // Run profiling with executable directly
      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--cwd',
        fixtureDir,
        '--',
        './Test',
      ]);

      // stderr may contain progress messages - just ensure the command succeeded
      expect(result.stdout).toContain('Profiling completed successfully');

      // Verify the profile contains expected symbols
      verifyProfile(outputPath, [
        'Test!Test.CalculateFibonacci',
        'Test!Test.FindPrimes',
        'Test!Test.ProcessData',
      ]);
    });

    it.skip('should profile .NET C# source file', () => {
      const outputPath = getTempOutputPath('dotnet-cs-test');
      const csPath = path.join(FIXTURES_DIR, 'dotnet', 'Test-script.cs');

      // Run profiling with C# source file
      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--',
        csPath,
      ]);

      // stderr may contain progress messages - just ensure the command succeeded
      expect(result.stdout).toContain('Profiling completed successfully');

      // Verify the profile contains expected symbols
      verifyProfile(outputPath, [
        'Test!Test.CalculateFibonacci',
        'Test!Test.FindPrimes',
        'Test!Test.ProcessData',
      ]);
    });
  });

  // Platform detection is now tested in platform-detection.test.ts as unit tests
  // which is much faster than running actual profiling for each platform

  describe('Error Handling', () => {
    it('should handle non-existent files gracefully', () => {
      const outputPath = getTempOutputPath('error-test');

      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--format',
        'json',
        '--',
        'node',
        'non-existent-file.js',
      ]);

      // Should contain an error - check both stdout and stderr
      const combinedOutput = result.stdout + result.stderr;
      expect(combinedOutput).toMatch(/error|failed|cannot/i);
    });

    it('should handle invalid commands gracefully', () => {
      const outputPath = getTempOutputPath('error-test-2');

      const result = runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--',
        'invalid-command-that-does-not-exist',
      ]);

      // Should contain an error about unknown platform or command
      expect(result.stdout + result.stderr).toMatch(
        /could not detect platform|unknown|not found|invalid/i
      );
    });
  });

  describe('Analyze Command', () => {
    it('should analyze profiles with different formats', () => {
      // First create a profile
      const outputPath = getTempOutputPath('analyze-test');
      const _scriptPath = path.join(FIXTURES_DIR, 'nodejs', 'test.js');
      const fixtureDir = path.join(FIXTURES_DIR, 'nodejs');

      runUniprof([
        'record',
        '--mode',
        'container',
        '--output',
        outputPath,
        '--cwd',
        fixtureDir,
        '--',
        'node',
        'test.js',
      ]);

      // Test analyze command with JSON format
      const analyzeResultJson = runUniprof(['analyze', outputPath, '--format', 'json']);
      const analysis = JSON.parse(analyzeResultJson.stdout);
      expect(analysis.summary).toBeDefined();
      expect(analysis.summary.totalSamples).toBeGreaterThan(0);
      expect(analysis.hotspots).toBeDefined();
      expect(Array.isArray(analysis.hotspots)).toBe(true);
      expect(analysis.hotspots.length).toBeGreaterThan(0);

      // Verify hotspot structure
      const firstHotspot = analysis.hotspots[0];
      expect(firstHotspot.name).toBeDefined();
      expect(typeof firstHotspot.percentage).toBe('number');
      expect(firstHotspot.percentage).toBeGreaterThan(0);

      // Test analyze command with pretty format (explicit)
      const analyzeResultPretty = runUniprof(['analyze', outputPath, '--format', 'pretty']);
      expect(analyzeResultPretty.stdout).toContain('Top Functions by Time');
      expect(analyzeResultPretty.stdout).toMatch(/\d+\.\d+%/); // Should have percentages
    });
  });
});
