const ENTER_ALT_SCREEN = '\x1b[?1049h';
const EXIT_ALT_SCREEN = '\x1b[?1049l';
const CLEAR_SCREEN = '\x1b[2J\x1b[H';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export { DIM, GREEN, RESET };

export interface Tui {
  enter(): void;
  clear(): void;
  write(text: string): void;
  hideCursor(): void;
  onKey(handler: (key: string) => void): void;
  onCleanup(callback: () => void): void;
  cleanup(): void;
  quit(code?: number): void;
  fitView(sections: {
    header: string[];
    body: string[];
    footer: string[];
    moreMarker?: string;
  }): string[];
}

export class TuiClient implements Tui {
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

  #exit(): void {
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

  #showCursor(): void {
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
    this.#exit();
    this.#showCursor();
    process.stdout.write(RESET);
  }

  quit(code: number = 0): void {
    this.cleanup();
    process.exit(code);
  }

  #getSize(): { rows: number; cols: number } {
    return {
      rows: process.stdout.rows ?? 24,
      cols: process.stdout.columns ?? 80,
    };
  }

  #visualRows(line: string, cols?: number): number {
    const w = line.replace(ANSI_RE, '').length;
    const c = cols ?? this.#getSize().cols;
    return w === 0 ? 1 : Math.max(1, Math.ceil(w / c));
  }

  #fitLines(
    lines: string[],
    availableRows: number,
    moreMarker: string = '',
  ): string[] {
    const cols = this.#getSize().cols;

    if (availableRows <= 0) return [];

    const moreRows = moreMarker ? this.#visualRows(moreMarker, cols) : 0;
    const result: string[] = [];
    let used = 0;
    let truncated = false;

    for (const line of lines) {
      const r = this.#visualRows(line, cols);
      if (used + r > availableRows) {
        truncated = true;
        break;
      }
      result.push(line);
      used += r;
    }

    if (!truncated) {
      while (used < availableRows) {
        result.push('');
        used += 1;
      }
    } else if (moreMarker) {
      while (result.length > 0 && used + moreRows > availableRows) {
        const last = result.pop()!;
        used -= this.#visualRows(last, cols);
      }
      if (availableRows - used >= moreRows) {
        result.push(moreMarker);
      }
    }

    return result;
  }

  fitView(sections: {
    header: string[];
    body: string[];
    footer: string[];
    moreMarker?: string;
  }): string[] {
    const { rows, cols } = this.#getSize();
    const headerRows = sections.header.reduce(
      (n, l) => n + this.#visualRows(l, cols),
      0,
    );
    const footerRows = sections.footer.reduce(
      (n, l) => n + this.#visualRows(l, cols),
      0,
    );
    const avail = rows - headerRows - footerRows;
    const marker = sections.moreMarker ?? '';

    let fitted: string[];
    if (avail <= 0) {
      fitted = [sections.body.find((l) => l.length > 0) ?? ''];
    } else {
      fitted = this.#fitLines(sections.body, avail, marker);
    }

    const used = headerRows + fitted.reduce((n, l) => n + this.#visualRows(l, cols), 0) + footerRows;
    const pad = rows - used;
    if (pad > 0) {
      fitted.push(...Array<string>(pad).fill(''));
    }

    return [...sections.header, ...fitted, ...sections.footer];
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
