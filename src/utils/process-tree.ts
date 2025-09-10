export function parsePidPpidChildren(output: string, parentPid: number): number[] {
  const lines = output.split('\n').slice(1);
  const pairs = lines
    .map((l) => l.trim().split(/\s+/))
    .filter((arr) => arr.length >= 2)
    .map(([pid, ppid]) => ({ pid: Number.parseInt(pid, 10), ppid: Number.parseInt(ppid, 10) }));

  const byParent = new Map<number, number[]>();
  for (const { pid, ppid } of pairs) {
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    if (!byParent.has(ppid)) byParent.set(ppid, []);
    byParent.get(ppid)!.push(pid);
  }

  const result: number[] = [];
  const stack = [parentPid];
  const visited = new Set<number>();
  while (stack.length) {
    const cur = stack.pop()!;
    const children = byParent.get(cur) || [];
    for (const c of children) {
      if (visited.has(c)) continue;
      visited.add(c);
      result.push(c);
      stack.push(c);
    }
  }
  return result;
}

// The denylist is platform-specific; platforms supply process names.

export function parsePidComm(output: string): Map<number, string> {
  const map = new Map<number, string>();
  const lines = output.split('\n').slice(1);
  for (const l of lines) {
    const parts = l.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const pid = Number.parseInt(parts[0], 10);
    const comm = parts.slice(1).join(' ');
    if (Number.isFinite(pid) && comm) {
      map.set(pid, comm.toLowerCase());
    }
  }
  return map;
}

export function filterPidsByDenylist(
  pids: number[],
  pidToComm: Map<number, string>,
  denylist: string[]
): number[] {
  const deny = new Set(denylist.map((n) => n.toLowerCase()));
  return pids.filter((pid) => {
    const name = (pidToComm.get(pid) || '').toLowerCase();
    return !deny.has(name);
  });
}
