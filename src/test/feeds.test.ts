// src/test/feeds.test.ts
import { describe, it, expect } from 'vitest';
import { parseFeed } from '../feeds';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Neuroscience Weekly</title>
<item>
  <guid>guid-1</guid>
  <title>Morning light improves sleep</title>
  <link>https://example.com/a</link>
  <description><![CDATA[<p>Un <b>résumé</b> de l'étude sur la lumière du matin.</p>]]></description>
</item>
<item>
  <guid>guid-2</guid>
  <title>Caffeine windowing</title>
  <link>https://example.com/b</link>
  <description>Plain text description.</description>
</item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Biohack Lab</title>
<entry>
  <id>atom-1</id>
  <title>Sauna &amp; cardiovascular health</title>
  <link href="https://example.com/sauna"/>
  <summary type="html">&lt;p&gt;Une &lt;b&gt;étude&lt;/b&gt; finlandaise.&lt;/p&gt;</summary>
</entry>
</feed>`;

describe('parseFeed', () => {
  it('parses RSS 2.0 items and strips HTML from descriptions', () => {
    const parsed = parseFeed(RSS);
    expect(parsed.feedTitle).toBe('Neuroscience Weekly');
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].guid).toBe('guid-1');
    expect(parsed.items[0].title).toBe('Morning light improves sleep');
    expect(parsed.items[0].link).toBe('https://example.com/a');
    expect(parsed.items[0].description).toContain('résumé');
    expect(parsed.items[0].description).not.toContain('<');
  });

  it('parses Atom entries (link via href, html entity-encoded summary)', () => {
    const parsed = parseFeed(ATOM);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].guid).toBe('atom-1');
    expect(parsed.items[0].link).toBe('https://example.com/sauna');
    expect(parsed.items[0].description.replace(/&/g, '&amp;')).toContain('étude');
  });

  it('returns an empty result for malformed or empty input', () => {
    expect(parseFeed('')).toEqual({ items: [] });
    expect(parseFeed('this is not xml <item>')).toEqual({ items: [] });
  });
});
