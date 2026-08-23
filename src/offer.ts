import { type Db } from './db.ts';
import {
  fetchDesc as fetchJustJoinDesc,
  fetchJustJoin,
  type JustJoinOffer,
} from './justjoin.ts';
import {
  fetchDesc as fetchLinkedInDesc,
  fetchLinkedInJobs,
  type LinkedInOffer,
} from './linkedin.ts';
import {
  fetchDesc as fetchNoFluffJobsDesc,
  fetchNoFluffJobs,
  type NoFluffJobsOffer,
} from './nofluffjobs.ts';

export type OfferSource = 'linkedin' | 'justjoin' | 'nofluffjobs';

export function fetchDesc(offer: OfferRow): Promise<string> {
  if (offer.source === 'linkedin') return fetchLinkedInDesc(offer.link);
  if (offer.source === 'nofluffjobs') return fetchNoFluffJobsDesc(offer.link);
  return fetchJustJoinDesc(offer.link);
}

export type Offer = {
  source: OfferSource;
  link: string;
  title: string;
  company: string;

  workplaceType?: string;
  postedAt?: string;
  salary?: string;
  skills?: string;
  locations?: string;

  languages?: string;
};

export type OfferRow = Offer & {
  hidden: number;
  savedAt: string;
};

export function initTable(db: Db): void {
  const existed = !!db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='offers'",
    )
    .get();

  db.exec(`
    CREATE TABLE IF NOT EXISTS offers (
      link TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT,
      company TEXT,
      workplaceType TEXT,
      postedAt TEXT,
      salary TEXT,
      skills TEXT,
      locations TEXT,
      languages TEXT,
      hidden INTEGER NOT NULL DEFAULT 0,
      savedAt TEXT NOT NULL
    );
  `);

  if (!existed) {
    db.exec('PRAGMA user_version = 2');
    return;
  }

  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };

  if (version < 2) {
    db.exec('ALTER TABLE offers DROP COLUMN experienceLevel');
    db.exec('PRAGMA user_version = 2');
  }
}

export async function fetchOffers(): Promise<{
  offers: Offer[];
  urls: string[];
}> {
  const [linkedin, justjoin, nofluffjobs] = await Promise.all([
    fetchLinkedInJobs(),
    fetchJustJoin(),
    fetchNoFluffJobs(),
  ]);

  return {
    offers: [
      ...linkedin.offers.map(mapLinkedInOffer),
      ...justjoin.offers.map(mapJustJoinOffer),
      ...nofluffjobs.offers.map(mapNoFluffJobsOffer),
    ],
    urls: [linkedin.url, justjoin.url, nofluffjobs.url],
  };
}

export function saveOffers(
  db: Db,
  offers: Offer[],
): { inserted: number; skipped: number } {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO offers (
      link, source, title, company, workplaceType,
      postedAt, salary, skills, locations, languages, savedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  for (const o of offers) {
    const r = insert.run(
      o.link,
      o.source,
      o.title,
      o.company,
      o.workplaceType ?? null,
      o.postedAt ?? null,
      o.salary ?? null,
      o.skills ?? null,
      o.locations ?? null,
      o.languages ?? null,
      now,
    );
    if (r.changes > 0) inserted++;
    else skipped++;
  }
  return { inserted, skipped };
}

export function selectVisibleOffers(db: Db): OfferRow[] {
  const select = db.prepare(`
    SELECT link, source, title, company, workplaceType,
           postedAt, salary, skills, locations, languages, hidden, savedAt
    FROM offers
    WHERE hidden = 0
    ORDER BY postedAt IS NULL, postedAt DESC, savedAt DESC
  `);
  return select.all() as OfferRow[];
}

export function markHidden(db: Db, link: string): void {
  const update = db.prepare('UPDATE offers SET hidden = 1 WHERE link = ?');
  update.run(link);
}

function mapLinkedInOffer(offer: LinkedInOffer): Offer {
  return {
    source: 'linkedin',
    link: offer.link,
    title: offer.title,
    company: offer.company,
    locations: offer.location,
    postedAt: offer.postedDate ?? offer.postedText,
  };
}

function mapJustJoinOffer(offer: JustJoinOffer): Offer {
  return {
    source: 'justjoin',
    link: offer.link,
    title: offer.title,
    company: offer.company,
    workplaceType: offer.workplaceType,
    postedAt: offer.publishedAt,
    salary: offer.employmentType,
    skills: offer.requiredSkills,
    locations: offer.locations,
    languages: offer.languages,
  };
}

function mapNoFluffJobsOffer(offer: NoFluffJobsOffer): Offer {
  return {
    source: 'nofluffjobs',
    link: offer.link,
    title: offer.title,
    company: offer.company,
    locations: offer.location,
    salary: offer.salary,
    skills: offer.requiredSkills,
    postedAt: offer.postedAt,
  };
}
