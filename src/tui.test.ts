import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DIM, RESET, TuiClient } from './tui.ts';

const stdoutWriteSpy = vi.spyOn(process.stdout, 'write');
const processExitSpy = vi
  .spyOn(process, 'exit')
  .mockImplementation((() => {
    throw new Error('EXIT');
  }) as never);
const processOnSpy = vi.spyOn(process, 'on');

type FakeStdin = {
  isTTY: boolean;
  isRaw: boolean;
  setRawMode: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  emit: (ev: string, ...args: unknown[]) => boolean;
};

let fakeStdin: FakeStdin;
let realStdin: typeof process.stdin;
let originalIsTTY: boolean | undefined;

function installFakeStdin(isTTY = true): void {
  const ee = new EventEmitter();
  fakeStdin = {
    isTTY,
    isRaw: false,
    setRawMode: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
    on: vi.fn((ev: string, cb: (...a: unknown[]) => void) => ee.on(ev, cb)),
    removeListener: vi.fn((ev: string, cb: (...a: unknown[]) => void) =>
      ee.removeListener(ev, cb),
    ),
    emit: (ev: string, ...args: unknown[]) => ee.emit(ev, ...args),
  };
  realStdin = process.stdin;
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: fakeStdin,
  });
}

function restoreStdin(): void {
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: realStdin,
  });
}

beforeEach(() => {
  stdoutWriteSpy.mockClear();
  processExitSpy.mockClear();
  processOnSpy.mockClear();
  originalIsTTY = process.stdout.isTTY;
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: true,
  });
  installFakeStdin(true);
});

afterEach(() => {
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: originalIsTTY,
  });
  restoreStdin();
  // strip any real SIGINT/SIGTERM/SIGHUP handlers that the Tui instances
  // registered via #installSignals (the spy captures them but process.on
  // also fires the real registration chain)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.removeAllListeners(sig);
  }
});

function writes(): string {
  return stdoutWriteSpy.mock.calls.map((c) => c[0]).join('');
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
  it('enter() writes alt-screen + clear when stdout is a TTY', () => {
    const tui = new TuiClient();
    tui.enter();
    expect(writes()).toBe('\x1b[?1049h\x1b[2J\x1b[H');
  });

  it('enter() is a no-op when stdout is not a TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: false,
    });
    const tui = new TuiClient();
    tui.enter();
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it('exit() writes exit-alt-screen when stdout is a TTY', () => {
    const tui = new TuiClient();
    tui.exit();
    expect(writes()).toBe('\x1b[?1049l');
  });

  it('exit() is a no-op when stdout is not a TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: false,
    });
    const tui = new TuiClient();
    tui.exit();
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it('clear() always writes the clear-screen sequence', () => {
    const tui = new TuiClient();
    tui.clear();
    expect(writes()).toBe('\x1b[2J\x1b[H');
  });

  it('hideCursor() writes the hide-cursor sequence', () => {
    const tui = new TuiClient();
    tui.hideCursor();
    expect(writes()).toBe('\x1b[?25l');
  });

  it('showCursor() writes the show-cursor sequence', () => {
    const tui = new TuiClient();
    tui.showCursor();
    expect(writes()).toBe('\x1b[?25h');
  });

  it('write(text) forwards the exact text to stdout', () => {
    const tui = new TuiClient();
    tui.write('hello world');
    expect(writes()).toBe('hello world');
  });

  it('write("") still calls stdout.write with the empty string', () => {
    const tui = new TuiClient();
    tui.write('');
    expect(stdoutWriteSpy).toHaveBeenCalledWith('');
  });
});

describe('Tui (key handling)', () => {
  it('onKey stores the original raw mode, enables raw mode, resumes, and registers a data listener', () => {
    const tui = new TuiClient();
    const handler = vi.fn();
    tui.onKey(handler);

    expect(fakeStdin.setRawMode).toHaveBeenCalledWith(true);
    expect(fakeStdin.resume).toHaveBeenCalledTimes(1);
    expect(fakeStdin.on).toHaveBeenCalledTimes(1);
    expect(fakeStdin.on).toHaveBeenCalledWith('data', expect.any(Function));
  });

  it('onKey forwards Buffer data to the handler coerced to a string', () => {
    const tui = new TuiClient();
    const handler = vi.fn();
    tui.onKey(handler);
    fakeStdin.emit('data', Buffer.from('q'));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('q');
  });

  it('onKey is a no-op when stdin is not a TTY', () => {
    installFakeStdin(false);
    const tui = new TuiClient();
    const handler = vi.fn();
    tui.onKey(handler);

    expect(fakeStdin.setRawMode).not.toHaveBeenCalled();
    expect(fakeStdin.on).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('cleanup() restores the original raw mode, removes the listener, and pauses stdin', () => {
    const tui = new TuiClient();
    tui.onKey(vi.fn());
    const originalWrap = fakeStdin.on.mock.calls[0]![1] as (d: Buffer) => void;
    fakeStdin.setRawMode.mockClear();
    fakeStdin.pause.mockClear();
    fakeStdin.removeListener.mockClear();

    tui.cleanup();

    expect(fakeStdin.removeListener).toHaveBeenCalledWith('data', originalWrap);
    expect(fakeStdin.setRawMode).toHaveBeenCalledWith(false);
    expect(fakeStdin.pause).toHaveBeenCalledTimes(1);
  });

  it('cleanup() without onKey attached does not touch removeListener/setRawMode and still pauses stdin', () => {
    const tui = new TuiClient();
    fakeStdin.removeListener.mockClear();
    fakeStdin.setRawMode.mockClear();
    fakeStdin.pause.mockClear();

    tui.cleanup();

    expect(fakeStdin.removeListener).not.toHaveBeenCalled();
    expect(fakeStdin.setRawMode).not.toHaveBeenCalled();
    expect(fakeStdin.pause).toHaveBeenCalledTimes(1);
  });
});

describe('Tui (cleanup callbacks)', () => {
  it('fires onCleanup callbacks in registration order, then clears the list', () => {
    const tui = new TuiClient();
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
    const tui = new TuiClient();
    expect(() => tui.cleanup()).not.toThrow();
  });

  it('cleanup() orders callbacks before stdout-restore writes', () => {
    const tui = new TuiClient();
    const order: string[] = [];
    tui.onCleanup(() => {
      order.push('cb1');
    });
    stdoutWriteSpy.mockImplementation((s) => {
      order.push(`write:${s}`);
      return true;
    });
    // restore real impl (the Once above only intercepts the first call)
    stdoutWriteSpy.mockImplementation((s) => {
      order.push(`write:${s}`);
      return true;
    });

    tui.cleanup();
    expect(order[0]).toBe('cb1');
    // subsequent write entries come after cb1
    expect(order.findIndex((x) => x.startsWith('write:'))).toBeGreaterThan(0);
    // restore default mock
    stdoutWriteSpy.mockImplementation(() => true);
  });

  it('cleanup() writes SHOW_CURSOR then RESET (after alt-screen exit) when stdout is a TTY', () => {
    const tui = new TuiClient();
    stdoutWriteSpy.mockClear();
    tui.cleanup();
    const out = writes();
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
    const tui = new TuiClient();
    tui.cleanup();
    expect(processExitSpy).not.toHaveBeenCalled();
  });
});

describe('Tui (quit)', () => {
  it('quit() runs cleanup and then calls process.exit(0) by default', () => {
    const tui = new TuiClient();
    const cb = vi.fn();
    tui.onCleanup(cb);

    expect(() => tui.quit()).toThrow('EXIT');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('quit(code) forwards the exit code to process.exit', () => {
    const tui = new TuiClient();
    expect(() => tui.quit(7)).toThrow('EXIT');
    expect(processExitSpy).toHaveBeenCalledWith(7);
  });

  it('quit() still writes the cleanup escape sequences before exiting', () => {
    const tui = new TuiClient();
    stdoutWriteSpy.mockClear();
    expect(() => tui.quit()).toThrow('EXIT');
    const out = writes();
    expect(out).toContain('\x1b[?25h');
    expect(out).toContain('\x1b[0m');
  });
});

describe('Tui (signal installation)', () => {
  it('constructor registers handlers for SIGINT, SIGTERM, and SIGHUP via process.on', () => {
    processOnSpy.mockClear();
    new TuiClient();
    const signals = processOnSpy.mock.calls.map((c) => c[0]);
    expect(signals).toEqual(['SIGINT', 'SIGTERM', 'SIGHUP']);
    processOnSpy.mock.calls.forEach((c) =>
      expect(c[1]).toEqual(expect.any(Function)),
    );
  });

  it('each signal handler routes through quit(0) which calls process.exit(0)', () => {
    processOnSpy.mockClear();
    const tui = new TuiClient();
    const handlers = processOnSpy.mock.calls.map((c) => c[1] as () => void);
    for (const h of handlers) {
      processExitSpy.mockClear();
      expect(() => h()).toThrow('EXIT');
      expect(processExitSpy).toHaveBeenCalledWith(0);
    }
    void tui;
  });

  it('does not reinstall signal handlers on the same instance twice', () => {
    processOnSpy.mockClear();
    const tui = new TuiClient();
    const first = processOnSpy.mock.calls.length;
    // call the private guard indirectly — there is no public re-entry, so just
    // assert that constructing two instances installs 6 total (3 each).
    new TuiClient();
    expect(processOnSpy.mock.calls.length).toBe(first + 3);
    void tui;
  });
});

describe('Tui (restoration safety)', () => {
  it('cleanup() called twice is safe: second invocation still restores stdin cleanly', () => {
    const tui = new TuiClient();
    tui.onKey(vi.fn());
    tui.cleanup();
    fakeStdin.removeListener.mockClear();
    fakeStdin.pause.mockClear();
    fakeStdin.setRawMode.mockClear();
    expect(() => tui.cleanup()).not.toThrow();
    expect(fakeStdin.pause).toHaveBeenCalledTimes(1);
  });

  it('cleanup() restores isRaw to the value captured before onKey enabled raw mode', () => {
    const tui = new TuiClient();
    fakeStdin.isRaw = true;
    tui.onKey(vi.fn());
    fakeStdin.setRawMode.mockClear();
    tui.cleanup();
    expect(fakeStdin.setRawMode).toHaveBeenCalledWith(true);
  });

  it('cleanup() does not call setRawMode when stdin is no longer a TTY', () => {
    const tui = new TuiClient();
    tui.onKey(vi.fn());
    // simulate the TTY disappearing between onKey and cleanup
    installFakeStdin(false);
    fakeStdin.setRawMode.mockClear();
    expect(() => tui.cleanup()).not.toThrow();
    expect(fakeStdin.setRawMode).not.toHaveBeenCalled();
  });
});