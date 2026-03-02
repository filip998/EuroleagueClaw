import type { NewsPort, NewsEntry } from '../../ports/news.port.js';
import type { Logger } from '../../shared/logger.js';

const ROTOWIRE_BASE = 'https://www.rotowire.com/euro/news.php';
const ROTOWIRE_INJURIES = `${ROTOWIRE_BASE}?view=injuries`;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  data: NewsEntry[];
  fetchedAt: number;
}

export class RotoWireAdapter implements NewsPort {
  private newsCache: CacheEntry | null = null;
  private injuryCache: CacheEntry | null = null;
  private cacheTtlMs = DEFAULT_CACHE_TTL_MS;

  constructor(private readonly logger: Logger) {}

  setCacheTtl(ttlMs: number): void {
    this.cacheTtlMs = ttlMs;
    this.logger.info({ ttlMs }, 'RotoWire cache TTL updated');
  }

  async getLatestNews(): Promise<NewsEntry[]> {
    return this.fetchWithCache('news', ROTOWIRE_BASE, this.newsCache, (c) => { this.newsCache = c; });
  }

  async getInjuryNews(): Promise<NewsEntry[]> {
    return this.fetchWithCache('injuries', ROTOWIRE_INJURIES, this.injuryCache, (c) => { this.injuryCache = c; });
  }

  private async fetchWithCache(
    label: string,
    url: string,
    cache: CacheEntry | null,
    setCache: (c: CacheEntry) => void,
  ): Promise<NewsEntry[]> {
    if (cache && Date.now() - cache.fetchedAt < this.cacheTtlMs) {
      return cache.data;
    }

    try {
      const html = await this.fetchPage(url);
      const entries = this.parseNews(html);
      const cacheEntry: CacheEntry = { data: entries, fetchedAt: Date.now() };
      setCache(cacheEntry);
      this.logger.info({ count: entries.length, type: label }, 'RotoWire news loaded');
      return entries;
    } catch (err) {
      this.logger.warn({ error: String(err), type: label }, 'Failed to fetch RotoWire news');
      return cache?.data ?? [];
    }
  }

  private async fetchPage(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`RotoWire returned ${response.status}`);
    }

    return response.text();
  }

  /** Parse news entries from RotoWire HTML using regex-based extraction. */
  parseNews(html: string): NewsEntry[] {
    const entries: NewsEntry[] = [];

    // Split by news-update blocks
    const blocks = html.split(/class="[^"]*news-update(?:\s|")/);

    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      const entry = this.parseBlock(block);
      if (entry) entries.push(entry);
    }

    return entries;
  }

  private parseBlock(block: string): NewsEntry | null {
    const playerName = this.extractField(block, 'news-update__player-link')
      ?? this.extractField(block, 'news-update__player');
    if (!playerName) return null;

    const headline = this.extractField(block, 'news-update__headline') ?? '';
    const date = this.extractField(block, 'news-update__timestamp') ?? '';
    const position = this.extractField(block, 'news-update__pos') ?? '';
    const injuryType = this.extractField(block, 'news-update__inj');
    const newsText = this.stripTags(this.extractField(block, 'news-update__news') ?? '').trim();

    const isInjury = !!injuryType;

    return {
      playerName: playerName.trim(),
      headline: headline.trim(),
      date: date.trim(),
      position: position.trim(),
      injuryType: injuryType?.trim(),
      newsText,
      isInjury,
    };
  }

  /** Extract text content from an element identified by its CSS class. */
  private extractField(html: string, className: string): string | null {
    // Match class="...className..." followed by > then content until next closing tag
    const pattern = new RegExp(
      `class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)(?:<\\/[a-z]+>)`,
      'i',
    );
    const match = html.match(pattern);
    if (!match) return null;

    const raw = match[1].trim();
    return raw.length > 0 ? raw : null;
  }

  private stripTags(text: string): string {
    return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
  }
}
