const ENTER_ALT_SCREEN = '\x1b[?1049h';
const EXIT_ALT_SCREEN = '\x1b[?1049l';
const CLEAR_SCREEN = '\x1b[2J\x1b[H';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export { DIM, GREEN, RESET };

export interface ProcessLike {
  stdout: {
    isTTY?: boolean;
    rows?: number;
    columns?: number;
    write(text: string): boolean;
  };
  stdin: {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode(mode: boolean): void;
    resume(): void;
    pause(): void;
    on(event: string, listener: (data: Buffer) => void): void;
    removeListener(event: string, listener: (data: Buffer) => void): void;
  };
  exit(code?: number): never;
  on(event: string, listener: () => void): void;
}

export interface Tui {
  enter(): void;
  hideCursor(): void;
  onKey(handler: (key: string) => void): void;
  onCleanup(callback: () => void): void;
  clear(): void;
  write(text: string): void;
  fitView(sections: {
    header: string[];
    body: string[];
    footer: string[];
    moreMarker?: string;
  }): string[];
  cleanup(): void;
  quit(code?: number): void;
}

export class TuiClient implements Tui {
  #process: ProcessLike;
  #originalIsRaw?: boolean;
  #wrap?: (data: Buffer) => void;
  #cleanupCallbacks: Array<() => void> = [];
  #signalsInstalled = false;

  constructor(processLike: ProcessLike = process) {
    this.#process = processLike;
    this.#installSignals();
  }

  enter(): void {
    if (this.#process.stdout.isTTY !== true) return;
    this.#process.stdout.write(`${ENTER_ALT_SCREEN}${CLEAR_SCREEN}`);
  }

  hideCursor(): void {
    this.#process.stdout.write(HIDE_CURSOR);
  }

  onKey(handler: (key: string) => void): void {
    if (!this.#process.stdin.isTTY) return;
    this.#originalIsRaw = this.#process.stdin.isRaw;
    this.#process.stdin.setRawMode(true);
    this.#process.stdin.resume();
    this.#wrap = (data: Buffer) => handler(data.toString());
    this.#process.stdin.on('data', this.#wrap);
  }

  onCleanup(callback: () => void): void {
    this.#cleanupCallbacks.push(callback);
  }

  clear(): void {
    this.#process.stdout.write(CLEAR_SCREEN);
  }

  write(text: string): void {
    this.#process.stdout.write(text);
  }

  fitView(sections: {
    header: string[];
    body: string[];
    footer: string[];
    moreMarker?: string;
  }): string[] {
    const { rows, cols } = this.#getSize();
    const headerRows = this.#rowsOf(sections.header, cols);
    const footerRows = this.#rowsOf(sections.footer, cols);
    const avail = rows - headerRows - footerRows;
    const marker = sections.moreMarker ?? '';

    const fitted = this.#fitLines(sections.body, avail, cols, marker);

    const pad = avail - this.#rowsOf(fitted, cols);
    if (pad > 0) {
      fitted.push(...Array<string>(pad).fill(''));
    }

    return [...sections.header, ...fitted, ...sections.footer];
  }

  cleanup(): void {
    for (const callback of this.#cleanupCallbacks) callback();
    this.#cleanupCallbacks.length = 0;
    this.#restoreStdin();
    this.#exit();
    this.#showCursor();
    this.#process.stdout.write(RESET);
  }

  quit(code: number = 0): void {
    this.cleanup();
    this.#process.exit(code);
  }

  #installSignals(): void {
    if (this.#signalsInstalled) return;
    this.#signalsInstalled = true;
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      this.#process.on(signal, () => this.quit(0));
    }
  }

  #exit(): void {
    if (this.#process.stdout.isTTY !== true) return;
    this.#process.stdout.write(EXIT_ALT_SCREEN);
  }

  #showCursor(): void {
    this.#process.stdout.write(SHOW_CURSOR);
  }

  #restoreStdin(): void {
    if (this.#wrap) {
      this.#process.stdin.removeListener('data', this.#wrap);
      this.#wrap = undefined;
    }
    if (this.#originalIsRaw !== undefined && this.#process.stdin.isTTY) {
      this.#process.stdin.setRawMode(this.#originalIsRaw);
      this.#originalIsRaw = undefined;
    }
    this.#process.stdin.pause();
  }

  #getSize(): { rows: number; cols: number } {
    return {
      rows: this.#process.stdout.rows ?? 24,
      cols: this.#process.stdout.columns ?? 80,
    };
  }

  #rowsOf(lines: string[], cols: number): number {
    return lines.reduce((n, l) => n + this.#visualRows(l, cols), 0);
  }

  #visualRows(line: string, cols: number): number {
    const w = line.replace(ANSI_RE, '').length;
    return w === 0 ? 1 : Math.max(1, Math.ceil(w / cols));
  }

  #fitLines(
    lines: string[],
    availableRows: number,
    cols: number,
    moreMarker: string = '',
  ): string[] {
    // No room for content: at least show the first non-empty line.
    if (availableRows <= 0) {
      return [lines.find((l) => l.length > 0) ?? ''];
    }

    // Everything fits: show the whole body (fitView pads to fill the terminal).
    if (this.#rowsOf(lines, cols) <= availableRows) return lines;

    const moreRows = moreMarker ? this.#visualRows(moreMarker, cols) : 0;

    // The marker must fit on its own; if not, show nothing.
    if (moreRows > availableRows) return [];

    // Reserve rows for the marker, or use all rows when there is none.
    const budget = moreMarker ? availableRows - moreRows : availableRows;
    const fitted: string[] = [];
    let used = 0;
    for (const line of lines) {
      const r = this.#visualRows(line, cols);
      if (used + r > budget) break;
      fitted.push(line);
      used += r;
    }
    if (moreMarker) fitted.push(moreMarker);
    return fitted;
  }
}
