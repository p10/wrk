import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchDesc, fetchNoFluffJobs } from '../nofluffjobs.ts';

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

function item(over: Record<string, string> = {}): string {
  const {
    id = 'nfjPostingListItem-senior-frontend-developer-ai-lead-itfs-remote',
    href = '/pl/job/senior-frontend-developer-ai-lead-itfs-remote',
    title = 'Senior Frontend Developer / AI Lead',
    company = 'ITFS Sp. z o.o.',
    salary = '140 – 150 PLN / godz.',
    location = 'Zdalnie',
    requiredSkills = 'TypeScript, Next.js',
  } = over;
  const skillSpans = requiredSkills
    .split(', ')
    .map(
      (s) =>
        `<span data-cy="category name on the job offer listing" class="posting-tag"> ${s} </span>`,
    )
    .join('');
  return `
    <a id="${id}" href="${href}" class="posting-list-item--frontend" target="_self">
      <h3 data-cy="title position on the job offer listing" class="posting-title__position"> ${title} </h3>
      <h4 class="company-name"> ${company} </h4>
      <span data-cy="salary ranges on the job offer listing" class="posting-tag"> ${salary} </span>
      <nfj-posting-item-city data-cy="location on the job offer listing">
        <span> ${location} </span>
      </nfj-posting-item-city>
      ${skillSpans}
    </a>`;
}

const LISTING_HTML = `<html><body>${item()}</body></html>`;

describe('fetchNoFluffJobs', () => {
  it('parses a full offer card', async () => {
    mockedRequest.mockResolvedValue(LISTING_HTML);
    const { offers: [o] } = await fetchNoFluffJobs();
    assertDefined(o);
    expect(o).toEqual({
      title: 'Senior Frontend Developer / AI Lead',
      company: 'ITFS Sp. z o.o.',
      link: 'https://nofluffjobs.com/pl/job/senior-frontend-developer-ai-lead-itfs-remote',
      location: 'Zdalnie',
      salary: '140 – 150 PLN / godz.',
      requiredSkills: 'TypeScript, Next.js',
    });
  });

  it('absolutizes relative job hrefs', async () => {
    mockedRequest.mockResolvedValue(
      `<html><body>${item({ href: '/pl/job/relative-link' })}</body></html>`,
    );
    const { offers: [o] } = await fetchNoFluffJobs();
    assertDefined(o);
    expect(o.link).toBe('https://nofluffjobs.com/pl/job/relative-link');
  });

  it('returns one entry per posting item, preserving order', async () => {
    mockedRequest.mockResolvedValue(
      `<html><body>${item({ id: 'nfjPostingListItem-a', title: 'A' })}${item({ id: 'nfjPostingListItem-b', title: 'B' })}</body></html>`,
    );
    const { offers: out } = await fetchNoFluffJobs();
    expect(out.map((o) => o.title)).toEqual(['A', 'B']);
  });

  it('returns empty array when there are no posting items', async () => {
    mockedRequest.mockResolvedValue('<html><body></body></html>');
    expect((await fetchNoFluffJobs()).offers).toEqual([]);
  });

  it('leaves optional fields undefined when absent', async () => {
    const minimal = `
      <a id="nfjPostingListItem-x" href="/pl/job/x" class="posting-list-item--frontend">
        <h3 data-cy="title position on the job offer listing"> T </h3>
        <h4 class="company-name"> C </h4>
      </a>`;
    mockedRequest.mockResolvedValue(`<html><body>${minimal}</body></html>`);
    const { offers: [o] } = await fetchNoFluffJobs();
    assertDefined(o);
    expect(o.location).toBeUndefined();
    expect(o.salary).toBeUndefined();
    expect(o.requiredSkills).toBeUndefined();
  });

  it('builds request URL with the documented criteria', async () => {
    mockedRequest.mockResolvedValue('<html></html>');
    await fetchNoFluffJobs();
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [url] = mockedRequest.mock.calls[0]!;
    const u = new URL(url as URL | string);
    expect(u.origin + u.pathname).toBe(
      'https://nofluffjobs.com/pl/praca-zdalna/frontend',
    );
    expect(u.searchParams.get('criteria')).toBe(
      'city=gdansk requirement=TypeScript',
    );
  });

  it('passes the desktop User-Agent header', async () => {
    mockedRequest.mockResolvedValue('<html></html>');
    await fetchNoFluffJobs();
    const opts = mockedRequest.mock.calls[0]![1];
    expect(opts?.headers).toMatchObject({
      'User-Agent': DESKTOP_USER_AGENT,
    });
  });
});

describe('fetchDesc', () => {
  function detailHtml(body: string): string {
    return `<html><body>
      <div class="tw-mb-12">
        <section class="tw-block tw-p-5 tw-bg-white tw-rounded-xl tw-mb-4">
          <common-posting-header class="tw-flex tw-mb-4"> Senior Frontend Developer / AI Lead ITFS Sp. z o.o. </common-posting-header>
          <ul class="posting-info-row tw-grid desktop:tw-grid"> Kategoria: Frontend , TypeScript Senior Praca zdalna Dolnośląskie </ul>
        </section>
        <div class="tw-block tw-px-5 tw-pt-5 tw-pb-3"> Obowiązkowe TypeScript Next.js </div>
        <section class="tw-block tw-p-5"><p>Opis wymagań</p><p>Minimum 4 lata doświadczenia</p></section>
        <div> Szczegóły oferty Start 2026-09-21 Kontrakt </div>
      </div>
      ${body}
    </body></html>`;
  }

  it('strips the header and sidebar, keeping the description', async () => {
    mockedRequest.mockResolvedValue(detailHtml(''));
    const text = await fetchDesc(
      'https://nofluffjobs.com/pl/job/senior-frontend-developer-ai-lead-itfs-remote',
    );
    expect(text).toContain('Opis wymagań');
    expect(text).toContain('Minimum 4 lata doświadczenia');
    expect(text).not.toContain('Kategoria');
    expect(text).not.toContain('Szczegóły oferty');
  });

  it('throws when the description container is missing', async () => {
    mockedRequest.mockResolvedValue('<html><body>no desc here</body></html>');
    await expect(
      fetchDesc(
        'https://nofluffjobs.com/pl/job/senior-frontend-developer-ai-lead-itfs-remote',
      ),
    ).rejects.toThrow(
      'Description not found for job: https://nofluffjobs.com/pl/job/senior-frontend-developer-ai-lead-itfs-remote',
    );
  });

  it('absolutizes relative job links before requesting', async () => {
    mockedRequest.mockResolvedValue(detailHtml(''));
    await fetchDesc('/pl/job/senior-frontend-developer-ai-lead-itfs-remote');
    expect(String(mockedRequest.mock.calls[0]![0])).toBe(
      'https://nofluffjobs.com/pl/job/senior-frontend-developer-ai-lead-itfs-remote',
    );
  });

  it('passes the desktop User-Agent header', async () => {
    mockedRequest.mockResolvedValue(detailHtml(''));
    await fetchDesc(
      'https://nofluffjobs.com/pl/job/senior-frontend-developer-ai-lead-itfs-remote',
    );
    const opts = mockedRequest.mock.calls[0]![1];
    expect(opts?.headers).toMatchObject({
      'User-Agent': DESKTOP_USER_AGENT,
    });
  });
});
