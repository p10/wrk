const ENTER_ALT_SCREEN = '\x1b[?1049h';
const EXIT_ALT_SCREEN = '\x1b[?1049l';
const CLEAR_SCREEN = '\x1b[2J\x1b[H';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';

export { DIM, GREEN, RESET };

export class Tui {
  #originalIsRaw?: boolean;
  #wrap?: (data: Buffer) => void;
  #cleanupCallbacks: Array<() => void> = [];
  #signalsInstalled = false;

  constructor() {
    this.#installSignals();
  }

  enter(): void {
    if (process.stdout.isTTY !== true) return;
    process.stdout.write(`${ENTER_ALT_SCREEN}${CLEAR_SCREEN}`);
  }

  exit(): void {
    if (process.stdout.isTTY !== true) return;
    process.stdout.write(EXIT_ALT_SCREEN);
  }

  clear(): void {
    process.stdout.write(CLEAR_SCREEN);
  }

  write(text: string): void {
    process.stdout.write(text);
  }

  hideCursor(): void {
    process.stdout.write(HIDE_CURSOR);
  }

  showCursor(): void {
    process.stdout.write(SHOW_CURSOR);
  }

  onKey(handler: (key: string) => void): void {
    if (!process.stdin.isTTY) return;
    this.#originalIsRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    this.#wrap = (data: Buffer) => handler(data.toString());
    process.stdin.on('data', this.#wrap);
  }

  onCleanup(callback: () => void): void {
    this.#cleanupCallbacks.push(callback);
  }

  cleanup(): void {
    for (const callback of this.#cleanupCallbacks) callback();
    this.#cleanupCallbacks.length = 0;
    this.#restoreStdin();
    this.exit();
    process.stdout.write(SHOW_CURSOR);
    process.stdout.write(RESET);
  }

  quit(code: number = 0): void {
    this.cleanup();
    process.exit(code);
  }

  #restoreStdin(): void {
    if (this.#wrap) {
      process.stdin.removeListener('data', this.#wrap);
      this.#wrap = undefined;
    }
    if (this.#originalIsRaw !== undefined && process.stdin.isTTY) {
      process.stdin.setRawMode(this.#originalIsRaw);
      this.#originalIsRaw = undefined;
    }
    process.stdin.pause();
  }

  #installSignals(): void {
    if (this.#signalsInstalled) return;
    this.#signalsInstalled = true;
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as NodeJS.Signals[]) {
      process.on(signal, () => this.quit(0));
    }
  }
}
