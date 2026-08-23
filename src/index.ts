#!/usr/bin/env node

import { browse } from './browse.ts';
import { getDb, type Db } from './db.ts';
import { fetchOffers, initTable, saveOffers } from './offer.ts';
import { TuiClient, DIM, RESET } from './tui.ts';

let cleanup: (() => void) | undefined;

async function main() {
  const db = getDb();
  initTable(db);

  const args = process.argv.slice(2);
  if (args.includes('--fetch')) {
    cleanup = () => db.close();
    await fetch(db, args.includes('-v'));
  } else {
    cleanup = browse(db, new TuiClient());
  }
}

async function fetch(db: Db, verbose: boolean) {
  const { offers, urls } = await fetchOffers();
  const { inserted, skipped } = saveOffers(db, offers);
  db.close();
  console.log(`Inserted ${inserted}, skipped ${skipped}`);
  if (verbose) {
    for (const url of urls) {
      console.log(`${DIM}${url}${RESET}`);
    }
  }
}

main().catch((err) => {
  cleanup?.();
  console.error(err);
  process.exit(1);
});
