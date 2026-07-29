// https://justjoin.it/job-offers/gdansk?radius=50&experience-levels=mid,senior&keyword=typescript&published-date=7&sortBy=newest
// Underlying JSON API (discovered from the SSR stream): /api/candidate-api/offers
// Param mapping (matches React Query hash from the page):
//   city, cityRadius, experienceLevels (repeat), keyword,
//   publishedSinceDays, sortBy

import { JSDOM } from 'jsdom';
import { htmlToText } from './html.ts';
import { request } from './request.ts';

const BASE_API = 'https://justjoin.it/api/candidate-api/offers';
const MAX_OFFERS = 30;

export type JustJoinOffer = {
  title: string;
  company: string;
  link: string;
  workplaceType?: string;
  publishedAt?: string;
  requiredSkills?: string;
  employmentType?: string;
  languages?: string;
  locations?: string;
};

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

export async function fetchDesc(link: string): Promise<string> {
  const slug = extractSlug(link);
  const url = `${BASE_API}/${slug}`;
  const body = await request(url, { headers: HEADERS });
  const payload = JSON.parse(body) as { body?: string };
  if (!payload.body)
    throw new Error(`Description not found for offer: ${slug}`);

  const dom = new JSDOM(`<body>${payload.body}</body>`);
  return htmlToText(dom.window.document.body);
}

export async function fetchJustJoin(): Promise<{
  offers: JustJoinOffer[];
  url: string;
}> {
  const url = new URL(BASE_API);
  url.searchParams.set('keywords', 'typescript');
  url.searchParams.set('city', 'Gdańsk');
  url.searchParams.set('cityRadius', '50');
  url.searchParams.append('experienceLevels', 'mid');
  url.searchParams.append('experienceLevels', 'senior');
  url.searchParams.set('publishedSinceDays', '7');
  url.searchParams.set('sortBy', 'newest');
  url.searchParams.set('from', '0');
  url.searchParams.set('itemsCount', String(MAX_OFFERS));

  const urlStr = url.toString();

  const body = await request(url, { headers: HEADERS });
  const payload = JSON.parse(body) as { data: Record<string, unknown>[] };

  return {
    offers: payload.data.map((raw) => normalizeOffer(raw)),
    url: urlStr,
  };
}

function normalizeOffer(raw: Record<string, unknown>): JustJoinOffer {
  const slug = str(raw.slug);
  const locations = arr<{ city?: unknown; slug?: unknown }>(raw.locations).map(
    (l) => ({
      city: str(l.city),
      slug: str(l.slug),
    }),
  );
  const level = optStr(raw.experienceLevel);
  const strLevel = level ? ` (${level})` : '';
  return {
    title: `${str(raw.title)}${strLevel}`,
    company: str(raw.companyName),
    link: slug ? `https://justjoin.it/job-offer/${slug}` : '',
    workplaceType: optStr(raw.workplaceType),
    publishedAt: toDate(raw.publishedAt),
    requiredSkills:
      arr<{ name?: unknown; level?: unknown }>(raw.requiredSkills)
        .map((s) => {
          const name = str(s.name);
          const level = typeof s.level === 'number' ? s.level : 0;
          return level ? `${name}:${level}` : name;
        })
        .filter(Boolean)
        .join(', ') || undefined,
    employmentType: formatEmployment(
      arr<Record<string, unknown>>(raw.employmentTypes),
    ),
    languages:
      arr<{ code?: unknown; level?: unknown }>(raw.languages)
        .map((l) => `${str(l.code)}: ${str(l.level)}`)
        .join(' | ') || undefined,
    locations: locations.map((l) => l.city).join(' | ') || undefined,
  };
}

function formatEmployment(
  types: Record<string, unknown>[],
): string | undefined {
  const hasPln = types.some((t) => t.currency === 'PLN');
  const picked = hasPln ? types.filter((t) => t.currency === 'PLN') : types;
  return (
    picked
      .map((t) => {
        const parts: string[] = [];
        parts.push(`${str(t.type)}`);
        parts.push(
          typeof t.from === 'number' && typeof t.to === 'number'
            ? `${t.from} - ${t.to}`
            : 'n/a',
        );
        parts.push(`(${optStr(t.unit) ?? 'n/a'})`);
        parts.push(`${str(t.currency)}`);
        parts.push(
          t.gross === true ? 'gross' : t.gross === false ? 'net' : 'n/a',
        );
        return parts.join(' ');
      })
      .join(' | ') || undefined
  );
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function optStr(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function toDate(v: unknown): string | undefined {
  if (typeof v !== 'string' || v === '') return undefined;
  const d = new Date(v);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

function extractSlug(link: string): string {
  const u = new URL(link);
  const parts = u.pathname.split('/').filter(Boolean);
  const slug = parts[parts.length - 1];
  if (!slug) throw new Error(`Could not extract slug from link: ${link}`);
  return slug;
}
