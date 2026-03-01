import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArenaSportAdapter } from '../../src/adapters/tv-schedule/arena-sport.adapter.js';

function createMockLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  } as any;
}

describe('ArenaSportAdapter', () => {
  let adapter: ArenaSportAdapter;

  beforeEach(() => {
    adapter = new ArenaSportAdapter(createMockLogger());
  });

  describe('parseSchedule — window.TV_SCHEMES JSON extraction', () => {
    it('should parse TV_SCHEMES JSON when present', () => {
      const html = `
        <html><head><script>
        window.TV_SCHEMES = [
          {"channel_name":"Arena Premium 1","title":"Evroliga: Partizan - Real Madrid","date":"2026-03-04","time":"20:30","category":"kosarka"},
          {"channel_name":"Arena Sport 2","title":"Fudbal: Premier Liga","date":"2026-03-04","time":"21:00","category":"fudbal"}
        ];
        </script></head></html>
      `;

      const entries = adapter.parseSchedule(html);
      expect(entries).toHaveLength(2);
      expect(entries[0].channelShort).toBe('ASP1');
      expect(entries[0].title).toContain('Partizan');
      expect(entries[0].date).toBe('2026-03-04');
      expect(entries[0].time).toBe('20:30');
    });

    it('should handle alternative JSON field names', () => {
      const html = `
        <script>window.TV_SCHEMES = [{"channelName":"Arena Sport 1","name":"Makabi - Barselona","date":"2026-03-05","start_time":"19:00:00","category":"Evroliga"}];</script>
      `;

      const entries = adapter.parseSchedule(html);
      expect(entries).toHaveLength(1);
      expect(entries[0].channelShort).toBe('AS1');
      expect(entries[0].title).toBe('Makabi - Barselona');
      expect(entries[0].time).toBe('19:00');
    });
  });

  describe('EuroLeague filtering', () => {
    it('should identify EuroLeague entries by keyword', async () => {
      const html = `
        <script>window.TV_SCHEMES = [
          {"channel_name":"Arena Premium 1","title":"Evroliga: Partizan - Real Madrid","date":"2026-03-04","time":"20:30","category":"kosarka"},
          {"channel_name":"Arena Sport 2","title":"Fudbal: Premier Liga","date":"2026-03-04","time":"21:00","category":"fudbal"},
          {"channel_name":"Arena Premium 2","title":"Euroleague: Barcelona - Olympiacos","date":"2026-03-04","time":"20:00","category":"kosarka"}
        ];</script>
      `;

      // We use parseSchedule to get all, then test the filtering by
      // mocking fetch to return our HTML
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(html),
      });
      vi.stubGlobal('fetch', fetchMock);

      const schedule = await adapter.getEuroLeagueSchedule();
      expect(schedule.length).toBe(2);
      expect(schedule[0].title).toContain('Partizan');
      expect(schedule[1].title).toContain('Barcelona');

      vi.unstubAllGlobals();
    });

    it('should identify EuroLeague entries by team names', async () => {
      const html = `
        <script>window.TV_SCHEMES = [
          {"channel_name":"Arena Premium 1","title":"Partizan - Makabi","date":"2026-03-04","time":"20:30","category":"kosarka"},
          {"channel_name":"Arena Sport 3","title":"Tenis: Roland Garros","date":"2026-03-04","time":"14:00","category":"tenis"}
        ];</script>
      `;

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(html),
      });
      vi.stubGlobal('fetch', fetchMock);

      const schedule = await adapter.getEuroLeagueSchedule();
      expect(schedule.length).toBe(1);
      expect(schedule[0].title).toContain('Partizan');

      vi.unstubAllGlobals();
    });
  });

  describe('live detection', () => {
    it('should detect live broadcasts from title', () => {
      const html = `
        <script>window.TV_SCHEMES = [
          {"channel_name":"Arena Premium 1","title":"Evroliga uživo: Partizan - Real","date":"2026-03-04","time":"20:30","category":""},
          {"channel_name":"Arena Premium 2","title":"Evroliga: Barcelona - Efes","date":"2026-03-04","time":"20:30","category":""}
        ];</script>
      `;

      const entries = adapter.parseSchedule(html);
      expect(entries[0].isLive).toBe(true);
      expect(entries[1].isLive).toBe(false);
    });

    it('should detect live from category', () => {
      const html = `
        <script>window.TV_SCHEMES = [
          {"channel_name":"Arena Premium 1","title":"Evroliga: Partizan - Bayern","date":"2026-03-04","time":"20:30","category":"LIVE prenos"}
        ];</script>
      `;

      const entries = adapter.parseSchedule(html);
      expect(entries[0].isLive).toBe(true);
    });
  });

  describe('channel short code mapping', () => {
    it('should map known channel names to short codes', () => {
      const html = `
        <script>window.TV_SCHEMES = [
          {"channel_name":"Arena Premium 1","title":"Test","date":"","time":"20:00","category":""},
          {"channel_name":"Arena Premium 2","title":"Test","date":"","time":"20:00","category":""},
          {"channel_name":"Arena Sport 1","title":"Test","date":"","time":"20:00","category":""},
          {"channel_name":"Arena Sport 3","title":"Test","date":"","time":"20:00","category":""}
        ];</script>
      `;

      const entries = adapter.parseSchedule(html);
      expect(entries[0].channelShort).toBe('ASP1');
      expect(entries[1].channelShort).toBe('ASP2');
      expect(entries[2].channelShort).toBe('AS1');
      expect(entries[3].channelShort).toBe('AS3');
    });
  });

  describe('date normalization', () => {
    it('should normalize DD.MM.YYYY dates', () => {
      const html = `
        <script>window.TV_SCHEMES = [
          {"channel_name":"Arena Premium 1","title":"Test","date":"04.03.2026","time":"20:00","category":""}
        ];</script>
      `;

      const entries = adapter.parseSchedule(html);
      expect(entries[0].date).toBe('2026-03-04');
    });

    it('should pass through ISO dates', () => {
      const html = `
        <script>window.TV_SCHEMES = [
          {"channel_name":"Arena Premium 1","title":"Test","date":"2026-03-04","time":"20:00","category":""}
        ];</script>
      `;

      const entries = adapter.parseSchedule(html);
      expect(entries[0].date).toBe('2026-03-04');
    });
  });

  describe('graceful degradation', () => {
    it('should return empty array on fetch failure', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', fetchMock);

      const schedule = await adapter.getEuroLeagueSchedule();
      expect(schedule).toEqual([]);

      vi.unstubAllGlobals();
    });

    it('should return empty array on non-OK response', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      vi.stubGlobal('fetch', fetchMock);

      const schedule = await adapter.getEuroLeagueSchedule();
      expect(schedule).toEqual([]);

      vi.unstubAllGlobals();
    });

    it('should use cached data on subsequent fetch failure', async () => {
      // First call succeeds
      const html = `<script>window.TV_SCHEMES = [{"channel_name":"Arena Premium 1","title":"Evroliga: Partizan - Real","date":"2026-03-04","time":"20:30","category":""}];</script>`;
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(html) })
        .mockRejectedValueOnce(new Error('Network error'));
      vi.stubGlobal('fetch', fetchMock);

      const first = await adapter.getEuroLeagueSchedule();
      expect(first).toHaveLength(1);

      // Force cache expiry by manipulating adapter internals
      (adapter as any).cache.fetchedAt = 0;

      const second = await adapter.getEuroLeagueSchedule();
      expect(second).toHaveLength(1); // Returns stale cache

      vi.unstubAllGlobals();
    });
  });

  describe('caching', () => {
    it('should cache results for 1 hour', async () => {
      const html = `<script>window.TV_SCHEMES = [{"channel_name":"Arena Premium 1","title":"Evroliga: Partizan - Real","date":"2026-03-04","time":"20:30","category":""}];</script>`;
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(html),
      });
      vi.stubGlobal('fetch', fetchMock);

      await adapter.getEuroLeagueSchedule();
      await adapter.getEuroLeagueSchedule();

      // Should only fetch once due to cache
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });
  });
});
