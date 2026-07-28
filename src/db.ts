import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const projectRoot = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== '/' && !existsSync(resolve(dir, 'package.json'))) {
    dir = dirname(dir);
  }
  return dir;
})();

const LOCATION = resolve(projectRoot, 'data/app.sqlite');

export type Db = {
  exec: (sql: string) => void;
  prepare: (sql: string) => StatementSync;
  close: () => void;
};

export function getDb(): Db {
  const database = new DatabaseSync(LOCATION);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA foreign_keys = ON;');
  return {
    exec: (sql: string) => database.exec(sql),
    prepare: (sql: string): StatementSync => database.prepare(sql),
    close: () => database.close(),
  };
}