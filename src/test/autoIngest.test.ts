// src/test/autoIngest.test.ts
import { describe, it, expect } from 'vitest';
import type { FeedConfig } from '../types';
import { runFeedCycle, DEFAULT_FEEDS } from '../autoIngest';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Neuro</title>
<item><guid>g1</guid><title>Morning light</title><description>La lumière du matin améliore le sommeil.</description></item>
<item><guid>g2</guid><title>Caffeine windowing</title><description>La caféine le soir nuit au repos.</description></item>
</channel></rss>`;

function feed(over: Partial<FeedConfig> = {}): FeedConfig {
  return {
    id: 'f1',
    url: 'https://example.com/rss',
    title: 'Source test',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastGuids: [],
    ...over,
  };
}

describe('runFeedCycle', () => {
  it('extracts protocols from new feed items and records sources', async () => {
    const outcome = await runFeedCycle([feed()], [], [], async () => XML, new Date(2026, 5, 1));
    expect(outcome.newItemsCount).toBe(2);
    expect(outcome.sources).toHaveLength(2);
    expect(outcome.protocols.length).toBeGreaterThan(0);
    expect(outcome.feeds[0].lastFetchAt).toBeTruthy();
    // Dedupe guids recorded.
    expect(outcome.feeds[0].lastGuids).toContain('g1');
    expect(outcome.feeds[0].lastGuids).toContain('g2');
  });

  it('dedupes on the second run using stored guids + existing sources', async () => {
    const first = await runFeedCycle([feed()], [], [], async () => XML, new Date(2026, 5, 1));
    const second = await runFeedCycle(
      first.feeds,
      first.protocols,
      first.sources,
      async () => XML,
      new Date(2026, 5, 2),
    );
    expect(second.newItemsCount).toBe(0);
    expect(second.newProtocolsCount).toBe(0);
    expect(second.sources).toHaveLength(0);
  });

  it('skips disabled feeds without fetching', async () => {
    let fetched = 0;
    const outcome = await runFeedCycle(
      [feed({ enabled: false })],
      [],
      [],
      async () => { fetched++; return XML; },
      new Date(),
    );
    expect(fetched).toBe(0);
    expect(outcome.newItemsCount).toBe(0);
  });

  it('records per-feed errors when a fetch fails', async () => {
    const outcome = await runFeedCycle(
      [feed()],
      [],
      [],
      async () => { throw new Error('network down'); },
      new Date(),
    );
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0].url).toBe('https://example.com/rss');
    expect(outcome.feeds[0].lastFetchAt).toBeUndefined();
  });

  it('provides a curated set of default feeds', () => {
    expect(DEFAULT_FEEDS.length).toBeGreaterThanOrEqual(3);
    for (const f of DEFAULT_FEEDS) {
      expect(f.url).toMatch(/^https:\/\//);
      expect(f.enabled).toBe(true);
    }
  });
});
