export interface PerfFrame {
  address: string;
  symbolName: string;
  file: string;
}

export interface PerfEvent {
  command: string;
  processID: number | null;
  threadID: number;
  time: number;
  eventType: string;
  stack: PerfFrame[];
}

export function parsePerfScript(scriptOutput: string): PerfEvent[] {
  const events: PerfEvent[] = [];
  const lines = scriptOutput.split('\n');
  let currentEvent: PerfEvent | null = null;

  for (const line of lines) {
    if (line === '') {
      if (currentEvent) {
        events.push(currentEvent);
        currentEvent = null;
      }
      continue;
    }

    // Skip comment lines
    if (line.startsWith('#')) continue;

    // Parse event header line
    const eventMatch = /^(\S+)\s+(\d+)(?:\/?(\d+))?\s+(\d+\.\d+):\s+\d+\s+(\S+):/.exec(line);
    if (eventMatch) {
      if (currentEvent) {
        events.push(currentEvent);
      }

      currentEvent = {
        command: eventMatch[1],
        processID: eventMatch[3] ? Number.parseInt(eventMatch[2], 10) : null,
        threadID: Number.parseInt(eventMatch[3] || eventMatch[2], 10),
        time: Number.parseFloat(eventMatch[4]),
        eventType: eventMatch[5],
        stack: [],
      };
    } else if (currentEvent && line.trim()) {
      // Parse stack frame
      // Common formats:
      //   <addr> <symbol+offset> (<file>)
      //   <addr> <symbol+offset>
      // The (file) segment may be absent on some perf setups; treat it as unknown.
      const m = /^\s*([0-9a-fA-F]+)\s+(.+?)(?:\s+\(([^)]+)\))?$/.exec(line);
      if (m) {
        const [, address, symbolNameRaw, fileMaybe] = m;
        const symbolName = symbolNameRaw.replace(/\+0x[\da-fA-F]+$/, '');
        currentEvent.stack.unshift({
          address: `0x${address}`,
          symbolName,
          file: fileMaybe || '[unknown]',
        });
      }
    }
  }

  if (currentEvent) {
    events.push(currentEvent);
  }

  return events;
}

export function convertPerfEventsToSpeedscope(
  events: PerfEvent[],
  exporter = 'uniprof-perf',
  samplingHz = 999
): {
  $schema: string;
  profiles: Array<{
    type: 'sampled';
    name: string;
    unit: 'seconds';
    startValue: number;
    endValue: number;
    samples: number[][];
    weights: number[];
  }>;
  shared: { frames: Array<{ name: string; file?: string }> };
  name: string;
  exporter: string;
} {
  // Convert to speedscope format
  const speedscopeProfile: {
    $schema: string;
    profiles: Array<{
      type: 'sampled';
      name: string;
      unit: 'seconds';
      startValue: number;
      endValue: number;
      samples: number[][];
      weights: number[];
    }>;
    shared: { frames: Array<{ name: string; file?: string }> };
    name: string;
    exporter: string;
  } = {
    $schema: 'https://www.speedscope.app/file-format-schema.json',
    profiles: [],
    shared: {
      frames: [],
    },
    name: 'Native Profile (perf)',
    exporter,
  };

  // Build frame table
  const frameMap = new Map<string, number>();
  const getOrCreateFrame = (symbolName: string, file: string): number => {
    const key = `${symbolName}:${file}`;
    if (!frameMap.has(key)) {
      frameMap.set(key, speedscopeProfile.shared.frames.length);
      speedscopeProfile.shared.frames.push({
        name: symbolName === '[unknown]' ? `??? (${file})` : symbolName,
        file: file,
      });
    }
    return frameMap.get(key)!;
  };

  // Group events by process/thread
  const profilesByThread = new Map<string, { samples: number[][]; weights: number[] }>();

  for (const event of events) {
    if (!event || !event.time) continue;

    const profileKey =
      event.command && event.threadID
        ? event.processID
          ? `${event.command} (pid: ${event.processID}, tid: ${event.threadID})`
          : `${event.command} (tid: ${event.threadID})`
        : event.command || 'Unknown Process';

    if (!profilesByThread.has(profileKey)) {
      profilesByThread.set(profileKey, {
        samples: [],
        weights: [],
      });
    }

    const profile = profilesByThread.get(profileKey)!;
    const stack: number[] = [];

    // Build stack from bottom to top
    for (const frame of event.stack) {
      const frameIndex = getOrCreateFrame(frame.symbolName, frame.file);
      stack.push(frameIndex);
    }

    profile.samples.push(stack);
    const hz = samplingHz > 0 ? samplingHz : 999;
    profile.weights.push(1 / hz); // Each sample represents 1/hz seconds
  }

  // Create profile for each thread
  for (const [name, data] of profilesByThread) {
    if (data.samples.length > 0) {
      speedscopeProfile.profiles.push({
        type: 'sampled',
        name,
        unit: 'seconds',
        startValue: 0,
        endValue: data.samples.length / (samplingHz > 0 ? samplingHz : 999),
        samples: data.samples,
        weights: data.weights,
      });
    }
  }

  return speedscopeProfile;
}
