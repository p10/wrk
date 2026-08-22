import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchDesc, fetchLinkedInJobs } from '../linkedin.ts';

vi.mock('../request.ts', () => ({
  request: vi.fn(),
}));

const mockedRequest = vi.mocked(
  (await import('../request.ts')).request,
  { deep: false },
);

beforeEach(() => {
  mockedRequest.mockReset();
});

function assertDefined<T>(v: T): asserts v {
  if (v === undefined || v === null) {
    throw new Error('expected defined');
  }
}

const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function li(over: Partial<Record<string, string>> = {}): string {
  const {
    title = 'Senior TS Dev',
    company = 'Acme',
    href = 'https://www.linkedin.com/jobs/view/senior-ts-dev-at-acme-1234567890',
    location = 'Gdańsk, PL',
    datetime = '2026-07-20',
    postedText = '2 days ago',
    benefits = 'Private healthcare',
  } = over;
  return `
    <li>
      <a class="base-card__full-link" href="${href}?trk=x">link</a>
      <h3 class="base-search-card__title">${title}</h3>
      <h4 class="base-search-card__subtitle">${company}</h4>
      <div class="job-search-card__location">${location}</div>
      <time datetime="${datetime}">${postedText}</time>
      <div class="job-posting-benefits__text">${benefits}</div>
    </li>`;
}

describe('fetchLinkedInJobs', () => {
  it('parses a full offer card', async () => {
    mockedRequest.mockResolvedValue(`<ul>${li()}</ul>`);
    const { offers: [o] } = await fetchLinkedInJobs();
    assertDefined(o);
    expect(o).toEqual({
      title: 'Senior TS Dev',
      company: 'Acme',
      link: 'https://www.linkedin.com/jobs/view/senior-ts-dev-at-acme-1234567890',
      location: 'Gdańsk, PL',
      postedDate: '2026-07-20',
      postedText: '2 days ago',
      benefits: 'Private healthcare',
    });
  });

  it('strips query string from the href to form the link', async () => {
    mockedRequest.mockResolvedValue(
      `<ul>${li({ href: 'https://www.linkedin.com/jobs/view/x-99' })}</ul>`,
    );
    const { offers: [o] } = await fetchLinkedInJobs();
    assertDefined(o);
    expect(o.link).toBe('https://www.linkedin.com/jobs/view/x-99');
  });

  it('returns one entry per li element, preserving order', async () => {
    mockedRequest.mockResolvedValue(
      `<ul>
        ${li({ title: 'A', href: 'https://www.linkedin.com/jobs/view/a-1' })}
        ${li({ title: 'B', href: 'https://www.linkedin.com/jobs/view/b-2' })}
        ${li({ title: 'C', href: 'https://www.linkedin.com/jobs/view/c-3' })}
      </ul>`,
    );
    const { offers: out } = await fetchLinkedInJobs();
    expect(out.map((o) => o.title)).toEqual(['A', 'B', 'C']);
  });

  it('returns empty array when there are no li elements', async () => {
    mockedRequest.mockResolvedValue('<html><body></body></html>');
    expect((await fetchLinkedInJobs()).offers).toEqual([]);
  });

  it('skips li elements missing title', async () => {
    mockedRequest.mockResolvedValue(
      `<ul>
        ${li({ title: 'Has Title' })}
        <li>
          <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/x-1">x</a>
          <h4 class="base-search-card__subtitle">NoTitle Co</h4>
        </li>
      </ul>`,
    );
    const { offers: out } = await fetchLinkedInJobs();
    expect(out.map((o) => o.title)).toEqual(['Has Title']);
  });

  it('skips li elements missing company', async () => {
    mockedRequest.mockResolvedValue(
      `<ul>
        ${li({ title: 'Has Company' })}
        <li>
          <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/x-1">x</a>
          <h3 class="base-search-card__title">NoCompany</h3>
        </li>
      </ul>`,
    );
    const { offers: out } = await fetchLinkedInJobs();
    expect(out.map((o) => o.title)).toEqual(['Has Company']);
  });

  it('skips li elements missing href', async () => {
    mockedRequest.mockResolvedValue(
      `<ul>
        ${li({ title: 'Has Link' })}
        <li>
          <h3 class="base-search-card__title">NoLink</h3>
          <h4 class="base-search-card__subtitle">Co</h4>
          <div class="job-search-card__location">X</div>
        </li>
      </ul>`,
    );
    const { offers: out } = await fetchLinkedInJobs();
    expect(out.map((o) => o.title)).toEqual(['Has Link']);
  });

  it('leaves optional fields undefined when absent', async () => {
    mockedRequest.mockResolvedValue(
      `<ul>
        <li>
          <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/x-1">x</a>
          <h3 class="base-search-card__title">T</h3>
          <h4 class="base-search-card__subtitle">C</h4>
        </li>
      </ul>`,
    );
    const { offers: [o] } = await fetchLinkedInJobs();
    assertDefined(o);
    expect(o.location).toBeUndefined();
    expect(o.postedDate).toBeUndefined();
    expect(o.postedText).toBeUndefined();
    expect(o.benefits).toBeUndefined();
  });

  it('handles missing time element gracefully', async () => {
    mockedRequest.mockResolvedValue(
      `<ul>
        <li>
          <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/x-1">x</a>
          <h3 class="base-search-card__title">T</h3>
          <h4 class="base-search-card__subtitle">C</h4>
          <div class="job-search-card__location">X</div>
        </li>
      </ul>`,
    );
    const { offers: [o] } = await fetchLinkedInJobs();
    assertDefined(o);
    expect(o.postedDate).toBeUndefined();
    expect(o.postedText).toBeUndefined();
  });

  it('builds request URL with the documented query parameters', async () => {
    mockedRequest.mockResolvedValue('<html></html>');
    await fetchLinkedInJobs();
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [url] = mockedRequest.mock.calls[0]!;
    const u = new URL(url as URL | string);
    expect(u.origin + u.pathname).toBe(
      'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search',
    );
    expect(u.searchParams.get('keywords')).toBe('typescript');
    expect(u.searchParams.get('geoId')).toBe('90009831');
    expect(u.searchParams.get('f_PP')).toBe('101496088,104056882');
    expect(u.searchParams.get('f_WT')).toBe('3,2,1');
    expect(u.searchParams.get('f_TPR')).toBe('r604800');
    expect(u.searchParams.get('sortBy')).toBe('R');
    expect(u.searchParams.get('start')).toBe('0');
  });

  it('passes the desktop User-Agent header', async () => {
    mockedRequest.mockResolvedValue('<html></html>');
    await fetchLinkedInJobs();
    const opts = mockedRequest.mock.calls[0]![1];
    expect(opts?.headers).toMatchObject({
      'User-Agent': DESKTOP_USER_AGENT,
    });
  });
});

describe('fetchDesc', () => {
  function detailHtml(body: string): string {
    return `<html><body>
      <div class="description__text description__text--rich">
        <section class="show-more-less-html">
          <div class="show-more-less-html__markup">${body}</div>
        </section>
      </div>
    </body></html>`;
  }

  it('converts the description markup into plain text via htmlToText', async () => {
    mockedRequest.mockResolvedValue(
      detailHtml('<p>hello</p><ul><li>a</li><li>b</li></ul>'),
    );
    const text = await fetchDesc(
      'https://www.linkedin.com/jobs/view/senior-ts-dev-at-acme-1234567890',
    );
    expect(text).toBe('hello\na\nb');
  });

  it('throws when description selector is missing', async () => {
    mockedRequest.mockResolvedValue('<html><body>no desc here</body></html>');
    await expect(
      fetchDesc('https://www.linkedin.com/jobs/view/x-4443390579'),
    ).rejects.toThrow('Description not found for job: 4443390579');
  });

  it('throws when link has no numeric job id', async () => {
    mockedRequest.mockResolvedValue(detailHtml('<p>x</p>'));
    await expect(
      fetchDesc('https://www.linkedin.com/jobs/view/no-id-here'),
    ).rejects.toThrow(/Could not extract job id from link:/);
  });

  it('extracts numeric id from the trailing path segment', async () => {
    mockedRequest.mockResolvedValue(detailHtml('<p>ok</p>'));
    await fetchDesc('https://www.linkedin.com/jobs/view/x-4443390579');
    expect(String(mockedRequest.mock.calls[0]![0])).toBe(
      'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4443390579',
    );
  });

  it('strips query string before requesting the detail endpoint', async () => {
    mockedRequest.mockResolvedValue(detailHtml('<p>ok</p>'));
    await fetchDesc(
      'https://www.linkedin.com/jobs/view/x-4443390579?trk=public_jobs',
    );
    expect(String(mockedRequest.mock.calls[0]![0])).toBe(
      'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4443390579',
    );
  });

  it('passes the desktop User-Agent header', async () => {
    mockedRequest.mockResolvedValue(detailHtml('<p>x</p>'));
    await fetchDesc('https://www.linkedin.com/jobs/view/x-4443390579');
    const opts = mockedRequest.mock.calls[0]![1];
    expect(opts?.headers).toMatchObject({
      'User-Agent': DESKTOP_USER_AGENT,
    });
  });

  it('returns empty string for empty description markup', async () => {
    mockedRequest.mockResolvedValue(detailHtml(''));
    const text = await fetchDesc(
      'https://www.linkedin.com/jobs/view/x-4443390579',
    );
    expect(text).toBe('');
  });

  it('cooperates with nested rich markup (br, strong, nested ul)', async () => {
    mockedRequest.mockResolvedValue(
      detailHtml(
        '<p>Intro <strong>bold</strong></p><p>line1<br>line2</p><ul><li>item1<ul><li>sub</li></ul></li></ul>',
      ),
    );
    const text = await fetchDesc(
      'https://www.linkedin.com/jobs/view/x-4443390579',
    );
    expect(text).toBe('Intro bold\nline1\nline2\nitem1\nsub');
  });
});