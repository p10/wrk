import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { browse } from '../browse.ts';
import { type Db } from '../db.ts';
import { initTable, saveOffers } from '../offer.ts';

type OfferRow = {
  source: 'linkedin' | 'justjoin';
  link: string;
  title: string;
  company: string;
  salary?: string;
  workplaceType?: string;
  postedAt?: string;
  skills?: string;
  locations?: string;
  languages?: string;
};

vi.mock('../linkedin.ts', () => ({
  fetchDesc: vi.fn(
    (_link: string) =>
      new Promise<string>((resolve, reject) => {
        tuiState.pendingDesc.push({ resolve, reject });
      }),
  ),
}));

vi.mock('../justjoin.ts', () => ({
  fetchDesc: vi.fn(
    (_link: string) =>
      new Promise<string>((resolve, reject) => {
        tuiState.pendingDesc.push({ resolve, reject });
      }),
  ),
}));

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

let tuiState: ReturnType<typeof makeTuiState>;

function makeTuiState() {
  const writes: string[] = [];
  let keyHandler: ((k: string) => void) | undefined;
  const cleanupCallbacks: Array<() => void> = [];
  let cleaned = false;
  let quitCalled = false;
  const pendingDesc: Array<{
    resolve: (s: string) => void;
    reject: (e: unknown) => void;
  }> = [];

  const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

  function visualRows(line: string, cols: number): number {
    const w = line.replace(ANSI_RE, '').length;
    return w === 0 ? 1 : Math.max(1, Math.ceil(w / cols));
  }

  const tui = {
    writes,
    cleaned: false,
    quitCalled: false,
    onKey(cb: (k: string) => void): void {
      keyHandler = cb;
    },
    onCleanup(cb: () => void): void {
      cleanupCallbacks.push(cb);
    },
    enter(): void {},
    hideCursor(): void {},
    clear(): void {
      writes.length = 0;
    },
    write(s: string): void {
      writes.push(s);
    },
    showCursor(): void {},
    cleanup(): void {
      for (const cb of cleanupCallbacks) cb();
      cleanupCallbacks.length = 0;
      cleaned = true;
    },
    quit(): void {
      this.cleanup();
      quitCalled = true;
    },
    getSize(): { rows: number; cols: number } {
      return {
        rows: process.stdout.rows ?? 24,
        cols: process.stdout.columns ?? 80,
      };
    },
    visualRows(line: string, cols?: number): number {
      return visualRows(line, cols ?? 80);
    },
    fitLines(lines: string[], availableRows: number, moreMarker: string = ''): string[] {
      const cols = (process.stdout.columns ?? 80) as number;

      if (availableRows <= 0) return [];

      const moreRows = moreMarker ? visualRows(moreMarker, cols) : 0;
      const result: string[] = [];
      let used = 0;
      let truncated = false;

      for (const line of lines) {
        const r = visualRows(line, cols);
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
          used -= visualRows(last, cols);
        }
        if (availableRows - used >= moreRows) {
          result.push(moreMarker);
        }
      }

      return result;
    },
    fitView(sections: {
      header: string[];
      body: string[];
      footer: string[];
      moreMarker?: string;
    }): string[] {
      const { rows, cols } = this.getSize();
      const headerRows = sections.header.reduce(
        (n, l) => n + visualRows(l, cols),
        0,
      );
      const footerRows = sections.footer.reduce(
        (n, l) => n + visualRows(l, cols),
        0,
      );
      const avail = rows - headerRows - footerRows;
      const marker = sections.moreMarker ?? '';

      let fitted: string[];
      if (avail <= 0) {
        fitted = [sections.body.find((l) => l.length > 0) ?? ''];
      } else {
        fitted = this.fitLines(sections.body, avail, marker);
      }

      const used = headerRows + fitted.reduce((n, l) => n + visualRows(l, cols), 0) + footerRows;
      const pad = rows - used;
      if (pad > 0) {
        fitted.push(...Array<string>(pad).fill(''));
      }

      return [...sections.header, ...fitted, ...sections.footer];
    },
  };

  Object.defineProperty(tui, 'cleaned', {
    get() {
      return cleaned;
    },
  });
  Object.defineProperty(tui, 'quitCalled', {
    get() {
      return quitCalled;
    },
  });

  return { tui, writes, getKeyHandler: () => keyHandler, pendingDesc };
}

const mockedLinkedInFetchDesc = vi.mocked(
  (await import('../linkedin.ts')).fetchDesc,
  { deep: false },
);
const mockedJustJoinFetchDesc = vi.mocked(
  (await import('../justjoin.ts')).fetchDesc,
  { deep: false },
);
const mockedSpawnSync = vi.mocked(
  (await import('node:child_process')).spawnSync,
  {
    deep: false,
  },
);

function makeDb(): Db {
  const d = new DatabaseSync(':memory:');
  let closed = false;
  return {
    exec: (sql) => d.exec(sql),
    prepare: (sql) => d.prepare(sql),
    close: () => {
      if (closed) return;
      closed = true;
      d.close();
    },
  };
}

let db: Db;
let origRows: number | undefined;
let origCols: number | undefined;
let origIsTTY: boolean | undefined;
let origConsoleLog: typeof console.log;

beforeEach(() => {
  db = makeDb();
  initTable(db);
  tuiState = makeTuiState();
  mockedLinkedInFetchDesc.mockClear();
  mockedJustJoinFetchDesc.mockClear();
  mockedSpawnSync.mockClear();
  origRows = process.stdout.rows;
  origCols = process.stdout.columns;
  origIsTTY = process.stdout.isTTY;
  origConsoleLog = console.log;
  Object.defineProperty(process.stdout, 'rows', {
    configurable: true,
    value: 24,
  });
  Object.defineProperty(process.stdout, 'columns', {
    configurable: true,
    value: 80,
  });
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: true,
  });
});

afterEach(() => {
  Object.defineProperty(process.stdout, 'rows', {
    configurable: true,
    value: origRows,
  });
  Object.defineProperty(process.stdout, 'columns', {
    configurable: true,
    value: origCols,
  });
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: origIsTTY,
  });
  console.log = origConsoleLog;
  db.close();
});

async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

async function press(key: string): Promise<string> {
  const kh = tuiState.getKeyHandler();
  if (!kh) throw new Error('no key handler installed');
  const prev = tuiState.writes.join('');
  tuiState.writes.length = 0;
  kh(key);
  await flush();
  if (tuiState.writes.length === 0) {
    tuiState.writes.push(prev);
  }
  return tuiState.writes.join('');
}

function render(): string {
  return tuiState.writes.join('');
}

function insertOffer(over: Partial<OfferRow> = {}): string {
  const link = over.link ?? `https://example.com/j/${Math.random()}`;
  saveOffers(db, [
    {
      source: over.source ?? 'linkedin',
      link,
      title: over.title ?? 'Job Title',
      company: over.company ?? 'Company',
      salary: over.salary,
      workplaceType: over.workplaceType,
      postedAt: over.postedAt,
      skills: over.skills,
      locations: over.locations,
      languages: over.languages,
    },
  ]);
  return link;
}

describe('browse (empty state)', () => {
  it('prints "No offers to show." and returns a no-op cleanup', () => {
    const logSpy = vi.fn();
    console.log = logSpy;
    const cleanup = browse(db, tuiState.tui);
    expect(logSpy).toHaveBeenCalledWith('No offers to show.');
    expect(cleanup).toBeTypeOf('function');
    expect(() => cleanup()).not.toThrow();
    expect(tuiState.tui.cleaned).toBe(false);
  });

  it('closes the db when there are no offers', () => {
    console.log = vi.fn();
    const closeSpy = vi.spyOn(db, 'close');
    browse(db, tuiState.tui);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('does not install a key handler when there are no offers', () => {
    console.log = vi.fn();
    browse(db, tuiState.tui);
    expect(tuiState.getKeyHandler()).toBeUndefined();
  });
});

describe('browse (initial render)', () => {
  it('renders title, company, source suffix, and footer counter', async () => {
    insertOffer({
      title: 'Senior X',
      company: 'Acme',
      source: 'linkedin',
      postedAt: '2026-07-21',
    });
    insertOffer({
      title: 'Junior Y',
      company: 'Beta',
      source: 'justjoin',
      postedAt: '2026-07-20',
    });
    browse(db, tuiState.tui);
    const out = render();
    expect(out).toContain('Senior X');
    expect(out).toContain('Acme  (linkedin)');
    expect(out).toContain('[1/2]');
  });

  it('renders optional fields when present', async () => {
    insertOffer({
      title: 'Full',
      company: 'C',
      source: 'justjoin',
      salary: 'b2b 100 - 200 (month) PLN gross',
      workplaceType: 'remote',
      skills: 'TypeScript:4',
      locations: 'Gdańsk | Warszawa',
      languages: 'en: C1',
      postedAt: '2026-07-20',
    });
    browse(db, tuiState.tui);
    const out = render();
    expect(out).toContain('b2b 100 - 200 (month) PLN gross');
    expect(out).toContain('remote');
    expect(out).toContain('skills: TypeScript:4');
    expect(out).toContain('locations: Gdańsk | Warszawa');
    expect(out).toContain('languages: en: C1');
    expect(out).toContain('posted: 2026-07-20');
  });

  it('always renders the offer link in dim', async () => {
    const link = insertOffer();
    browse(db, tuiState.tui);
    expect(render()).toContain(link);
    expect(render()).toContain('\x1b[2m');
  });

  it('renders the footer help line with index / total', async () => {
    insertOffer();
    insertOffer();
    insertOffer();
    browse(db, tuiState.tui);
    expect(render()).toMatch(
      /\[1\/3\].*n=next.*p=prev.*o=open.*m=hide.*q=quit/,
    );
  });

  it('initial linkedin render triggers description fetch and shows "getting desc..."', async () => {
    insertOffer({ source: 'linkedin' });
    browse(db, tuiState.tui);
    expect(mockedLinkedInFetchDesc).toHaveBeenCalledTimes(1);
    expect(render()).toContain('getting desc...');
  });

  it('does not fetch description for an unknown source', async () => {
    insertOffer({ source: 'justjoin' });
    browse(db, tuiState.tui);
    const ljCalls = mockedLinkedInFetchDesc.mock.calls.length;
    const jjCalls = mockedJustJoinFetchDesc.mock.calls.length;
    expect(ljCalls).toBe(0);
    expect(jjCalls).toBe(1);
  });
});

describe('browse (description fetching)', () => {
  it('renders fetched description text after linkedin fetch resolves', async () => {
    insertOffer({ source: 'linkedin' });
    browse(db, tuiState.tui);
    expect(tuiState.pendingDesc).toHaveLength(1);
    tuiState.pendingDesc[0]!.resolve('Hello world description');
    await flush();
    const out = render();
    expect(out).toContain('Hello world description');
    expect(out).not.toContain('getting desc...');
  });

  it('renders "error: <msg>" when the description fetch rejects', async () => {
    insertOffer({ source: 'linkedin' });
    browse(db, tuiState.tui);
    tuiState.pendingDesc[0]!.reject(new Error('boom'));
    await flush();
    const out = render();
    expect(out).toContain('error: boom');
    expect(out).not.toContain('getting desc...');
  });

  it('uses fetchJustJoinDesc for justjoin offers', async () => {
    insertOffer({ source: 'justjoin' });
    browse(db, tuiState.tui);
    expect(mockedJustJoinFetchDesc).toHaveBeenCalledTimes(1);
    expect(mockedLinkedInFetchDesc).not.toHaveBeenCalled();
    tuiState.pendingDesc[0]!.resolve('JJ body');
    await flush();
    expect(render()).toContain('JJ body');
  });

  it('caches description across renders — no re-fetch on revisit', async () => {
    const link = insertOffer({ source: 'linkedin' });
    insertOffer({ source: 'linkedin' });
    browse(db, tuiState.tui);
    tuiState.pendingDesc[0]!.resolve('desc body');
    await flush();
    await press('n');
    await press('p');
    const calls = mockedLinkedInFetchDesc.mock.calls.map((c) => c[0]);
    expect(calls.filter((l) => l === link)).toHaveLength(1);
    expect(render()).toContain('desc body');
  });

  it('does not re-fetch while the description is still loading', async () => {
    insertOffer({ source: 'linkedin' });
    insertOffer({ source: 'justjoin' });
    browse(db, tuiState.tui);
    expect(mockedLinkedInFetchDesc).toHaveBeenCalledTimes(1);
    await press('n');
    await press('p');
    expect(mockedLinkedInFetchDesc).toHaveBeenCalledTimes(1);
    expect(mockedJustJoinFetchDesc).toHaveBeenCalledTimes(1);
  });

  it('does not crash if description text is empty after resolve', async () => {
    insertOffer({ source: 'linkedin' });
    browse(db, tuiState.tui);
    tuiState.pendingDesc[0]!.resolve('');
    await flush();
    const out = render();
    expect(out).not.toContain('getting desc...');
    expect(out).not.toContain('error:');
  });
});

describe('browse (navigation)', () => {
  it('n moves to the next offer and updates the counter', async () => {
    insertOffer({ title: 'A', postedAt: '2026-07-22' });
    insertOffer({ title: 'B', postedAt: '2026-07-21' });
    insertOffer({ title: 'C', postedAt: '2026-07-20' });
    browse(db, tuiState.tui);
    expect(render()).toContain('A');
    expect(render()).toContain('[1/3]');
    await press('n');
    expect(render()).toContain('B');
    expect(render()).toContain('[2/3]');
    await press('n');
    expect(render()).toContain('C');
    expect(render()).toContain('[3/3]');
  });

  it('n at the last offer does not advance past the end', async () => {
    insertOffer({ title: 'Only', postedAt: '2026-07-21' });
    browse(db, tuiState.tui);
    await press('n');
    expect(render()).toContain('Only');
    expect(render()).toContain('[1/1]');
  });

  it('p at the first offer does not move backward', async () => {
    insertOffer({ title: 'First', postedAt: '2026-07-21' });
    insertOffer({ title: 'Second', postedAt: '2026-07-20' });
    browse(db, tuiState.tui);
    await press('p');
    expect(render()).toContain('First');
    expect(render()).toContain('[1/2]');
  });

  it('p moves backward after an n', async () => {
    insertOffer({ title: 'A', postedAt: '2026-07-21' });
    insertOffer({ title: 'B', postedAt: '2026-07-20' });
    browse(db, tuiState.tui);
    await press('n');
    expect(render()).toContain('B');
    await press('p');
    expect(render()).toContain('A');
    expect(render()).toContain('[1/2]');
  });

  it('unknown keys cause no movement or refetch', async () => {
    insertOffer({ title: 'A', postedAt: '2026-07-21' });
    insertOffer({ title: 'B', postedAt: '2026-07-20' });
    browse(db, tuiState.tui);
    const before = render();
    await press('x');
    expect(render()).toBe(before);
  });
});

describe('browse (open link)', () => {
  it('o opens the current offer link via spawnSync open', async () => {
    const link = insertOffer({ title: 'X' });
    browse(db, tuiState.tui);
    await press('o');
    expect(mockedSpawnSync).toHaveBeenCalledWith('open', [link], {
      stdio: 'ignore',
    });
  });

  it('o on an offer with falsy link does not call spawnSync', async () => {
    db.prepare(
      `INSERT INTO offers (link, source, title, company, savedAt) VALUES (?, 'linkedin', 'T', 'C', '2026-07-20')`,
    ).run('');
    browse(db, tuiState.tui);
    mockedSpawnSync.mockClear();
    await press('o');
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });
});

describe('browse (hide current)', () => {
  it('m hides the current offer and re-renders with the next', async () => {
    insertOffer({ title: 'A', link: 'l1', postedAt: '2026-07-22' });
    insertOffer({ title: 'B', link: 'l2', postedAt: '2026-07-21' });
    insertOffer({ title: 'C', link: 'l3', postedAt: '2026-07-20' });
    browse(db, tuiState.tui);
    expect(render()).toContain('A');
    await press('m');
    expect(render()).not.toContain('A');
    expect(render()).toContain('B');
    expect(render()).toContain('[1/2]');
  });

  it('m on the last offer adjusts the index rather than going out of range', async () => {
    insertOffer({ title: 'A', postedAt: '2026-07-21' });
    insertOffer({ title: 'B', postedAt: '2026-07-20' });
    browse(db, tuiState.tui);
    await press('n');
    expect(render()).toContain('B');
    await press('m');
    expect(render()).toContain('A');
    expect(render()).toContain('[1/1]');
  });

  it('m on the only offer triggers quit', async () => {
    insertOffer({ title: 'Lonely' });
    browse(db, tuiState.tui);
    expect(tuiState.tui.quitCalled).toBe(false);
    await press('m');
    expect(tuiState.tui.quitCalled).toBe(true);
    expect(tuiState.tui.cleaned).toBe(true);
  });
});

describe('browse (quit)', () => {
  it('q triggers cleanup', async () => {
    insertOffer();
    browse(db, tuiState.tui);
    const kh = tuiState.getKeyHandler();
    kh!('q');
    await flush();
    expect(tuiState.tui.cleaned).toBe(true);
    expect(tuiState.tui.quitCalled).toBe(true);
  });

  it('Ctrl-C (\\x03) triggers cleanup, same as q', async () => {
    insertOffer();
    browse(db, tuiState.tui);
    const kh = tuiState.getKeyHandler();
    kh!('\x03');
    await flush();
    expect(tuiState.tui.quitCalled).toBe(true);
  });

  it('q also runs registered cleanup callbacks (db close)', async () => {
    insertOffer();
    const closeSpy = vi.spyOn(db, 'close');
    browse(db, tuiState.tui);
    const kh = tuiState.getKeyHandler();
    kh!('q');
    await flush();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('browse (returned cleanup)', () => {
  it('returns a function that fires registered cleanup callbacks (db close)', () => {
    insertOffer();
    const closeSpy = vi.spyOn(db, 'close');
    const cleanup = browse(db, tuiState.tui);
    cleanup();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(tuiState.tui.cleaned).toBe(true);
  });

  it('does not close the db simply by entering browse — only on cleanup', () => {
    insertOffer();
    const closeSpy = vi.spyOn(db, 'close');
    browse(db, tuiState.tui);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('double-calling the returned cleanup is safe (callbacks cleared after first)', () => {
    insertOffer();
    const cleanup = browse(db, tuiState.tui);
    cleanup();
    const callsBefore = tuiState.tui.cleaned;
    expect(() => cleanup()).not.toThrow();
    expect(tuiState.tui.cleaned).toBe(callsBefore);
  });
});

describe('browse (description trimming)', () => {
  it('shows "... (more)" when description does not fit in the available rows', async () => {
    insertOffer({ source: 'linkedin' });

    Object.defineProperty(process.stdout, 'rows', {
      configurable: true,
      value: 24,
    });
    Object.defineProperty(process.stdout, 'columns', {
      configurable: true,
      value: 80,
    });

    browse(db, tuiState.tui);
    const long = Array.from(
      { length: 50 },
      (_, i) => `Paragraph ${i + 1}.`,
    ).join('\n');
    tuiState.pendingDesc[0]!.resolve(long);
    await flush();
    const out = render();
    expect(out).toContain('... (more)');
  });

  it('does not show "... (more)" when the description fits in the available rows', async () => {
    insertOffer({ source: 'linkedin' });
    browse(db, tuiState.tui);
    tuiState.pendingDesc[0]!.resolve('Short description.');
    await flush();
    const out = render();
    expect(out).toContain('Short description.');
    expect(out).not.toContain('... (more)');
  });

  it('always renders the header (title) and footer even when description is long', async () => {
    insertOffer({ title: 'HeaderVisible', source: 'linkedin' });
    Object.defineProperty(process.stdout, 'rows', {
      configurable: true,
      value: 20,
    });
    browse(db, tuiState.tui);
    tuiState.pendingDesc[0]!.resolve(
      'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no',
    );
    await flush();
    const out = render();
    expect(out).toContain('HeaderVisible');
    expect(out).toContain('[1/1]');
    const headIdx = out.indexOf('HeaderVisible');
    const moreIdx = out.indexOf('... (more)');
    expect(moreIdx).toBeGreaterThan(headIdx);
  });

  it('keeps the footer pinned to the bottom row even when the description is truncated', async () => {
    insertOffer({ source: 'linkedin' });
    Object.defineProperty(process.stdout, 'rows', {
      configurable: true,
      value: 24,
    });
    browse(db, tuiState.tui);
    tuiState.pendingDesc[0]!.resolve(
      Array.from({ length: 200 })
        .map(() => 'x'.repeat(60))
        .join('\n'),
    );
    await flush();
    const stripped = render().replace(
      new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'),
      '',
    );
    const lines = stripped.split('\n');
    expect(lines.length).toBe(24);
    expect(lines[23]).toContain('[1/1]');
    expect(lines[23]).toContain('q=quit');
  });

  it('falls back to a single non-empty desc line when avail <= 0', async () => {
    insertOffer({ source: 'linkedin' });
    Object.defineProperty(process.stdout, 'rows', {
      configurable: true,
      value: 1,
    });
    browse(db, tuiState.tui);
    tuiState.pendingDesc[0]!.resolve('first line\nsecond line');
    await flush();
    const out = render();
    expect(out).toContain('first line');
    expect(out).not.toContain('second line');
  });
});

describe('browse (terminal resize)', () => {
  it('respects process.stdout.columns for line wrapping when computing row count', async () => {
    insertOffer({ source: 'linkedin', link: 'short' });
    Object.defineProperty(process.stdout, 'rows', {
      configurable: true,
      value: 16,
    });
    Object.defineProperty(process.stdout, 'columns', {
      configurable: true,
      value: 10,
    });
    browse(db, tuiState.tui);
    tuiState.pendingDesc[0]!.resolve('012345678901234567890123456789');
    await flush();
    expect(render()).toContain('... (more)');
  });
});
