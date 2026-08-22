// https://nofluffjobs.com/pl/praca-zdalna/frontend?criteria=city%3Dgdansk%20requirement%3DTypeScript
// Server-rendered Angular app: the listing and the job description are both
// present in the initial HTML, so we parse the DOM directly (no JSON API).

import { JSDOM } from 'jsdom';
import { htmlToText } from './html.ts';
import { request } from './request.ts';

export type NoFluffJobsOffer = {
  title: string;
  company: string;
  link: string;
  location?: string;
  salary?: string;
  requiredSkills?: string;
  postedAt?: string;
};

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const BASE_URL = 'https://nofluffjobs.com';

export async function fetchDesc(link: string): Promise<string> {
  const url = normalizeJobUrl(link);
  const html = await request(url, { headers: HEADERS });
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const wrapper = document.querySelector('common-posting-content-wrapper');
  const content = wrapper?.children[0] ?? document.querySelector('article');
  if (!content) throw new Error(`Description not found for job: ${link}`);

  content
    .querySelectorAll(
      'common-posting-header, .posting-logo, ul.posting-info-row',
    )
    .forEach((n) => n.remove());
  const sidebar = [...content.querySelectorAll('div, aside')].find((d) =>
    (d.textContent ?? '').trim().startsWith('Szczegóły oferty'),
  );
  sidebar?.remove();

  return htmlToText(content);
}

export async function fetchNoFluffJobs(): Promise<{
  offers: NoFluffJobsOffer[];
  url: string;
}> {
  const url = new URL(`${BASE_URL}/pl/praca-zdalna/frontend`);
  url.searchParams.set('criteria', 'city=gdansk requirement=TypeScript');
  const urlStr = url.toString();

  const html = await request(urlStr, { headers: HEADERS });
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const offers: NoFluffJobsOffer[] = [];

  for (const el of document.querySelectorAll('a[id^="nfjPostingListItem"]')) {
    const href = el.getAttribute('href') ?? '';
    const link = href.startsWith('http') ? href : `${BASE_URL}${href}`;
    const title = text(
      el.querySelector('h3[data-cy="title position on the job offer listing"]'),
    );
    const company = text(el.querySelector('h4.company-name'));
    const salary = text(
      el.querySelector('span[data-cy="salary ranges on the job offer listing"]'),
    );
    const location = text(
      el.querySelector('[data-cy="location on the job offer listing"] span'),
    );
    const skills = [
      ...el.querySelectorAll('span[data-cy="category name on the job offer listing"]'),
    ]
      .map((s) => text(s))
      .filter(Boolean)
      .join(', ');

    if (title && company && link) {
      offers.push({
        title,
        company,
        link,
        location: location || undefined,
        salary: salary || undefined,
        requiredSkills: skills || undefined,
      });
    }
  }

  return { offers, url: urlStr };
}

function normalizeJobUrl(link: string): string {
  if (link.startsWith('http')) return link;
  return `${BASE_URL}${link}`;
}

function text(node: Element | null): string {
  return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}
