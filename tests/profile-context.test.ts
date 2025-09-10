import { describe, expect, it } from 'bun:test';
import type { ProfileContext } from '../src/types/platform-plugin.js';
import {
  addTempDir,
  addTempFile,
  mergeRuntimeEnv,
  setRawArtifact,
} from '../src/utils/profile-context.js';

describe('profile-context helpers', () => {
  it('sets raw artifact', () => {
    const ctx: ProfileContext = {};
    setRawArtifact(ctx, 'ticks', '/tmp/ticks.json');
    expect(ctx.rawArtifact).toBeDefined();
    expect(ctx.rawArtifact?.type).toBe('ticks');
    expect(ctx.rawArtifact?.path).toBe('/tmp/ticks.json');
  });

  it('accumulates temp files/dirs', () => {
    const ctx: ProfileContext = {};
    addTempFile(ctx, '/tmp/a');
    addTempFile(ctx, '/tmp/b');
    addTempDir(ctx, '/tmp/dir1');
    addTempDir(ctx, '/tmp/dir2');
    expect(ctx.tempFiles).toEqual(['/tmp/a', '/tmp/b']);
    expect(ctx.tempDirs).toEqual(['/tmp/dir1', '/tmp/dir2']);
  });

  it('merges runtime env', () => {
    const ctx: ProfileContext = {};
    mergeRuntimeEnv(ctx, { A: '1', B: '2' });
    mergeRuntimeEnv(ctx, { B: '3', C: '4' });
    expect(ctx.runtimeEnv).toEqual({ A: '1', B: '3', C: '4' });
  });
});
