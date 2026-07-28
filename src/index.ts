#!/usr/bin/env node

import { fetchOffers, initTable, saveOffers } from './offer.ts';
import { getDb, type Db } from './db.ts';
import { browse } from './browse.ts';
import { DIM, GREEN, RESET } from './tui.ts';

let cleanup: (() => void) | undefined;

async function main() {
  const db = getDb();
  initTable(db);

  const args = process.argv.slice(2);
  if (args.includes('--fetch')) {
    cleanup = () => db.close();
    await fetch(db);
  } else {
    cleanup = browse(db);
  }
}

async function fetch(db: Db) {
  const { offers, urls } = await fetchOffers();
  const { inserted, skipped } = saveOffers(db, offers);
  db.close();
  const insertedStr =
    inserted > 0 ? `${GREEN}${inserted}${RESET}` : `${inserted}`;
  console.log(`Inserted ${insertedStr}, skipped ${skipped}`);
  for (const url of urls) {
    console.log(`${DIM}${url}${RESET}`);
  }
}

main().catch((err) => {
  cleanup?.();
  console.error(err);
  process.exit(1);
});
