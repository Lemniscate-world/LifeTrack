// src/feeds.ts
// RSS 2.0 / Atom parser — feeds the permanent auto-ingest pipeline.
// Pure: XML string → typed items. DOMParser exists in the webview and jsdom.
// No external dependency, no network here (fetching lives in autoIngest.ts).

export interface FeedItem {
  guid: string;
  title: string;
  link?: string;
  description: string;   // cleaned plain text (HTML tags stripped)
  pubDate?: string;
}

export interface ParsedFeed {
  feedTitle?: string;
  items: FeedItem[];
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse an RSS 2.0 or Atom document into a channel title + items.
 * Handles `<item>` (RSS) and `<entry>` (Atom) equally.
 */
export function parseFeed(xml: string): ParsedFeed {
  const empty: ParsedFeed = { items: [] };
  if (!xml || !xml.trim()) return empty;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml');
  } catch {
    return empty;
  }

  // Detect a failed XML parse (parsererror node).
  if (doc.getElementsByTagName('parsererror').length > 0) return empty;

  // Walk by LOCAL name so both plain RSS (no namespace) and Atom (default
  // namespace) work — jsdom's getElementsByTagName ignores namespaced elements.
  function* walk(el: Element): Generator<Element> {
    for (const child of Array.from(el.children)) {
      yield child;
      yield* walk(child);
    }
  }
  const roots = doc.documentElement ? [doc.documentElement] : [];
  const allByName = (names: string[]): Element[] => {
    const out: Element[] = [];
    for (const root of roots) {
      for (const el of walk(root)) {
        if (names.includes(el.localName)) out.push(el);
      }
    }
    return out;
  };

  const nodeList = allByName(['item', 'entry']);
  const childOf = (el: Element, tag: string): string =>
    allByName([tag]).find((c) => el.contains(c) && c !== el)?.textContent?.trim() ?? '';

  const channelTitle = allByName(['title'])[0]?.textContent?.trim() || undefined;

  const items: FeedItem[] = [];
  for (const el of nodeList) {
    // Atom links carry the URL in the href attribute (RSS in the text).
    const linkEl = allByName(['link']).find((c) => el.contains(c) && c !== el);
    const linkHref = linkEl?.getAttribute('href') ?? linkEl?.getAttribute('url');
    const title = childOf(el, 'title') || 'Sans titre';
    const descriptionRaw =
      childOf(el, 'description')
      || childOf(el, 'summary')
      || childOf(el, 'content')
      || childOf(el, 'encoded');
    const guid =
      childOf(el, 'guid')
      || childOf(el, 'id')
      || linkHref
      || title;
    const pubDate = childOf(el, 'pubDate') || childOf(el, 'published') || childOf(el, 'updated');
    const description = stripHtml(descriptionRaw).slice(0, 2000);
    const link = (linkHref && linkHref.trim()) ? linkHref : (childOf(el, 'link') || undefined);

    if (!guid) continue;
    items.push({ guid, title, link, description, pubDate: pubDate || undefined });
  }

  return { feedTitle: channelTitle, items };
}