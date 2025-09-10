import type { Readable } from 'node:stream';
import { execa, execaSync, type Subprocess } from 'execa';

export interface SpawnOptions {
  stdin?: 'inherit' | 'pipe';
  stdout?: 'inherit' | 'pipe';
  stderr?: 'inherit' | 'pipe';
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export interface SpawnProcess {
  pid?: number;
  stdout: Readable | null;
  stderr: Readable | null;
  exited: Promise<number>;
  kill: (signal?: NodeJS.Signals) => void;
  signalCode: NodeJS.Signals | null;
}

export function spawn(cmd: string[], options: SpawnOptions = {}): SpawnProcess {
  const child: Subprocess = execa(cmd[0], cmd.slice(1), {
    stdin: options.stdin ?? 'inherit',
    stdout: options.stdout ?? 'pipe',
    stderr: options.stderr ?? 'pipe',
    cwd: options.cwd,
    env: options.env,
    reject: false,
  });

  let signalCode: NodeJS.Signals | null = null;
  const exited = new Promise<number>((resolve) => {
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      signalCode = signal || null;
      resolve(code ?? 0);
    });
  });

  return {
    pid: child.pid,
    stdout: child.stdout ?? null,
    stderr: child.stderr ?? null,
    exited,
    kill: (signal?: NodeJS.Signals) => {
      try {
        child.kill(signal);
      } catch {}
    },
    get signalCode() {
      return signalCode;
    },
  };
}

export function spawnSync(cmd: string[], options: SpawnOptions = {}) {
  const res = execaSync(cmd[0], cmd.slice(1), {
    stdin: options.stdin ?? 'inherit',
    stdout: options.stdout ?? 'pipe',
    stderr: options.stderr ?? 'pipe',
    cwd: options.cwd,
    env: options.env,
    reject: false,
  });
  return {
    exitCode: res.exitCode ?? 0,
    stdout: Buffer.from(res.stdout ?? ''),
    stderr: Buffer.from(res.stderr ?? ''),
  };
}

// Helper to accumulate an entire Readable stream into a UTF-8 string.
export function readAll(stream?: Readable | null): Promise<string> {
  if (!stream) return Promise.resolve('');
  return new Promise<string>((resolve, reject) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      data += chunk;
    });
    stream.on('end', () => resolve(data));
    stream.on('error', (err) => reject(err));
  });
}

// Collect stdout/stderr concurrently; resolves when both streams end.
export function collectOutputs(proc: SpawnProcess): {
  stdout: Promise<string>;
  stderr: Promise<string>;
} {
  return {
    stdout: readAll(proc.stdout),
    stderr: readAll(proc.stderr),
  };
}
