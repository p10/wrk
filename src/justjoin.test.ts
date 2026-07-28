import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchDesc, fetchJustJoin } from './justjoin.ts';

vi.mock('./request.ts', () => ({
  request: vi.fn(),
}));

const mockedRequest = vi.mocked((await import('./request.ts')).request, {
  deep: false,
});

beforeEach(() => {
  mockedRequest.mockReset();
});

function assertDefined<T>(v: T): asserts v {
  if (v === undefined || v === null) {
    throw new Error('expected defined');
  }
}

function oneOffer(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: 'acme-x',
    title: 'Senior X',
    companyName: 'Acme',
    experienceLevel: 'senior',
    workplaceType: 'remote',
    publishedAt: '2026-07-20T10:00:00.000Z',
    requiredSkills: [{ name: 'TypeScript', level: 4 }, { name: 'React' }],
    employmentTypes: [
      {
        type: 'b2b',
        from: 20000,
        to: 30000,
        unit: 'month',
        currency: 'PLN',
        gross: true,
      },
    ],
    languages: [{ code: 'en', level: 'C1' }],
    locations: [
      { city: 'Gdańsk', slug: 'g' },
      { city: 'Warszawa', slug: 'w' },
    ],
    ...over,
  };
}

describe('fetchJustJoin', () => {
  it('maps all fields of a full offer', async () => {
    mockedRequest.mockResolvedValue(JSON.stringify({ data: [oneOffer()] }));
    const {
      offers: [o],
    } = await fetchJustJoin();
    assertDefined(o);
    expect(o).toEqual({
      title: 'Senior X',
      company: 'Acme',
      link: 'https://justjoin.it/job-offer/acme-x',
      experienceLevel: 'senior',
      workplaceType: 'remote',
      publishedAt: '2026-07-20',
      requiredSkills: 'TypeScript:4, React',
      employmentType: 'b2b 20000 - 30000 (month) PLN gross',
      languages: 'en: C1',
      locations: 'Gdańsk | Warszawa',
    });
  });

  it('returns an entry per data element, preserving order', async () => {
    mockedRequest.mockResolvedValue(
      JSON.stringify({
        data: [
          { slug: 'a-1', title: 'A', companyName: 'C1' },
          { slug: 'a-2', title: 'B', companyName: 'C2' },
          { slug: 'a-3', title: 'C', companyName: 'C3' },
        ],
      }),
    );
    const { offers: out } = await fetchJustJoin();
    expect(out.map((o) => o.link)).toEqual([
      'https://justjoin.it/job-offer/a-1',
      'https://justjoin.it/job-offer/a-2',
      'https://justjoin.it/job-offer/a-3',
    ]);
  });

  it('returns empty array when data is empty', async () => {
    mockedRequest.mockResolvedValue(JSON.stringify({ data: [] }));
    expect((await fetchJustJoin()).offers).toEqual([]);
  });

  it('leaves optional fields undefined when missing', async () => {
    mockedRequest.mockResolvedValue(
      JSON.stringify({ data: [{ slug: 's', title: 'T', companyName: 'C' }] }),
    );
    const {
      offers: [o],
    } = await fetchJustJoin();
    assertDefined(o);
    expect(o.experienceLevel).toBeUndefined();
    expect(o.workplaceType).toBeUndefined();
    expect(o.publishedAt).toBeUndefined();
    expect(o.requiredSkills).toBeUndefined();
    expect(o.employmentType).toBeUndefined();
    expect(o.languages).toBeUndefined();
    expect(o.locations).toBeUndefined();
  });

  it('sets link to empty string when slug missing', async () => {
    mockedRequest.mockResolvedValue(
      JSON.stringify({ data: [{ title: 'T', companyName: 'C' }] }),
    );
    const {
      offers: [o],
    } = await fetchJustJoin();
    assertDefined(o);
    expect(o.link).toBe('');
  });

  it('prefers PLN employment types and drops other currencies', async () => {
    mockedRequest.mockResolvedValue(
      JSON.stringify({
        data: [
          oneOffer({
            employmentTypes: [
              {
                type: 'b2b',
                from: 100,
                to: 200,
                unit: 'month',
                currency: 'USD',
                gross: false,
              },
              {
                type: 'permanent',
                from: 10000,
                to: 15000,
                unit: 'Month',
                currency: 'PLN',
                gross: true,
              },
            ],
          }),
        ],
      }),
    );
    const {
      offers: [o],
    } = await fetchJustJoin();
    assertDefined(o);
    expect(o.employmentType).toBe('permanent 10000 - 15000 (Month) PLN gross');
  });

  it('keeps all currencies when PLN absent', async () => {
    mockedRequest.mockResolvedValue(
      JSON.stringify({
        data: [
          oneOffer({
            employmentTypes: [
              {
                type: 'b2b',
                from: 100,
                to: 200,
                unit: 'month',
                currency: 'USD',
                gross: false,
              },
              {
                type: 'b2b',
                from: 90,
                to: 180,
                unit: 'month',
                currency: 'EUR',
                gross: true,
              },
            ],
          }),
        ],
      }),
    );
    const {
      offers: [o],
    } = await fetchJustJoin();
    assertDefined(o);
    expect(o.employmentType).toBe(
      'b2b 100 - 200 (month) USD net | b2b 90 - 180 (month) EUR gross',
    );
  });

  it('renders n/a for salary, unit, and gross when values missing', async () => {
    mockedRequest.mockResolvedValue(
      JSON.stringify({
        data: [
          oneOffer({
            employmentTypes: [{ type: 'b2b', currency: 'PLN' }],
          }),
        ],
      }),
    );
    const {
      offers: [o],
    } = await fetchJustJoin();
    assertDefined(o);
    expect(o.employmentType).toBe('b2b n/a (n/a) PLN n/a');
  });

  it('returns undefined employmentType when no employmentTypes at all', async () => {
    mockedRequest.mockResolvedValue(
      JSON.stringify({ data: [oneOffer({ employmentTypes: [] })] }),
    );
    const {
      offers: [o],
    } = await fetchJustJoin();
    assertDefined(o);
    expect(o.employmentType).toBeUndefined();
  });

  it('returns undefined publishedAt for non-string / unparseable date', async () => {
    mockedRequest.mockResolvedValue(
      JSON.stringify({
        data: [
          oneOffer({ publishedAt: 12345 }),
          oneOffer({
            slug: 'b',
            title: 'T',
            companyName: 'C',
            publishedAt: 'not-a-date',
          }),
        ],
      }),
    );
    const { offers: out } = await fetchJustJoin();
    expect(out[0]?.publishedAt).toBeUndefined();
    expect(out[1]?.publishedAt).toBeUndefined();
  });

  it('handles missing or non-array locations gracefully', async () => {
    mockedRequest.mockResolvedValue(
      JSON.stringify({ data: [oneOffer({ locations: null })] }),
    );
    const {
      offers: [o],
    } = await fetchJustJoin();
    assertDefined(o);
    expect(o.locations).toBeUndefined();
  });

  it('renders skill with level=0 as name only', async () => {
    mockedRequest.mockResolvedValue(
      JSON.stringify({
        data: [
          oneOffer({
            requiredSkills: [
              { name: 'Docker', level: 0 },
              { name: 'Rust', level: 3 },
            ],
          }),
        ],
      }),
    );
    const {
      offers: [o],
    } = await fetchJustJoin();
    assertDefined(o);
    expect(o.requiredSkills).toBe('Docker, Rust:3');
  });

  it('returns undefined requiredSkills when array is empty', async () => {
    mockedRequest.mockResolvedValue(
      JSON.stringify({ data: [oneOffer({ requiredSkills: [] })] }),
    );
    const {
      offers: [o],
    } = await fetchJustJoin();
    assertDefined(o);
    expect(o.requiredSkills).toBeUndefined();
  });

  it('returns undefined languages when array is empty', async () => {
    mockedRequest.mockResolvedValue(
      JSON.stringify({ data: [oneOffer({ languages: [] })] }),
    );
    const {
      offers: [o],
    } = await fetchJustJoin();
    assertDefined(o);
    expect(o.languages).toBeUndefined();
  });

  it('builds request URL with the documented query parameters', async () => {
    mockedRequest.mockResolvedValue(JSON.stringify({ data: [] }));
    await fetchJustJoin();
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [url, _opts] = mockedRequest.mock.calls[0]!;
    const u = new URL(url as URL | string);
    expect(u.origin + u.pathname).toBe(
      'https://justjoin.it/api/candidate-api/offers',
    );
    expect(u.searchParams.get('keywords')).toBe('typescript');
    expect(u.searchParams.get('city')).toBe('Gdańsk');
    expect(u.searchParams.get('cityRadius')).toBe('50');
    expect(u.searchParams.getAll('experienceLevels')).toEqual([
      'mid',
      'senior',
    ]);
    expect(u.searchParams.get('publishedSinceDays')).toBe('7');
    expect(u.searchParams.get('sortBy')).toBe('newest');
    expect(u.searchParams.get('from')).toBe('0');
    expect(u.searchParams.get('itemsCount')).toBe('30');
  });

  it('passes the desktop User-Agent header', async () => {
    mockedRequest.mockResolvedValue(JSON.stringify({ data: [] }));
    await fetchJustJoin();
    const opts = mockedRequest.mock.calls[0]![1];
    expect(opts?.headers).toMatchObject({
      'User-Agent': expect.stringContaining('Mozilla/5.0'),
    });
  });
});

describe('fetchDesc', () => {
  it('converts HTML body into plain text via htmlToText', async () => {
    mockedRequest.mockResolvedValue(
      JSON.stringify({
        body: '<p>hello</p><ul><li>a</li><li>b</li></ul>',
      }),
    );
    const text = await fetchDesc('https://justjoin.it/job-offer/slug-x');
    expect(text).toBe('hello\na\nb');
  });

  it('throws when body field is missing', async () => {
    mockedRequest.mockResolvedValue(JSON.stringify({}));
    await expect(
      fetchDesc('https://justjoin.it/job-offer/slug-x'),
    ).rejects.toThrow('Description not found for offer: slug-x');
  });

  it('throws when body is empty string', async () => {
    mockedRequest.mockResolvedValue(JSON.stringify({ body: '' }));
    await expect(
      fetchDesc('https://justjoin.it/job-offer/slug-x'),
    ).rejects.toThrow('Description not found for offer: slug-x');
  });

  it('throws when link has no slug', async () => {
    await expect(fetchDesc('https://justjoin.it/')).rejects.toThrow(
      /Could not extract slug from link:/,
    );
  });

  it('strips query string before requesting the detail endpoint', async () => {
    mockedRequest.mockResolvedValue(JSON.stringify({ body: '<p>ok</p>' }));
    await fetchDesc('https://justjoin.it/job-offer/slug-x?source=foo');
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [url] = mockedRequest.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://justjoin.it/api/candidate-api/offers/slug-x',
    );
  });

  it('handles trailing slash in link', async () => {
    mockedRequest.mockResolvedValue(JSON.stringify({ body: '<p>ok</p>' }));
    const text = await fetchDesc('https://justjoin.it/job-offer/slug-x/');
    expect(text).toBe('ok');
    expect(String(mockedRequest.mock.calls[0]![0])).toBe(
      'https://justjoin.it/api/candidate-api/offers/slug-x',
    );
  });

  it('passes the desktop User-Agent header', async () => {
    mockedRequest.mockResolvedValue(JSON.stringify({ body: '<p>x</p>' }));
    await fetchDesc('https://justjoin.it/job-offer/slug-x');
    const opts = mockedRequest.mock.calls[0]![1];
    expect(opts?.headers).toMatchObject({
      'User-Agent': expect.stringContaining('Mozilla/5.0'),
    });
  });
});
