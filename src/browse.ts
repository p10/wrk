import { spawnSync } from 'node:child_process';

import { type Db } from './db.ts';
import {
  fetchDesc,
  markHidden,
  selectVisibleOffers,
  type OfferRow,
} from './offer.ts';
import { type Tui, DIM, RESET } from './tui.ts';

export function browse(db: Db, tui: Tui): () => void {
  let offers: OfferRow[] = selectVisibleOffers(db);
  let i = 0;

  if (offers.length === 0) {
    db.close();
    console.log('No offers to show.');
    return () => {};
  }

  tui.onCleanup(() => db.close());
  tui.enter();
  tui.hideCursor();
  tui.onKey((key) => {
    switch (key) {
      case 'q':
      case '\x03':
        tui.quit();
        break;
      case 'n':
        move(1);
        break;
      case 'p':
        move(-1);
        break;
      case 'o':
        openCurrent();
        break;
      case 'm':
        hideCurrent();
        break;
    }
  });

  type DescState =
    | { type: 'loading' }
    | { type: 'success'; text: string }
    | { type: 'error'; message: string };
  const descCache = new Map<string, DescState>();

  render();

  function move(delta: number): void {
    const next = i + delta;
    if (next >= 0 && next < offers.length) {
      i = next;
      render();
    }
  }

  function openCurrent(): void {
    const o = offers[i];
    if (o?.link) spawnSync('open', [o.link], { stdio: 'ignore' });
  }

  function hideCurrent(): void {
    const o = offers[i];
    if (!o) return;
    markHidden(db, o.link);
    offers = selectVisibleOffers(db);
    if (offers.length === 0) {
      tui.quit();
      return;
    }
    if (i >= offers.length) i = offers.length - 1;
    render();
  }

  function loadDescription(o: OfferRow): void {
    if (o.source !== 'linkedin' && o.source !== 'justjoin') return;
    if (descCache.has(o.link)) return;
    descCache.set(o.link, { type: 'loading' });
    fetchDesc(o)
      .then((text: string) => {
        descCache.set(o.link, { type: 'success', text });
        if (offers[i]?.link === o.link) render();
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        descCache.set(o.link, { type: 'error', message });
        if (offers[i]?.link === o.link) render();
      });
  }

  function render(): void {
    const o = offers[i];
    if (!o) return;
    const header: string[] = [
      `${DIM}[${i + 1}/${offers.length}]  n=next  p=prev  o=open  m=hide  q=quit${RESET}`,
      `${o.title}`,
      `${o.company}${o.source ? `  (${o.source})` : ''}`,
    ];
    if (o.salary) header.push(`${o.salary}`);
    if (o.workplaceType) header.push(`${o.workplaceType}`);
    header.push('');
    if (o.skills) header.push(`skills: ${o.skills}`);
    if (o.locations) header.push(`locations: ${o.locations}`);
    if (o.languages) header.push(`languages: ${o.languages}`);
    if (o.postedAt) header.push(`posted: ${o.postedAt}`);
    header.push('');
    header.push(`${DIM}${o.link}${RESET}`);

    const descLines: string[] = [];
    loadDescription(o);
    const state = descCache.get(o.link);
    if (state?.type === 'loading') {
      descLines.push('');
      descLines.push('getting desc...');
    } else if (state?.type === 'error') {
      descLines.push('');
      descLines.push(`${DIM}error: ${state.message}${RESET}`);
    } else if (state?.type === 'success') {
      descLines.push('');
      for (const line of state.text.split('\n')) {
        descLines.push(line);
      }
    }

    const lines = tui.fitView({
      header,
      body: descLines,
      footer: [],
      moreMarker: `${DIM}... (more)${RESET}`,
    });
    tui.clear();
    tui.write(lines.join('\n'));
  }

  return () => tui.cleanup();
}
