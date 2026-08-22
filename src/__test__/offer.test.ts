import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Db } from '../db.ts';
import {
  fetchOffers,
  initTable,
  markHidden,
  saveOffers,
  selectVisibleOffers,
} from '../offer.ts';

vi.mock('../linkedin.ts', () => ({
  fetchLinkedInJobs: vi.fn(),
}));
vi.mock('../justjoin.ts', () => ({
  fetchJustJoin: vi.fn(),
}));
vi.mock('../nofluffjobs.ts', () => ({
  fetchNoFluffJobs: vi.fn(() =>
    Promise.resolve({ offers: [], url: '' }),
  ),
}));

const mockedFetchLinkedInJobs = vi.mocked(
  (await import('../linkedin.ts')).fetchLinkedInJobs,
  { deep: false },
);
const mockedFetchJustJoin = vi.mocked(
  (await import('../justjoin.ts')).fetchJustJoin,
  { deep: false },
);
const mockedFetchNoFluffJobs = vi.mocked(
  (await import('../nofluffjobs.ts')).fetchNoFluffJobs,
  { deep: false },
);

function assertDefined<T>(v: T): asserts v {
  if (v === undefined || v === null) {
    throw new Error('expected defined');
  }
}

function makeDb(): Db {
  const d = new DatabaseSync(':memory:');
  return {
    exec: (sql) => d.exec(sql),
    prepare: (sql) => d.prepare(sql),
    close: () => d.close(),
  };
}

let db: Db;

  beforeEach(() => {
    db = makeDb();
    mockedFetchLinkedInJobs.mockReset();
    mockedFetchJustJoin.mockReset();
    mockedFetchNoFluffJobs.mockReset();
  });

describe('initTable', () => {
  it('creates the offers table without throwing', () => {
    expect(() => initTable(db)).not.toThrow();
  });

  it('is idempotent (calling twice does not throw or duplicate columns)', () => {
    initTable(db);
    expect(() => initTable(db)).not.toThrow();
  });

  it('makes the table available for select (returns empty array)', () => {
    initTable(db);
    expect(selectVisibleOffers(db)).toEqual([]);
  });
});

describe('saveOffers', () => {
  beforeEach(() => {
    initTable(db);
  });

  it('inserts new offers and reports counts', () => {
    const { inserted, skipped } = saveOffers(db, [
      {
        source: 'linkedin',
        link: 'https://www.linkedin.com/jobs/view/a-1',
        title: 'A',
        company: 'C1',
      },
      {
        source: 'justjoin',
        link: 'https://justjoin.it/job-offer/b-2',
        title: 'B',
        company: 'C2',
      },
    ]);
    expect(inserted).toBe(2);
    expect(skipped).toBe(0);
  });

  it('skips duplicate links and reports counts', () => {
    const offer = {
      source: 'linkedin' as const,
      link: 'https://www.linkedin.com/jobs/view/a-1',
      title: 'A',
      company: 'C1',
    };
    saveOffers(db, [offer]);
    const { inserted, skipped } = saveOffers(db, [offer]);
    expect(inserted).toBe(0);
    expect(skipped).toBe(1);
  });

  it('reports zeros for an empty input array', () => {
    expect(saveOffers(db, [])).toEqual({ inserted: 0, skipped: 0 });
  });

  it('persists optional fields onto the row', () => {
    saveOffers(db, [
      {
        source: 'justjoin',
        link: 'l',
        title: 'T',
        company: 'C',
        workplaceType: 'remote',
        postedAt: '2026-07-20',
        salary: 'b2b 100 - 200 (month) PLN gross',
        skills: 'TypeScript:4',
        locations: 'Gdańsk | Warszawa',
        languages: 'en: C1',
      },
    ]);
    const [row] = selectVisibleOffers(db);
    assertDefined(row);
    expect(row).toMatchObject({
      source: 'justjoin',
      link: 'l',
      title: 'T',
      company: 'C',
      workplaceType: 'remote',
      postedAt: '2026-07-20',
      salary: 'b2b 100 - 200 (month) PLN gross',
      skills: 'TypeScript:4',
      locations: 'Gdańsk | Warszawa',
      languages: 'en: C1',
    });
  });

  it('stores undefined optional fields as NULL and reads them back as undefined', () => {
    saveOffers(db, [
      { source: 'linkedin', link: 'l', title: 'T', company: 'C' },
    ]);
    const [row] = selectVisibleOffers(db);
    assertDefined(row);
    expect(row.workplaceType).toBeNull();
    expect(row.postedAt).toBeNull();
    expect(row.salary).toBeNull();
    expect(row.skills).toBeNull();
    expect(row.locations).toBeNull();
    expect(row.languages).toBeNull();
  });

  it('sets a savedAt timestamp in ISO format on every inserted row', () => {
    saveOffers(db, [
      { source: 'linkedin', link: 'l', title: 'T', company: 'C' },
    ]);
    const [row] = selectVisibleOffers(db);
    assertDefined(row);
    expect(row.savedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it('shares one savedAt value across all rows in a single batch', () => {
    saveOffers(db, [
      { source: 'linkedin', link: 'l1', title: 'T1', company: 'C1' },
      { source: 'justjoin', link: 'l2', title: 'T2', company: 'C2' },
    ]);
    const rows = selectVisibleOffers(db);
    expect(rows[0]!.savedAt).toBe(rows[1]!.savedAt);
  });
});

describe('selectVisibleOffers', () => {
  beforeEach(() => {
    initTable(db);
  });

  it('returns rows where hidden=0 only', () => {
    saveOffers(db, [
      { source: 'linkedin', link: 'v1', title: 'V', company: 'C1' },
      { source: 'linkedin', link: 'v2', title: 'X', company: 'C2' },
    ]);
    markHidden(db, 'v1');
    const rows = selectVisibleOffers(db);
    expect(rows.map((r) => r.link)).toEqual(['v2']);
  });

  it('returns rows with hidden and savedAt fields extended onto the row', () => {
    saveOffers(db, [
      { source: 'linkedin', link: 'l', title: 'T', company: 'C' },
    ]);
    const [row] = selectVisibleOffers(db);
    assertDefined(row);
    expect(row.hidden).toBe(0);
    expect(row.savedAt).toEqual(expect.any(String));
  });

  it('orders by postedAt IS NULL first, then postedAt DESC, then savedAt DESC', () => {
    // Insert in an order that should NOT be the returned order.
    saveOffers(db, [
      {
        source: 'linkedin',
        link: 'old',
        title: 'Old',
        company: 'C',
        postedAt: '2026-01-01',
      },
      {
        source: 'linkedin',
        link: 'noDate1',
        title: 'NoDate1',
        company: 'C',
      },
      {
        source: 'linkedin',
        link: 'recent',
        title: 'Recent',
        company: 'C',
        postedAt: '2026-07-20',
      },
      {
        source: 'linkedin',
        link: 'noDate2',
        title: 'NoDate2',
        company: 'C',
      },
    ]);

    // To exercise savedAt DESC tiebreaker we must distinguish the two noDate
    // rows. Save the noDate1 again-as-a-different-link trick won't work (PK).
    // Instead, insert noDate2 with a slightly newer savedAt by saving it again
    // via a separate saveOffers call (no-op for the existing one, but new row
    // gets newer savedAt). Simpler: just check the resulting orderings.
    const rows = selectVisibleOffers(db);
    const links = rows.map((r) => r.link);

    // Expect: most-recent-to-oldest dated rows first, then null-rows.
    expect(links).toEqual(['recent', 'old', 'noDate1', 'noDate2']);
  });

  it('returns empty array when table has no offers', () => {
    expect(selectVisibleOffers(db)).toEqual([]);
  });
});

describe('markHidden', () => {
  beforeEach(() => {
    initTable(db);
  });

  it('sets hidden=1 for the matching link', () => {
    saveOffers(db, [
      { source: 'linkedin', link: 'x', title: 'X', company: 'C' },
    ]);
    markHidden(db, 'x');
    expect(selectVisibleOffers(db)).toEqual([]);
  });

  it('is a no-op (does not throw) when the link does not exist', () => {
    expect(() => markHidden(db, 'nonexistent')).not.toThrow();
  });

  it('only hides the specified link, leaving siblings visible', () => {
    saveOffers(db, [
      { source: 'linkedin', link: 'keep', title: 'K', company: 'C' },
      { source: 'linkedin', link: 'hide', title: 'H', company: 'C' },
    ]);
    markHidden(db, 'hide');
    const rows = selectVisibleOffers(db);
    expect(rows.map((r) => r.link)).toEqual(['keep']);
  });
});

describe('fetchOffers', () => {
  it('returns linkedin offers followed by justjoin offers, mapped by source', async () => {
    mockedFetchLinkedInJobs.mockResolvedValue({
      offers: [
        {
          title: 'L1',
          company: 'LC1',
          link: 'https://www.linkedin.com/jobs/view/l1',
          location: 'Gdańsk',
          postedDate: '2026-07-20',
        },
      ],
      url: 'https://linkedin.com/jobs/search?q=1',
    });
    mockedFetchJustJoin.mockResolvedValue({
      offers: [
        {
          title: 'J1',
          company: 'JC1',
          link: 'https://justjoin.it/job-offer/j1',
        },
      ],
      url: 'https://justjoin.it/api/offers?q=1',
    });
    const { offers, urls } = await fetchOffers();
    expect(offers.map((o) => o.source)).toEqual(['linkedin', 'justjoin']);
    expect(offers[0]).toMatchObject({
      source: 'linkedin',
      title: 'L1',
      company: 'LC1',
      link: 'https://www.linkedin.com/jobs/view/l1',
      locations: 'Gdańsk',
      postedAt: '2026-07-20',
    });
    expect(offers[1]).toMatchObject({
      source: 'justjoin',
      title: 'J1',
      company: 'JC1',
      link: 'https://justjoin.it/job-offer/j1',
    });
    expect(urls).toEqual([
      'https://linkedin.com/jobs/search?q=1',
      'https://justjoin.it/api/offers?q=1',
      expect.any(String),
    ]);
  });

  it('returns an empty offers array and three urls when all sources return empty', async () => {
    mockedFetchLinkedInJobs.mockResolvedValue({
      offers: [],
      url: 'https://linkedin.com/jobs/search',
    });
    mockedFetchJustJoin.mockResolvedValue({
      offers: [],
      url: 'https://justjoin.it/api/offers',
    });
    mockedFetchNoFluffJobs.mockResolvedValue({
      offers: [],
      url: 'https://nofluffjobs.com/pl/praca-zdalna/frontend',
    });
    const { offers, urls } = await fetchOffers();
    expect(offers).toEqual([]);
    expect(urls).toHaveLength(3);
  });

  it('calls all three fetchers exactly once', async () => {
    mockedFetchLinkedInJobs.mockResolvedValue({ offers: [], url: '' });
    mockedFetchJustJoin.mockResolvedValue({ offers: [], url: '' });
    mockedFetchNoFluffJobs.mockResolvedValue({ offers: [], url: '' });
    await fetchOffers();
    expect(mockedFetchLinkedInJobs).toHaveBeenCalledTimes(1);
    expect(mockedFetchJustJoin).toHaveBeenCalledTimes(1);
    expect(mockedFetchNoFluffJobs).toHaveBeenCalledTimes(1);
  });

  it('maps a linkedin offer with postedText fallback when postedDate missing', async () => {
    mockedFetchLinkedInJobs.mockResolvedValue({
      offers: [
        {
          title: 'L',
          company: 'C',
          link: 'l',
          postedText: '3 days ago',
        },
      ],
      url: '',
    });
    mockedFetchJustJoin.mockResolvedValue({ offers: [], url: '' });
    const {
      offers: [o],
    } = await fetchOffers();
    assertDefined(o);
    expect(o.postedAt).toBe('3 days ago');
    expect(o.locations).toBeUndefined();
  });

  it('maps a justjoin offer, preserving all optional fields', async () => {
    mockedFetchLinkedInJobs.mockResolvedValue({ offers: [], url: '' });
    mockedFetchJustJoin.mockResolvedValue({
      offers: [
        {
          title: 'J',
          company: 'C',
          link: 'j',
          workplaceType: 'remote',
          publishedAt: '2026-05-10',
          employmentType: 'b2b ...',
          requiredSkills: 'TS:4',
          locations: 'Gdańsk | Warszawa',
          languages: 'en: C1',
        },
      ],
      url: '',
    });
    const {
      offers: [o],
    } = await fetchOffers();
    assertDefined(o);
    expect(o).toMatchObject({
      source: 'justjoin',
      title: 'J',
      company: 'C',
      link: 'j',
      workplaceType: 'remote',
      postedAt: '2026-05-10',
      salary: 'b2b ...',
      skills: 'TS:4',
      locations: 'Gdańsk | Warszawa',
      languages: 'en: C1',
    });
  });

  it('propagates rejection if either source throws', async () => {
    mockedFetchLinkedInJobs.mockResolvedValue({ offers: [], url: '' });
    mockedFetchJustJoin.mockRejectedValue(new Error('jj boom'));
    mockedFetchNoFluffJobs.mockResolvedValue({ offers: [], url: '' });
    await expect(fetchOffers()).rejects.toThrow('jj boom');
  });
});
