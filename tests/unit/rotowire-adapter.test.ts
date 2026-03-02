import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RotoWireAdapter } from '../../src/adapters/rotowire/rotowire.adapter.js';
import type { Logger } from '../../src/shared/logger.js';

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

/** Build a fake RotoWire HTML page containing news-update blocks. */
function buildHtml(blocks: string[]): string {
  const body = blocks.join('\n');
  return `<html><body>${body}</body></html>`;
}

function newsBlock(opts: {
  player: string;
  headline?: string;
  date?: string;
  position?: string;
  injuryType?: string;
  newsText?: string;
  extraClass?: string;
}): string {
  const cls = opts.extraClass ? `news-update ${opts.extraClass}` : 'news-update';
  const injuryTag = opts.injuryType
    ? `<span class="news-update__inj">${opts.injuryType}</span>`
    : '';
  return `
    <div class="${cls}">
      <a class="news-update__player-link">${opts.player}</a>
      <div class="news-update__headline">${opts.headline ?? 'Some headline'}</div>
      <span class="news-update__timestamp">${opts.date ?? 'Jun 18, 2025'}</span>
      <span class="news-update__pos">${opts.position ?? 'G'}</span>
      ${injuryTag}
      <div class="news-update__news">${opts.newsText ?? 'Player update text.'}</div>
    </div>`;
}

describe('RotoWireAdapter', () => {
  let adapter: RotoWireAdapter;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    adapter = new RotoWireAdapter(logger);
  });

  describe('parseNews', () => {
    it('should extract player name, headline, date, position, and news text', () => {
      const html = buildHtml([
        newsBlock({
          player: 'Nikola Jovic',
          headline: 'Expected to start Friday',
          date: 'Jul 18, 2025',
          position: 'F',
          newsText: 'Jovic will start at forward.',
        }),
      ]);

      const entries = adapter.parseNews(html);

      expect(entries).toHaveLength(1);
      expect(entries[0].playerName).toBe('Nikola Jovic');
      expect(entries[0].headline).toBe('Expected to start Friday');
      expect(entries[0].date).toBe('Jul 18, 2025');
      expect(entries[0].position).toBe('F');
      expect(entries[0].newsText).toBe('Jovic will start at forward.');
    });

    it('should parse multiple news blocks', () => {
      const html = buildHtml([
        newsBlock({ player: 'Player One' }),
        newsBlock({ player: 'Player Two' }),
        newsBlock({ player: 'Player Three' }),
      ]);

      const entries = adapter.parseNews(html);
      expect(entries).toHaveLength(3);
      expect(entries.map((e) => e.playerName)).toEqual([
        'Player One',
        'Player Two',
        'Player Three',
      ]);
    });

    it('should handle empty HTML gracefully', () => {
      const entries = adapter.parseNews('');
      expect(entries).toEqual([]);
    });

    it('should handle HTML with no news-update blocks', () => {
      const html = '<html><body><div class="other-content">Nothing here</div></body></html>';
      const entries = adapter.parseNews(html);
      expect(entries).toEqual([]);
    });

    it('should mark entries with injuryType as isInjury: true', () => {
      const html = buildHtml([
        newsBlock({ player: 'Injured Player', injuryType: 'Knee' }),
      ]);

      const entries = adapter.parseNews(html);
      expect(entries).toHaveLength(1);
      expect(entries[0].isInjury).toBe(true);
      expect(entries[0].injuryType).toBe('Knee');
    });

    it('should set isInjury: false when no injuryType present', () => {
      const html = buildHtml([
        newsBlock({ player: 'Healthy Player' }),
      ]);

      const entries = adapter.parseNews(html);
      expect(entries).toHaveLength(1);
      expect(entries[0].isInjury).toBe(false);
      expect(entries[0].injuryType).toBeUndefined();
    });

    it('should strip HTML tags from news text', () => {
      // extractField regex captures up to first closing tag, then stripTags removes inline tags
      const html = buildHtml([
        newsBlock({
          player: 'Tagged Player',
          newsText: '<b>Breaking news</b>',
        }),
      ]);

      const entries = adapter.parseNews(html);
      // The regex captures "<b>Breaking news" up to </b>, then stripTags removes <b>
      expect(entries[0].newsText).toBe('Breaking news');
      expect(entries[0].newsText).not.toContain('<');
      expect(entries[0].newsText).not.toContain('>');
    });

    it('should trim whitespace from extracted fields', () => {
      const html = buildHtml([
        newsBlock({
          player: '  Spaced Player  ',
          headline: '  Headline with spaces  ',
          date: '  Jul 18, 2025  ',
          position: '  C  ',
        }),
      ]);

      const entries = adapter.parseNews(html);
      expect(entries[0].playerName).toBe('Spaced Player');
      expect(entries[0].headline).toBe('Headline with spaces');
      expect(entries[0].date).toBe('Jul 18, 2025');
      expect(entries[0].position).toBe('C');
    });

    it('should handle block with news-update__player fallback (no player-link)', () => {
      const html = `<html><body>
        <div class="news-update">
          <span class="news-update__player">Fallback Player</span>
          <div class="news-update__headline">Update</div>
          <span class="news-update__timestamp">Jul 18, 2025</span>
          <span class="news-update__pos">G</span>
          <div class="news-update__news">Some news.</div>
        </div>
      </body></html>`;

      const entries = adapter.parseNews(html);
      expect(entries).toHaveLength(1);
      expect(entries[0].playerName).toBe('Fallback Player');
    });

    it('should skip blocks without a player name', () => {
      const html = `<html><body>
        <div class="news-update">
          <div class="news-update__headline">Orphan headline</div>
          <span class="news-update__timestamp">Jul 18, 2025</span>
          <span class="news-update__pos">G</span>
          <div class="news-update__news">No player here.</div>
        </div>
      </body></html>`;

      const entries = adapter.parseNews(html);
      expect(entries).toEqual([]);
    });
  });

  describe('caching', () => {
    it('should return cached data on second call within TTL', async () => {
      const html = buildHtml([newsBlock({ player: 'Cached Player' })]);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(html),
      }));

      const first = await adapter.getLatestNews();
      const second = await adapter.getLatestNews();

      expect(first).toEqual(second);
      expect(fetch).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });

    it('should have separate caches for news and injuries', async () => {
      const newsHtml = buildHtml([newsBlock({ player: 'News Player' })]);
      const injuryHtml = buildHtml([newsBlock({ player: 'Injury Player', injuryType: 'Ankle' })]);

      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
        callCount++;
        const html = callCount === 1 ? newsHtml : injuryHtml;
        return Promise.resolve({ ok: true, text: () => Promise.resolve(html) });
      }));

      const news = await adapter.getLatestNews();
      const injuries = await adapter.getInjuryNews();

      expect(news[0].playerName).toBe('News Player');
      expect(injuries[0].playerName).toBe('Injury Player');
      expect(fetch).toHaveBeenCalledTimes(2);

      vi.unstubAllGlobals();
    });

    it('should default to 1-hour TTL', async () => {
      const html = buildHtml([newsBlock({ player: 'TTL Player' })]);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(html),
      }));

      vi.useFakeTimers();
      await adapter.getLatestNews();

      // At 59 minutes, cache is still valid
      vi.advanceTimersByTime(59 * 60 * 1000);
      await adapter.getLatestNews();
      expect(fetch).toHaveBeenCalledTimes(1);

      // At 61 minutes, cache has expired
      vi.advanceTimersByTime(2 * 60 * 1000);
      await adapter.getLatestNews();
      expect(fetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('should respect custom TTL set via setCacheTtl()', async () => {
      const html = buildHtml([newsBlock({ player: 'Short TTL' })]);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(html),
      }));

      adapter.setCacheTtl(4 * 60 * 1000); // 4 min

      vi.useFakeTimers();
      await adapter.getLatestNews();

      // At 3 min, cache is still valid
      vi.advanceTimersByTime(3 * 60 * 1000);
      await adapter.getLatestNews();
      expect(fetch).toHaveBeenCalledTimes(1);

      // At 5 min total, cache has expired
      vi.advanceTimersByTime(2 * 60 * 1000);
      await adapter.getLatestNews();
      expect(fetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('should expire cache after 25 min when setCacheTtl(25min)', async () => {
      const html = buildHtml([newsBlock({ player: 'Med TTL' })]);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(html),
      }));

      adapter.setCacheTtl(25 * 60 * 1000); // 25 min

      vi.useFakeTimers();
      await adapter.getLatestNews();

      // At 24 min, still cached
      vi.advanceTimersByTime(24 * 60 * 1000);
      await adapter.getLatestNews();
      expect(fetch).toHaveBeenCalledTimes(1);

      // At 26 min total, expired
      vi.advanceTimersByTime(2 * 60 * 1000);
      await adapter.getLatestNews();
      expect(fetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('setCacheTtl() logs the new TTL value', () => {
      adapter.setCacheTtl(120000);
      expect(logger.info).toHaveBeenCalledWith({ ttlMs: 120000 }, 'RotoWire cache TTL updated');
    });

    it('should return stale cache on fetch error', async () => {
      const html = buildHtml([newsBlock({ player: 'Stale Player' })]);

      // First call succeeds
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(html) })
        .mockRejectedValueOnce(new Error('Network error')),
      );

      const first = await adapter.getLatestNews();
      expect(first).toHaveLength(1);

      // Force cache expiry by advancing time
      vi.useFakeTimers();
      vi.advanceTimersByTime(61 * 60 * 1000); // past 1-hour TTL

      const second = await adapter.getLatestNews();
      expect(second).toHaveLength(1);
      expect(second[0].playerName).toBe('Stale Player');

      vi.useRealTimers();
      vi.unstubAllGlobals();
    });
  });
});
