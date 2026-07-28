import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Db } from './db.ts';
import { initTable, saveOffers } from './offer.ts';

const mockState = vi.hoisted(() => ({
  writes: [] as string[],
  keyHandler: undefined as ((k: string) => void) | undefined,
  cleanupCallbacks: [] as (() => void)[],
  cleaned: false,
  quitCalled: false,
  pendingDesc: [] as Array<{
    resolve: (s: string) => void;
    reject: (e: unknown) => void;
  }>,
}));

vi.mock('./tui.ts', () => {
  class MockTui {
    onKey(cb: (k: string) => void): void {
      mockState.keyHandler = cb;
    }
    onCleanup(cb: () => void): void {
      mockState.cleanupCallbacks.push(cb);
    }
    enter(): void {}
    hideCursor(): void {}
    clear(): void {
      mockState.writes.length = 0;
    }
    write(s: string): void {
      mockState.writes.push(s);
    }
    showCursor(): void {}
    cleanup(): void {
      for (const cb of mockState.cleanupCallbacks) cb();
      mockState.cleanupCallbacks.length = 0;
      mockState.cleaned = true;
    }
    quit(): void {
      this.cleanup();
      mockState.quitCalled = true;
    }
    exit(): void {}
  }
  return {
    DIM: '\x1b[2m',
    RESET: '\x1b[0m',
    Tui: MockTui,
  };
});

vi.mock('./linkedin.ts', () => ({
  fetchDesc: vi.fn(
    (_link: string) =>
      new Promise<string>((resolve, reject) => {
        mockState.pendingDesc.push({ resolve, reject });
      }),
  ),
}));

vi.mock('./justjoin.ts', () => ({
  fetchDesc: vi.fn(
    (_link: string) =>
      new Promise<string>((resolve, reject) => {
        mockState.pendingDesc.push({ resolve, reject });
      }),
  ),
}));

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

const mockedLinkedInFetchDesc = vi.mocked(
  (await import('./linkedin.ts')).fetchDesc,
  { deep: false },
);
const mockedJustJoinFetchDesc = vi.mocked(
  (await import('./justjoin.ts')).fetchDesc,
  { deep: false },
);
const mockedSpawnSync = vi.mocked((await import('node:child_process')).spawnSync, {
  deep: false,
});

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
  mockState.writes.length = 0;
  mockState.keyHandler = undefined;
  mockState.cleanupCallbacks.length = 0;
  mockState.cleaned = false;
  mockState.quitCalled = false;
  mockState.pendingDesc.length = 0;
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

/** Resolve all pending microtasks so async .then/.catch handlers run. */
async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

/**
 * Drive the TUI with the given key. Returns the rendered output after the key
 * press; throws if no key handler is installed (no offers / not in TUI mode).
 */
async function press(key: string): Promise<string> {
  if (!mockState.keyHandler) throw new Error('no key handler installed');
  const prev = mockState.writes.join('');
  mockState.writes.length = 0;
  mockState.keyHandler(key);
  await flush();
  // If the key caused no re-render, restore the prior visible content so
  // render() reflects what is actually on screen.
  if (mockState.writes.length === 0) {
    mockState.writes.push(prev);
  }
  return mockState.writes.join('');
}

function render(): string {
  return mockState.writes.join('');
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
      experienceLevel: over.experienceLevel,
    },
  ]);
  return link;
}

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
  experienceLevel?: string;
};

describe('browse (empty state)', () => {
  it('prints "No offers to show." and returns a no-op cleanup', async () => {
    const logSpy = vi.fn();
    console.log = logSpy;
    const cleanup = await browse(db);
    expect(logSpy).toHaveBeenCalledWith('No offers to show.');
    expect(cleanup).toBeTypeOf('function');
    expect(() => cleanup()).not.toThrow();
    expect(mockState.cleaned).toBe(false);
  });

  it('closes the db when there are no offers', async () => {
    console.log = vi.fn();
    const closeSpy = vi.spyOn(db, 'close');
    await browse(db);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('does not install a key handler when there are no offers', async () => {
    console.log = vi.fn();
    await browse(db);
    expect(mockState.keyHandler).toBeUndefined();
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
    await browse(db);
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
      experienceLevel: 'senior',
    });
    await browse(db);
    const out = render();
    expect(out).toContain('b2b 100 - 200 (month) PLN gross');
    expect(out).toContain('remote');
    expect(out).toContain('skills: TypeScript:4');
    expect(out).toContain('locations: Gdańsk | Warszawa');
    expect(out).toContain('languages: en: C1');
    expect(out).toContain('posted: 2026-07-20');
    expect(out).toContain('level: senior');
  });

  it('always renders the offer link in dim', async () => {
    const link = insertOffer();
    await browse(db);
    expect(render()).toContain(link);
    expect(render()).toContain('\x1b[2m');
  });

  it('renders the footer help line with index / total', async () => {
    insertOffer();
    insertOffer();
    insertOffer();
    await browse(db);
    expect(render()).toMatch(/\[1\/3\].*l=next.*h=prev.*o=open.*m=hide.*q=quit/);
  });

  it('initial linkedin render triggers description fetch and shows "getting desc..."', async () => {
    insertOffer({ source: 'linkedin' });
    await browse(db);
    expect(mockedLinkedInFetchDesc).toHaveBeenCalledTimes(1);
    expect(render()).toContain('getting desc...');
  });

  it('does not fetch description for an unknown source', async () => {
    insertOffer({ source: 'justjoin' });
    await browse(db);
    const ljCalls = mockedLinkedInFetchDesc.mock.calls.length;
    const jjCalls = mockedJustJoinFetchDesc.mock.calls.length;
    expect(ljCalls).toBe(0);
    expect(jjCalls).toBe(1);
  });
});

describe('browse (description fetching)', () => {
  it('renders fetched description text after linkedin fetch resolves', async () => {
    insertOffer({ source: 'linkedin' });
    await browse(db);
    expect(mockState.pendingDesc).toHaveLength(1);
    mockState.pendingDesc[0]!.resolve('Hello world description');
    await flush();
    const out = render();
    expect(out).toContain('Hello world description');
    expect(out).not.toContain('getting desc...');
  });

  it('renders "error: <msg>" when the description fetch rejects', async () => {
    insertOffer({ source: 'linkedin' });
    await browse(db);
    mockState.pendingDesc[0]!.reject(new Error('boom'));
    await flush();
    const out = render();
    expect(out).toContain('error: boom');
    expect(out).not.toContain('getting desc...');
  });

  it('uses fetchJustJoinDesc for justjoin offers', async () => {
    insertOffer({ source: 'justjoin' });
    await browse(db);
    expect(mockedJustJoinFetchDesc).toHaveBeenCalledTimes(1);
    expect(mockedLinkedInFetchDesc).not.toHaveBeenCalled();
    mockState.pendingDesc[0]!.resolve('JJ body');
    await flush();
    expect(render()).toContain('JJ body');
  });

  it('caches description across renders — no re-fetch on revisit', async () => {
    const link = insertOffer({ source: 'linkedin' });
    insertOffer({ source: 'linkedin' });
    await browse(db);
    mockState.pendingDesc[0]!.resolve('desc body');
    await flush();
    // move away then back
    await press('l');
    await press('h');
    // linkedin fetch was called once for each offer (different links),
    // but never twice for the same link.
    const calls = mockedLinkedInFetchDesc.mock.calls.map((c) => c[0]);
    expect(calls.filter((l) => l === link)).toHaveLength(1);
    expect(render()).toContain('desc body');
  });

  it('does not re-fetch while the description is still loading', async () => {
    insertOffer({ source: 'linkedin' });
    insertOffer({ source: 'justjoin' });
    await browse(db);
    expect(mockedLinkedInFetchDesc).toHaveBeenCalledTimes(1);
    // navigate to next and back — linkedin fetchDesc is cached as 'loading'
    await press('l');
    await press('h');
    expect(mockedLinkedInFetchDesc).toHaveBeenCalledTimes(1);
    expect(mockedJustJoinFetchDesc).toHaveBeenCalledTimes(1);
  });

  it('does not crash if description text is empty after resolve', async () => {
    insertOffer({ source: 'linkedin' });
    await browse(db);
    mockState.pendingDesc[0]!.resolve('');
    await flush();
    // contains only the header + footer, no 'desc' body, no error
    const out = render();
    expect(out).not.toContain('getting desc...');
    expect(out).not.toContain('error:');
  });
});

describe('browse (navigation)', () => {
  it('l moves to the next offer and updates the counter', async () => {
    insertOffer({ title: 'A', postedAt: '2026-07-22' });
    insertOffer({ title: 'B', postedAt: '2026-07-21' });
    insertOffer({ title: 'C', postedAt: '2026-07-20' });
    await browse(db);
    expect(render()).toContain('A');
    expect(render()).toContain('[1/3]');
    await press('l');
    expect(render()).toContain('B');
    expect(render()).toContain('[2/3]');
    await press('l');
    expect(render()).toContain('C');
    expect(render()).toContain('[3/3]');
  });

  it('l at the last offer does not advance past the end', async () => {
    insertOffer({ title: 'Only', postedAt: '2026-07-21' });
    await browse(db);
    await press('l');
    expect(render()).toContain('Only');
    expect(render()).toContain('[1/1]');
  });

  it('h at the first offer does not move backward', async () => {
    insertOffer({ title: 'First', postedAt: '2026-07-21' });
    insertOffer({ title: 'Second', postedAt: '2026-07-20' });
    await browse(db);
    await press('h');
    expect(render()).toContain('First');
    expect(render()).toContain('[1/2]');
  });

  it('h moves backward after an l', async () => {
    insertOffer({ title: 'A', postedAt: '2026-07-21' });
    insertOffer({ title: 'B', postedAt: '2026-07-20' });
    await browse(db);
    await press('l');
    expect(render()).toContain('B');
    await press('h');
    expect(render()).toContain('A');
    expect(render()).toContain('[1/2]');
  });

  it('unknown keys cause no movement or refetch', async () => {
    insertOffer({ title: 'A', postedAt: '2026-07-21' });
    insertOffer({ title: 'B', postedAt: '2026-07-20' });
    await browse(db);
    const before = render();
    await press('x');
    expect(render()).toBe(before);
  });
});

describe('browse (open link)', () => {
  it('o opens the current offer link via spawnSync open', async () => {
    const link = insertOffer({ title: 'X' });
    await browse(db);
    await press('o');
    expect(mockedSpawnSync).toHaveBeenCalledWith('open', [link], {
      stdio: 'ignore',
    });
  });

  it('o on an offer with falsy link does not call spawnSync', async () => {
    // forge an offer with empty link by direct insert
    db.prepare(
      `INSERT INTO offers (link, source, title, company, savedAt) VALUES (?, 'linkedin', 'T', 'C', '2026-07-20')`,
    ).run('');
    await browse(db);
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
    await browse(db);
    expect(render()).toContain('A');
    await press('m');
    expect(render()).not.toContain('A');
    expect(render()).toContain('B');
    expect(render()).toContain('[1/2]');
  });

  it('m on the last offer adjusts the index rather than going out of range', async () => {
    insertOffer({ title: 'A', postedAt: '2026-07-21' });
    insertOffer({ title: 'B', postedAt: '2026-07-20' });
    await browse(db);
    await press('l');
    expect(render()).toContain('B');
    await press('m');
    expect(render()).toContain('A');
    expect(render()).toContain('[1/1]');
  });

  it('m on the only offer triggers quit', async () => {
    insertOffer({ title: 'Lonely' });
    await browse(db);
    expect(mockState.quitCalled).toBe(false);
    await press('m');
    expect(mockState.quitCalled).toBe(true);
    expect(mockState.cleaned).toBe(true);
  });
});

describe('browse (quit)', () => {
  it('q triggers cleanup', async () => {
    insertOffer();
    await browse(db);
    mockState.keyHandler!('q');
    await flush();
    expect(mockState.cleaned).toBe(true);
    expect(mockState.quitCalled).toBe(true);
  });

  it('Ctrl-C (\\x03) triggers cleanup, same as q', async () => {
    insertOffer();
    await browse(db);
    mockState.keyHandler!('\x03');
    await flush();
    expect(mockState.quitCalled).toBe(true);
  });

  it('q also runs registered cleanup callbacks (db close)', async () => {
    insertOffer();
    const closeSpy = vi.spyOn(db, 'close');
    await browse(db);
    mockState.keyHandler!('q');
    await flush();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('browse (returned cleanup)', () => {
  it('returns a function that fires registered cleanup callbacks (db close)', async () => {
    insertOffer();
    const closeSpy = vi.spyOn(db, 'close');
    const cleanup = await browse(db);
    cleanup();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(mockState.cleaned).toBe(true);
  });

  it('does not close the db simply by entering browse — only on cleanup', async () => {
    insertOffer();
    const closeSpy = vi.spyOn(db, 'close');
    await browse(db);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('double-calling the returned cleanup is safe (callbacks cleared after first)', async () => {
    insertOffer();
    const cleanup = await browse(db);
    cleanup();
    const callsBefore = mockState.cleaned;
    expect(() => cleanup()).not.toThrow();
    expect(mockState.cleaned).toBe(callsBefore);
  });
});

describe('browse (description trimming)', () => {
  it('shows "... (more)" when description does not fit in the available rows', async () => {
    insertOffer({ source: 'linkedin' });

    // rows=24 leaves ~15 available rows for the description; 50 paragraphs
    // definitely overflow.
    Object.defineProperty(process.stdout, 'rows', {
      configurable: true,
      value: 24,
    });
    Object.defineProperty(process.stdout, 'columns', {
      configurable: true,
      value: 80,
    });

    await browse(db);
    const long = Array.from({ length: 50 }, (_, i) => `Paragraph ${i + 1}.`).join(
      '\n',
    );
    mockState.pendingDesc[0]!.resolve(long);
    await flush();
    const out = render();
    expect(out).toContain('... (more)');
  });

  it('does not show "... (more)" when the description fits in the available rows', async () => {
    insertOffer({ source: 'linkedin' });
    await browse(db);
    mockState.pendingDesc[0]!.resolve('Short description.');
    await flush();
    const out = render();
    expect(out).toContain('Short description.');
    expect(out).not.toContain('... (more)');
  });

  it('always renders the header (title) and footer even when description is long', async () => {
    insertOffer({ title: 'HeaderVisible', source: 'linkedin' });
    Object.defineProperty(process.stdout, 'rows', {
      configurable: true,
      value: 24,
    });
    await browse(db);
    mockState.pendingDesc[0]!.resolve(
      'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no',
    );
    await flush();
    const out = render();
    expect(out).toContain('HeaderVisible');
    expect(out).toContain('[1/1]');
    // header is rendered before any desc content
    const headIdx = out.indexOf('HeaderVisible');
    const moreIdx = out.indexOf('... (more)');
    expect(moreIdx).toBeGreaterThan(headIdx);
  });

  it('falls back to a single non-empty desc line when avail <= 0', async () => {
    insertOffer({ source: 'linkedin' });
    Object.defineProperty(process.stdout, 'rows', {
      configurable: true,
      value: 1,
    });
    await browse(db);
    mockState.pendingDesc[0]!.resolve('first line\nsecond line');
    await flush();
    const out = render();
    // single line fallback shows the first non-empty desc line at most
    expect(out).toContain('first line');
    expect(out).not.toContain('second line');
  });
});

describe('browse (terminal resize)', () => {
  it('respects process.stdout.columns for line wrapping when computing row count', async () => {
    // Short link so the header doesn't itself wrap at narrow columns.
    insertOffer({ source: 'linkedin', link: 'short' });
    // rows=16 cols=10 → header wraps to ~7 rows, footer to ~6 rows,
    // avail = 16 - 7 - 6 - 1 = 2. A 30-char body wraps to 3 rows on
    // a 10-col terminal → truncates and shows the more-marker.
    Object.defineProperty(process.stdout, 'rows', {
      configurable: true,
      value: 16,
    });
    Object.defineProperty(process.stdout, 'columns', {
      configurable: true,
      value: 10,
    });
    await browse(db);
    mockState.pendingDesc[0]!.resolve('012345678901234567890123456789');
    await flush();
    expect(render()).toContain('... (more)');
  });
});

// Import browse dynamically so mocks apply before the module body runs.
async function browse(db: Db): Promise<() => void> {
  const mod = await import('./browse.ts');
  return mod.browse(db);
}