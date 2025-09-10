import * as fs from 'node:fs';
import type { ProfileContext, RawArtifactType } from '../types/platform-plugin.js';

export function setRawArtifact(ctx: ProfileContext, type: RawArtifactType, path: string): void {
  ctx.rawArtifact = { type, path };
}

export function addTempFile(ctx: ProfileContext, path: string): void {
  if (!ctx.tempFiles) ctx.tempFiles = [];
  ctx.tempFiles.push(path);
}

export function addTempDir(ctx: ProfileContext, path: string): void {
  if (!ctx.tempDirs) ctx.tempDirs = [];
  ctx.tempDirs.push(path);
}

export function mergeRuntimeEnv(
  ctx: ProfileContext,
  env: Record<string, string> | undefined | null
): void {
  if (!env) return;
  ctx.runtimeEnv = { ...(ctx.runtimeEnv || {}), ...env };
}

export async function cleanupTemps(ctx: ProfileContext): Promise<void> {
  if (ctx.tempFiles) {
    for (const f of ctx.tempFiles) {
      try {
        if (fs.existsSync(f)) await fs.promises.unlink(f);
      } catch {}
    }
  }
  if (ctx.tempDirs) {
    for (const d of ctx.tempDirs) {
      try {
        await fs.promises.rm(d, { recursive: true, force: true });
      } catch {}
    }
  }
}

export async function finalizeProfile(
  ctx: ProfileContext,
  inputPath: string,
  finalOutputPath: string,
  exporter: string
): Promise<void> {
  const { setProfileExporter } = await import('./profile.js');
  await setProfileExporter(inputPath, exporter);
  if (inputPath !== finalOutputPath) {
    await fs.promises.rename(inputPath, finalOutputPath);
  }
  await cleanupTemps(ctx);
}
