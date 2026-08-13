// src/autoIngest.ts
// The PERMANENT automated ingestion loop.
//
// LifeTrack fetches its curated RSS/Atom feeds on a schedule, parses new items,
// extracts structured, evidence-graded protocols from each one, and merges them
// into the local library — with no pasting, no manual step, forever. The webview
// fetches through a Rust command (`fetch_url`) so there is no CORS.
//
// Pure engine: `runFeedCycle` takes the feed list + library + a fetcher and
// returns the NEW state (feeds with dedupe guids, merged protocols, new source
// records). Persistence is the caller's job (store.applyFeedIngest).

import type { FeedConfig, IngestedSource, Protocol } from './types';
import { parseFeed, type FeedItem } from './feeds';
import { extractProtocolsFromText, mergeProtocols } from './ingest';

// eslint-disable-next-line no-unused-vars
export type Fetcher = (url: string) => Promise<string>;

/** Max dedupe guids kept per feed. */
const GUID_CAP = 120;

/** A short, reusable id for each default feed (stable across startup). */
const FEED_ID = (slug: string) => `feed-${slug}`;

/**
 * Curated default feeds — reliable, open, NB: arXiv RSS is stable and
 * well-aligned with behavioral/neuroscience research. All are editable in-app.
 */
export const DEFAULT_FEEDS: FeedConfig[] = [
  {
    id: FEED_ID('arxiv-qbionc'),
    url: 'https://rss.arxiv.org/rss/q-bio.NC',
    title: 'arXiv Neurosciences (q-bio.NC)',
    createdAt: '1970-01-01T00:00:00.000Z',
    lastGuids: [],
    enabled: true,
  },
  {
    id: FEED_ID('arxiv-cshc'),
    url: 'https://rss.arxiv.org/rss/cs.HC',
    title: 'arXiv Interaction Homme-Machine (cs.HC)',
    createdAt: '1970-01-01T00:00:00.000Z',
    lastGuids: [],
    enabled: true,
  },
  {
    id: FEED_ID('arxiv-csai'),
    url: 'https://rss.arxiv.org/rss/cs.AI',
    title: 'arXiv Intelligence Artificielle (cs.AI)',
    createdAt: '1970-01-01T00:00:00.000Z',
    lastGuids: [],
    enabled: true,
  },
];

export interface FeedCycleOutcome {
  feeds: FeedConfig[];          // new feed state (updated guids + lastFetchAt)
  protocols: Protocol[];        // merged library (deduped by title)
  sources: IngestedSource[];    // NEW source records to persist
  newItemsCount: number;
  newProtocolsCount: number;
  errors: { url: string; error: string }[];
  lastRunAt: string;
}

function stripRssHtml(html: string): string {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * One full cycle over all enabled feeds.
 *
 * @param feeds         current feed configs (their lastGuids are used for dedupe)
 * @param protocols     current protocol library (may be empty on first run)
 * @param existingSources current ingested sources (dedupe by title)
 * @param fetchXml      injected HTTP fetcher (Tauri invoke / browser fetch)
 */
export async function runFeedCycle(
  feeds: FeedConfig[],
  protocols: Protocol[],
  existingSources: IngestedSource[],
  fetchXml: Fetcher,
  now: Date = new Date(),
): Promise<FeedCycleOutcome> {
  const lastRunAt = now.toISOString();
  const errors: FeedCycleOutcome['errors'] = [];
  let newItemsCount = 0;
  let newProtocolsCount = 0;
  const sources: IngestedSource[] = [];
  let library = protocols.slice();
  const knownTitles = new Set(existingSources.map((s) => s.title));
  const seenGuids = new Set(existingSources.flatMap((s) => (s as IngestedSource & { guid?: string }).guid ?? []));

  const updatedFeeds = await Promise.all(
    feeds.map(async (feed) => {
      if (!feed.enabled) return feed;
      let xml: string;
      try {
        xml = await fetchXml(feed.url);
      } catch (e) {
        errors.push({ url: feed.url, error: e instanceof Error ? e.message : String(e) });
        return feed;
      }

      const parsed = parseFeed(xml);
      const fresh: FeedItem[] = [];
      const guids = new Set(feed.lastGuids ?? []);

      for (const item of parsed.items) {
        const guid = item.guid;
        if (guids.has(guid) || seenGuids.has(guid)) continue;
        if (knownTitles.has(item.title)) continue;
        guids.add(guid);
        seenGuids.add(guid);
        fresh.push(item);
      }

      for (const item of fresh) {
        const rawText = `${item.title}\n${stripRssHtml(item.description)}`;
        const extracted = extractProtocolsFromText(rawText, feed.title);
        const before = library.length;
        library = mergeProtocols(library, extracted);
        newProtocolsCount += library.length - before;
        newItemsCount++;
        knownTitles.add(item.title);
        sources.push({
          id: `src-${item.guid}`.replace(/[^A-Za-z0-9_-]/g, '-'),
          title: item.title,
          rawText,
          createdAt: lastRunAt,
          ingested: true,
        });
      }

      // Cap the dedupe window so we notice old-untouched items again one day.
      const trimmed = [...guids].slice(-GUID_CAP);
      return {
        ...feed,
        lastFetchAt: lastRunAt,
        ...(fresh.length > 0 ? { lastGuids: trimmed } : {}),
      };
    }),
  );

  return {
    feeds: updatedFeeds,
    protocols: library,
    sources,
    newItemsCount,
    newProtocolsCount,
    errors,
    lastRunAt,
  };
}

/** Pick the right HTTP fetcher: Tauri IPC in the desktop app, plain fetch elsewhere. */
export async function pickFetcher(): Promise<Fetcher> {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return async (url: string) => invoke<string>('fetch_url', { url });
  }
  return async (url: string) => {
    const resp = await fetch(url, {
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.text();
  };
}