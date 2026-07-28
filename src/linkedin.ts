import { JSDOM } from 'jsdom';
import { htmlToText } from './html.ts';
import { request } from './request.ts';

export type LinkedInOffer = {
  title: string;
  company: string;
  link: string;
  location?: string;
  postedDate?: string;
  postedText?: string;
  benefits?: string;
};

export async function fetchDesc(link: string): Promise<string> {
  const jobId = extractJobId(link);
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };

  const html = await request(url, { headers });
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const markup = document.querySelector('.show-more-less-html__markup');
  if (!markup) throw new Error(`Description not found for job: ${jobId}`);

  return htmlToText(markup);
}

export async function fetchLinkedInJobs(): Promise<{
  offers: LinkedInOffer[];
  url: string;
}> {
  const url = new URL(
    'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search',
  );

  url.searchParams.set('keywords', 'typescript');
  url.searchParams.set('geoId', '90009831'); // Poland
  url.searchParams.set('f_PP', '101496088,104056882'); // Location filter
  url.searchParams.set('f_WT', '3,2,1'); // Remote/On-site/Hybrid
  url.searchParams.set('f_TPR', 'r604800'); // Past week
  url.searchParams.set('sortBy', 'R'); // Sort by recent
  url.searchParams.set('start', '0'); // Pagination offset (increments by 25)

  const urlStr = url.toString();

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };

  const html = await request(url, { headers });
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const jobs: LinkedInOffer[] = [];

  for (const element of document.querySelectorAll('li')) {
    const title = element
      .querySelector('h3.base-search-card__title')
      ?.textContent.trim();
    const company = element
      .querySelector('h4.base-search-card__subtitle')
      ?.textContent.trim();
    const href = element
      .querySelector('a.base-card__full-link')
      ?.getAttribute('href');
    const link = href ? href.split('?')[0] : undefined;
    const location = element
      .querySelector('.job-search-card__location')
      ?.textContent.trim();
    const timeEl = element.querySelector('time');
    const postedDate = timeEl?.getAttribute('datetime') ?? undefined;
    const postedText = timeEl?.textContent.trim() ?? undefined;
    const benefits = element
      .querySelector('.job-posting-benefits__text')
      ?.textContent.trim();

    if (title && company && link) {
      jobs.push({
        title,
        company,
        link,
        location,
        postedDate,
        postedText,
        benefits,
      });
    }
  }

  return { offers: jobs, url: urlStr };
}

function extractJobId(link: string): string {
  const match = link.match(/(\d+)(?:\?(?:.*))?$/);
  if (!match) throw new Error(`Could not extract job id from link: ${link}`);
  return match[1] as string;
}
