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
        window.TV_SCHEMES = {
          "Arena Premium 1": {
            "days": {
              "2026-03-04": {
                "emisije": [
                  { "content": "Partizan - Real Madrid", "time": "20:30", "category": "EVROLIGA", "description": "uzivo" }
                ]
              }
            }
          },
          "Arena Sport 2": {
            "days": {
              "2026-03-04": {
                "emisije": [
                  { "content": "Fudbal: Premier Liga", "time": "21:00", "category": "fudbal", "description": "snimak" }
                ]
              }
            }
          }
        };
        </script></head></html>
      `;

      const entries = adapter.parseSchedule(html);
      expect(entries).toHaveLength(2);
      expect(entries[0].channelShort).toBe('ASP1');
      expect(entries[0].title).toContain('Partizan');
      expect(entries[0].date).toBe('2026-03-04');
      expect(entries[0].time).toBe('20:30');
    });

    it('should parse single emisija entry correctly', () => {
      const html = `
        <script>window.TV_SCHEMES = {"Arena Sport 1":{"days":{"2026-03-05":{"emisije":[{"content":"Makabi - Barselona","time":"19:00","category":"kosarka","description":"uzivo"}]}}}};</script>
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
        <script>window.TV_SCHEMES = {
          "Arena Premium 1":{"days":{"2026-03-04":{"emisije":[{"content":"Partizan - Real Madrid","time":"20:30","category":"EVROLIGA","description":"uzivo"}]}}},
          "Arena Sport 2":{"days":{"2026-03-04":{"emisije":[{"content":"Fudbal: Premier Liga","time":"21:00","category":"fudbal","description":"snimak"}]}}},
          "Arena Premium 2":{"days":{"2026-03-04":{"emisije":[{"content":"Barcelona - Olympiacos","time":"20:00","category":"EVROLIGA","description":"uzivo"}]}}}
        };</script>
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
        <script>window.TV_SCHEMES = {
          "Arena Premium 1":{"days":{"2026-03-04":{"emisije":[{"content":"Partizan - Makabi","time":"20:30","category":"kosarka","description":"uzivo"}]}}},
          "Arena Sport 3":{"days":{"2026-03-04":{"emisije":[{"content":"Tenis: Roland Garros","time":"14:00","category":"tenis","description":"snimak"}]}}}
        };</script>
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
    it('should detect live broadcasts from description field', () => {
      const html = `
        <script>window.TV_SCHEMES = {
          "Arena Premium 1":{"days":{"2026-03-04":{"emisije":[{"content":"Partizan - Real","time":"20:30","category":"EVROLIGA","description":"uzivo"}]}}},
          "Arena Premium 2":{"days":{"2026-03-04":{"emisije":[{"content":"Barcelona - Efes","time":"20:30","category":"EVROLIGA","description":"snimak"}]}}}
        };</script>
      `;

      const entries = adapter.parseSchedule(html);
      expect(entries[0].isLive).toBe(true);
      expect(entries[1].isLive).toBe(false);
    });

    it('should detect uživo description as live', () => {
      const html = `
        <script>window.TV_SCHEMES = {
          "Arena Premium 1":{"days":{"2026-03-04":{"emisije":[{"content":"Partizan - Bayern","time":"20:30","category":"EVROLIGA","description":"uživo"}]}}}
        };</script>
      `;

      const entries = adapter.parseSchedule(html);
      expect(entries[0].isLive).toBe(true);
    });
  });

  describe('channel short code mapping', () => {
    it('should map known channel names to short codes', () => {
      const html = `
        <script>window.TV_SCHEMES = {
          "Arena Premium 1":{"days":{"2026-03-04":{"emisije":[{"content":"Test","time":"20:00","category":"","description":""}]}}},
          "Arena Premium 2":{"days":{"2026-03-04":{"emisije":[{"content":"Test","time":"20:00","category":"","description":""}]}}},
          "Arena Sport 1":{"days":{"2026-03-04":{"emisije":[{"content":"Test","time":"20:00","category":"","description":""}]}}},
          "Arena Sport 3":{"days":{"2026-03-04":{"emisije":[{"content":"Test","time":"20:00","category":"","description":""}]}}}
        };</script>
      `;

      const entries = adapter.parseSchedule(html);
      expect(entries[0].channelShort).toBe('ASP1');
      expect(entries[1].channelShort).toBe('ASP2');
      expect(entries[2].channelShort).toBe('AS1');
      expect(entries[3].channelShort).toBe('AS3');
    });
  });

  describe('date extraction', () => {
    it('should extract date from day key', () => {
      const html = `
        <script>window.TV_SCHEMES = {
          "Arena Premium 1":{"days":{"2026-03-04":{"emisije":[{"content":"Test","time":"20:00","category":"","description":""}]}}}
        };</script>
      `;

      const entries = adapter.parseSchedule(html);
      expect(entries[0].date).toBe('2026-03-04');
    });

    it('should handle multiple days per channel', () => {
      const html = `
        <script>window.TV_SCHEMES = {
          "Arena Premium 1":{"days":{"2026-03-04":{"emisije":[{"content":"Test","time":"20:00","category":"","description":""}]},"2026-03-05":{"emisije":[{"content":"Test 2","time":"21:00","category":"","description":""}]}}}
        };</script>
      `;

      const entries = adapter.parseSchedule(html);
      expect(entries).toHaveLength(2);
      expect(entries[0].date).toBe('2026-03-04');
      expect(entries[1].date).toBe('2026-03-05');
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
      const html = `<script>window.TV_SCHEMES = {"Arena Premium 1":{"days":{"2026-03-04":{"emisije":[{"content":"Partizan - Real","time":"20:30","category":"EVROLIGA","description":"uzivo"}]}}}};</script>`;
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
      const html = `<script>window.TV_SCHEMES = {"Arena Premium 1":{"days":{"2026-03-04":{"emisije":[{"content":"Partizan - Real","time":"20:30","category":"EVROLIGA","description":"uzivo"}]}}}};</script>`;
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
