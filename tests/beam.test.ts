import { describe, expect, it } from 'bun:test';
import { BeamPlatform } from '../src/platforms/beam.js';

// Combined tests for Elixir + Erlang BEAM support
describe('BeamPlatform (Erlang/Elixir)', () => {
  const platform = new BeamPlatform();

  describe('detectCommand - Elixir', () => {
    it('detects elixir and iex', () => {
      expect(platform.detectCommand(['elixir', 'script.exs'])).toBe(true);
      expect(platform.detectCommand(['iex', '-S', 'mix'])).toBe(true);
    });
    it('detects mix invocations', () => {
      expect(platform.detectCommand(['mix', 'run', '--no-halt'])).toBe(true);
      expect(platform.detectCommand(['mix', 'test'])).toBe(true);
      expect(platform.detectCommand(['mix', 'deps.get'])).toBe(true);
    });
  });

  describe('detectCommand - Erlang', () => {
    it('detects erl, escript, rebar3', () => {
      expect(platform.detectCommand(['erl', '-noshell', '-s', 'module'])).toBe(true);
      expect(platform.detectCommand(['escript', 'script.erl'])).toBe(true);
      expect(platform.detectCommand(['rebar3', 'compile'])).toBe(true);
      expect(platform.detectCommand(['./hello.escript'])).toBe(true);
    });
  });

  describe('detectExtension', () => {
    it('includes Elixir/Erlang extensions', () => {
      expect(platform.detectExtension('module.ex')).toBe(true);
      expect(platform.detectExtension('module.exs')).toBe(true);
      expect(platform.detectExtension('module.erl')).toBe(true);
      expect(platform.detectExtension('header.hrl')).toBe(true);
      expect(platform.detectExtension('app.app.src')).toBe(true);
    });
  });

  describe('platform properties', () => {
    it('metadata', () => {
      expect(platform.name).toBe('beam');
      expect(platform.profiler).toBe('perf');
      expect(platform.getContainerImage()).toBe('ghcr.io/indragiek/uniprof-beam:latest');
    });
  });

  describe('host-mode env propagation', () => {
    it('sets ERL_FLAGS into runtimeEnv for Elixir', () => {
      const ctx: any = {};
      const cmd = platform.buildLocalProfilerCommand(
        ['elixir', 'script.exs'],
        '/tmp/profile.json',
        { output: '/tmp/profile.json' },
        ctx
      );
      expect(Array.isArray(cmd)).toBe(true);
      expect(ctx.runtimeEnv?.ERL_FLAGS).toBe('+JPperf true');
    });

    it('sets ERL_FLAGS into runtimeEnv for Erlang', () => {
      const ctx: any = {};
      const cmd = platform.buildLocalProfilerCommand(
        ['erl', '-noshell', '-s', 'm', 'start'],
        '/tmp/profile.json',
        { output: '/tmp/profile.json' },
        ctx
      );
      expect(Array.isArray(cmd)).toBe(true);
      expect(ctx.runtimeEnv?.ERL_FLAGS).toBe('+JPperf true');
    });
  });

  describe('sampling rate', () => {
    it('defaults to 999Hz and respects -F', () => {
      expect(platform.getSamplingRate()).toBe(999);
      expect(platform.getSamplingRate(['-F', '500'])).toBe(500);
    });
  });
});
