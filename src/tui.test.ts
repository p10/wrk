import { describe, expect, it, vi } from 'vitest';

import { DIM, RESET, TuiClient, type ProcessLike } from './tui.ts';

type FakeProcess = ReturnType<typeof makeFakeProcess>;

function makeFakeProcess(options: {
  stdoutIsTTY?: boolean;
  stdinIsTTY?: boolean;
  rows?: number;
  cols?: number;
  stdinIsRaw?: boolean;
} = {}) {
  const writes: string[] = [];
  const setRawModeCalls: boolean[] = [];
  const exitCodes: number[] = [];
  const signalHandlers = new Map<string, () => void>();
  let dataListener: ((data: Buffer) => void) | undefined;
  let pauseCount = 0;
  let resumeCount = 0;
  let removeListenerCount = 0;

  const process: ProcessLike = {
    stdout: {
      isTTY: options.stdoutIsTTY ?? true,
      rows: options.rows,
      columns: options.cols,
      write(text: string): boolean {
        writes.push(text);
        return true;
      },
    },
    stdin: {
      isTTY: options.stdinIsTTY ?? true,
      isRaw: options.stdinIsRaw ?? false,
      setRawMode(mode: boolean): void {
        setRawModeCalls.push(mode);
      },
      resume(): void {
        resumeCount += 1;
      },
      pause(): void {
        pauseCount += 1;
      },
      on(event: string, listener: (data: Buffer) => void): void {
        if (event === 'data') dataListener = listener;
      },
      removeListener(event: string, listener: (data: Buffer) => void): void {
        removeListenerCount += 1;
        if (event === 'data' && dataListener === listener) {
          dataListener = undefined;
        }
      },
    },
    exit(code?: number): never {
      exitCodes.push(code ?? 0);
      throw new Error('EXIT');
    },
    on(event: string, listener: () => void): void {
      signalHandlers.set(event, listener);
    },
  };

  return {
    process,
    writes,
    setRawModeCalls,
    exitCodes,
    signalHandlers,
    getDataListener: () => dataListener,
    emitKey: (data: Buffer) => dataListener?.(data),
    pauseCount: () => pauseCount,
    resumeCount: () => resumeCount,
    removeListenerCount: () => removeListenerCount,
  };
}

describe('module exports', () => {
  it('exposes DIM as the dim ANSI escape', () => {
    expect(DIM).toBe('\x1b[2m');
  });

  it('exposes RESET as the reset ANSI escape', () => {
    expect(RESET).toBe('\x1b[0m');
  });
});

describe('Tui (ANSI emission)', () => {
  function writes(fake: FakeProcess): string {
    return fake.writes.join('');
  }

  it('enter() writes alt-screen + clear when stdout is a TTY', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    tui.enter();
    expect(writes(fake)).toBe('\x1b[?1049h\x1b[2J\x1b[H');
  });

  it('enter() is a no-op when stdout is not a TTY', () => {
    const fake = makeFakeProcess({ stdoutIsTTY: false });
    const tui = new TuiClient(fake.process);
    tui.enter();
    expect(fake.writes).toEqual([]);
  });

  it('clear() always writes the clear-screen sequence', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    tui.clear();
    expect(writes(fake)).toBe('\x1b[2J\x1b[H');
  });

  it('hideCursor() writes the hide-cursor sequence', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    tui.hideCursor();
    expect(writes(fake)).toBe('\x1b[?25l');
  });

  it('write(text) forwards the exact text to stdout', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    tui.write('hello world');
    expect(writes(fake)).toBe('hello world');
  });

  it('write("") still calls stdout.write with the empty string', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    tui.write('');
    expect(fake.writes).toEqual(['']);
  });
});

describe('Tui (key handling)', () => {
  it('onKey stores the original raw mode, enables raw mode, resumes, and registers a data listener', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    const handler = () => {};
    tui.onKey(handler);

    expect(fake.setRawModeCalls).toEqual([true]);
    expect(fake.resumeCount()).toBe(1);
    expect(fake.getDataListener()).toEqual(expect.any(Function));
  });

  it('onKey forwards Buffer data to the handler coerced to a string', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    const handler = vi.fn();
    tui.onKey(handler);
    fake.emitKey(Buffer.from('q'));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('q');
  });

  it('onKey is a no-op when stdin is not a TTY', () => {
    const fake = makeFakeProcess({ stdinIsTTY: false });
    const tui = new TuiClient(fake.process);
    const handler = vi.fn();
    tui.onKey(handler);

    expect(fake.setRawModeCalls).toEqual([]);
    expect(fake.getDataListener()).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it('cleanup() restores the original raw mode, removes the listener, and pauses stdin', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    tui.onKey(() => {});
    const wrap = fake.getDataListener();
    fake.setRawModeCalls.length = 0;

    tui.cleanup();

    expect(fake.removeListenerCount()).toBe(1);
    expect(fake.getDataListener()).toBeUndefined();
    expect(fake.setRawModeCalls).toEqual([false]);
    expect(fake.pauseCount()).toBe(1);
    expect(wrap).toEqual(expect.any(Function));
  });

  it('cleanup() without onKey attached does not touch removeListener/setRawMode and still pauses stdin', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);

    tui.cleanup();

    expect(fake.removeListenerCount()).toBe(0);
    expect(fake.setRawModeCalls).toEqual([]);
    expect(fake.pauseCount()).toBe(1);
  });
});

describe('Tui (cleanup callbacks)', () => {
  it('fires onCleanup callbacks in registration order, then clears the list', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    const calls: number[] = [];
    tui.onCleanup(() => calls.push(1));
    tui.onCleanup(() => calls.push(2));
    tui.onCleanup(() => calls.push(3));

    tui.cleanup();
    expect(calls).toEqual([1, 2, 3]);

    // calling cleanup again should not re-fire them
    calls.length = 0;
    tui.cleanup();
    expect(calls).toEqual([]);
  });

  it('cleanup() with no registered callbacks does not throw', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    expect(() => tui.cleanup()).not.toThrow();
  });

  it('cleanup() orders callbacks before stdout-restore writes', () => {
    const fake = makeFakeProcess();
    const order: string[] = [];
    fake.process.stdout.write = (s: string) => {
      order.push(`write:${s}`);
      return true;
    };
    const tui = new TuiClient(fake.process);
    tui.onCleanup(() => {
      order.push('cb1');
    });

    tui.cleanup();
    expect(order[0]).toBe('cb1');
    expect(order.findIndex((x) => x.startsWith('write:'))).toBeGreaterThan(0);
  });

  it('cleanup() writes SHOW_CURSOR then RESET (after alt-screen exit) when stdout is a TTY', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    tui.cleanup();
    const out = fake.writes.join('');
    expect(out).toContain('\x1b[?1049l');
    expect(out).toContain('\x1b[?25h');
    expect(out).toContain('\x1b[0m');
    // exit alt-screen comes before show-cursor which comes before reset
    const iExit = out.indexOf('\x1b[?1049l');
    const iShow = out.indexOf('\x1b[?25h');
    const iReset = out.indexOf('\x1b[0m');
    expect(iExit).toBeLessThan(iShow);
    expect(iShow).toBeLessThan(iReset);
  });

  it('cleanup() does not call process.exit', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    tui.cleanup();
    expect(fake.exitCodes).toEqual([]);
  });
});

describe('Tui (quit)', () => {
  it('quit() runs cleanup and then calls process.exit(0) by default', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    const cb = vi.fn();
    tui.onCleanup(cb);

    expect(() => tui.quit()).toThrow('EXIT');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(fake.exitCodes).toEqual([0]);
  });

  it('quit(code) forwards the exit code to process.exit', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    expect(() => tui.quit(7)).toThrow('EXIT');
    expect(fake.exitCodes).toEqual([7]);
  });

  it('quit() still writes the cleanup escape sequences before exiting', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    expect(() => tui.quit()).toThrow('EXIT');
    const out = fake.writes.join('');
    expect(out).toContain('\x1b[?25h');
    expect(out).toContain('\x1b[0m');
  });
});

describe('Tui (signal installation)', () => {
  it('constructor registers handlers for SIGINT, SIGTERM, and SIGHUP via process.on', () => {
    const fake = makeFakeProcess();
    new TuiClient(fake.process);
    expect([...fake.signalHandlers.keys()]).toEqual([
      'SIGINT',
      'SIGTERM',
      'SIGHUP',
    ]);
    for (const handler of fake.signalHandlers.values()) {
      expect(handler).toEqual(expect.any(Function));
    }
  });

  it('each signal handler routes through quit(0) which calls process.exit(0)', () => {
    const fake = makeFakeProcess();
    new TuiClient(fake.process);
    for (const handler of fake.signalHandlers.values()) {
      fake.exitCodes.length = 0;
      expect(() => handler()).toThrow('EXIT');
      expect(fake.exitCodes).toEqual([0]);
    }
  });

  it('does not grow the handler map when another instance shares the same process', () => {
    const fake = makeFakeProcess();
    new TuiClient(fake.process);
    new TuiClient(fake.process);
    expect(fake.signalHandlers.size).toBe(3);
  });
});

describe('Tui (fitView)', () => {
  const longMarker = `${DIM}... (more)${RESET}`;

  it('returns combined header, body, footer lines', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    const lines = tui.fitView({
      header: ['H1'],
      body: [''],
      footer: ['F1'],
    });
    expect(lines).toContain('H1');
    expect(lines).toContain('F1');
  });

  it('fills terminal height with padding', () => {
    const fake = makeFakeProcess({ rows: 10, cols: 80 });
    const tui = new TuiClient(fake.process);
    const lines = tui.fitView({
      header: ['H'],
      body: [''],
      footer: ['F'],
    });
    // header (1 empty + H) = 2 rows, footer (1 empty + F) = 2 rows, body fits in 6
    expect(lines.length).toBe(10);
  });

  it('truncates body and appends moreMarker when content exceeds available space', () => {
    const fake = makeFakeProcess({ rows: 6, cols: 80 });
    const tui = new TuiClient(fake.process);
    const lines = tui.fitView({
      header: [],
      body: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      footer: [],
      moreMarker: longMarker,
    });
    expect(lines).toContain('a');
    expect(lines.join('\n')).toContain('... (more)');
    expect(lines).not.toContain('g');
  });

  it('does not add moreMarker when body fits within available space', () => {
    const fake = makeFakeProcess({ rows: 10, cols: 80 });
    const tui = new TuiClient(fake.process);
    const lines = tui.fitView({
      header: [],
      body: ['one', 'two'],
      footer: [],
      moreMarker: longMarker,
    });
    expect(lines).toContain('one');
    expect(lines).toContain('two');
    expect(lines.join('\n')).not.toContain('... (more)');
  });

  it('falls back to first non-empty body line when header+footer consume all rows', () => {
    const fake = makeFakeProcess({ rows: 3, cols: 80 });
    const tui = new TuiClient(fake.process);
    const lines = tui.fitView({
      header: ['H1', 'H2'],
      body: ['', 'first', 'second'],
      footer: ['F1'],
    });
    expect(lines).toContain('first');
    expect(lines.join('\n')).not.toContain('second');
  });

  it('wraps long body lines based on stdout.columns', () => {
    const fake = makeFakeProcess({ rows: 10, cols: 10 });
    const tui = new TuiClient(fake.process);
    const longLine = 'x'.repeat(25);
    const lines = tui.fitView({
      header: ['H'],
      body: [longLine],
      footer: ['F'],
      moreMarker: longMarker,
    });
    expect(lines).toContain(longLine);
  });

  it('applies default rows=24, cols=80 when stdout dimensions are undefined', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    const lines = tui.fitView({
      header: ['H'],
      body: ['body'],
      footer: ['F'],
    });
    expect(lines.length).toBe(24);
  });
});

describe('Tui (restoration safety)', () => {
  it('cleanup() called twice is safe: second invocation still restores stdin cleanly', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    tui.onKey(() => {});
    tui.cleanup();
    expect(() => tui.cleanup()).not.toThrow();
    expect(fake.pauseCount()).toBe(2);
  });

  it('cleanup() restores isRaw to the value captured before onKey enabled raw mode', () => {
    const fake = makeFakeProcess({ stdinIsRaw: true });
    const tui = new TuiClient(fake.process);
    tui.onKey(() => {});
    fake.setRawModeCalls.length = 0;
    tui.cleanup();
    expect(fake.setRawModeCalls).toEqual([true]);
  });

  it('cleanup() does not call setRawMode when stdin is no longer a TTY', () => {
    const fake = makeFakeProcess();
    const tui = new TuiClient(fake.process);
    tui.onKey(() => {});
    // simulate the TTY disappearing between onKey and cleanup
    fake.process.stdin.isTTY = false;
    fake.setRawModeCalls.length = 0;
    expect(() => tui.cleanup()).not.toThrow();
    expect(fake.setRawModeCalls).toEqual([]);
  });
});
